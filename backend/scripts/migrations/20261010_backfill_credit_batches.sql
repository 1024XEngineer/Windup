-- 回填积分批次：给没有 CreditBatch 的存量 CreditAccount 补建一个
-- 无有效期的 REGISTER_GIFT 批次，使账户余额全部由批次承载。
--
-- ⚠️ 执行时机：必须在本分支代码上线**之前**执行。上线后 reserve_credit 的
-- legacy fallback 会为新冻结创建 source_ref='legacy_balance' 的批次（remaining=0，
-- 只覆盖冻结部分），此时"NOT EXISTS 批次"的条件会被这些零余额批次污染，
-- 部分真实余额将永久缺少批次，perpetual_credits 显示为 0。
--
-- 幂等：可安全重复执行（NOT EXISTS 保证已回填的账户不再插入）。
BEGIN;

INSERT INTO windup_credit_batch (
    user_id, source_type, source_ref, total, remaining, frozen, expires_at, is_exhausted, create_at
)
SELECT
    a.user_id,
    1,                          -- CreditReason.REGISTER_GIFT
    'register_backfill',
    a.balance,
    a.balance,
    0,
    NULL,                       -- 无有效期（永久积分）
    0,
    NOW() AT TIME ZONE 'UTC'
FROM windup_credit_account a
WHERE NOT EXISTS (
    SELECT 1 FROM windup_credit_batch b
    WHERE b.user_id = a.user_id
)
  AND a.balance > 0;

COMMIT;
