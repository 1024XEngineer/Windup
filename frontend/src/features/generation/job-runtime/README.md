# Job Runtime

展示 Production Engine 对上提供的生成状态和产物，不直接读取 Task Repository 或订阅 Task Event Source。PR #64 没有 Task 进度字段，页面不猜测 0–100 进度。

重试、失败次数和质量门禁属于后端 Generation/Review，不在前端计算或推进。

