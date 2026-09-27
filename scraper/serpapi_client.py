"""
Comunicarea cu SerpApi:
  - SerpApiClient: căutări reale (consumă credite) + verificarea creditelor (gratuită)
  - FakeSerpApiClient: pentru --dry-run, citește răspunsuri salvate local (nu consumă nimic)
  - parse_response: transformă răspunsul Google Flights într-o listă simplă de zboruri
"""
import copy
import hashlib
import random
import time

import requests

from .config import FIXTURES_DIR, read_json, write_json

SEARCH_URL = "https://serpapi.com/search.json"
ACCOUNT_URL = "https://serpapi.com/account.json"  # gratuit, nu consumă căutări

# Mesajul SerpApi când Google nu are niciun zbor pentru căutare (nu e o eroare reală)
NO_RESULTS_HINTS = ("hasn't returned any results", "no results")


class SearchError(Exception):
    """O căutare a eșuat. `fatal=True` înseamnă că nu are rost să continuăm (cheie greșită, credite epuizate)."""

    def __init__(self, message, fatal=False):
        super().__init__(message)
        self.fatal = fatal


class SerpApiClient:
    def __init__(self, api_key, record_dir=None):
        self.api_key = api_key
        self.record_dir = record_dir  # dacă e setat, salvăm răspunsurile brute (pentru --dry-run ulterior)
        self.searches_done = 0

    def _clean(self, text):
        """Ascunde cheia API din orice mesaj de eroare (log-urile repo-ului public sunt publice!)."""
        return str(text).replace(self.api_key, "***") if self.api_key else str(text)

    def account(self):
        """Informații despre cont. Documentația SerpApi: Account API nu consumă din cotă."""
        try:
            r = requests.get(ACCOUNT_URL, params={"api_key": self.api_key}, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001 - vrem orice eroare, ca text
            raise SearchError(self._clean(f"Nu am putut verifica creditele SerpApi: {e}"))

    def search(self, params):
        """O căutare google_flights (consumă 1 credit). Întoarce JSON-ul răspunsului."""
        last_error = None
        for attempt in range(2):  # o singură reîncercare, doar la erori de rețea / server
            try:
                r = requests.get(SEARCH_URL, params={**params, "api_key": self.api_key}, timeout=90)
            except requests.RequestException as e:
                last_error = SearchError(self._clean(f"Eroare de rețea: {e}"))
                time.sleep(5)
                continue

            try:
                data = r.json()
            except ValueError:
                data = {}

            if r.status_code == 401:
                raise SearchError("Cheia SerpApi este greșită (401).", fatal=True)
            if r.status_code == 429:
                raise SearchError(self._clean(f"Limită SerpApi atinsă (429): {data.get('error', '')}"), fatal=True)
            if r.status_code >= 500:
                last_error = SearchError(f"Eroare server SerpApi ({r.status_code})")
                time.sleep(5)
                continue

            self.searches_done += 1
            error = data.get("error")
            if error and "run out of searches" in error.lower():
                raise SearchError(self._clean(error), fatal=True)
            if r.status_code != 200 and not error:
                raise SearchError(f"Răspuns neașteptat de la SerpApi ({r.status_code})")
            self._record(params, data)
            return data
        raise last_error

    def _record(self, params, data):
        if not self.record_dir:
            return
        write_json(self.record_dir / f"{fixture_name(params)}.json", data)


class FakeSerpApiClient:
    """
    Client de test (--dry-run): nu face nicio cerere pe internet.
    Folosește răspunsuri salvate în scraper/fixtures/ și variază prețurile ușor
    (în funcție de dată și combinație), ca să vezi grafice și notificări realiste.
    """

    def __init__(self, day):
        self.day = day
        self.searches_done = 0
        self.outbound = read_json(FIXTURES_DIR / "google_flights_roundtrip.json")
        self.returning = read_json(FIXTURES_DIR / "google_flights_return.json")
        self.account_data = read_json(FIXTURES_DIR / "account.json")
        self.booking = read_json(FIXTURES_DIR / "google_flights_booking.json")

    def account(self):
        return copy.deepcopy(self.account_data)

    def search(self, params):
        self.searches_done += 1
        recorded = read_json(FIXTURES_DIR / "recorded" / f"{fixture_name(params)}.json")
        if recorded:
            return recorded
        if "booking_token" in params:
            return copy.deepcopy(self.booking)
        is_return = "departure_token" in params
        data = copy.deepcopy(self.returning if is_return else self.outbound)

        # Prețuri "aleatoare" dar reproductibile: aceeași zi + combinație => același preț
        seed = f"{params.get('arrival_id')}|{params.get('outbound_date')}|{params.get('return_date')}|{self.day}"
        rnd = random.Random(hashlib.md5(seed.encode()).hexdigest())
        factor = rnd.uniform(0.75, 1.3)
        date_out = params["return_date"] if is_return else params["outbound_date"]
        for group in ("best_flights", "other_flights"):
            for flight in data.get(group, []):
                flight["price"] = round(flight["price"] * factor)
                for leg in flight.get("flights", []):
                    for side in ("departure_airport", "arrival_airport"):
                        t = leg[side]["time"]
                        leg[side]["time"] = date_out + t[10:]
        if "price_insights" in data:
            pi = data["price_insights"]
            pi["lowest_price"] = min(f["price"] for g in ("best_flights", "other_flights") for f in data.get(g, []))
        data.setdefault("search_parameters", {}).update(params)
        return data


def fixture_name(params):
    """Numele fișierului în care salvăm/căutăm un răspuns înregistrat."""
    parts = [params.get("departure_id", ""), params.get("arrival_id", ""),
             params.get("outbound_date", ""), params.get("return_date", "")]
    name = "_".join(p.replace(",", "-") for p in parts)
    if "departure_token" in params:
        name += "_retur"
    return name


def is_no_results(data):
    error = (data.get("error") or "").lower()
    return any(h in error for h in NO_RESULTS_HINTS)


def _parse_flight(item, is_best):
    """Transformă un rezultat Google Flights într-un dicționar simplu."""
    legs = []
    for leg in item.get("flights", []):
        legs.append({
            "airline": leg.get("airline", ""),
            "flight_number": leg.get("flight_number", ""),
            "from": leg.get("departure_airport", {}).get("id", ""),
            "from_name": leg.get("departure_airport", {}).get("name", ""),
            "to": leg.get("arrival_airport", {}).get("id", ""),
            "to_name": leg.get("arrival_airport", {}).get("name", ""),
            "departure_time": leg.get("departure_airport", {}).get("time", ""),
            "arrival_time": leg.get("arrival_airport", {}).get("time", ""),
            "duration": leg.get("duration"),
            "airplane": leg.get("airplane", ""),
            "logo": leg.get("airline_logo", ""),
            "legroom": leg.get("legroom", ""),
            "extensions": leg.get("extensions", []) or [],  # ex. „Wi-Fi”, „Priză”, „Spațiu mediu pentru picioare”
            "overnight": bool(leg.get("overnight")),
            "often_delayed": bool(leg.get("often_delayed_by_over_30_min")),
        })
    layovers = [{
        "airport": lay.get("id", ""),
        "name": lay.get("name", ""),
        "duration": lay.get("duration"),
        "overnight": bool(lay.get("overnight")),
    } for lay in item.get("layovers", [])]

    airlines = []
    for leg in legs:
        if leg["airline"] and leg["airline"] not in airlines:
            airlines.append(leg["airline"])

    carbon = item.get("carbon_emissions") or {}
    return {
        "price": item.get("price"),
        "is_best": is_best,
        "logo": item.get("airline_logo", ""),
        "carbon_diff": carbon.get("difference_percent"),  # % față de tipicul rutei (negativ = mai puțin CO₂)
        "airlines": airlines,
        "flight_numbers": [leg["flight_number"] for leg in legs if leg["flight_number"]],
        "from": legs[0]["from"] if legs else "",
        "to": legs[-1]["to"] if legs else "",
        "departure_time": legs[0]["departure_time"] if legs else "",
        "arrival_time": legs[-1]["arrival_time"] if legs else "",
        "total_duration": item.get("total_duration"),
        "stops": len(layovers),
        "layovers": layovers,
        "legs": legs,
        # jetoane Google: departure_token (dus-întors: alegerea întoarcerii), booking_token (opțiunile de rezervare)
        "departure_token": item.get("departure_token"),
        "booking_token": item.get("booking_token"),
    }


def parse_response(data):
    """
    Extrage din răspunsul SerpApi:
      - flights: toate zborurile din best_flights + other_flights (preț = total dus-întors)
      - price_insights: lowest_price, price_level, typical_price_range
      - google_flights_url: linkul către Google Flights
    """
    flights = []
    for item in data.get("best_flights", []) or []:
        flights.append(_parse_flight(item, True))
    for item in data.get("other_flights", []) or []:
        flights.append(_parse_flight(item, False))
    # Unele rezultate nu au preț (ex. "preț indisponibil") -> le punem la final
    flights.sort(key=lambda f: (f["price"] is None, f["price"] or 0))

    pi = data.get("price_insights") or {}
    insights = {
        "lowest_price": pi.get("lowest_price"),
        "price_level": pi.get("price_level"),
        "typical_price_range": pi.get("typical_price_range"),
    }
    url = (data.get("search_metadata") or {}).get("google_flights_url", "")
    return {"flights": flights, "price_insights": insights, "google_flights_url": url}


def strip_private(flight):
    """Scoate câmpurile interne înainte de salvare."""
    return {k: v for k, v in flight.items() if not k.startswith("_")}

