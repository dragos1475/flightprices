"""
Lucrul cu alertele: care sunt active, ce combinații (plecare × nopți) generează,
ce parametri trimitem la SerpApi și câte căutări consumă.

ATENȚIE: aceeași logică de buget există și în aplicație (js/budget.js).
Dacă o schimbi aici, schimb-o și acolo.
"""
import hashlib
import json
from datetime import date, timedelta


def parse_date(value):
    """Transformă 'AAAA-LL-ZZ' în obiect `date` (sau None dacă lipsește/e greșit)."""
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def is_monitoring_on(alert, day):
    """Este alerta pornită și `day` se află în perioada de monitorizare?"""
    if not alert.get("active", True):
        return False
    start = parse_date(alert.get("monitor_start"))
    end = parse_date(alert.get("monitor_end"))
    if start and day < start:
        return False
    if end and day > end:
        return False
    return True


def is_one_way(alert):
    """Alertă/căutare „doar dus” (fără întoarcere). Implicit: dus-întors."""
    return alert.get("trip_type") == "one_way"


# Orele (în România) la care se caută o alertă, dacă nu s-a ales altceva.
DEFAULT_HOURS = [8]
MAX_TIMES_PER_DAY = 4


def search_hours(alert):
    """Orele programate ale alertei, sortate (ex. [8, 20]). Implicit: [8]."""
    raw = alert.get("search_hours")
    hours = sorted({int(h) for h in (raw or []) if isinstance(h, (int, float)) and 0 <= int(h) <= 23})
    return hours[:MAX_TIMES_PER_DAY] or list(DEFAULT_HOURS)


def searches_per_day(alert):
    return len(search_hours(alert))


def current_slot(alert, hour):
    """Ultima oră programată care a trecut azi (ex. la 15:xx pentru [8, 20] -> 8). None dacă n-a venit prima."""
    return max((h for h in search_hours(alert) if h <= hour), default=None)


def combo_key(combo):
    """Cheia unei combinații în istoric: '2026-11-12_2026-11-16' (dus-întors) sau '2026-11-12' (doar dus)."""
    if combo.get("return_date"):
        return f"{combo['outbound_date']}_{combo['return_date']}"
    return combo["outbound_date"]


def combo_label(combo):
    """Text scurt pentru log-uri: '2026-11-12→2026-11-16' sau '2026-11-12 (doar dus)'."""
    if combo.get("return_date"):
        return f"{combo['outbound_date']}→{combo['return_date']}"
    return f"{combo['outbound_date']} (one way)"


def combinations(alert, day=None):
    """
    Toate combinațiile de căutat ale unei alerte.
    Dacă `day` e dat, păstrează doar plecările care nu au trecut încă.

    Dus-întors: {"date": "2026-11-12", "nights": [4, 5]}
      -> (12.11, 16.11, 4 nopți) și (12.11, 17.11, 5 nopți)
    Doar dus: fiecare dată de plecare este o combinație (nopțile nu contează).
    """
    result = []
    seen = set()
    one_way = is_one_way(alert)
    for dep in alert.get("departures", []):
        outbound = parse_date(dep.get("date"))
        if outbound is None:
            continue
        if day is not None and outbound < day:
            continue  # plecarea a trecut
        if one_way:
            if outbound not in seen:
                seen.add(outbound)
                result.append({"outbound_date": outbound.isoformat(), "return_date": None, "nights": None})
            continue
        for nights in dep.get("nights", []):
            try:
                nights = int(nights)
            except (TypeError, ValueError):
                continue
            if nights < 0:
                continue
            ret = outbound + timedelta(days=nights)
            key = (outbound, ret)
            if key in seen:
                continue
            seen.add(key)
            result.append({
                "outbound_date": outbound.isoformat(),
                "return_date": ret.isoformat(),
                "nights": nights,
            })
    result.sort(key=lambda c: (c["outbound_date"], c["return_date"] or ""))
    return result


def active_combinations(alert, day):
    """Combinațiile de căutat în ziua `day` (listă goală dacă alerta nu e activă)."""
    if not is_monitoring_on(alert, day):
        return []
    return combinations(alert, day)


def is_active(alert, day):
    """Alertă activă = pornită, în perioada de monitorizare și cu cel puțin o plecare viitoare."""
    return len(active_combinations(alert, day)) > 0


def status_label(alert, day):
    """Starea alertei, ca text scurt (folosită în rezumate)."""
    if not alert.get("active", True):
        return "paused"
    start = parse_date(alert.get("monitor_start"))
    if start and day < start:
        return "scheduled"
    if is_active(alert, day):
        return "active"
    return "expired"


def max_stops(alert):
    """
    Numărul maxim de escale: None = oricâte, 0 = doar directe, 1, 2.
    (Alertele vechi aveau "direct_only": true, echivalent cu 0.)
    """
    value = alert.get("max_stops")
    if value is None and alert.get("direct_only"):
        return 0
    return value if value in (0, 1, 2) else None


def search_params(alert, combo):
    """Parametrii căutării SerpApi `google_flights` pentru o combinație (fără cheia API)."""
    params = {
        "engine": "google_flights",
        "type": "2" if is_one_way(alert) else "1",  # 1 = dus-întors, 2 = doar dus
        "departure_id": ",".join(alert.get("departure_airports", [])),
        "arrival_id": ",".join(alert.get("destination", {}).get("codes", [])),
        "outbound_date": combo["outbound_date"],
        "currency": alert.get("currency", "EUR"),
        "gl": "ro",
        "hl": "en",  # textele de la Google (escale, detalii, opțiuni de rezervare) în engleză
        "adults": str(int(alert.get("adults", 1) or 1)),
        "show_hidden": "true",
    }
    if combo.get("return_date"):
        params["return_date"] = combo["return_date"]
    bags = int(alert.get("bags", 0) or 0)
    if bags > 0:
        params["bags"] = str(bags)
    airlines = alert.get("airlines") or []  # listă goală = oricare companie
    if airlines:
        params["include_airlines"] = ",".join(airlines)
    stops = max_stops(alert)
    if stops is not None:
        # SerpApi: stops=1 doar directe, 2 = maxim 1 escală, 3 = maxim 2 escale
        params["stops"] = str(stops + 1)
    # NU trimitem max_price: vrem toate prețurile, filtrăm noi.
    return params


def search_key(params):
    """Amprentă scurtă a unei căutări: dacă parametrii nu s-au schimbat, amprenta e aceeași."""
    # Limba (hl) nu schimbă prețurile: o fixăm în amprentă, ca schimbarea limbii să nu provoace căutări noi.
    raw = json.dumps({**params, "hl": "ro"}, sort_keys=True).encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]


def validate(alert):
    """Întoarce o listă de probleme (texte în română). Listă goală = alertă validă."""
    problems = []
    if not alert.get("id"):
        problems.append("missing id")
    if not alert.get("departure_airports"):
        problems.append("no departure airports")
    if not alert.get("destination", {}).get("codes"):
        problems.append("no destination")
    if not combinations(alert):
        problems.append("no departure day" if is_one_way(alert) else "no departure day with a number of nights")
    raw_hours = alert.get("search_hours")
    if raw_hours is not None and (
            not isinstance(raw_hours, list) or not 1 <= len(raw_hours) <= MAX_TIMES_PER_DAY
            or any(not isinstance(h, int) or not 0 <= h <= 23 for h in raw_hours)
            or len(set(raw_hours)) != len(raw_hours)):
        problems.append(f"search times must be 1–{MAX_TIMES_PER_DAY} different hours between 0 and 23")
    if alert.get("trip_type") not in (None, "round_trip", "one_way"):
        problems.append("trip type must be round_trip or one_way")
    if alert.get("currency", "EUR") not in ("EUR", "RON"):
        problems.append("currency must be EUR or RON")
    if alert.get("max_stops") not in (None, 0, 1, 2):
        problems.append("maximum stops must be 0, 1, 2 or empty")
    return problems


def estimate_budget(alerts, day, days=30):
    """
    Estimarea consumului de căutări:
      - per_day: câte căutări se fac azi (1 căutare / combinație activă, × de câte ori pe zi)
      - per_month: suma pe următoarele `days` zile, ținând cont că alertele
        expiră și că plecările trecute nu se mai caută
      - extra_max_per_month: maximul de căutări suplimentare pentru detaliile
        zborului de întoarcere (1 pe combinație, doar când prețul e sub prag)
    """
    def count(a, d):
        return len(active_combinations(a, d)) * searches_per_day(a)

    per_day = sum(count(a, day) for a in alerts)
    per_month = 0
    extra = 0  # doar dus-întors are căutare separată pentru întoarcere
    for i in range(days):
        d = day + timedelta(days=i)
        per_month += sum(count(a, d) for a in alerts)
        extra += sum(count(a, d) for a in alerts if not is_one_way(a))
    return {"per_day": per_day, "per_month": per_month, "extra_max_per_month": extra}
