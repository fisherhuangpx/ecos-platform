"""声明式连接器目录：加载 catalog.d/*.yaml，含 read/write scope × 风险等级。"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Mapping

import yaml

CATALOG_DIR = Path(__file__).parent / "catalog.d"


class Scope(str, Enum):
    read = "read"
    write = "write"


class Risk(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class AuthKind(str, Enum):
    personal_token = "personal_token"
    oauth2 = "oauth2"
    api_key = "api_key"
    session_cookie = "session_cookie"
    custom_fields = "custom_fields"


class McpMode(str, Enum):
    remote = "remote"
    gateway = "gateway"


@dataclass(frozen=True)
class ToolDecl:
    name: str
    scope: Scope
    risk: Risk
    description: str = ""
    params: Mapping[str, Any] = field(default_factory=dict)
    required: tuple[str, ...] = ()

    @property
    def requires_approval(self) -> bool:
        """写操作一律需审批（闸门由 scope 推导，调用方不可关闭）。"""
        return self.scope is Scope.write

    @property
    def input_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": dict(self.params),
            "required": list(self.required),
        }

    def arg_errors(self, args: Mapping[str, Any]) -> list[str]:
        """校验调用参数是否落在目录声明的契约内。"""
        provided = set(args)
        errors = [
            f"缺少参数: {name}" for name in self.required if name not in provided
        ]
        errors += [
            f"未声明参数: {name}" for name in sorted(provided - set(self.params))
        ]
        errors += [
            f"参数不能为空: {name}"
            for name in self.required
            if name in provided
            and (args[name] is None or (isinstance(args[name], str) and not args[name].strip()))
        ]
        return errors


@dataclass(frozen=True)
class ConnectorEntry:
    kind: str
    name: str
    category: str
    auth_kind: AuthKind
    mcp_mode: McpMode
    description: str = ""
    mcp_url: str | None = None
    oauth_issuer: str | None = None
    oauth_scopes: tuple[str, ...] = ()
    credential_fields: tuple[str, ...] = ()
    tools: tuple[ToolDecl, ...] = ()

    def tool(self, name: str) -> ToolDecl | None:
        for tool in self.tools:
            if tool.name == name:
                return tool
        return None

    @property
    def read_tools(self) -> tuple[ToolDecl, ...]:
        return tuple(t for t in self.tools if t.scope is Scope.read)

    @property
    def write_tools(self) -> tuple[ToolDecl, ...]:
        return tuple(t for t in self.tools if t.scope is Scope.write)


def load_catalog(catalog_dir: Path) -> dict[str, ConnectorEntry]:
    catalog: dict[str, ConnectorEntry] = {}
    for path in sorted(Path(catalog_dir).glob("*.yaml")):
        entry = _parse_entry(path)
        if entry.kind in catalog:
            raise ValueError(f"连接器 kind 重复: {entry.kind} ({path})")
        catalog[entry.kind] = entry
    return catalog


def default_catalog() -> dict[str, ConnectorEntry]:
    return load_catalog(CATALOG_DIR)


def _parse_entry(path: Path) -> ConnectorEntry:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise ValueError(f"目录文件格式错误（应为映射）: {path}")
    for key in ("kind", "name", "auth_kind", "mcp_mode"):
        if not raw.get(key):
            raise ValueError(f"缺少必填字段 {key}: {path}")
    try:
        auth_kind = AuthKind(raw["auth_kind"])
        mcp_mode = McpMode(raw["mcp_mode"])
    except ValueError as exc:
        raise ValueError(f"字段取值非法 ({exc}): {path}") from exc
    if mcp_mode is McpMode.remote and not raw.get("mcp_url"):
        raise ValueError(f"remote 模式必须提供 mcp_url: {path}")
    if auth_kind is AuthKind.oauth2 and not raw.get("oauth_issuer"):
        raise ValueError(f"oauth2 授权必须提供 oauth_issuer: {path}")

    tools: list[ToolDecl] = []
    seen: set[str] = set()
    for item in raw.get("tools") or []:
        name = item.get("name")
        if not name or name in seen:
            raise ValueError(f"工具名缺失或重复: {name!r} ({path})")
        seen.add(name)
        try:
            scope = Scope(item.get("scope"))
            risk = Risk(item.get("risk"))
        except ValueError as exc:
            raise ValueError(f"工具 {name} 的 scope/risk 非法: {path}") from exc
        tools.append(
            ToolDecl(
                name=name,
                scope=scope,
                risk=risk,
                description=item.get("description", ""),
                params=item.get("params") or {},
                required=tuple(item.get("required") or ()),
            )
        )

    return ConnectorEntry(
        kind=raw["kind"],
        name=raw["name"],
        category=raw.get("category", ""),
        auth_kind=auth_kind,
        mcp_mode=mcp_mode,
        description=raw.get("description", ""),
        mcp_url=raw.get("mcp_url"),
        oauth_issuer=raw.get("oauth_issuer"),
        oauth_scopes=tuple(raw.get("oauth_scopes") or ()),
        credential_fields=tuple(raw.get("credential_fields") or ()),
        tools=tuple(tools),
    )
