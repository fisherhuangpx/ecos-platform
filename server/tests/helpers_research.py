"""研究流水线测试的假源：注入信号、模拟失败，不碰网络。"""

from __future__ import annotations

from ecos.research.base import FetchError, ResearchSource, Signal, make_signal


class FakeSource(ResearchSource):
    tier = "live"

    def __init__(
        self,
        id: str,
        board: str,
        signals: list[Signal] | None = None,
        fail: str | None = None,
    ) -> None:
        self.id, self.name, self.board = id, id, board
        self._signals = signals or []
        self._fail = fail  # None | FetchError kind

    def fetch(self, args):
        if self._fail:
            raise FetchError(self._fail, f"{self.id} 注入失败")
        return list(self._signals)


def sig(source_id, platform, keyword, metric, value, window="7d", url=None):
    return make_signal(
        source_id,
        platform,
        keyword,
        metric,
        value,
        window,
        url or f"https://example.com/{source_id}",
    )
