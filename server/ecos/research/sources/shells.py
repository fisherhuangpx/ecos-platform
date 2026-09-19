"""两个代表壳：official（淘宝开放平台）与 licensed（蝉妈妈）。"""

from ..vault_source import VaultApiSource


class TaobaoOpen(VaultApiSource):
    id = "taobao_open"
    name = "淘宝开放平台"
    board = "shelf"
    tier = "official"
    vault_kind = "src-taobao-open"
    description = "需商家 appkey + 授权；填凭据即进入可用清单（真实对接未排期）"
    params = {"category": {"type": "string"}, "fields": {"type": "string"}}
    required = ("category",)


class Chanmama(VaultApiSource):
    id = "chanmama"
    name = "蝉妈妈开放 API"
    board = "content"
    tier = "licensed"
    vault_kind = "src-chanmama"
    description = "抖音电商 GMV 级数据；采购开通后填凭据启用（真实对接未排期）"
    params = {"category": {"type": "string"}}
    required = ("category",)
