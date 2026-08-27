"""管理平台原子权限码。"""

GATEWAY_READ = "gateway.read"
GATEWAY_WRITE = "gateway.write"
GATEWAY_PUBLISH = "gateway.publish"
GATEWAY_ROLLBACK = "gateway.rollback"
CREDENTIAL_READ = "credential.read"
CREDENTIAL_ROTATE = "credential.rotate"
CREDENTIAL_TEST = "credential.test"
MODEL_IMAGE_MANAGE = "model.image.manage"
MODEL_VIDEO_MANAGE = "model.video.manage"
ROUTING_MANAGE = "routing.manage"
CIRCUIT_MANAGE = "circuit.manage"
SENSITIVE_WORD_READ = "sensitive_word.read"
SENSITIVE_WORD_WRITE = "sensitive_word.write"
REDEMPTION_READ = "redemption.read"
REDEMPTION_CREATE = "redemption.create"
REDEMPTION_DISABLE = "redemption.disable"
REDEMPTION_EXPORT = "redemption.export"
USER_READ = "user.read"
USER_MANAGE = "user.manage"
CREDIT_READ = "credit.read"
CREDIT_ADJUST = "credit.adjust"
ADMIN_MANAGE = "admin.manage"
ROLE_MANAGE = "role.manage"
AUDIT_READ = "audit.read"

ALL_ADMIN_PERMISSIONS = frozenset(
    {
        GATEWAY_READ,
        GATEWAY_WRITE,
        GATEWAY_PUBLISH,
        GATEWAY_ROLLBACK,
        CREDENTIAL_READ,
        CREDENTIAL_ROTATE,
        CREDENTIAL_TEST,
        MODEL_IMAGE_MANAGE,
        MODEL_VIDEO_MANAGE,
        ROUTING_MANAGE,
        CIRCUIT_MANAGE,
        SENSITIVE_WORD_READ,
        SENSITIVE_WORD_WRITE,
        REDEMPTION_READ,
        REDEMPTION_CREATE,
        REDEMPTION_DISABLE,
        REDEMPTION_EXPORT,
        USER_READ,
        USER_MANAGE,
        CREDIT_READ,
        CREDIT_ADJUST,
        ADMIN_MANAGE,
        ROLE_MANAGE,
        AUDIT_READ,
    }
)
