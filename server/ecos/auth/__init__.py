"""身份与权限：IdentityProvider + RBAC。"""

from .identity import (
    IdentityProvider,
    LocalDirectoryIdP,
    OidcIdP,
    Principal,
    build_idp,
)
from .rbac import (
    PERMISSIONS,
    ROLES,
    effective_permissions,
    ensure_user,
    grant_role,
    seed_rbac,
)

__all__ = [
    "PERMISSIONS",
    "ROLES",
    "IdentityProvider",
    "LocalDirectoryIdP",
    "OidcIdP",
    "Principal",
    "build_idp",
    "effective_permissions",
    "ensure_user",
    "grant_role",
    "seed_rbac",
]
