"""人工冒烟：python scripts/research_probe.py <source_id> [category]

真网抓一次并把响应体写进 tests/fixtures/research/<id>.<ext>（覆盖前看 diff）。
仅公开 GET，UA 已声明为内部工具。"""

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecos.research.scraper import fetch_http_text  # noqa: E402
from ecos.research.sources import default_sources  # noqa: E402

TARGETS = {
    "douyin_hot": ".json",
    "google_trends": ".json",
    "amazon_bestsellers": ".html",
    "jd_rank": ".html",
    "ali1688_hot": ".json",
    "baidu_index": ".json",
    "juliang_trend": ".json",
}


def main() -> None:
    source_id = sys.argv[1] if len(sys.argv) > 1 else ""
    if source_id not in TARGETS:
        raise SystemExit(f"可选: {sorted(TARGETS)}")
    src = next(s for s in default_sources() if s.id == source_id)
    category = sys.argv[2] if len(sys.argv) > 2 else "手机支架"
    fmt = {
        "category": category,
        "geo": "CN",
        "cat": "9987,2131,2133",
        "begin_date": "20260912",
        "end_date": "20260918",
    }
    url = src.url_template.format(**fmt)
    text = fetch_http_text(url, timeout=15, proxy=src.proxy_url or None, headers=src.headers)
    out = (
        Path(__file__).resolve().parents[1]
        / "tests"
        / "fixtures"
        / "research"
        / f"{source_id}{TARGETS[source_id]}"
    )
    out.write_text(text, encoding="utf-8")
    print(f"captured {len(text)} bytes -> {out}")
    print("若真实结构与代表 fixture 不同：以真实结构为准更新 fixture 与 parse 选择器。")


if __name__ == "__main__":
    main()
