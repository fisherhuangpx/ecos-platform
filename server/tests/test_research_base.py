"""源抽象契约：arg_errors 与 ToolDecl 同构；capabilities 可 JSON 化；fetch 契约。"""

import json

import pytest

from ecos.research.base import FetchError, ResearchSource, make_signal


class EchoSource(ResearchSource):
    id = "echo"
    name = "回声源"
    board = "shelf"
    tier = "live"
    params = {"category": {"type": "string"}, "window": {"type": "string"}}
    required = ("category",)

    def fetch(self, args):
        return [
            make_signal(self.id, "京东", args["category"], "heat", 1.0, "7d", "https://e")
        ]


def test_arg_errors_parity_with_tool_decl():
    src = EchoSource()
    assert src.arg_errors({"category": "支架"}) == []
    assert src.arg_errors({}) == ["缺少参数: category"]
    assert src.arg_errors({"category": "  "}) == ["参数不能为空: category"]
    assert src.arg_errors({"category": "x", "nope": 1}) == ["未声明参数: nope"]


def test_capabilities_json_safe_and_schema():
    caps = EchoSource().capabilities()
    assert json.loads(json.dumps(caps))["id"] == "echo"
    assert caps["input_schema"] == {
        "type": "object",
        "properties": {"category": {"type": "string"}, "window": {"type": "string"}},
        "required": ["category"],
    }


def test_make_signal_shape_and_metric_guard():
    sig = make_signal("echo", "京东", "支架", "heat", 12.5, "7d", "https://e")
    assert set(sig) == {
        "source_id", "platform", "keyword", "metric",
        "value", "window", "url", "captured_at",
    }
    with pytest.raises(ValueError):
        make_signal("echo", "京东", "支架", "gmv", 1, "7d", "https://e")


def test_fetch_error_carries_kind():
    err = FetchError("blocked", "风控页")
    assert err.kind == "blocked" and "blocked" in str(err)
