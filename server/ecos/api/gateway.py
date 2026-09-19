"""内部 MCP 网关：JSON-RPC 2.0 子集（initialize / tools/list / tools/call）。

机机端点：绑定实例的过期签名令牌鉴权；写操作只落审批任务，绝不直接执行。
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..connectors.adapters import call_adapter
from ..models import ConnectorInstance
from ..tasks.engine import spec_from_tool
from .deps import Services, get_services

router = APIRouter(prefix="/api/internal/mcp")

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602


def _error(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _result(req_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _tool_content(payload: Any, *, is_error: bool = False) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
        "isError": is_error,
    }


@router.post("/{kind}/{instance_id}")
async def mcp_endpoint(
    kind: str,
    instance_id: str,
    request: Request,
    svc: Services = Depends(get_services),
    token: str = "",
) -> Any:
    instance = svc.session.get(ConnectorInstance, instance_id)
    if instance is None or instance.kind != kind or instance.status != "active":
        return JSONResponse(
            status_code=404,
            content=_error(None, -32001, f"连接器实例不可用: {instance_id}"),
        )
    vault = request.app.state.vault
    if not vault.verify_gateway_token(instance_id, token):
        svc.audit.log(
            user_id=instance.user_id,
            actor="mcp-gateway",
            action="connector.gateway.denied",
            target_type="connector_instance",
            target_id=instance_id,
            level="system",
            result="denied",
        )
        return JSONResponse(
            status_code=401,
            content=_error(None, -32001, "网关令牌无效或已过期"),
        )

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 响应体内按 JSON-RPC 错误返回
        return JSONResponse(content=_error(None, PARSE_ERROR, "请求体不是合法 JSON"))
    if not isinstance(body, dict):
        return JSONResponse(content=_error(None, INVALID_REQUEST, "请求必须是 JSON-RPC 对象"))

    req_id = body.get("id")
    method = body.get("method") or ""
    params = body.get("params") or {}
    entry = svc.connectors.catalog.get(kind)
    if entry is None:
        return JSONResponse(
            status_code=404,
            content=_error(req_id, -32001, f"连接器不存在: {kind}"),
        )

    if method == "initialize":
        return _result(
            req_id,
            {
                "protocolVersion": params.get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": instance.mcp_server_name, "version": "1.0.0"},
            },
        )
    if method == "notifications/initialized":
        return _result(req_id, {})
    if method == "tools/list":
        return _result(
            req_id,
            {
                "tools": [
                    {
                        "name": decl.name,
                        "description": decl.description,
                        "inputSchema": decl.input_schema,
                        "risk": decl.risk.value,
                        "requiresApproval": decl.requires_approval,
                    }
                    for decl in entry.tools
                ]
            },
        )
    if method == "tools/call":
        return _tools_call(svc, instance, entry, params, req_id)
    return JSONResponse(content=_error(req_id, METHOD_NOT_FOUND, f"未知方法: {method}"))


def _tools_call(svc: Services, instance, entry, params: dict, req_id: Any) -> dict:
    name = str(params.get("name") or "")
    arguments = params.get("arguments") or {}
    if not isinstance(arguments, dict):
        return _error(req_id, INVALID_PARAMS, "arguments 必须是对象")
    decl = entry.tool(name)
    if decl is None:
        return _error(req_id, INVALID_PARAMS, f"工具不存在: {name}")
    errors = decl.arg_errors(arguments)
    if errors:
        return _error(
            req_id,
            INVALID_PARAMS,
            f"工具 {name} 参数不符合目录契约: {'；'.join(errors)}",
        )

    if decl.requires_approval:
        spec = spec_from_tool(
            name=f"mcp:{name}",
            tool_ref=f"{entry.kind}:{name}",
            decl=decl,
            args=arguments,
        )
        task = svc.engine.create_task(
            user_id=instance.user_id,
            type="connector_write",
            title=f"MCP 网关写入：{entry.name} · {name}",
            steps=[spec],
            payload={"source": "mcp-gateway"},
        )
        svc.engine.submit(task, requested_by="mcp-gateway")
        svc.audit.log(
            user_id=instance.user_id,
            actor="mcp-gateway",
            action=f"tool.{name}",
            target_type="connector_instance",
            target_id=instance.id,
            level="high_risk" if decl.risk.value == "high" else "write",
            detail={"arguments": arguments, "task_id": task.id},
        )
        svc.session.commit()
        return _result(
            req_id,
            _tool_content(
                {
                    "status": task.status,
                    "task_id": task.id,
                    "approval_required": True,
                    "message": "写操作已提交审批，通过后由任务引擎执行",
                }
            ),
        )

    try:
        output = call_adapter(entry.kind, name, dict(arguments))
    except Exception as exc:  # noqa: BLE001 适配器失败以 isError 返回
        svc.audit.log(
            user_id=instance.user_id,
            actor="mcp-gateway",
            action=f"tool.{name}",
            target_type="connector_instance",
            target_id=instance.id,
            level="read",
            result="failed",
            detail={"arguments": arguments, "error": str(exc)},
        )
        return _result(req_id, _tool_content({"error": str(exc)}, is_error=True))
    svc.audit.log(
        user_id=instance.user_id,
        actor="mcp-gateway",
        action=f"tool.{name}",
        target_type="connector_instance",
        target_id=instance.id,
        level="read",
        detail={"arguments": arguments},
    )
    return _result(req_id, _tool_content(output))
