"""AI Provider 配置。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class AIProviderSettings(BaseSettings):
    """OpenAI-compatible AI 服务配置。"""

    model_config = SettingsConfigDict(
        env_prefix="AI_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    provider: str = "openai-compatible"
    base_url: str = "https://api.openai.com/v1"
    api_key: str = ""
    model: str = ""
    timeout: float = 120.0
    max_retries: int = 2
    chat_completions_path: str = "/chat/completions"

    @property
    def normalized_base_url(self) -> str:
        return self.base_url.rstrip("/")


settings = AIProviderSettings()
