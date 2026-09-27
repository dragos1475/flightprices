"""
Generează o pereche de chei VAPID pentru notificările Web Push.

Rulare (o singură dată, pe calculatorul tău):
    pip install cryptography
    python tools/genereaza_chei_vapid.py

Apoi:
  - VAPID_PRIVATE_KEY  -> GitHub Secret (NU o publica nicăieri!)
  - VAPID_PUBLIC_KEY   -> GitHub Secret ȘI în config/settings.json la "vapid_public_key"
                          (cheia publică nu e secretă; aplicația are nevoie de ea)

Alternativ: aplicația are un generator în Setări > "Generează chei VAPID".
"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def main():
    key = ec.generate_private_key(ec.SECP256R1())
    private_raw = key.private_numbers().private_value.to_bytes(32, "big")
    public_raw = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    print("VAPID_PUBLIC_KEY (publică):")
    print(b64url(public_raw))
    print()
    print("VAPID_PRIVATE_KEY (SECRETĂ - doar în GitHub Secrets):")
    print(b64url(private_raw))


if __name__ == "__main__":
    main()
