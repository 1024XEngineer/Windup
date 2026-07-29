"""七牛 Kodo 对象存储适配器。"""

import logging

from qiniu import Auth, BucketManager, put_data

from windup_framework.config.storage import StorageSettings, settings

logger = logging.getLogger("windup.storage.kodo")


class KodoStorage:
    """封装七牛上传和公开下载地址拼接。"""

    def __init__(self, config: StorageSettings = settings) -> None:
        self.config = config
        self._validated = False

    def _ensure_config(self) -> None:
        if self._validated:
            return
        if not self.config.access_key or not self.config.secret_key:
            raise RuntimeError("Kodo 未配置 AccessKey / SecretKey")
        if not self.config.bucket_name or not self.config.bucket_domain:
            raise RuntimeError("Kodo 未配置 Bucket / BucketDomain")
        self._validated = True

    def upload(self, data: bytes, key: str, mime_type: str | None = None) -> str:
        """上传字节内容,返回可访问 URL。"""
        self._ensure_config()
        logger.info(
            "[WINDUP] Kodo 开始上传 | bucket=%s key=%s size=%s",
            self.config.bucket_name, key, len(data),
        )
        auth = Auth(self.config.access_key, self.config.secret_key)
        token = auth.upload_token(
            self.config.bucket_name, key, expires=self.config.upload_expires
        )
        result, info = put_data(token, key, data)
        if info.status_code != 200 or not result:
            logger.error(
                "[WINDUP] Kodo 上传失败 | key=%s status=%s",
                key, info.status_code,
            )
            raise RuntimeError(f"Kodo 上传失败: {info.status_code}")
        url = f"{self.config.download_base}/{key}"
        logger.info("[WINDUP] Kodo 上传完成 | url=%s", url)
        return url

    def delete(self, key: str) -> None:
        """删除对象。"""
        self._ensure_config()
        logger.info("[WINDUP] Kodo 开始删除 | bucket=%s key=%s", self.config.bucket_name, key)
        auth = Auth(self.config.access_key, self.config.secret_key)
        manager = BucketManager(auth)
        result = manager.delete(self.config.bucket_name, key)
        if result.status_code != 200:
            logger.error(
                "[WINDUP] Kodo 删除失败 | key=%s status=%s",
                key, result.status_code,
            )
            raise RuntimeError(f"Kodo 删除失败: {result.status_code}")
        logger.info("[WINDUP] Kodo 删除完成 | key=%s", key)
