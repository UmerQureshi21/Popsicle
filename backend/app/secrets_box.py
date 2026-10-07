"""Encrypting the Gmail login kept in the database, so a copy of the database (a leaked
connection string, a backup) doesn't hand out access to your Gmail."""

from cryptography.fernet import Fernet, InvalidToken

from .config import settings

PREFIX = "fernet:"


class CantDecrypt(Exception):
    pass


def is_sealed(stored: str) -> bool:
    return stored.startswith(PREFIX)


def seal(text: str) -> str:
    """Encrypted when a key is set (always, when deployed); as-is locally without one."""
    if not settings.token_encryption_key:
        return text
    return PREFIX + Fernet(settings.token_encryption_key).encrypt(text.encode()).decode()


def unseal(stored: str) -> str:
    if not is_sealed(stored):
        return stored  # saved before encryption was set up
    if not settings.token_encryption_key:
        raise CantDecrypt("The Gmail login is encrypted but TOKEN_ENCRYPTION_KEY isn't set.")
    try:
        return Fernet(settings.token_encryption_key).decrypt(stored[len(PREFIX) :].encode()).decode()
    except InvalidToken as e:
        raise CantDecrypt("The Gmail login can't be decrypted with this TOKEN_ENCRYPTION_KEY.") from e
