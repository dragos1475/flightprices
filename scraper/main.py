"""
Punctul de pornire al căutării zilnice.

Rulare normală (în GitHub Actions):
    python -m scraper.main

Test fără să consumi căutări (răspunsuri salvate local):
    python -m scraper.main --dry-run --alerts scraper/fixtures/alerts_example.json

Opțiuni utile:
    --force               caută din nou chiar dacă s-a căutat deja azi
    --today 2026-11-01    simulează altă dată (doar pentru teste)
    --send-notifications  la --dry-run, trimite totuși notificările (test canale)
    --save-responses      salvează răspunsurile SerpApi reale pentru --dry-run ulterior
    --test-notification   trimite doar o notificare de test (verifică secretele de notificare)
"""
import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

from . import alerts as A
from . import one_time, price_check
from .config import DATA_DIR, FIXTURES_DIR, ROOT, TIMEZONE, app_url, load_settings, now, read_json, today, write_json
from .notify import Notifier, alert_summary
from .search import Credits, new_entry, search_combination
from .serpapi_client import FakeSerpApiClient, SearchError, SerpApiClient
from .storage import Storage


def parse_args():
    p = argparse.ArgumentParser(description="Monitor prețuri zboruri (SerpApi Google Flights)")
    p.add_argument("--dry-run", action="store_true", help="folosește răspunsuri salvate local, fără credite")
    p.add_argument("--alerts", default=str(DATA_DIR / "alerts.json"), help="fișierul cu alerte")
    p.add_argument("--output-dir", default=None, help="unde se scriu rezultatele (implicit: data/, sau dry-run-output/ la --dry-run)")
    p.add_argument("--force", action="store_true", help="caută din nou și combinațiile deja căutate azi")
    p.add_argument("--today", default=None, help="simulează altă dată AAAA-LL-ZZ (teste)")
    p.add_argument("--send-notifications", action="store_true", help="la --dry-run: trimite notificările pe bune")
    p.add_argument("--save-responses", action="store_true", help="salvează răspunsurile SerpApi în scraper/fixtures/recorded/")
    p.add_argument("--hour", type=int, default=None, help="(teste) simulează ora din România (0-23)")
    p.add_argument("--test-notification", action="store_true", help="trimite doar o notificare de test și se oprește")
    p.add_argument("--trigger", default=os.environ.get("GITHUB_EVENT_NAME", "manual"), help="(informativ) ce a pornit rularea")
    return p.parse_args()


def searched_hour(entry):
    """Ora (în România) la care a fost căutată o combinație, din câmpul searched_at."""
    try:
        return datetime.fromisoformat(entry["searched_at"]).astimezone(TIMEZONE).hour
    except (KeyError, TypeError, ValueError):
        return -1


def plan_searches(alert_list, previous, day, force, hour):
    """
    Decide ce combinații trebuie căutate acum (workflow-ul rulează în fiecare oră).
    Fiecare alertă are orele ei (ex. 08:00 și 20:00). O combinație se caută dacă:
      - e nouă sau i s-au schimbat parametrii (ex. alertă editată), sau
      - a trecut o oră programată de la ultima căutare (ex. e 20:xx și ultima căutare a fost la 08:xx).
    Rulările fără nimic programat nu consumă credite.
    Întoarce: {alert_id: [(combo, params, key, rezultat_vechi_sau_None), ...]}
    """
    plan = {}
    for alert in alert_list:
        old_combos = {c.get("search_key"): c for c in (previous.get(alert["id"]) or {}).get("combinations", [])}
        slot = A.current_slot(alert, hour)
        items = []
        for combo in A.active_combinations(alert, day):
            params = A.search_params(alert, combo)
            key = A.search_key(params)
            old = old_combos.get(key)
            fresh = (slot is None  # nu a venit încă prima oră programată azi: păstrăm ultimele rezultate
                     or (old is not None and old.get("searched_on") == day.isoformat() and searched_hour(old) >= slot))
            reusable = (old is not None and not force and old.get("status") in ("ok", "no_results") and fresh)
            items.append((combo, params, key, old if reusable else None))
        plan[alert["id"]] = items
    return plan


def send_test_notification(settings):
    """Trimite o notificare de test pe toate canalele configurate, fără nicio căutare."""
    notifier = Notifier(settings, really_send=True)
    print("Canale de notificare:", ", ".join(notifier.channels()) or "niciunul configurat")
    problem = notifier.check_vapid_keys()
    if problem:
        print("⚠️ ", problem)
    link = app_url(settings)
    notifier.send("🧪 Test notificare zboruri",
                  "Dacă vezi acest mesaj, notificările funcționează.\n"
                  "✅ 12.11→16.11 (4 nopți): 168 EUR\n   Dus: Wizz Air W6 3131 · OTP 06:10→FCO 07:45 · direct",
                  url="https://www.google.com/travel/flights", app_url=link, tags=["test_tube"])
    for err in notifier.errors:
        print("❌", err)
    if notifier.errors or not notifier.channels():
        sys.exit(1)
    print("Notificare de test trimisă.")


def refresh_credits_only(out_dir, dry_run, day):
    """Actualizează doar creditele din status.json, dacă s-au schimbat (Account API nu consumă credite)."""
    api_key = os.environ.get("SERPAPI_KEY", "").strip()
    if not (api_key or dry_run):
        return
    client = FakeSerpApiClient(day) if dry_run else SerpApiClient(api_key)
    try:
        account = client.account()
    except SearchError as e:
        print("⚠️  Nu am putut verifica creditele:", e)
        return
    left = account.get("total_searches_left", account.get("plan_searches_left"))
    usage = account.get("this_month_usage")
    path = out_dir / "status.json"
    status = read_json(path, default=None) or {}
    print(f"Credite SerpApi rămase: {left} (folosite luna aceasta: {usage})")
    if left is None or (status.get("searches_left_after") == left and status.get("this_month_usage") == usage):
        print("Creditele nu s-au schimbat. Gata (fără salvare).")
        return
    status.update(searches_left_after=left, this_month_usage=usage,
                  credits_checked_at=now().isoformat(timespec="seconds"))
    status.setdefault("searches_left_before", left)
    write_json(path, status)
    print("Creditele s-au schimbat: status.json actualizat.")


def main():
    args = parse_args()
    if args.test_notification:
        send_test_notification(load_settings())
        return
    if args.today:
        os.environ["FLIGHTS_TODAY"] = args.today
    day = today()
    settings = load_settings()
    limit = int(settings.get("monthly_search_limit", 250))
    reserve = int(settings.get("search_reserve", 5))

    out_dir = Path(args.output_dir) if args.output_dir else (ROOT / "dry-run-output" if args.dry_run else DATA_DIR)
    storage = Storage(out_dir)
    status = {
        "last_run": now().isoformat(timespec="seconds"),
        "trigger": args.trigger,
        "dry_run": args.dry_run,
        "searches_left_before": None,
        "searches_used": 0,
        "planned_searches": 0,
        "skipped_budget": False,
        "alerts_searched": [],
        "errors": [],
        "warnings": [],
        "notifications_sent": 0,
    }

    print(f"=== Monitor zboruri · {day.isoformat()} · {'TEST (dry-run)' if args.dry_run else 'real'} ===")

    # 1) Citim alertele și le validăm
    all_alerts = (read_json(args.alerts, default={}) or {}).get("alerts", [])
    valid_alerts = []
    for alert in all_alerts:
        problems = A.validate(alert)
        if problems:
            msg = f"Alerta '{alert.get('name') or alert.get('id')}' ignorată: {', '.join(problems)}"
            print("⚠️ ", msg)
            status["warnings"].append(msg)
        else:
            valid_alerts.append(alert)
    active_alerts = [a for a in valid_alerts if A.is_active(a, day)]
    print(f"Alerte: {len(all_alerts)} în total, {len(active_alerts)} active azi.")

    estimate = A.estimate_budget(valid_alerts, day)
    status["estimate"] = {**estimate, "limit": limit}
    print(f"Estimare: {estimate['per_day']} căutări/zi, ~{estimate['per_month']} în următoarele 30 de zile (limită {limit}).")

    notifier = Notifier(settings, really_send=(not args.dry_run) or args.send_notifications)
    print("Canale de notificare:", ", ".join(notifier.channels()) or "niciunul configurat")
    vapid_problem = notifier.check_vapid_keys()
    if vapid_problem:
        status["warnings"].append(vapid_problem)
        print("⚠️ ", vapid_problem)

    state = storage.load_state()
    previous = {a["id"]: storage.load_results(a["id"]) for a in active_alerts}
    hour = args.hour if args.hour is not None else now().hour
    print(f"Ora (România): {hour:02d}:xx")
    plan = plan_searches(active_alerts, previous, day, args.force, hour)
    needed = sum(1 for items in plan.values() for (_, _, _, old) in items if old is None)
    status["planned_searches"] = needed
    print(f"Căutări necesare acum: {needed}")

    # 2) Clientul SerpApi (real sau de test). Cheia e necesară doar dacă avem ce căuta.
    link = app_url(settings)
    waiting = one_time.pending(storage) + price_check.pending(storage)
    if needed == 0 and not waiting and args.trigger == "schedule":
        # Rularea din oră în oră: nimic programat acum. Verificăm doar creditele (gratuit) și salvăm
        # numai dacă s-au schimbat (resetarea lunară, căutări făcute în afara aplicației) -> rar un commit
        print("Nimic programat la ora asta.")
        refresh_credits_only(out_dir, args.dry_run, day)
        return
    if args.dry_run:
        client = FakeSerpApiClient(day)
    else:
        api_key = os.environ.get("SERPAPI_KEY", "").strip()
        if not api_key and (needed > 0 or waiting):
            print("❌ Lipsește secretul SERPAPI_KEY. Adaugă-l în GitHub > Settings > Secrets and variables > Actions.")
            sys.exit(1)
        record_dir = FIXTURES_DIR / "recorded" if args.save_responses else None
        client = SerpApiClient(api_key, record_dir=record_dir)
        if not api_key:
            print("ℹ️  SERPAPI_KEY nu este setat încă, dar nu e nimic de căutat acum.")

    # 3) Verificăm creditele rămase (Account API e gratuit, deci verificăm la fiecare rulare)
    credits = Credits()
    previous_status = read_json(out_dir / "status.json", default=None) or {}
    month_usage = None
    if args.dry_run or os.environ.get("SERPAPI_KEY", "").strip():
        try:
            account = client.account()
            credits.left = account.get("total_searches_left", account.get("plan_searches_left"))
            month_usage = account.get("this_month_usage")
            status["searches_left_before"] = credits.left
            status["credits_checked_at"] = now().isoformat(timespec="seconds")
            print(f"Credite SerpApi rămase: {credits.left} (folosite luna aceasta: {month_usage})")
        except SearchError as e:
            status["warnings"].append(str(e))
            print("⚠️ ", e, "- continui fără verificare.")
    if credits.left is None and previous_status.get("searches_left_after") is not None:
        # nu am putut verifica acum: păstrăm ultima valoare cunoscută (doar pentru afișare)
        status["searches_left_before"] = previous_status.get("searches_left_after")
        status["credits_checked_at"] = previous_status.get("credits_checked_at")
        month_usage = previous_status.get("this_month_usage")

    # 4) Căutările rapide (pornite din aplicație) au prioritate: cineva așteaptă rezultatul
    status["errors"].extend(one_time.process(storage, client, credits, notifier, settings, day, state, link))
    # „Preț la companie” (cerut din aplicație pentru un zbor anume)
    status["errors"].extend(price_check.process(storage, client, credits, settings, state))

    if not credits.enough(needed):
        # Nu ajung creditele: nu căutăm nimic, trimitem un avertisment (o dată pe zi)
        status["skipped_budget"] = True
        msg = (f"Sunt necesare {needed} căutări, dar mai ai doar {credits.left} credite SerpApi. "
               f"Căutările de azi au fost sărite. Oprește sau restrânge unele alerte.")
        print("⚠️ ", msg)
        status["warnings"].append(msg)
        if state.setdefault("warnings", {}).get("budget") != day.isoformat():
            notifier.send("⚠️ Credite SerpApi insuficiente", msg, app_url=link, tags=["warning"], priority=4)
            state["warnings"]["budget"] = day.isoformat()
        plan = {alert_id: [] for alert_id in plan}  # nimic de căutat

    # 5) Căutările pentru alerte
    fatal_error = None
    for alert in active_alerts:
        items = plan.get(alert["id"], [])
        if not items:
            continue
        searched_any = False
        combos_out = []
        for combo, params, key, old in items:
            label = f"{alert['id']} {A.combo_label(combo)}"
            if old is not None:
                combos_out.append(old)  # deja căutată azi cu aceiași parametri
                continue
            entry = new_entry(combo, params, key, day)
            if args.hour is not None:
                entry["searched_at"] = f"{day.isoformat()}T{hour:02d}:30:00+03:00"  # (doar la teste cu --hour)
            if fatal_error:
                entry.update(status="error", error=f"Sărită: {fatal_error}")
                combos_out.append(entry)
                continue
            searched_any = True
            err = search_combination(
                client, params, entry, credits,
                # detaliile întoarcerii: doar pentru cel mai ieftin zbor, doar dacă e sub prag
                return_details="under" if settings.get("return_details_for_cheapest", True) else False,
                max_price=alert.get("max_price", 0), reserve=reserve, label=label)
            if err:
                status["errors"].append({"alert_id": alert["id"], "combination": label, "message": str(err)})
                if err.fatal:
                    fatal_error = str(err)
            combos_out.append(entry)

        # Nimic nou căutat și aceleași combinații ca înainte -> nu rescriem fișierul
        prev_count = len((previous.get(alert["id"]) or {}).get("combinations", []))
        if not searched_any and all(old is not None for (_, _, _, old) in items) and prev_count == len(items):
            continue

        ok_prices = [c["lowest_price"] for c in combos_out if c.get("lowest_price") is not None]
        results = {
            "alert_id": alert["id"],
            "alert_name": alert.get("name", ""),
            "updated_at": now().isoformat(timespec="seconds"),
            "day": day.isoformat(),
            "currency": alert.get("currency", "EUR"),
            "max_price": alert.get("max_price"),
            "lowest_price": min(ok_prices) if ok_prices else None,
            "combinations": combos_out,
        }
        storage.save_results(alert["id"], results)
        storage.update_history(alert["id"], day, combos_out, alert.get("currency", "EUR"))
        status["alerts_searched"].append(alert["id"])
        previous[alert["id"]] = results

    status["searches_used"] = client.searches_done

    # 6) Notificări: rezumat zilnic pentru fiecare alertă sub prag
    for alert in active_alerts:
        results = previous.get(alert["id"])
        if not results or results.get("day") != day.isoformat():
            continue  # nu are rezultate de azi
        combos = [c for c in results.get("combinations", []) if c.get("lowest_price") is not None]
        if not any(c["lowest_price"] <= alert.get("max_price", 0) for c in combos):
            continue
        # O notificare pe zi (sau pe parte a zilei, la 2× pe zi), cu excepția cazului în care alerta a fost modificată
        # Alertele cu mai multe ore pe zi primesc câte un rezumat după fiecare căutare programată
        slot = A.current_slot(alert, hour)
        part = f"@{slot}" if A.searches_per_day(alert) > 1 and slot is not None else ""
        if part and not any(c.get("searched_on") == day.isoformat() and searched_hour(c) >= slot for c in combos):
            continue  # nu s-a căutat nimic nou de la ultima oră programată: nu repetăm rezumatul
        notify_key = f"{day.isoformat()}{part}|{alert.get('max_price')}|" + ",".join(sorted(c["search_key"] for c in combos))
        if state.setdefault("notifications", {}).get(alert["id"]) == notify_key and not args.force:
            continue
        title, body, url, app = alert_summary(alert, results, link)
        notifier.send(title, body, url=url, app_url=app, tags=["airplane"], priority=4)
        state["notifications"][alert["id"]] = notify_key

    # Rezumat erori (o notificare, dacă au existat căutări eșuate)
    if status["errors"]:
        lines = [f"{e['combination']}: {e['message']}" for e in status["errors"][:8]]
        notifier.send(f"⚠️ {len(status['errors'])} căutări eșuate", "\n".join(lines),
                      app_url=link, tags=["warning"], priority=3)

    status["notifications_sent"] = notifier.sent
    status["notification_errors"] = notifier.errors
    if credits.left is not None:
        status["searches_left_after"] = credits.left
        status["this_month_usage"] = (month_usage or 0) + client.searches_done if month_usage is not None else None
        if client.searches_done:
            # valoarea exactă de la SerpApi după căutări (gratuit). SerpApi poate întârzia câteva secunde
            # actualizarea, așa că păstrăm valoarea mai mică dintre cea calculată și cea citită.
            try:
                account = client.account()
                fresh = account.get("total_searches_left", account.get("plan_searches_left"))
                if fresh is not None:
                    status["searches_left_after"] = min(fresh, credits.left)
                    status["credits_checked_at"] = now().isoformat(timespec="seconds")
                usage = account.get("this_month_usage")
                if usage is not None:
                    status["this_month_usage"] = max(usage, status["this_month_usage"] or 0)
                print(f"Credite SerpApi rămase după căutări: {status['searches_left_after']}")
            except SearchError as e:
                print("⚠️  Nu am putut reciti creditele:", e)
    else:
        status["searches_left_after"] = status.get("searches_left_before")
        status["this_month_usage"] = month_usage
    storage.save_state(state)
    storage.save_status(status)

    print(f"\nGata. Căutări folosite: {client.searches_done}. Notificări trimise: {notifier.sent}. "
          f"Erori: {len(status['errors'])}.")
    if args.dry_run:
        print(f"Rezultatele de test sunt în: {out_dir}")


if __name__ == "__main__":
    main()
