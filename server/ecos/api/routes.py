"""REST 路由：连接器 / 任务 / 审批 / 审计。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select

from ..auth.rbac import ROLES, effective_permissions, ensure_user, grant_role
from ..config import Settings
from ..errors import ConnectorValidationError, NotFoundError, ToolNotAllowed
from ..models import Task
from ..tasks.engine import StepSpec, spec_from_tool
from . import serializers
from .deps import Services, get_services

router = APIRouter(prefix="/api")


class InstallPayload(BaseModel):
    kind: str
    credentials: dict[str, str] = Field(default_factory=dict)


class StepPayload(BaseModel):
    name: str
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)
    requires_approval: bool | None = None
    """客户端只能回显；闸门一律由目录 scope 在服务端推导。"""


class TaskPayload(BaseModel):
    type: str
    title: str
    payload: dict[str, Any] = Field(default_factory=dict)
    steps: list[StepPayload]


class DecidePayload(BaseModel):
    approver: str
    decision: str
    note: str | None = None


class MintPayload(BaseModel):
    user_id: str


class UserPayload(BaseModel):
    user_id: str
    display_name: str = ""


class RolePayload(BaseModel):
    role: str


@router.get("/meta")
def meta(request: Request) -> dict[str, Any]:
    """公开元信息（无鉴权）：前端登录页显隐与模式判定用，不暴露敏感数据。"""
    settings: Settings = request.app.state.settings
    return {
        "auth_enabled": settings.auth_enabled,
        "auth_mode": settings.auth_mode,
        "app_version": "0.1.0",
    }


@router.post("/auth/token")
def mint_token(
    payload: MintPayload, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    if not svc.settings.auth_enabled:
        raise ValueError("未开启认证（ECOS_AUTH_ENABLED=false），无需令牌")
    if svc.settings.auth_mode != "local":
        raise ValueError("本地自签未启用，请从企业 IdP（OIDC）获取令牌")
    token = svc.idp.mint_token(svc.session, payload.user_id)
    svc.audit.log(
        user_id=payload.user_id,
        actor=f"user:{payload.user_id}",
        action="auth.token_mint",
        target_type="user",
        target_id=payload.user_id,
        level="system",
    )
    svc.session.commit()
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": svc.settings.jwt_ttl_seconds,
    }


@router.get("/auth/me")
def whoami(svc: Services = Depends(get_services)) -> dict[str, Any]:
    return {"principal": serializers.principal_out(svc.principal)}


@router.get("/auth/roles")
def list_roles(svc: Services = Depends(get_services)) -> dict[str, Any]:
    return {
        "roles": [
            {"code": code, "permissions": list(perms)}
            for code, perms in ROLES.items()
        ]
    }


@router.post("/admin/users")
def create_user(
    payload: UserPayload, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require("user.manage")
    user = ensure_user(svc.session, payload.user_id, display_name=payload.display_name)
    svc.audit.log(
        user_id=svc.user_id,
        actor=f"user:{svc.user_id}",
        action="rbac.user_upsert",
        target_type="user",
        target_id=user.user_id,
        level="system",
    )
    svc.session.commit()
    return {
        "user": {
            "user_id": user.user_id,
            "display_name": user.display_name,
            "status": user.status,
        }
    }


@router.post("/admin/users/{user_id}/roles")
def assign_role(
    user_id: str, payload: RolePayload, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require("user.manage")
    try:
        grant_role(svc.session, user_id, payload.role)
    except ValueError as exc:
        raise NotFoundError(str(exc)) from exc
    roles, _ = effective_permissions(svc.session, user_id)
    svc.audit.log(
        user_id=svc.user_id,
        actor=f"user:{svc.user_id}",
        action="rbac.role_grant",
        target_type="user",
        target_id=user_id,
        level="system",
        detail={"role": payload.role},
    )
    svc.session.commit()
    return {"user_id": user_id, "roles": list(roles)}


@router.get("/connectors/catalog")
def get_catalog(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require("connector.view")
    return {
        "connectors": [
            serializers.entry_out(entry) for entry in svc.connectors.catalog.values()
        ]
    }


@router.post("/connectors/install")
def install(
    payload: InstallPayload, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require("connector.install")
    instance = svc.connectors.install(
        user_id=svc.user_id, kind=payload.kind, credentials=payload.credentials
    )
    svc.session.commit()
    return {"instance": serializers.instance_out(instance)}


@router.get("/connectors/instances")
def list_instances(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require("connector.view")
    return {
        "instances": [
            serializers.instance_out(item)
            for item in svc.connectors.list_instances(svc.user_id)
        ]
    }


@router.get("/connectors/instances/{instance_id}/mcp-spec")
def get_mcp_spec(
    instance_id: str, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require("connector.view")
    instance = _get_instance(svc, instance_id)
    spec = svc.connectors.mcp_spec(instance)
    return {
        "spec": {
            "name": spec.name,
            "transport": spec.transport,
            "url": spec.url,
            "headers": dict(spec.headers),
        }
    }


@router.post("/connectors/instances/{instance_id}/revoke")
def revoke_instance(
    instance_id: str, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require("connector.revoke")
    instance = _get_instance(svc, instance_id)
    instance = svc.connectors.revoke(instance, by=svc.user_id)
    svc.session.commit()
    return {"instance": serializers.instance_out(instance)}


@router.get("/tasks")
def list_tasks(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require("task.view")
    conds = [Task.user_id == svc.user_id]
    if svc.settings.auth_enabled and "task.approve" in svc.principal.permissions:
        # 审批队列：他人待审批任务对持 task.approve 者可见，否则认证模式下审批闸门没有入口
        conds.append(
            and_(Task.user_id != svc.user_id, Task.status == "pending_approval")
        )
    rows = (
        svc.session.execute(
            select(Task).where(or_(*conds)).order_by(Task.created_at.desc())
        )
        .scalars()
        .all()
    )
    return {
        "tasks": [
            serializers.task_out(task, svc.approvals.for_task(task)) for task in rows
        ]
    }


@router.post("/tasks")
def create_task(
    payload: TaskPayload, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require("task.create")
    specs: list[StepSpec] = []
    for item in payload.steps:
        kind, _, tool_name = item.tool.partition(":")
        if not kind or not tool_name:
            raise ToolNotAllowed(f"工具引用格式应为 kind:tool: {item.tool}")
        _, decl = svc.connectors.resolve_tool(svc.user_id, kind, tool_name)
        errors = decl.arg_errors(item.args)
        if errors:
            raise ConnectorValidationError(
                f"{item.tool} 参数不符合目录契约: {'；'.join(errors)}"
            )
        specs.append(
            spec_from_tool(
                name=item.name,
                tool_ref=item.tool,
                decl=decl,
                args=item.args,
            )
        )
    task = svc.engine.create_task(
        user_id=svc.user_id,
        type=payload.type,
        title=payload.title,
        steps=specs,
        payload=payload.payload,
    )
    requester = svc.principal.user_id if svc.settings.auth_enabled else "system"
    svc.engine.submit(task, requested_by=requester)
    svc.session.commit()
    return {"task": serializers.task_out(task, svc.approvals.for_task(task))}


@router.post("/tasks/{task_id}/run")
def run_task(task_id: str, svc: Services = Depends(get_services)) -> dict[str, Any]:
    is_approver = (
        svc.settings.auth_enabled and "task.approve" in svc.principal.permissions
    )
    if not is_approver:
        # 权限 403 先于租户 404：无 task.run 且非审批身份时在此拦下并留痕
        svc.require("task.run")
    task = _get_task(svc, task_id, approver_may_trigger=is_approver)
    svc.engine.run(task)
    svc.session.commit()
    return {"task": serializers.task_out(task, svc.approvals.for_task(task))}


@router.post("/tasks/{task_id}/retry")
def retry_task(task_id: str, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require("task.retry")
    task = _get_task(svc, task_id)
    svc.engine.retry_failed(task)
    svc.session.commit()
    return {"task": serializers.task_out(task, svc.approvals.for_task(task))}


@router.post("/approvals/{approval_id}/decide")
def decide_approval(
    approval_id: str, payload: DecidePayload, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require("task.approve")
    approver = payload.approver.strip()
    if svc.settings.auth_enabled:
        if approver and approver != svc.principal.user_id:
            raise ValueError("审批人与当前登录身份不一致，不允许代批")
        approver = svc.principal.user_id
    approval = svc.approvals.get(approval_id)
    task = svc.session.get(Task, approval.task_id)
    if task is None:
        raise NotFoundError(f"审批单不存在: {approval_id}")
    if not svc.settings.auth_enabled and task.user_id != svc.user_id:
        # 未接认证时的租户兜底：他人审批单不可见（不泄露存在性）；
        # 认证模式下由 task.approve 角色 + 职责分离把关
        raise NotFoundError(f"审批单不存在: {approval_id}")
    approval = svc.approvals.decide(
        approval_id,
        approver=approver,
        decision=payload.decision,
        note=payload.note,
    )
    svc.session.commit()
    return {"approval": serializers.approval_out(approval)}


@router.get("/audit")
def list_audit(
    limit: int = 100, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require("audit.view")
    rows = svc.audit.list(user_id=svc.user_id, limit=limit)
    return {"entries": [serializers.audit_out(row) for row in rows]}


def _get_task(svc: Services, task_id: str, approver_may_trigger: bool = False) -> Task:
    task = svc.session.get(Task, task_id)
    if task is None or task.user_id != svc.user_id:
        # 不泄露存在性：他人任务与不存在任务同样返回 404；
        # 唯一例外是审批人触发「已批准待执行」的任务（凭据仍按属主解析）
        if not (approver_may_trigger and task is not None and task.status == "approved"):
            raise NotFoundError(f"任务不存在: {task_id}")
    return task


def _get_instance(svc: Services, instance_id: str):
    instance = svc.connectors.get(instance_id)
    if instance.user_id != svc.user_id:
        raise NotFoundError(f"连接器实例不存在: {instance_id}")
    return instance
