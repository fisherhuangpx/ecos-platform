"""领域异常层级（供 API 层做 HTTP 映射）。"""


class EcosError(Exception):
    """ecos 领域异常基类。"""


class NotFoundError(EcosError):
    """目标对象不存在。"""


class ConnectorError(EcosError):
    """连接器域异常基类。"""


class UnknownConnectorKind(ConnectorError):
    """目录中不存在该连接器类型。"""


class ConnectorValidationError(ConnectorError):
    """安装参数/凭据字段不合法。"""


class ConnectorInactive(ConnectorError):
    """连接器未安装、已撤销或不可用。"""


class ConnectorAuthError(ConnectorError):
    """凭据过期或即将过期，需要重新授权。"""


class ToolNotAllowed(ConnectorError):
    """工具不在连接器声明白名单内。"""


class AdapterError(EcosError):
    """连接器适配器执行失败（平台侧错误/限流等）。"""


class ApprovalRequired(EcosError):
    """写操作未经审批，禁止执行。"""


class TaskStateError(EcosError):
    """任务状态不允许该操作。"""


class Unauthorized(EcosError):
    """未认证：token 缺失、非法或已过期。"""


class PermissionDenied(EcosError):
    """已认证但缺少所需权限（RBAC 判定）。"""


class ApprovalForbidden(EcosError):
    """职责分离违规：任务属主/发起人不得审批自己的写操作。"""
