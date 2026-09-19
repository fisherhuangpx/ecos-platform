import pytest
from cryptography.fernet import InvalidToken

from ecos.security.vault import CredentialVault


def test_encrypt_decrypt_roundtrip():
    vault = CredentialVault("test-secret")
    token = vault.encrypt("super-token-123")
    assert token != "super-token-123"
    assert vault.decrypt(token) == "super-token-123"


def test_wrong_secret_cannot_decrypt():
    token = CredentialVault("secret-a").encrypt("x")
    with pytest.raises(InvalidToken):
        CredentialVault("secret-b").decrypt(token)


def test_same_secret_roundtrips_after_restart():
    token = CredentialVault("fixed-secret").encrypt("value")
    assert CredentialVault("fixed-secret").decrypt(token) == "value"
