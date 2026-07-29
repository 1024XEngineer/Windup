# Generation Step

生成阶段页面：生成请求、后端任务状态和产物的页面组合入口。

前端不选择 Provider，也不维护 Provider Session；具体生成方由后端能力内部决定。
质量门禁和重试规则由后端 Generation/Review 决定，前端只展示结果。
