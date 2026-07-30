"""七牛云 Kodo 对象存储配置。

从环境变量(或 ``.env``)读取,字段前缀 ``QINIU_``。
本地开发需在 ``.env`` 填入 AccessKey / SecretKey / Bucket / 绑定域名。
"""

from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# 显式加载项目根目录的 .env,避免 CWD 不同时相对路径找不到文件
_ROOT_ENV = Path(__file__).resolve().parents[6] / ".env"
load_dotenv(_ROOT_ENV, override=False)


class StorageSettings(BaseSettings):
    """七牛 Kodo 对象存储配置。"""

    model_config = SettingsConfigDict(
        env_prefix="QINIU_",
        env_file=(_ROOT_ENV, ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    access_key: str = ""
    secret_key: str = ""
    bucket_name: str = ""
    # 绑定的 CDN / 测试域名,用于拼接下载 URL(如 https://cdn.example.com)
    bucket_domain: str = ""
    # 是否私有空间;私有空间下载需签名,公开空间直接拼 URL
    private_space: bool = False
    upload_expires: int = 3600
    download_expires: int = 3600
    # 可选;不填则 SDK 自动查询 bucket 所在区域(z0=华东 z1=华北 z2=华南 na0=北美 as0=东南亚)
    region: str | None = None

    @property
    def download_base(self) -> str:
        """下载 URL 基础域名,去掉末尾 ``/``,客户端拼接 key 即可。"""
        domain = self.bucket_domain.rstrip("/")
        if domain and not domain.startswith(("http://", "https://")):
            # 七牛测试域名 SSL 证书可能不匹配，默认用 http
            domain = f"http://{domain}"
        return domain


settings = StorageSettings()
