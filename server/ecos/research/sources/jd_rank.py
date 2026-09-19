"""京东公开榜单页：货架销量代理与价格带信号。"""

from __future__ import annotations

import re
from typing import Any

from ..base import Signal, make_signal
from ..scraper import ScraperSource

BLOCK_RE = re.compile(r'data-sku="(\d+)"(.*?)(?=data-sku=|\Z)', re.S)
TITLE_RE = re.compile(r"<em>([^<]+)")
PRICE_RE = re.compile(r'p-price"><i>([\d.]+)')
COMMIT_RE = re.compile(r'p-commit"><strong>([^<]+)')

DEFAULT_CAT = "9987,2131,2133"


def _cn_count(raw: str) -> float:
    """'2万+'→20000、'5000+'→5000、'1.5亿'→1.5e8；千分位与加号剥除。"""
    text = (raw or "").replace(",", "").replace("+", "").strip()
    for suf, mult in (("万", 1e4), ("w", 1e4), ("亿", 1e8)):
        if text.endswith(suf):
            try:
                return float(text[: -len(suf)]) * mult
            except ValueError:
                return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


class JdRank(ScraperSource):
    id = "jd_rank"
    name = "京东榜单"
    board = "shelf"
    description = "京东类目列表页（评价数代理销量 + 标价；公开页，风控页自动按 blocked 降级）"
    url_template = f"https://list.jd.com/list.html?cat={{cat}}&sort=stock&desc=true"
    params = {"category": {"type": "string"}, "cat": {"type": "string"}}
    required = ("category",)

    def fetch(self, args: dict[str, Any]) -> list[Signal]:
        args.setdefault("cat", DEFAULT_CAT)
        return super().fetch(args)

    def parse(self, text: str) -> list[Signal]:
        url = f"https://list.jd.com/list.html?cat={DEFAULT_CAT}"
        signals: list[Signal] = []
        for _sku, block in BLOCK_RE.findall(text):
            title_m = TITLE_RE.search(block)
            if not title_m:
                continue
            keyword = re.sub(r"\s+", " ", title_m.group(1)).strip()[:40]
            if not keyword:
                continue
            price_m = PRICE_RE.search(block)
            if price_m:
                signals.append(
                    make_signal(self.id, "京东", keyword, "price_band",
                                float(price_m.group(1)), "now", url)
                )
            commit_m = COMMIT_RE.search(block)
            if commit_m:
                count = _cn_count(commit_m.group(1))
                if count > 0:
                    signals.append(
                        make_signal(self.id, "京东", keyword, "sales_proxy",
                                    count, "now", url)
                    )
        return signals
