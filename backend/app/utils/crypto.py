"""
AES-256-GCM encryption for storing GitHub PATs at rest.

The ENCRYPTION_KEY env var must be a 64-char hex string (32 bytes).
Each ciphertext is prefixed with a 12-byte nonce so every encryption
produces a unique output even for the same plaintext.
"""

from __future__ import annotations

import binascii
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings


import hashlib

def _get_key() -> bytes:
    hex_key = get_settings().ENCRYPTION_KEY
    try:
        raw = binascii.unhexlify(hex_key)
        if len(raw) == 32:
            return raw
    except (binascii.Error, ValueError):
        pass
    
    # Fallback: Hash whatever string is in ENCRYPTION_KEY using SHA-256
    # to derive a safe, deterministic 32-byte key.
    return hashlib.sha256(hex_key.encode()).digest()


def encrypt_token(plaintext: str) -> str:
    """Encrypt a plaintext string → hex(nonce + ciphertext + tag)."""
    key = _get_key()
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return (nonce + ct).hex()


def decrypt_token(hex_blob: str) -> str:
    """Decrypt hex(nonce + ciphertext + tag) → plaintext string."""
    key = _get_key()
    raw = binascii.unhexlify(hex_blob)
    nonce, ct = raw[:12], raw[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ct, None).decode()
