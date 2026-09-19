"""凭据保险库：Fernet 对称加密 + 网关短时令牌（HMAC + 过期）。"""

import base64
import calendar
import hashlib
import hmac
from datetime import datetime

from cryptography.fernet import Fernet

from ..models.base import utcnow


class CredentialVault:
    """由 ECOS_SECRET_KEY 派生密钥；明文凭据永不落库。"""

    def __init__(self, secret_key: str) -> None:
        key = base64.urlsafe_b64encode(
            hashlib.sha256(secret_key.encode("utf-8")).digest()
        )
        self._fernet = Fernet(key)
        self._secret = secret_key.encode("utf-8")

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str) -> str:
        return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")

    @staticmethod
    def _epoch(dt: datetime | None) -> int:
        return calendar.timegm((dt or utcnow()).timetuple())

    def issue_gateway_token(
        self,
        instance_id: str,
        *,
        ttl_seconds: int = 900,
        now: datetime | None = None,
    ) -> str:
        """绑定实例的短时网关令牌：{过期epoch}.{签名}。"""
        exp = self._epoch(now) + ttl_seconds
        return f"{exp}.{self._gateway_sig(instance_id, exp)}"

    def verify_gateway_token(
        self,
        instance_id: str,
        token: str,
        *,
        now: datetime | None = None,
    ) -> bool:
        exp_str, _, sig = token.partition(".")
        try:
            exp = int(exp_str)
        except ValueError:
            return False
        if self._epoch(now) >= exp:
            return False
        expected = self._gateway_sig(instance_id, exp)
        return hmac.compare_digest(sig, expected)

    def _gateway_sig(self, instance_id: str, exp: int) -> str:
        return hmac.new(
            self._secret,
            f"gateway:{instance_id}:{exp}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()[:32]
