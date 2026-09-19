"""抖音热搜榜（公开接口）：需求脉冲信号。"""

from __future__ import annotations

import json

from ..base import FetchError, Signal, make_signal
from ..scraper import ScraperSource


class DouyinHot(ScraperSource):
    id = "douyin_hot"
    name = "抖音热搜榜"
    board = "content"
    description = "抖音公开热搜脉冲（词级热度，全品类混排，交叉层按品类词过滤）"
    url_template = "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/"
    params = {"category": {"type": "string"}}
    required = ("category",)

    def parse(self, text: str) -> list[Signal]:
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise FetchError("layout", str(exc)) from exc
        # 真实响应为顶层 word_list；旧版包一层 data，两者都兼容。
        rows = data.get("word_list") or (data.get("data") or {}).get("word_list") or []
        return [
            make_signal(
                self.id,
                "抖音",
                str(r.get("word", "")).strip(),
                "heat",
                float(r.get("hot_value") or 0),
                "now",
                "https://www.douyin.com/hot",
            )
            for r in rows
            if str(r.get("word", "")).strip()
        ]
