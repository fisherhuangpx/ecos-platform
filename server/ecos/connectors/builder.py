"""MCP spec 生成：remote（厂商托管 MCP）/ gateway（内部网关）双模式。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from ..models import ConnectorInstance
from .catalog import ConnectorEntry, McpMode


@dataclass(frozen=True)
class McpServerSpec:
    name: str
    transport: str
    url: str
    headers: Mapping[str, str]


def server_name(kind: str, instance_id: str) -> str:
    """Octop 约定：{kind}__{instance_id}。"""
    return f"{kind}__{instance_id}"


def internal_mcp_url(gateway_base_url: str, kind: str, instance_id: str) -> str:
    return f"{gateway_base_url.rstrip('/')}/api/internal/mcp/{kind}/{instance_id}"


def build_mcp_spec(
    entry: ConnectorEntry,
    instance: ConnectorInstance,
    *,
    credential: str | None,
    gateway_base_url: str,
    gateway_token: str,
) -> McpServerSpec:
    name = server_name(entry.kind, instance.id)
    if entry.mcp_mode is McpMode.remote:
        headers = {"Authorization": f"Bearer {credential}"} if credential else {}
        return McpServerSpec(
            name=name,
            transport="http",
            url=entry.mcp_url or "",
            headers=headers,
        )
    url = f"{internal_mcp_url(gateway_base_url, entry.kind, instance.id)}?token={gateway_token}"
    return McpServerSpec(name=name, transport="http", url=url, headers={})
