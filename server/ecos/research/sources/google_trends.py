"""Google Trends 每日趋势（公开 JSON 端点）：跨境需求走势信号。"""

from __future__ import annotations

import json
from typing import Any

from ..base import FetchError, Signal, make_signal
from ..scraper import ScraperSource

_SUFFIX = {"K": 1e3, "M": 1e6, "万": 1e4, "亿": 1e8}


def _traffic_to_float(raw: str) -> float:
    """'100K+'→100000、'1.2M+'→1200000、'2万+'→20000、纯数字直转，失败 0。"""
    text = (raw or "").strip().rstrip("+")
    for suf, mult in _SUFFIX.items():
        if text.endswith(suf):
            try:
                return float(text[: -len(suf)]) * mult
            except ValueError:
                return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


class GoogleTrends(ScraperSource):
    id = "google_trends"
    name = "Google Trends"
    board = "crossborder"
    description = "Google 每日热搜趋势（出境代理可达；无代理时源自身降级为 unreachable）"
    url_template = (
        "https://trends.google.com/trends/api/dailytrends?hl=zh-CN&tz=-480&geo={geo}"
    )
    use_proxy = True
    params = {
        "category": {"type": "string"},
        "geo": {"type": "string"},
    }
    required = ("category",)

    def fetch(self, args: dict[str, Any]) -> list[Signal]:
        args.setdefault("geo", "CN")
        return super().fetch(args)

    def parse(self, text: str) -> list[Signal]:
        payload = text.partition("\n")[2] if text.lstrip().startswith(")]}'") else text
        try:
            data = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise FetchError("layout", str(exc)) from exc
        days = (data.get("default") or {}).get("trendingSearchesDays") or []
        url = "https://trends.google.com/trends/daily?geo=CN"
        signals: list[Signal] = []
        for day in days:
            for item in day.get("trendingSearches") or []:
                query = str((item.get("title") or {}).get("query", "")).strip()
                traffic = _traffic_to_float(str(item.get("formattedTraffic", "")))
                if query and traffic > 0:
                    signals.append(
                        make_signal(self.id, "Google", query, "trend", traffic, "1d", url)
                    )
                for rel in item.get("relatedQueries") or []:
                    rq = str(rel.get("query", "")).strip()
                    if rq:
                        signals.append(
                            make_signal(
                                self.id, "Google", rq, "trend", traffic * 0.4, "1d", url
                            )
                        )
        return signals
