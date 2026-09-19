"""适配器注册表：gateway 模式连接器的本地执行面。"""

from typing import Any, Callable, Mapping

from ...errors import AdapterError

AdapterFn = Callable[..., dict[str, Any]]

_ADAPTERS: dict[str, dict[str, AdapterFn]] = {}


def register(kind: str, funcs: Mapping[str, AdapterFn]) -> None:
    _ADAPTERS[kind] = dict(funcs)


def call_adapter(kind: str, tool: str, args: Mapping[str, Any]) -> dict[str, Any]:
    by_tool = _ADAPTERS.get(kind)
    if by_tool is None:
        raise AdapterError(f"未知适配器: {kind}")
    func = by_tool.get(tool)
    if func is None:
        raise AdapterError(f"适配器 {kind} 未实现工具 {tool}")
    return dict(func(**dict(args)))
