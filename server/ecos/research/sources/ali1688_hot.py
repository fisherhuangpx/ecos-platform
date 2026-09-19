"""1688 公开搜索热词：批发侧需求热度信号。"""

from __future__ import annotations

import json
import re

from ..base import Signal, make_signal
from ..scraper import ScraperSource

FALLBACK_RE = re.compile(r'"hotKeyWords":(\[.*?\])')


class Ali1688Hot(ScraperSource):
    id = "ali1688_hot"
    name = "1688 热搜词"
    board = "shelf"
    description = "1688 搜索场景公开热词（批发侧需求；probe 校准点，结构漂移时走正则兜底）"
    url_template = (
        "https://s.1688.com/selloffer/rpc.json?searchScene=pcSearchFind&keywords={category}"
    )
    params = {"category": {"type": "string"}}
    required = ("category",)

    def parse(self, text: str) -> list[Signal]:
        rows: list[dict] = []
        try:
            rows = (json.loads(text).get("result") or {}).get("hotKeyWords") or []
        except (json.JSONDecodeError, AttributeError):
            m = FALLBACK_RE.search(text)
            if m:
                try:
                    rows = json.loads(m.group(1))
                except json.JSONDecodeError:
                    rows = []
        url = "https://s.1688.com/"
        return [
            make_signal(
                self.id, "1688", str(r.get("keyword", "")).strip(), "heat",
                float(r.get("uv") or 0), "1d", url,
            )
            for r in rows
            if str(r.get("keyword", "")).strip()
        ]
