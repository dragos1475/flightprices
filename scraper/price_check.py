"""
„Preț la companie”: la cerere, pentru UN zbor ales în aplicație, aflăm opțiunile de rezervare
(ca în Google Flights → „Booking options”) și separăm prețul vândut direct de companie de agenții
(Kiwi, eDreams, Gotogate etc.).

Cum funcționează:
  1. Aplicația scrie data/prices/<id>.json (status "pending"), semnat cu parola de căutare
     (aceeași semnătură ca la căutarea rapidă: parola NU apare în fișier).
  2. Aici verificăm semnătura, apoi:
       - dus-întors: departure_token -> zborurile de întoarcere (1 credit) -> alegem întoarcerea
         cea mai ieftină -> booking_token -> opțiunile de rezervare (1 credit)
       - dus-întors, când întoarcerea e deja cunoscută (detaliile întoarcerii din căutare):
         direct booking_token-ul ei -> opțiunile de rezervare (1 credit); dacă jetonul a expirat,
         revenim la varianta de mai sus (încă 1 credit)
       - doar dus: booking_token -> opțiunile de rezervare (1 credit)
  3. Rezultatul se scrie în același fișier (status "done") și în data/prices/index.json.
Nimic nu se face automat: doar când utilizatorul apasă „Preț la companie”.
"""
import json
from datetime import datetime, timedelta

from .config import now, read_json, write_json
from .one_time import MAX_AGE, signature_ok
from .serpapi_client import SearchError, is_no_results, parse_response, strip_private

KEEP_LAST = 100


def prices_dir(storage):
    return storage.data_dir / "prices"


def pending(storage):
    folder = prices_dir(storage)
    if not folder.exists():
        return []
    items = []
    for path in sorted(folder.glob("*.json")):
        if path.name == "index.json":
            continue
        doc = read_json(path, default=None) or {}
        if doc.get("status") == "pending":
            items.append((path, doc))
    return items


def parse_booking_options(data):
    """Opțiunile de rezervare, simplificate. airline=True înseamnă vândut direct de companie."""
    options = []
    for opt in data.get("booking_options", []) or []:
        separate = bool(opt.get("separate_tickets"))
        parts = [opt.get("departing"), opt.get("returning")] if separate else [opt.get("together")]
        parts = [p for p in parts if p]
        if not parts:
            continue
        main = parts[0]
        prices = [p.get("price") for p in parts]
        request = main.get("booking_request") or {}
        options.append({
            "book_with": " + ".join(dict.fromkeys(p.get("book_with", "") for p in parts)),
            "airline": all(bool(p.get("airline")) for p in parts),
            "price": sum(prices) if all(isinstance(x, (int, float)) for x in prices) else None,
            "separate_tickets": separate,
            "option_title": main.get("option_title", ""),
            "logos": main.get("airline_logos", []) or [],
            "marketed_as": main.get("marketed_as", []) or [],
            "baggage": main.get("baggage_prices", []) or [],
            "extensions": (main.get("extensions") or [])[:4],
            "booking_url": request.get("url", ""),
            "booking_post": request.get("post_data", ""),
        })
    options.sort(key=lambda o: (o["price"] is None, o["price"] or 0))
    return options


def _booking_options(client, params, booking_token, credits):
    """Opțiunile de rezervare pentru un booking_token (1 credit)."""
    data = client.search({**params, "booking_token": booking_token})
    credits.use()
    if data.get("error") and not is_no_results(data):
        raise SearchError(data["error"])
    return parse_booking_options(data)


def process(storage, client, credits, settings, state):
    """Procesează cererile „Preț la companie”. Întoarce lista de erori (pentru status)."""
    items = pending(storage)
    if not items:
        return []
    import os
    password = os.environ.get("SEARCH_PASSWORD", "")
    done_ids = state.setdefault("prices_done", [])
    errors = []
    print(f"\nVerificări „preț la companie” în așteptare: {len(items)}")

    for path, doc in items:
        pid = path.stem
        doc["processed_at"] = now().isoformat(timespec="seconds")

        def reject(message):
            doc.update(status="rejected", message=message)
            write_json(path, doc)
            print(f"  ⛔ {pid}: {message}")

        text = doc.get("request", "")
        if not password:
            reject("Secretul SEARCH_PASSWORD nu este setat în GitHub. Nu s-a consumat niciun credit.")
            continue
        if not signature_ok(pid, text, doc.get("sig"), password):
            reject("Parolă greșită. Nu s-a consumat niciun credit.")
            continue
        try:
            req = json.loads(text)
            created = datetime.fromisoformat(req.get("created_at", "").replace("Z", "+00:00"))
        except ValueError:
            reject("Cerere invalidă.")
            continue
        if req.get("id") != pid or pid in done_ids:
            reject("Cerere invalidă sau deja procesată.")
            continue
        if now() - created > MAX_AGE or created - now() > timedelta(minutes=10):
            reject("Cererea a expirat. Apasă din nou „Preț la companie”.")
            continue
        params = req.get("search_params") or {}
        booking_token = req.get("booking_token")
        departure_token = req.get("departure_token")
        needed = 1 if booking_token else 2
        if not params or not (booking_token or departure_token):
            reject("Lipsesc datele zborului. Caută din nou ruta și încearcă pe un rezultat nou.")
            continue
        if not credits.enough(needed):
            reject(f"Credite SerpApi insuficiente: necesare {needed}, rămase {credits.left}.")
            continue

        label = f"{pid} {' '.join(req.get('flight_numbers', []))}"
        result = {"currency": params.get("currency", "EUR"), "return_flight": req.get("return_flight")}
        try:
            options = None
            if booking_token:
                # jetonul deja cunoscut (doar dus, sau întoarcerea salvată la căutare): 1 credit
                try:
                    options = _booking_options(client, params, booking_token, credits)
                except SearchError as e:
                    print(f"  {label}: jetonul salvat nu a mers ({e})")
                    if not departure_token:
                        raise
            if not options and departure_token and credits.enough(2):
                # dus-întors: alegem întoarcerea cea mai ieftină pentru zborul de dus ales (+2 credite)
                if booking_token:
                    print(f"  {label}: reîncerc cu zborurile de întoarcere")
                data = client.search({**params, "departure_token": departure_token})
                credits.use()
                returning = [] if is_no_results(data) else parse_response(data)["flights"]
                if not returning:
                    raise SearchError("Google nu mai are zboruri de întoarcere pentru acest zbor. Caută din nou ruta.")
                chosen = returning[0]
                result["return_flight"] = strip_private({k: v for k, v in chosen.items()
                                                         if k not in ("departure_token", "booking_token")})
                if not chosen.get("booking_token"):
                    raise SearchError("Google nu oferă opțiuni de rezervare pentru acest zbor.")
                options = _booking_options(client, params, chosen["booking_token"], credits)
            if options is None:
                raise SearchError("Nu am putut obține opțiunile de rezervare. Caută din nou ruta.")
        except SearchError as e:
            reject(f"{e}")
            errors.append({"alert_id": pid, "combination": label, "message": str(e)})
            continue

        airline_opts = [o for o in options if o["airline"] and o["price"] is not None]
        agency_opts = [o for o in options if not o["airline"] and o["price"] is not None]
        result.update({
            "options": options,
            "airline_price": airline_opts[0]["price"] if airline_opts else None,
            "airline_name": airline_opts[0]["book_with"] if airline_opts else None,
            "cheapest_agency_price": agency_opts[0]["price"] if agency_opts else None,
            "cheapest_agency": agency_opts[0]["book_with"] if agency_opts else None,
        })
        doc.update(status="done", message=None, result=result)
        write_json(path, doc)
        done_ids.append(pid)
        del done_ids[:-300]
        print(f"  💶 {label}: companie {result['airline_price']} ({result['airline_name']}), "
              f"agenție {result['cheapest_agency_price']} ({result['cheapest_agency']})")

    write_index(storage)
    return errors


def write_index(storage):
    """data/prices/index.json: rezumatul verificărilor (ultimele KEEP_LAST), citit de aplicație."""
    folder = prices_dir(storage)
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
        res = doc.get("result") or {}
        index.append({
            "id": path.stem,
            "flight_key": req.get("flight_key"),
            "created_at": created,
            "processed_at": doc.get("processed_at"),
            "status": doc.get("status"),
            "message": doc.get("message"),
            "currency": res.get("currency"),
            "airline_price": res.get("airline_price"),
            "airline_name": res.get("airline_name"),
            "cheapest_agency_price": res.get("cheapest_agency_price"),
            "cheapest_agency": res.get("cheapest_agency"),
        })
    write_json(folder / "index.json", {"prices": index})
