-- 在切换包含头像上传接口的后端前执行；可安全重复运行。
BEGIN;

ALTER TABLE windup_user
    ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL;

COMMIT;
