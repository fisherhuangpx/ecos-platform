"""公开页面抓取基座：声明式 url + 纯函数 parse；失败分类只记不抛穿。"""

from __future__ import annotations

import time
from typing import Any

import httpx

from .base import FetchError, ResearchSource, Signal

BLOCK_MARKERS = ("验证码", "captcha", "安全验证", "access denied", "滑动验证")

_last_hit: dict[str, float] = {}


def fetch_http_text(
    url: str, *, timeout: float, proxy: str | None, headers: dict[str, str]
) -> str:
    with httpx.Client(
        timeout=timeout, proxy=proxy or None, headers=headers, follow_redirects=True
    ) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.text


class ScraperSource(ResearchSource):
    """子类契约：url_template（format 模板）、headers、use_proxy、parse()。"""

    url_template: str = ""
    headers: dict[str, str] = {
        "User-Agent": "ECOSResearchBot/0.1 (internal tool; contact: ops@example.com)"
    }
    use_proxy: bool = False
    proxy_url: str = ""
    http_timeout: float = 8.0

    def fetch(self, args: dict[str, Any]) -> list[Signal]:
        errs = self.arg_errors(args)
        if errs:
            raise ValueError(";".join(errs))
        if self.use_proxy and not self.proxy_url:
            raise FetchError("unreachable", f"源 {self.id} 需出境代理但未配置")
        text = self._rate_limited_get(self.url_template.format(**args))
        low = text.lower()
        if not text.strip() or any(m in low for m in BLOCK_MARKERS):
            raise FetchError("blocked", f"源 {self.id} 返回疑似风控页")
        signals = self.parse(text)
        if not signals:
            raise FetchError("empty", f"源 {self.id} 该品类无命中信号")
        return signals

    def _rate_limited_get(self, url: str) -> str:
        now = time.monotonic()
        gap = now - _last_hit.get(self.id, 0.0)
        if gap < self.min_interval_seconds:
            time.sleep(self.min_interval_seconds - gap)
        _last_hit[self.id] = time.monotonic()
        try:
            return fetch_http_text(
                url, timeout=self.http_timeout, proxy=self.proxy_url, headers=self.headers
            )
        except httpx.TimeoutException as exc:
            raise FetchError("timeout", str(exc)) from exc
        except httpx.HTTPError as exc:
            raise FetchError("blocked", str(exc)) from exc

    def parse(self, text: str) -> list[Signal]:
        raise NotImplementedError
