"""连接器适配器注册表（gateway 模式的本地桥接实现）。"""

from . import demo_shop, platforms  # noqa: F401  触发内置适配器注册
from .registry import AdapterFn, call_adapter, register

__all__ = ["AdapterFn", "call_adapter", "demo_shop", "register"]
