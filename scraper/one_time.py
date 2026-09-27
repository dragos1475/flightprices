"""
Căutări rapide (one-time), pornite din aplicație cu butonul „Caută acum”.

Cum funcționează:
  1. Aplicația scrie fișierul data/searches/<id>.json cu status "pending".
     Fișierul conține cererea (text JSON) și o SEMNĂTURĂ calculată din parolă.
     Parola NU apare în fișier (repository-ul e public).
  2. Workflow-ul pornește automat, iar acest modul verifică semnătura cu secretul
     SEARCH_PASSWORD. Dacă parola e greșită, nu se consumă niciun credit.
  3. Rezultatele se scriu în același fișier (status "done") și primești o notificare.

Semnătura: HMAC-SHA256(cheie, text_cerere), unde
  cheie = PBKDF2-SHA256(parola, "zboruri:<id>", 200000 iterații, 32 octeți).
Aceeași formulă este în aplicație (js/data.js, signSearch).
"""
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta

from . import alerts as A
from .config import now, read_json, write_json
from .notify import combo_text, flight_line
from .search import new_entry, search_combination

KDF_ITERATIONS = 200_000
MAX_AGE = timedelta(minutes=90)   # o cerere mai veche nu se mai execută (anti-refolosire)
KEEP_LAST = 30                    # câte căutări păstrăm în istoric


def _key(password, search_id):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
                               f"zboruri:{search_id}".encode("utf-8"), KDF_ITERATIONS, dklen=32)


def signature_ok(search_id, request_text, sig, password):
    expected = hmac.new(_key(password, search_id), request_text.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, str(sig or ""))


def searches_dir(storage):
    return storage.data_dir / "searches"


def pending(storage):
    """Toate căutările care așteaptă să fie procesate: [(cale, document)]."""
    folder = searches_dir(storage)
    if not folder.exists():
        return []
    result = []
    for path in sorted(folder.glob("*.json")):
        if path.name == "index.json":
            continue
        doc = read_json(path, default=None) or {}
        if doc.get("status") == "pending":
            result.append((path, doc))
    return result


def _title(req):
    deps = ",".join(req.get("departure_airports", []))
    dest = (req.get("destination") or {}).get("name", "?")
    return req.get("title") or f"{deps} → {dest}"


def process(storage, client, credits, notifier, settings, day, state, app_link):
    """Procesează toate căutările rapide în așteptare. Întoarce lista de erori (pentru status)."""
    items = pending(storage)
    if not items:
        if searches_dir(storage).exists():
            _prune_and_index(storage)  # ține index.json la zi (ex. după ștergeri din aplicație)
        return []
    print(f"\nCăutări rapide în așteptare: {len(items)}")
    password = os.environ.get("SEARCH_PASSWORD", "")
    max_searches = int(settings.get("one_time_max_searches", 20))
    reserve = int(settings.get("search_reserve", 5))
    done_ids = state.setdefault("one_time_done", [])
    errors = []

    for path, doc in items:
        sid = path.stem
        doc["processed_at"] = now().isoformat(timespec="seconds")

        def reject(message):
            doc.update(status="rejected", message=message)
            write_json(path, doc)
            print(f"  ⛔ {sid}: {message}")

        # 1) Verificarea parolei (înainte de orice consum de credite)
        if not password:
            reject("Secretul SEARCH_PASSWORD nu este setat în GitHub. Nu s-a consumat niciun credit.")
            continue
        request_text = doc.get("request", "")
        if not signature_ok(sid, request_text, doc.get("sig"), password):
            reject("Parolă greșită. Nu s-a consumat niciun credit.")
            continue
        try:
            req = json.loads(request_text)
        except ValueError:
            reject("Cerere invalidă.")
            continue
        if req.get("id") != sid:
            reject("Cerere invalidă (id diferit).")
            continue
        if sid in done_ids:
            reject("Această cerere a fost deja procesată.")
            continue
        try:
            created = datetime.fromisoformat(req.get("created_at", "").replace("Z", "+00:00"))
        except ValueError:
            reject("Cerere invalidă (dată lipsă).")
            continue
        if now() - created > MAX_AGE or created - now() > timedelta(minutes=10):
            reject("Cererea a expirat. Pornește căutarea din nou din aplicație.")
            continue

        # 2) Validare și cost
        problems = A.validate({**req, "id": sid})
        if problems:
            reject("Cerere incompletă: " + ", ".join(problems))
            continue
        combos = A.combinations(req, day)
        if not combos:
            reject("Toate datele de plecare au trecut.")
            continue
        if len(combos) > max_searches:
            reject(f"Prea multe combinații ({len(combos)}). Maximul pentru o căutare rapidă este {max_searches}.")
            continue
        if not credits.enough(len(combos)):
            reject(f"Credite SerpApi insuficiente: necesare {len(combos)}, rămase {credits.left}.")
            continue

        # 3) Căutarea
        print(f"  🔎 {sid}: {_title(req)} · {len(combos)} combinații")
        max_price = float(req["max_price"]) if req.get("max_price") else None
        want_return = "always" if req.get("return_details") else False
        combos_out = []
        fatal = None
        for combo in combos:
            params = A.search_params(req, combo)
            entry = new_entry(combo, params, A.search_key(params), day)
            label = f"{sid} {A.combo_label(combo)}"
            if fatal:
                entry.update(status="error", error=f"Sărită: {fatal}")
            else:
                err = search_combination(client, params, entry, credits, return_details=want_return,
                                         max_price=max_price, reserve=reserve, label=label)
                if err:
                    errors.append({"alert_id": sid, "combination": label, "message": str(err)})
                    if err.fatal:
                        fatal = str(err)
            combos_out.append(entry)

        prices = [c["lowest_price"] for c in combos_out if c.get("lowest_price") is not None]
        doc.update(status="done", message=None, results={
            "currency": req.get("currency", "EUR"),
            "max_price": max_price,
            "lowest_price": min(prices) if prices else None,
            "combinations": combos_out,
        })
        write_json(path, doc)
        done_ids.append(sid)
        del done_ids[:-200]

        _notify(notifier, sid, req, doc["results"], app_link)

    _prune_and_index(storage)
    return errors


def _notify(notifier, sid, req, results, app_link):
    cur = results["currency"]
    combos = sorted([c for c in results["combinations"] if c.get("lowest_price") is not None],
                    key=lambda c: c["lowest_price"])
    app = f"{app_link}#/cautare/{sid}" if app_link else ""
    if not combos:
        notifier.send(f"🔎 {_title(req)}: niciun zbor găsit", "Nu am găsit zboruri pentru combinațiile cerute.",
                      app_url=app, tags=["mag"])
        return
    best = combos[0]
    lines = []
    for c in combos[:6]:
        f = c["flights"][0] if c.get("flights") else {}
        lines.append(f"{combo_text(c)}: {c['lowest_price']} {cur}")
        if f:
            lines.append(f"   {flight_line(f)}")
    if len(combos) > 6:
        lines.append(f"… și încă {len(combos) - 6} combinații în aplicație")
    notifier.send(f"🔎 {_title(req)}: de la {best['lowest_price']} {cur}", "\n".join(lines),
                  url=best.get("google_flights_url", ""), app_url=app, tags=["mag"], priority=4)


def _prune_and_index(storage):
    """Păstrează ultimele KEEP_LAST căutări și scrie data/searches/index.json (pentru aplicație)."""
    folder = searches_dir(storage)
    docs = []
    for path in folder.glob("*.json"):
        if path.name == "index.json":
            continue
        doc = read_json(path, default=None) or {}
        try:
            req = json.loads(doc.get("request") or "{}")
        except ValueError:
            req = {}
        docs.append((doc.get("created_at") or req.get("created_at") or "", path, doc, req))
    docs.sort(key=lambda x: x[0], reverse=True)
    for _, path, _, _ in docs[KEEP_LAST:]:
        path.unlink()
    index = []
    for created, path, doc, req in docs[:KEEP_LAST]:
        res = doc.get("results") or {}
        index.append({
            "id": path.stem,
            "title": _title(req) if req else path.stem,
            "created_at": created,
            "status": doc.get("status"),
            "message": doc.get("message"),
            "lowest_price": res.get("lowest_price"),
            "currency": res.get("currency") or req.get("currency"),
            "departures": req.get("departures", []),
            "destination": req.get("destination"),
        })
    write_json(folder / "index.json", {"searches": index})
