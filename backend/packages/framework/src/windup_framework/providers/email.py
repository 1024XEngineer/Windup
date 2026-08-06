"""邮件发送服务。

:class:`ResendEmailProvider` 基于 Resend SDK 实现验证码邮件发送。
"""

import logging
from abc import ABC, abstractmethod

import resend

from windup_framework.config.email import settings as email_settings

logger = logging.getLogger("windup.email")


class EmailProvider(ABC):
    """邮件发送抽象接口。"""

    @abstractmethod
    def send_verification_code(self, to: str, code: str) -> None:
        """发送验证码邮件。"""


class ResendEmailProvider(EmailProvider):
    """基于 Resend 的邮件发送实现。"""

    def __init__(self) -> None:
        resend.api_key = email_settings.api_key

    def send_verification_code(self, to: str, code: str) -> None:
        """发送 6 位数字验证码邮件。"""
        try:
            resend.Emails.send(
                {
                    "from": email_settings.from_email,
                    "to": [to],
                    "subject": "【Windup】您的验证码",
                    "html": (
                        f"<p>您的验证码是 <strong>{code}</strong>，"
                        f"5 分钟内有效。</p>"
                        f"<p>如非本人操作，请忽略此邮件。</p>"
                    ),
                }
            )
            logger.info("[WINDUP] 验证码邮件已发送 | to=%s", to)
        except Exception:
            logger.exception("[WINDUP] 验证码邮件发送失败 | to=%s", to)
            raise


email_provider = ResendEmailProvider()
