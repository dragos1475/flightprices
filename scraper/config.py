"""
Setări comune: căi către fișiere, citire/scriere JSON, data de azi în fusul orar al României.
"""
import json
import os
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

# Rădăcina proiectului (folderul care conține "scraper/", "data/", "config/")
ROOT = Path(__file__).resolve().parent.parent

CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
FIXTURES_DIR = ROOT / "scraper" / "fixtures"

TIMEZONE = ZoneInfo("Europe/Bucharest")


def read_json(path, default=None):
    """Citește un fișier JSON. Dacă nu există, întoarce `default`."""
    path = Path(path)
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    """Scrie un fișier JSON frumos formatat (cu diacritice păstrate)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_settings():
    """Citește config/settings.json."""
    return read_json(CONFIG_DIR / "settings.json", default={})


def now():
    """Data și ora curentă în România."""
    return datetime.now(TIMEZONE)


def today():
    """Data de azi în România (nu în UTC, cum rulează GitHub)."""
    override = os.environ.get("FLIGHTS_TODAY")  # folosit doar la teste (--today)
    if override:
        return date.fromisoformat(override)
    return now().date()


def app_url(settings):
    """
    Adresa aplicației (GitHub Pages), folosită în notificări.
    Se poate seta manual în settings.json ("app_url"); altfel se deduce
    din numele repository-ului (variabila GITHUB_REPOSITORY din Actions).
    """
    if settings.get("app_url"):
        return settings["app_url"].rstrip("/") + "/"
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" not in repo:
        return ""
    owner, name = repo.split("/", 1)
    if name.lower() == f"{owner.lower()}.github.io":
        return f"https://{owner.lower()}.github.io/"
    return f"https://{owner.lower()}.github.io/{name}/"
