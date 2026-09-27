"""
Notificări:
  - Web Push (către aplicația instalată pe telefon), cu chei VAPID
  - ntfy.sh (variantă de rezervă, merge bine și pe iPhone prin aplicația ntfy)

Secretele vin din variabilele de mediu (GitHub Secrets):
  VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, PUSH_SUBSCRIPTION, NTFY_TOPIC
"""
import json
import os

import requests

PUSH_MAX_BODY = 1500   # un mesaj Web Push are maxim ~4 KB (criptat); păstrăm textul scurt
NTFY_MAX_BODY = 3800   # ntfy acceptă mesaje de maxim 4096 octeți


# ---------------------------------------------------------------------------
# Formatarea textelor
# ---------------------------------------------------------------------------

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def short_date(iso):
    """'2026-11-12' -> '12 Nov'"""
    return f"{int(iso[8:10])} {MONTHS[int(iso[5:7]) - 1]}" if iso and len(iso) >= 10 else iso or ""


def hour(time_str):
    """'2026-11-12 06:10' -> '06:10'"""
    return time_str[11:16] if time_str and len(time_str) >= 16 else time_str or ""


def duration(minutes):
    if not minutes:
        return ""
    return f"{minutes // 60}h{minutes % 60:02d}"


def combo_text(c):
    """'12 Nov→16 Nov (4 nights)' sau '12 Nov (one way)'."""
    if c.get("return_date"):
        nights = c["nights"]
        return f"{short_date(c['outbound_date'])}→{short_date(c['return_date'])} ({nights} {'night' if nights == 1 else 'nights'})"
    return f"{short_date(c['outbound_date'])} (one way)"


def flight_line(f):
    """Un rând scurt despre un zbor: companie, nr. zbor, ore, escale."""
    stops = "direct" if f.get("stops", 0) == 0 else f"{f['stops']} stop" if f["stops"] == 1 else f"{f['stops']} stops"
    airlines = "/".join(f.get("airlines", [])) or "?"
    numbers = ", ".join(f.get("flight_numbers", []))
    return (f"{airlines} {numbers} · {f.get('from', '')} {hour(f.get('departure_time'))}"
            f"→{f.get('to', '')} {hour(f.get('arrival_time'))} · {stops} · {duration(f.get('total_duration'))}")


def alert_summary(alert, results, app_link):
    """
    Construiește textul notificării pentru o alertă cu prețuri sub prag.
    Întoarce (titlu, text, link_google_flights, link_aplicație).
    """
    cur = results.get("currency", "EUR")
    max_price = alert.get("max_price")
    combos = [c for c in results.get("combinations", []) if c.get("lowest_price") is not None]
    under = sorted([c for c in combos if c["lowest_price"] <= max_price], key=lambda c: c["lowest_price"])
    over = sorted([c for c in combos if c["lowest_price"] > max_price], key=lambda c: c["lowest_price"])
    best = under[0]

    title = f"✈️ {alert.get('name', alert['id'])}: {best['lowest_price']} {cur} (target {max_price} {cur})"
    lines = [f"Under target: {len(under)} of {len(combos)} date combinations"]
    for c in under:
        f = c["flights"][0] if c.get("flights") else {}
        lines.append(f"✅ {combo_text(c)}: {c['lowest_price']} {cur}")
        if f:
            lines.append(f"   Out: {flight_line(f)}")
        ret = c.get("return_flight")
        if ret:
            lines.append(f"   Back: {flight_line(ret)}")
    if over:
        lines.append("Over target: " + "; ".join(
            f"{combo_text(c)} {c['lowest_price']}" for c in over))
    errors = [c for c in results.get("combinations", []) if c.get("status") == "error"]
    if errors:
        lines.append(f"⚠️ {len(errors)} failed searches")
    body = "\n".join(lines)
    link = best.get("google_flights_url", "")
    app = f"{app_link}#/alerta/{alert['id']}" if app_link else ""
    return title, body, link, app


def truncate(text, limit):
    if len(text.encode("utf-8")) <= limit:
        return text
    suffix = "\n… (see all in the app)"
    while len((text + suffix).encode("utf-8")) > limit:
        text = text[: int(len(text) * 0.9)]
    return text.rsplit("\n", 1)[0] + suffix


# ---------------------------------------------------------------------------
# Trimiterea notificărilor
# ---------------------------------------------------------------------------

class Notifier:
    def __init__(self, settings, really_send=True):
        """
        really_send=False (la --dry-run): doar afișează notificările în consolă.
        """
        self.settings = settings.get("notifications", {})
        self.vapid_subject = settings.get("vapid_subject", "mailto:notificari@example.com")
        self.really_send = really_send
        self.sent = 0
        self.errors = []

        self.vapid_private = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
        self.vapid_public = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
        self.subscriptions = self._load_subscriptions(os.environ.get("PUSH_SUBSCRIPTION", ""))
        self.ntfy_topic = os.environ.get("NTFY_TOPIC", "").strip()
        self.ntfy_server = self.settings.get("ntfy_server", "https://ntfy.sh").rstrip("/")

    def _load_subscriptions(self, raw):
        """PUSH_SUBSCRIPTION poate conține un abonament (obiect JSON) sau mai multe (listă JSON)."""
        raw = raw.strip()
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except ValueError:
            self.errors.append("PUSH_SUBSCRIPTION is not valid JSON (copy it exactly from the app).")
            return []
        return data if isinstance(data, list) else [data]

    def channels(self):
        """Ce canale sunt configurate (pentru log)."""
        result = []
        if self.settings.get("web_push", True) and self.vapid_private and self.subscriptions:
            result.append(f"web push ({len(self.subscriptions)} dispozitiv(e))")
        if self.settings.get("ntfy", True) and self.ntfy_topic:
            result.append("ntfy")
        return result

    def send(self, title, body, url="", app_url="", tags=None, priority=3):
        """Trimite aceeași notificare pe toate canalele configurate."""
        if not self.really_send:
            print("\n----- NOTIFICARE (test, netrimisă) -----")
            print(title)
            print(body)
            if url:
                print(f"Link: {url}")
            if app_url:
                print(f"Aplicație: {app_url}")
            print("-----------------------------------------\n")
            self.sent += 1
            return

        delivered = False
        if self.settings.get("web_push", True) and self.vapid_private and self.subscriptions:
            delivered |= self._web_push(title, body, url, app_url)
        if self.settings.get("ntfy", True) and self.ntfy_topic:
            delivered |= self._ntfy(title, body, url, app_url, tags or [], priority)
        if delivered:
            self.sent += 1
        elif not self.channels():
            print(f"[notificare] Niciun canal configurat. Notificare nelivrată: {title}")

    def _web_push(self, title, body, url, app_url):
        from pywebpush import WebPushException, webpush

        payload = json.dumps({
            "title": title,
            "body": truncate(body, PUSH_MAX_BODY),
            "url": url or app_url,
            "app_url": app_url,
        }, ensure_ascii=False)
        ok = False
        for i, sub in enumerate(self.subscriptions, start=1):
            try:
                webpush(
                    subscription_info=sub,
                    data=payload,
                    vapid_private_key=self.vapid_private,
                    vapid_claims={"sub": self.vapid_subject},
                    ttl=24 * 3600,
                )
                ok = True
            except WebPushException as e:
                status = getattr(e.response, "status_code", None)
                if status in (404, 410):
                    msg = (f"Web Push device {i}: the subscription has expired ({status}). "
                           "Open the app > Settings and copy the new subscription into the PUSH_SUBSCRIPTION secret.")
                elif status == 403:
                    msg = (f"Web Push device {i}: the VAPID keys do not match (403). Check "
                           "VAPID_PRIVATE_KEY and the public key in config/settings.json, then re-subscribe the phone.")
                else:
                    msg = f"Web Push device {i}: {e}"
                self.errors.append(msg)
                print(f"[notificare] {msg}")
            except Exception as e:  # noqa: BLE001
                self.errors.append(f"Web Push device {i}: {e}")
                print(f"[notificare] Web Push dispozitiv {i}: {e}")
        return ok

    def _ntfy(self, title, body, url, app_url, tags, priority):
        message = {
            "topic": self.ntfy_topic,
            "title": title,
            "message": truncate(body, NTFY_MAX_BODY),
            "tags": tags,
            "priority": priority,
        }
        actions = []
        if url:
            message["click"] = url
            actions.append({"action": "view", "label": "Google Flights", "url": url})
        if app_url:
            actions.append({"action": "view", "label": "Open app", "url": app_url})
        if actions:
            message["actions"] = actions
        try:
            # Publicare JSON: suportă diacritice în titlu (anteturile HTTP nu le suportă)
            r = requests.post(self.ntfy_server + "/", json=message, timeout=30)
            r.raise_for_status()
            return True
        except Exception as e:  # noqa: BLE001
            msg = f"ntfy: {e}".replace(self.ntfy_topic, "***")
            self.errors.append(msg)
            print(f"[notificare] {msg}")
            return False

    def check_vapid_keys(self):
        """Verifică dacă cheia publică (secretul VAPID_PUBLIC_KEY) corespunde cheii private."""
        if not (self.vapid_private and self.vapid_public):
            return None
        try:
            from py_vapid import Vapid, b64urlencode
            from cryptography.hazmat.primitives import serialization

            v = Vapid.from_string(self.vapid_private)
            raw = v.public_key.public_bytes(serialization.Encoding.X962,
                                            serialization.PublicFormat.UncompressedPoint)
            derived = b64urlencode(raw)
            if isinstance(derived, bytes):
                derived = derived.decode()
            if derived.rstrip("=") != self.vapid_public.rstrip("="):
                return "VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY."
        except Exception as e:  # noqa: BLE001
            return f"VAPID_PRIVATE_KEY cannot be read: {e}"
        return None
