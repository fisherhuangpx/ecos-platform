"""RBAC 五表：用户 / 角色 / 权限 + 两张关联表。"""

from sqlalchemy import Column, ForeignKey, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, new_id

user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", ForeignKey("users.user_id"), primary_key=True),
    Column("role_id", ForeignKey("roles.id"), primary_key=True),
)

role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", ForeignKey("roles.id"), primary_key=True),
    Column("permission_code", ForeignKey("permissions.code"), primary_key=True),
)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(default="")
    status: Mapped[str] = mapped_column(default="active")

    roles: Mapped[list["Role"]] = relationship(
        secondary=user_roles, back_populates="users", lazy="selectin"
    )


class Role(Base, TimestampMixin):
    __tablename__ = "roles"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("role")
    )
    code: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str] = mapped_column(default="")

    users: Mapped[list["User"]] = relationship(
        secondary=user_roles, back_populates="roles"
    )
    permissions: Mapped[list["Permission"]] = relationship(
        secondary=role_permissions, back_populates="roles", lazy="selectin"
    )


class Permission(Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(primary_key=True)
    description: Mapped[str] = mapped_column(default="")

    roles: Mapped[list["Role"]] = relationship(
        secondary=role_permissions, back_populates="permissions"
    )
