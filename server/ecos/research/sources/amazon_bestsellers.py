"""Amazon Best Sellers 榜单（公开页面）：跨境货架排名与价格带信号。"""

from __future__ import annotations

import re

from ..base import Signal, make_signal
from ..scraper import ScraperSource

RANK_RE = re.compile(r'zg-bdg-text[^>]*>\s*#\s*(\d+)')
TITLE_RE = re.compile(r'class="p13n-sc-truncate[^"]*"[^>]*>\s*([^<]{8,})')
PRICE_RE = re.compile(r'p13n-sc-price[^>]*>([^<]+)')
NUM_RE = re.compile(r"[\d,.]+")


def _price_value(raw: str) -> float:
    """价格文本 tolerant 解析：CNY/¥/$ 前缀与 &nbsp; 混排都取末尾数字。"""
    nums = NUM_RE.findall(raw or "")
    if not nums:
        return 0.0
    try:
        return float(nums[-1].replace(",", ""))
    except ValueError:
        return 0.0


class AmazonBestSellers(ScraperSource):
    id = "amazon_bestsellers"
    name = "Amazon Best Sellers"
    board = "crossborder"
    description = "Amazon 类目畅销榜（排名+价格带；出境代理可达，无代理时降级 unreachable）"
    url_template = "https://www.amazon.com/Best-Sellers/zgbs"
    use_proxy = True
    params = {"category": {"type": "string"}}
    required = ("category",)

    def parse(self, text: str) -> list[Signal]:
        titles = TITLE_RE.findall(text)
        if not titles:
            return []
        ranks = [int(r) for r in RANK_RE.findall(text)]
        prices = [_price_value(p) for p in PRICE_RE.findall(text)]
        url = "https://www.amazon.com/Best-Sellers/zgbs"
        signals: list[Signal] = []
        for i, title in enumerate(titles):
            keyword = title.strip()[:40]
            if not keyword:
                continue
            rank = ranks[i] if i < len(ranks) else i + 1
            signals.append(make_signal(self.id, "Amazon", keyword, "rank", rank, "1w", url))
            if i < len(prices) and prices[i] > 0:
                signals.append(
                    make_signal(self.id, "Amazon", keyword, "price_band", prices[i], "1w", url)
                )
        return signals
