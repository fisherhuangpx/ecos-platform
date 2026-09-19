"""RBAC 种子与查询：权限目录、角色定义、授权与有效权限计算。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Permission, Role, User

PERMISSIONS: dict[str, str] = {
    "connector.view": "查看连接器目录与实例",
    "connector.install": "安装连接器",
    "connector.revoke": "撤销连接器",
    "task.create": "创建任务",
    "task.run": "执行任务",
    "task.retry": "重试失败步骤",
    "task.view": "查看任务",
    "task.approve": "审批写操作任务",
    "approval.view": "查看审批单",
    "audit.view": "查看审计流水",
    "user.manage": "管理用户与角色授权",
    "commerce.view": "查看交易域数据",
    "commerce.manage": "维护店铺/草稿/资产/收藏",
    "research.run": "运行 AI 选品研究",
    "ai.use": "使用 AI 洞察与归因",
    "ticket.review": "裁决售后工单",
}

ROLES: dict[str, tuple[str, ...]] = {
    "admin": tuple(PERMISSIONS),
    "operator": (
        "connector.view",
        "connector.install",
        "connector.revoke",
        "task.create",
        "task.run",
        "task.retry",
        "task.view",
        "approval.view",
        "audit.view",
        "commerce.view",
        "commerce.manage",
        "research.run",
        "ai.use",
        "ticket.review",
    ),
    "approver": (
        "connector.view",
        "task.view",
        "approval.view",
        "task.approve",
        "audit.view",
        "commerce.view",
        "ticket.review",
    ),
    "viewer": ("connector.view", "task.view", "approval.view", "commerce.view"),
}

ROLE_NAMES = {
    "admin": "管理员",
    "operator": "运营",
    "approver": "审批人",
    "viewer": "只读",
}


def seed_rbac(session: Session) -> None:
    """幂等写入权限目录与四个内置角色（角色权限以代码声明为准）。"""
    for code, desc in PERMISSIONS.items():
        if session.get(Permission, code) is None:
            session.add(Permission(code=code, description=desc))
    session.flush()
    for role_code, perms in ROLES.items():
        role = session.execute(
            select(Role).where(Role.code == role_code)
        ).scalar_one_or_none()
        if role is None:
            role = Role(code=role_code, name=ROLE_NAMES.get(role_code, role_code))
            session.add(role)
        role.permissions = [session.get(Permission, p) for p in perms]
    session.flush()


def ensure_user(
    session: Session, user_id: str, *, display_name: str = ""
) -> User:
    user = session.get(User, user_id)
    if user is None:
        user = User(user_id=user_id, display_name=display_name)
        session.add(user)
        session.flush()
    elif display_name and not user.display_name:
        user.display_name = display_name
    return user


def grant_role(session: Session, user_id: str, role_code: str) -> User:
    role = session.execute(
        select(Role).where(Role.code == role_code)
    ).scalar_one_or_none()
    if role is None:
        raise ValueError(f"角色不存在: {role_code}")
    user = ensure_user(session, user_id)
    if role not in user.roles:
        user.roles.append(role)
        session.flush()
    return user


def effective_permissions(
    session: Session, user_id: str
) -> tuple[tuple[str, ...], frozenset[str]]:
    user = session.get(User, user_id)
    if user is None:
        return (), frozenset()
    roles = tuple(sorted(r.code for r in user.roles))
    perms: set[str] = set()
    for role in user.roles:
        perms.update(p.code for p in role.permissions)
    return roles, frozenset(perms)
