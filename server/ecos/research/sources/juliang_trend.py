"""巨量算数公开热词指数：内容侧趋势信号。风控敏感，blocked 即降级（同 baidu_index）。"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from ...models.base import utcnow
from ..base import FetchError, Signal, make_signal
from ..scraper import ScraperSource


class JuliangTrend(ScraperSource):
    id = "juliang_trend"
    name = "巨量算数"
    board = "content"
    description = "巨量算数算术指数热词（近 7 日趋势；未握手时 blocked 降级）"
    url_template = (
        "https://trendinsight.oceanengine.com/arithmetic-index/analysisHotWord"
        "?category_name=全部&begin_date={begin_date}&end_date={end_date}&size=20&page=1"
    )
    params = {
        "category": {"type": "string"},
        "begin_date": {"type": "string"},
        "end_date": {"type": "string"},
    }
    required = ("category",)

    def fetch(self, args: dict[str, Any]) -> list[Signal]:
        today = utcnow().date()
        args.setdefault("end_date", (today - timedelta(days=1)).strftime("%Y%m%d"))
        args.setdefault("begin_date", (today - timedelta(days=7)).strftime("%Y%m%d"))
        return super().fetch(args)

    def parse(self, text: str) -> list[Signal]:
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            # 未握手时返回 SPA 空壳页，属预期降级路径（同 baidu_index，验收不依赖）。
            raise FetchError("blocked", f"巨量算数握手失败（设计内降级）: {exc}") from exc
        rows = (data.get("data") or {}).get("hot_words") or []
        return [
            make_signal(
                self.id, "抖音", str(r.get("word", "")).strip(), "trend",
                float(r.get("hot_value") or 0), "7d",
                "https://trendinsight.oceanengine.com/arithmetic-index",
            )
            for r in rows
            if str(r.get("word", "")).strip()
        ]
