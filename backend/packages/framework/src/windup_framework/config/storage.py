"""七牛云 Kodo 对象存储配置。

从环境变量(或 ``.env``)读取,字段前缀 ``QINIU_``。
本地开发需在 ``.env`` 填入 AccessKey / SecretKey / Bucket / 绑定域名。
"""

from urllib.parse import urlsplit

from pydantic_settings import BaseSettings, SettingsConfigDict


class StorageSettings(BaseSettings):
    """七牛 Kodo 对象存储配置。"""

    model_config = SettingsConfigDict(
        env_prefix="QINIU_",
        # 兼容从 backend/ 或项目根运行:../.env 覆盖根目录,.env 覆盖当前目录
        env_file=("../.env", ".env"),
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
        """返回浏览器可访问的下载域名。"""
        domain = self.bucket_domain.rstrip("/")
        if domain.startswith("http://"):
            raise ValueError("QINIU_BUCKET_DOMAIN 必须使用 HTTPS 下载域名")
        if domain and not domain.startswith("https://"):
            domain = f"https://{domain}"
        hostname = (urlsplit(domain).hostname or "").lower()
        labels = hostname.split(".")
        if hostname.endswith(".qiniucs.com") and any(
            label == "s3" or label.startswith("s3-") for label in labels
        ):
            raise ValueError(
                "QINIU_BUCKET_DOMAIN 不能使用七牛 S3 API 端点；"
                "请填写 Bucket 绑定的 HTTPS Kodo/CDN 下载域名"
            )
        return domain


settings = StorageSettings()
