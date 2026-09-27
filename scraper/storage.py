"""
Salvarea datelor în folderul data/ (sau în alt folder, la --dry-run):
  data/results/<alert_id>.json  - ultimele rezultate complete ale alertei
  data/history/<alert_id>.json  - cel mai mic preț pe zi, pentru fiecare combinație
  data/state.json               - ce notificări s-au trimis deja (ca să nu le repetăm)
  data/status.json              - rezumatul ultimei rulări (afișat în aplicație)
"""
from .alerts import combo_key
from .config import read_json, write_json


class Storage:
    def __init__(self, data_dir):
        self.data_dir = data_dir

    # ---------- rezultate ----------
    def results_path(self, alert_id):
        return self.data_dir / "results" / f"{alert_id}.json"

    def load_results(self, alert_id):
        return read_json(self.results_path(alert_id), default=None)

    def save_results(self, alert_id, results):
        write_json(self.results_path(alert_id), results)

    # ---------- istoric ----------
    def history_path(self, alert_id):
        return self.data_dir / "history" / f"{alert_id}.json"

    def update_history(self, alert_id, day, combos, currency):
        """
        Adaugă (sau înlocuiește) prețul minim de azi pentru fiecare combinație.
        Format: {"series": {"2026-11-12_2026-11-16": [{"date": "...", "price": 245, "currency": "EUR"}]}}
        """
        history = read_json(self.history_path(alert_id), default=None) or {"alert_id": alert_id, "series": {}}
        series = history.setdefault("series", {})
        for combo in combos:
            price = combo.get("lowest_price")
            if price is None:
                continue
            key = combo_key(combo)
            points = [p for p in series.get(key, []) if p.get("date") != day.isoformat()]
            points.append({"date": day.isoformat(), "price": price, "currency": currency})
            points.sort(key=lambda p: p["date"])
            series[key] = points
        write_json(self.history_path(alert_id), history)

    # ---------- stare notificări ----------
    def load_state(self):
        return read_json(self.data_dir / "state.json", default=None) or {"notifications": {}, "warnings": {}}

    def save_state(self, state):
        write_json(self.data_dir / "state.json", state)

    # ---------- rezumatul rulării ----------
    def save_status(self, status):
        write_json(self.data_dir / "status.json", status)
