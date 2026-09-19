"""运行配置：全部经环境变量（前缀 ECOS_）注入。"""

from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET_KEY = "dev-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ECOS_", extra="ignore")

    env: str = "dev"  # dev | prod
    database_url: str = "sqlite:///./ecos.db"
    secret_key: str = DEFAULT_SECRET_KEY
    gateway_base_url: str = "http://localhost:8000"
    default_user_id: str = "dev-user"

    model_name: str = ""
    model_api_key: str = ""
    model_base_url: str = ""

    # 认证与授权
    auth_enabled: bool = False  # false=开发模式，身份取 default_user_id
    auth_mode: str = "local"  # local（自签 HS256）| oidc（企业 IdP RS256+JWKS）
    jwt_ttl_seconds: int = 8 * 3600
    oidc_issuer: str = ""
    oidc_audience: str = "ecos-server"

    # 内部 MCP 网关
    gateway_token_ttl_seconds: int = 900

    # 选品调研（research 子域）
    research_enabled: bool = True
    research_source_ttl: int = 21600          # 快照缓存秒数（默认 6h）
    research_run_budget: int = 120            # 单次 run 网络预算（秒）
    research_source_timeout: int = 10         # 单源请求超时（秒）
    research_proxy_url: str = ""              # 跨境源出境代理（空=跨境源不可达降级）
    research_disabled_sources: str = ""       # 逗号分隔源 id，应急拉闸

    # CORS（逗号分隔白名单，空=不下发跨域头）
    cors_origins: str = ""

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def validate_runtime(self) -> None:
        """生产环境红线：弱密钥、无认证、本地签发一律拒绝启动。"""
        if self.env != "prod":
            return
        if self.secret_key == DEFAULT_SECRET_KEY or len(self.secret_key) < 32:
            raise ValueError(
                "生产环境必须配置不少于 32 位的强 ECOS_SECRET_KEY（当前为默认值或过短）"
            )
        if not self.auth_enabled:
            raise ValueError("生产环境必须开启认证：ECOS_AUTH_ENABLED=true")
        if self.auth_mode != "oidc":
            raise ValueError(
                "生产环境必须接入企业 IdP：ECOS_AUTH_MODE=oidc（local 签发仅限开发/测试）"
            )
        if not self.oidc_issuer:
            raise ValueError("生产环境必须配置 ECOS_OIDC_ISSUER（企业 IdP 地址）")
