-- 在切换包含 auth_version 的后端和 Worker 之前执行。
-- ADD COLUMN IF NOT EXISTS 使该迁移可以安全重复运行。
BEGIN;

ALTER TABLE windup_user
    ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;

COMMIT;
