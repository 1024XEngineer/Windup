-- 项目名称是显示字段，路由与关联始终使用 project.id；同一用户允许多个同名项目。
-- DROP CONSTRAINT IF EXISTS 使迁移可以安全重复运行。
BEGIN;

ALTER TABLE windup_project
    DROP CONSTRAINT IF EXISTS uq_windup_project_user_name;

COMMIT;
