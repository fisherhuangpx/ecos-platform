"""凭据型源（official 开放平台 / licensed 第三方）：本期为壳，契约先行。"""

from __future__ import annotations

from typing import Any, Callable

from .base import FetchError, ResearchSource, Signal


class VaultApiSource(ResearchSource):
    tier = "official"
    vault_kind: str = ""
    credential_lookup: Callable[[str], dict[str, Any] | None] = staticmethod(
        lambda kind: None
    )

    def __init__(self, *, credential_lookup=None) -> None:
        if credential_lookup is not None:
            self.credential_lookup = credential_lookup
        self.auth = f"vault:{self.vault_kind}"

    def _credentials(self) -> dict[str, Any] | None:
        return self.credential_lookup(self.vault_kind)

    def health(self) -> str:
        return "configured" if self._credentials() else "awaiting_credentials"

    def fetch(self, args: dict[str, Any]) -> list[Signal]:
        errs = self.arg_errors(args)
        if errs:
            raise ValueError(";".join(errs))
        if not self._credentials():
            raise FetchError("unconfigured", f"{self.id} 未配置凭据实例")
        raise FetchError("unconfigured", f"{self.id} 真实 HTTP 对接未排期（壳）")
