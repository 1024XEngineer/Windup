# Features 业务能力层

## 模块职责

`features` 保存页面会组合使用的粗粒度业务能力。它比页面更聚焦，比 Entity 更接近用户操作。Feature 可以调用 Entity APIs，也可以把用户输入整理成 Workflow Controller 能理解的数据，但不拥有整条 WorkflowRun 的推进规则。

## 已确认的 Feature 边界

- `character-setup`：角色资料、造型、动作定义和参考素材输入。
- `generation`：创建并展示 Generation 业务记录。
- `review`：查看生成结果，形成审核结论。
- `export`：展示导出条件、导出配置和导出结果。

当前只固定边界，不提交组件实现。后续出现真实页面时，再按以上业务能力创建子目录和具体代码。

## 不允许放入的内容

- 不把 `nextStep`、`restartFromStep`、`interrupt` 等流程推进规则拆进各个 Feature。
- 不在 Feature 内私自维护另一份 WorkflowRun 状态。
- 不在 Feature 里发明后端还没有确认的接口。
- 不为了显得“模块化”提前拆出空组件、空 Hook 或空 service。

判断标准是：Feature 负责一个用户可感知的业务能力，但整条流程的版本、步骤顺序和重启规则仍由 Workflow Controller 统一维护。
