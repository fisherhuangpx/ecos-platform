"""AgentScope 运行时工厂：模型 / Agent 装配 + 离线脚本化模型。"""

from __future__ import annotations

from typing import Any, Sequence

from agentscope.agent import Agent
from agentscope.credential import CredentialBase, OpenAICredential
from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import TextBlock
from agentscope.model import ChatModelBase, ChatResponse, OpenAIChatModel
from agentscope.tool import Toolkit, ToolBase
from pydantic import BaseModel

from ..config import Settings


def build_model(settings: Settings) -> OpenAIChatModel:
    if not settings.model_api_key:
        raise ValueError("未配置 ECOS_MODEL_API_KEY，无法初始化模型")
    return OpenAIChatModel(
        credential=OpenAICredential(
            api_key=settings.model_api_key,
            base_url=settings.model_base_url or None,
        ),
        model=settings.model_name,
        stream=False,
    )


def build_agent(
    *,
    name: str,
    system_prompt: str,
    model: ChatModelBase,
    tools: Sequence[ToolBase],
) -> Agent:
    return Agent(
        name=name,
        system_prompt=system_prompt,
        model=model,
        toolkit=Toolkit(tools=list(tools)),
    )


class ScriptedChatModel(ChatModelBase):
    """按脚本逐条返回响应的离线模型，用于测试与演示，不访问网络。"""

    class Parameters(BaseModel):
        pass

    def __init__(self, responses: Sequence[list[Any]]) -> None:
        super().__init__(
            credential=CredentialBase(),
            model="scripted",
            parameters=self.Parameters(),
            stream=False,
        )
        self.formatter = OpenAIChatFormatter()
        self._responses = [list(item) for item in responses]
        self.calls: list[list[Any]] = []

    async def _call_api(
        self,
        model_name: str,
        messages: list[Any],
        tools: list[dict] | None = None,
        tool_choice: Any | None = None,
        **kwargs: Any,
    ) -> ChatResponse:
        self.calls.append(messages)
        content = (
            self._responses.pop(0)
            if self._responses
            else [TextBlock(text="（脚本化模型已无更多响应）")]
        )
        return ChatResponse(content=content, is_last=True)


def scripted_model(responses: Sequence[list[Any]]) -> ScriptedChatModel:
    return ScriptedChatModel(responses)
