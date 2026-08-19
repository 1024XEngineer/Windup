"""判官闸口配置。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class QualityGateSettings(BaseSettings):
    """判官闸口开关。环境变量前缀 ``QUALITY_GATE_``。

    两个开关分开,是因为它们各自的代价不同,不该被一个 flag 绑在一起。
    """

    model_config = SettingsConfigDict(
        env_prefix="QUALITY_GATE_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 每交付一个动作多打一次付费模型调用,所以默认不开:开它是一次花钱的决定。
    enabled: bool = False

    # 判官说有问题就不交付。默认关,而且在积够 shadow 数据、定出判据之前不该开:
    # 误杀掉的是用户**已经付过钱**的产物,退不回来;而漏放一个坏产物,用户可以重试。
    enforce: bool = False


settings = QualityGateSettings()
