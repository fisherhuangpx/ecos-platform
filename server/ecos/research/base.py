"""源抽象：所有数据盘统一到 Signal；契约风格对齐 connectors.ToolDecl。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Mapping, TypedDict

from ..models.base import utcnow

METRICS = ("heat", "trend", "rank", "sales_proxy", "price_band")
BOARDS = ("shelf", "content", "crossborder")
TIERS = ("live", "official", "licensed")


class Signal(TypedDict):
    source_id: str
    platform: str
    keyword: str
    metric: str
    value: float
    window: str
    url: str
    captured_at: str


class FetchError(Exception):
    """取数失败分类：timeout|blocked|layout|empty|unconfigured|unreachable。"""

    def __init__(self, kind: str, message: str = "") -> None:
        super().__init__(f"{kind}: {message}" if message else kind)
        self.kind = kind


def make_signal(
    source_id: str,
    platform: str,
    keyword: str,
    metric: str,
    value: float,
    window: str,
    url: str,
) -> Signal:
    if metric not in METRICS:
        raise ValueError(f"非法信号指标: {metric}（可选 {METRICS}）")
    return {
        "source_id": source_id,
        "platform": platform,
        "keyword": keyword,
        "metric": metric,
        "value": float(value),
        "window": window,
        "url": url,
        "captured_at": utcnow().isoformat(timespec="seconds"),
    }


class ResearchSource(ABC):
    id: str = ""
    name: str = ""
    board: str = ""
    tier: str = "live"
    description: str = ""
    ttl_seconds: int = 21600
    auth: str = "none"  # "none" | "vault:<kind>"
    min_interval_seconds: float = 2.0
    params: Mapping[str, Any] = {}
    required: tuple[str, ...] = ()

    def arg_errors(self, args: Mapping[str, Any]) -> list[str]:
        provided = set(args)
        errors = [f"缺少参数: {n}" for n in self.required if n not in provided]
        errors += [f"未声明参数: {n}" for n in sorted(provided - set(self.params))]
        errors += [
            f"参数不能为空: {n}"
            for n in self.required
            if n in provided
            and (args[n] is None or (isinstance(args[n], str) and not args[n].strip()))
        ]
        return errors

    def input_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": dict(self.params),
            "required": list(self.required),
        }

    def capabilities(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "board": self.board,
            "tier": self.tier,
            "description": self.description,
            "auth": self.auth,
            "input_schema": self.input_schema(),
        }

    @abstractmethod
    def fetch(self, args: dict[str, Any]) -> list[Signal]: ...
