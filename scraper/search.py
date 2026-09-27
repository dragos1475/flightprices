"""
Căutarea unei singure combinații (plecare + întoarcere), folosită atât de alerte,
cât și de căutările rapide (one-time).
"""
from urllib.parse import quote

from .config import now
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
    q = (f"Flights to {params['arrival_id']} from {params['departure_id']} "
         f"on {params['outbound_date']} through {params['return_date']}")
    return "https://www.google.com/travel/flights?hl=ro&curr=" + params["currency"] + "&q=" + quote(q)


def new_entry(combo, params, key, day):
    """Rezultatul gol al unei combinații (completat după căutare)."""
    return {**combo, "search_key": key, "searched_on": day.isoformat(),
            "searched_at": now().isoformat(timespec="seconds"),
            "status": "ok", "error": None, "flights": [], "lowest_price": None,
            "price_insights": {}, "google_flights_url": fallback_google_url(params),
            "return_flight": None}


def search_combination(client, params, entry, credits, *, return_details=False, max_price=None,
                       reserve=5, label=""):
    """
    Face căutarea (1 credit) și completează `entry`.
    return_details:
      - False: fără detaliile zborului de întoarcere
      - "under": doar dacă cel mai mic preț e sub `max_price` (folosit la alerte)
      - "always": pentru cel mai ieftin zbor (folosit la căutarea rapidă, dacă e cerut)
    Întoarce eroarea (SearchError) sau None. Nu aruncă excepții.
    """
    try:
        data = client.search(params)
        credits.use()
        if is_no_results(data):
            entry["status"] = "no_results"
            print(f"  {label}: niciun zbor găsit")
            return None
        if data.get("error"):
            raise SearchError(data["error"])

        parsed = parse_response(data)
        flights = parsed["flights"]
        entry["flights"] = [strip_private(f) for f in flights]
        entry["price_insights"] = parsed["price_insights"]
        if parsed["google_flights_url"]:
            entry["google_flights_url"] = parsed["google_flights_url"]
        prices = [f["price"] for f in flights if f["price"] is not None]
        entry["lowest_price"] = min(prices) if prices else None
        if not flights:
            entry["status"] = "no_results"
        print(f"  {label}: {len(flights)} zboruri, minim {entry['lowest_price']} {params.get('currency')}")

        # Detaliile zborului de întoarcere (încă 1 credit), doar pentru cel mai ieftin zbor
        want = (return_details == "always"
                or (return_details == "under" and entry["lowest_price"] is not None
                    and max_price and entry["lowest_price"] <= max_price))
        token = flights[0].get("_departure_token") if flights else None
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
