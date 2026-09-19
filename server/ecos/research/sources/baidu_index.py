"""百度指数公开端点：搜索走势信号。默认降级源——需登录握手，非 JSON 即 blocked（设计内路径）。"""

from __future__ import annotations

import json

from ..base import FetchError, Signal, make_signal
from ..scraper import ScraperSource


class BaiduIndex(ScraperSource):
    id = "baidu_index"
    name = "百度指数"
    board = "content"
    description = "百度指数趋势端点（未登录常触发风控；blocked 属预期降级，验收不依赖此源）"
    url_template = "https://index.baidu.com/api/trend/api?area=all&words={category}"
    params = {"category": {"type": "string"}}
    required = ("category",)

    def parse(self, text: str) -> list[Signal]:
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise FetchError("blocked", f"百度指数握手失败（设计内降级）: {exc}") from exc
        signals: list[Signal] = []
        for word, points in (data.get("Data") or {}).items():
            if points and isinstance(points, list):
                signals.append(
                    make_signal(
                        self.id, "百度", str(word).strip(), "trend",
                        float(points[0].get("all") or 0), str(points[0].get("day", "now")),
                        "https://index.baidu.com/",
                    )
                )
        return signals
