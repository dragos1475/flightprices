"""
Căutarea unei singure combinații (plecare + întoarcere), folosită atât de alerte,
cât și de căutările rapide (one-time).
"""
from urllib.parse import quote

from .config import CONFIG_DIR, now, read_json
from .serpapi_client import SearchError, is_no_results, parse_response, strip_private


class Credits:
    """Ține evidența creditelor SerpApi rămase (None = necunoscut, nu limităm)."""

    def __init__(self, left=None):
        self.left = left

    def use(self, n=1):
        if self.left is not None:
            self.left -= n

    def enough(self, n):
        return self.left is None or self.left >= n

    def above(self, reserve):
        return self.left is None or self.left > reserve


def fallback_google_url(params):
    """Link Google Flights construit de noi, dacă SerpApi nu trimite unul."""
    if params.get("return_date"):
        q = (f"Flights to {params['arrival_id']} from {params['departure_id']} "
             f"on {params['outbound_date']} through {params['return_date']}")
    else:
        q = f"One way flights to {params['arrival_id']} from {params['departure_id']} on {params['outbound_date']}"
    return "https://www.google.com/travel/flights?hl=ro&curr=" + params["currency"] + "&q=" + quote(q)


def new_entry(combo, params, key, day):
    """Rezultatul gol al unei combinații (completat după căutare)."""
    return {**combo, "search_key": key, "searched_on": day.isoformat(),
            "searched_at": now().isoformat(timespec="seconds"),
            "status": "ok", "error": None, "flights": [], "lowest_price": None,
            "price_insights": {}, "google_flights_url": fallback_google_url(params),
            "return_flight": None}


def airline_groups(codes):
    """
    Grupează codurile IATA alese pe companii, după config/airlines.json.
    Ex. ['W6','W4','W9','5W','FR'] -> [('Wizz Air', {'W6','W4','W9','5W'}), ('Ryanair', {'FR'})].
    Alianțele (STAR_ALLIANCE etc.) nu se verifică individual.
    """
    chosen = {c for c in codes if "_" not in c}
    groups = []
    for a in (read_json(CONFIG_DIR / "airlines.json", default={}) or {}).get("airlines", []):
        common = chosen & set(a.get("codes", []))
        if common:
            groups.append((a["name"], common))
            chosen -= common
    groups += [(code, {code}) for code in sorted(chosen)]
    return groups


def airline_codes_in(flights):
    """Codurile companiilor prezente în zboruri, din numărul de zbor („W6 3131” -> W6)."""
    return {str(leg.get("flight_number", "")).split(" ")[0] for f in flights for leg in f.get("legs", [])}


def complete_missing_airlines(client, params, flights, credits, reserve, label):
    """
    Completarea automată: dacă unele companii alese lipsesc din rezultat, facem UN apel în plus
    doar cu ele. Întoarce (zboruri_noi, companii_care_tot_lipsesc).
    """
    groups = airline_groups(params.get("include_airlines", "").split(","))
    if len(groups) < 2:
        return [], []
    present = airline_codes_in(flights)
    missing = [(name, codes) for name, codes in groups if not codes & present]
    if not missing:
        return [], []
    if not flights:
        # nici un zbor pentru toate companiile împreună => nici separat nu există
        return [], [name for name, _ in missing]
    if not credits.above(reserve):
        print(f"  {label}: completarea pe companii sărită (rezerva de credite)")
        return [], None
    codes = sorted(set().union(*(c for _, c in missing)))
    print(f"  {label}: lipsesc {', '.join(n for n, _ in missing)} -> caut separat ({','.join(codes)})")
    data = client.search({**params, "include_airlines": ",".join(codes)})
    credits.use()
    extra = [] if is_no_results(data) or data.get("error") else parse_response(data)["flights"]
    for f in extra:
        f["second_pass"] = True  # găsit la a doua verificare
    found = airline_codes_in(extra)
    still = [name for name, c in missing if not c & found]
    return extra, still


def search_combination(client, params, entry, credits, *, return_details=False, max_price=None,
                       reserve=5, label="", complete_airlines=False):
    """
    Face căutarea (1 credit) și completează `entry`.
    return_details:
      - False: fără detaliile zborului de întoarcere
      - "under": doar dacă cel mai mic preț e sub `max_price` (folosit la alerte)
      - "always": pentru cel mai ieftin zbor (folosit la căutarea rapidă, dacă e cerut)
    complete_airlines: dacă unele companii alese lipsesc, încă un apel doar pentru ele (max. +1 credit).
    Întoarce eroarea (SearchError) sau None. Nu aruncă excepții.
    """
    try:
        data = client.search(params)
        credits.use()
        no_results = is_no_results(data)
        if data.get("error") and not no_results:
            raise SearchError(data["error"])
        flights = [] if no_results else parse_response(data)["flights"]

        # Completarea pe companii (opțional)
        if complete_airlines and params.get("include_airlines"):
            try:
                extra, still_missing = complete_missing_airlines(client, params, flights, credits, reserve, label)
            except SearchError as e:
                print(f"  {label}: completarea pe companii a eșuat: {e}")
                extra, still_missing = [], None
            if still_missing is not None:
                entry["airlines_checked"] = True
                entry["missing_airlines"] = still_missing
            seen = {(tuple(f["flight_numbers"]), f["departure_time"], f["price"]) for f in flights}
            flights += [f for f in extra if (tuple(f["flight_numbers"]), f["departure_time"], f["price"]) not in seen]
            flights.sort(key=lambda f: (f["price"] is None, f["price"] or 0))

        if not flights:
            entry["status"] = "no_results"
            print(f"  {label}: niciun zbor găsit")
            return None
        parsed = parse_response(data)
        entry["flights"] = [strip_private(f) for f in flights]
        entry["price_insights"] = parsed["price_insights"]
        if parsed["google_flights_url"]:
            entry["google_flights_url"] = parsed["google_flights_url"]
        prices = [f["price"] for f in flights if f["price"] is not None]
        entry["lowest_price"] = min(prices) if prices else None
        print(f"  {label}: {len(flights)} zboruri, minim {entry['lowest_price']} {params.get('currency')}")

        # Detaliile zborului de întoarcere (încă 1 credit), doar pentru cel mai ieftin zbor
        want = (return_details == "always"
                or (return_details == "under" and entry["lowest_price"] is not None
                    and max_price and entry["lowest_price"] <= max_price))
        # (la „doar dus” nu există zbor de întoarcere)
        token = flights[0].get("_departure_token") if flights and params.get("return_date") else None
        if want and token and credits.above(reserve):
            try:
                ret = client.search({**params, "departure_token": token})
                credits.use()
                returning = parse_response(ret)["flights"]
                entry["return_flight"] = strip_private(returning[0]) if returning else None
            except SearchError as e:
                print(f"  {label}: detaliile întoarcerii nu au putut fi obținute: {e}")
        return None
    except SearchError as e:
        entry.update(status="error", error=str(e))
        print(f"  ❌ {label}: {e}")
        return e
