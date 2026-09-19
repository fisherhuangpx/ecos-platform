"""数据源实现集合：live 公开源 + official/licensed 凭据壳。

注册表按配置装配：research_disabled_sources 拉闸、research_proxy_url 注入出境源。
"""

from __future__ import annotations

from ..base import ResearchSource
from .ali1688_hot import Ali1688Hot
from .amazon_bestsellers import AmazonBestSellers
from .baidu_index import BaiduIndex
from .douyin_hot import DouyinHot
from .google_trends import GoogleTrends
from .jd_rank import JdRank
from .juliang_trend import JuliangTrend
from .shells import Chanmama, TaobaoOpen


def _no_credentials(kind: str) -> None:
    return None


def default_sources(
    settings=None,
    disabled: frozenset[str] = frozenset(),
    vault_lookup=None,
) -> list[ResearchSource]:
    """装配启用源：7 live + 2 凭据壳；disabled 对壳同样生效。"""
    pulled = disabled | {
        s.strip()
        for s in (getattr(settings, "research_disabled_sources", "") or "").split(",")
        if s.strip()
    }
    lookup = vault_lookup or _no_credentials
    sources: list[ResearchSource] = [
        DouyinHot(),
        JdRank(),
        Ali1688Hot(),
        GoogleTrends(),
        AmazonBestSellers(),
        BaiduIndex(),
        JuliangTrend(),
        TaobaoOpen(credential_lookup=lookup),
        Chanmama(credential_lookup=lookup),
    ]
    live = [s for s in sources if s.id not in pulled]
    proxy = getattr(settings, "research_proxy_url", "") if settings is not None else ""
    if proxy:
        for s in live:
            if getattr(s, "use_proxy", False):
                s.proxy_url = proxy
    return live
