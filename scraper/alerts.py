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


def combinations(alert, day=None):
    """
    Toate perechile (data plecării, data întoarcerii) ale unei alerte.
    Dacă `day` e dat, păstrează doar plecările care nu au trecut încă.

    Exemplu: {"date": "2026-11-12", "nights": [4, 5]}
      -> (12.11, 16.11, 4 nopți) și (12.11, 17.11, 5 nopți)
    """
    result = []
    seen = set()
    for dep in alert.get("departures", []):
        outbound = parse_date(dep.get("date"))
        if outbound is None:
            continue
        if day is not None and outbound < day:
            continue  # plecarea a trecut
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
    result.sort(key=lambda c: (c["outbound_date"], c["return_date"]))
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
        return "oprită"
    start = parse_date(alert.get("monitor_start"))
    if start and day < start:
        return "programată"
    if is_active(alert, day):
        return "activă"
    return "expirată"


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
        "type": "1",  # 1 = dus-întors
        "departure_id": ",".join(alert.get("departure_airports", [])),
        "arrival_id": ",".join(alert.get("destination", {}).get("codes", [])),
        "outbound_date": combo["outbound_date"],
        "return_date": combo["return_date"],
        "currency": alert.get("currency", "EUR"),
        "gl": "ro",
        "hl": "ro",
        "adults": str(int(alert.get("adults", 1) or 1)),
        "show_hidden": "true",
    }
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
    raw = json.dumps(params, sort_keys=True).encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]


def validate(alert):
    """Întoarce o listă de probleme (texte în română). Listă goală = alertă validă."""
    problems = []
    if not alert.get("id"):
        problems.append("lipsește id-ul")
    if not alert.get("departure_airports"):
        problems.append("nu are aeroporturi de plecare")
    if not alert.get("destination", {}).get("codes"):
        problems.append("nu are destinație")
    if not combinations(alert):
        problems.append("nu are nicio zi de plecare cu număr de nopți")
    if alert.get("currency", "EUR") not in ("EUR", "RON"):
        problems.append("moneda trebuie să fie EUR sau RON")
    if alert.get("max_stops") not in (None, 0, 1, 2):
        problems.append("numărul maxim de escale trebuie să fie 0, 1, 2 sau gol")
    return problems


def estimate_budget(alerts, day, days=30):
    """
    Estimarea consumului de căutări:
      - per_day: câte căutări se fac azi (1 căutare / combinație activă)
      - per_month: suma pe următoarele `days` zile, ținând cont că alertele
        expiră și că plecările trecute nu se mai caută
      - extra_max_per_month: maximul de căutări suplimentare pentru detaliile
        zborului de întoarcere (1 pe combinație, doar când prețul e sub prag)
    """
    per_day = sum(len(active_combinations(a, day)) for a in alerts)
    per_month = 0
    for i in range(days):
        d = day + timedelta(days=i)
        per_month += sum(len(active_combinations(a, d)) for a in alerts)
    return {"per_day": per_day, "per_month": per_month, "extra_max_per_month": per_month}
