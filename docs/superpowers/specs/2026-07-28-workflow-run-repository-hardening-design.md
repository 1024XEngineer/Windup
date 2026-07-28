# WorkflowRun Repository 异步化与本地存储加固设计

> 更新：Quick Start 不再跳过素材节点，最新初始化规则见
> [Quick Start 与能力级 Adapter 设计](2026-07-28-quick-start-capability-adapters-design.md)。本文的异步
> Repository、存储回退、ID 降级和恢复校验规则继续有效。

## 背景与架构决策

当前页面通过 `createWorkflowRun`、`fetchWorkflowRun` 和
`submitWorkflowCommand` 使用 WorkflowRun，三个公开函数已经返回 Promise；但它们内部依赖的
`WorkflowRunRepository` 仍是同步接口，而且每个编排文件都直接导入本地实现。这会造成两个问题：

1. 未来接入网络实现时，Repository 契约及其调用链仍需整体重写。
2. 实现选择散落在三个调用点，无法像通用 API 层一样从一个位置切换。

本次采用已经确认的方案 A：**异步 Repository Port + 唯一组合入口，当前仍绑定本地
Adapter**。该方案同时遵守两项既有边界：

- Issue #58 要求前端从一开始就使用可等待的网络形状，并让未来实现替换集中在一处。
- PR #62 规定当前 WorkflowRun 是前端页面编排模型，后端没有 `/workflows` 或
  `/workflow-runs` 资源。

因此，本次不会虚构一个远程 WorkflowRun API，也不会把本地状态机包装成假 HTTP。以后真实后端
能力契约冻结时，可以新增远程或混合 Adapter，并且只修改唯一组合入口；页面、Feature 和三个
编排函数不需要改变。

## 目标

- 将 Repository 的创建、读取和提交命令全部改成 Promise 契约。
- 让三个编排函数只依赖同一个 Repository 组合入口。
- 保持当前本地 WorkflowRun 行为和页面公开调用方式不变。
- 修复 localStorage 写入失败后旧磁盘数据覆盖最新内存数据的问题。
- 为不支持 `crypto.randomUUID` 的运行环境提供 ID 生成兜底。
- 增加明确的“尚未开始生成”状态，并正确维护状态转换。
- 对持久化数据执行完整的运行时结构校验，拒绝损坏记录。
- 用回归测试覆盖每一条评审问题，并同步接口及架构文档。

## 非目标

- 不新增或猜测 `/workflows`、`/workflow-runs` 等后端路由。
- 不实现尚未冻结的 Generation、Asset、Review、Playtest 或 Export DTO。
- 不修改页面路由、布局或交互设计。
- 不把前端 WorkflowRun 归属改回后端。
- 不引入新的状态管理或运行时 Schema 依赖。

## 架构

```text
Pages / Features
       |
       v
WorkflowRun public facade（保持现有 Promise 签名）
       |
       v
create / get / submit orchestration
       |
       v
workflowRunRepository（唯一组合入口）
       |
       v
WorkflowRunRepository（异步 Port）
       |
       v
LocalWorkflowRunRepository（当前 Adapter）
       |-- 本地状态机
       `-- localStorage + 内存覆盖层

未来真实契约冻结后：
workflowRunRepository（唯一组合入口）
       `-- Remote/Hybrid Adapter
```

组合入口只负责选择实现，不承载业务逻辑。当前它固定导出本地 Adapter；由于不存在真实的
WorkflowRun 后端资源，本次不增加无效的环境开关或必然失败的远程分支。

## Repository 契约

Repository Port 调整为：

```ts
export interface WorkflowRunRepository {
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  get(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  submit(
    runId: WorkflowRun['id'],
    command: WorkflowCommand,
  ): Promise<WorkflowRun>
}
```

本地状态机内部仍可保持同步计算；本地 Adapter 负责把同步结果放进 Promise 契约。这样既不增加
无意义的异步逻辑，也能保证调用方从现在起就按照网络延迟、失败和等待的形状工作。

三个编排文件禁止直接导入 `localWorkflowRunRepository`，只能导入唯一组合入口导出的
`workflowRunRepository`。架构测试会固定这一约束。

## 本地存储一致性

### 问题

当前保存流程先更新内存，再尝试写 localStorage；一旦写入失败，后续读取又优先采用
localStorage 中的旧快照。这样会让刚创建或刚推进的工作流在下一次读取时消失。

### 设计

内存改为当前会话的覆盖层：

1. 每次读取都先解析并校验磁盘快照。
2. 将磁盘中的有效数据与内存覆盖层合并。
3. 同一 run ID 同时存在时，内存版本永远优先。
4. 保存时先更新内存覆盖层，再尝试持久化合并后的完整快照。
5. 写入失败只影响跨会话持久化，不影响当前会话读取到最新数据。

这既覆盖无痕模式、配额耗尽和安全策略异常，也保留读取其他有效磁盘记录的能力。

## 持久化数据校验

读取 JSON 后不再仅检查 `id` 和 `revisions`。校验器将验证完整的领域结构：

- Run：ID、项目与角色归属、driver、run 状态、当前 revision ID、prompt 和 revisions。
- Revision：ID、来源关系、生成/导出/试玩状态、节点数组、创建时间。
- Node：ID、节点类型、顺序、节点状态、引用节点 ID、失败次数，以及对象形状。
- 枚举字段必须属于当前定义的合法值。
- `currentRevisionId` 必须能在当前 run 的 revisions 中找到。
- 存储 Map 的键必须与记录自身的 run ID 一致。

损坏记录按条忽略，不能进入领域层；同一存储对象中的其他合法记录仍可使用。校验失败不会抛出到
页面，也不会覆盖会话内已经存在的最新合法数据。

## ID 生成兜底

ID 保持 `run-*`、`revision-*` 和 `node-*` 前缀。随机部分依次使用：

1. `crypto.randomUUID`（首选）。
2. `crypto.getRandomValues` 生成随机字节。
3. 时间戳、会话递增计数和 `Math.random` 的组合作为最后兜底。

ID 只用于前端本地编排标识，不作为安全令牌。测试将覆盖 `randomUUID` 缺失以及 Web Crypto 整体
不可用的情况，并验证连续生成不会立即重复。

## 生成状态

`GenerationStatus` 新增 `not_started`：

- 手动创建工作流时只有素材节点处于 active，生成状态为 `not_started`。
- 手动流程完成素材节点、进入 generation 节点时，转为 `in_progress`。
- Quick Start 创建后已位于 generation 节点，仍为 `in_progress`。
- 生成完成或失败后继续使用 `completed` / `failed`。
- 从 generation 或其后续节点重启时，回到 `in_progress`；仅停留在素材准备阶段时保持
  `not_started`。

页面现有的完成和失败判断继续有效；需要显示进行中时必须显式判断 `in_progress`，不得把
`not_started` 当成正在生成。

## 错误处理

- Repository Promise 会正常传播本地状态机抛出的非法命令错误。
- `fetchWorkflowRun` 对不存在或被判定为损坏的 run 继续抛出明确的“不存在”错误。
- localStorage 读取、解析或写入异常均退回有效内存数据，不返回假成功对象。
- ID 生成能力降级时自动使用下一级方案，不因浏览器运行环境直接崩溃。
- 不捕获并吞掉与存储无关的领域错误。

## 测试策略

实施遵循测试先行，每项先增加失败测试，再做最小实现：

1. 类型测试证明 Repository 三个方法返回 Promise。
2. 架构测试证明三个编排文件只依赖唯一组合入口，不直接引用本地 Adapter。
3. 行为测试证明现有创建、读取、推进调用仍可等待并保持页面行为。
4. 存储测试模拟 `setItem` 抛错，证明最新内存 run 不会被旧磁盘快照覆盖。
5. ID 测试分别移除 `randomUUID` 和整个 Web Crypto，证明生成仍成功且不重复。
6. 状态测试证明手动流程从 `not_started` 转到 `in_progress`，Quick Start 初始仍在生成中。
7. 校验测试放入缺字段、非法枚举、损坏节点和错误 revision 引用，证明它们不会进入领域层；合法
   同级记录仍可读取。
8. 最后运行格式、lint、完整测试、类型检查、构建和差异检查。

## 文档同步

- `frontend/API_CONTRACT.md`：说明 WorkflowRun Repository 是可等待的前端 Port，目前由本地
  Adapter 实现，未来只在组合入口替换。
- `frontend/MODULES.md`：记录唯一实现入口以及本地存储边界。
- `frontend/README.md`：说明当前本地实现与未来真实能力 Adapter 的切换方式。
- `frontend-architecture-v3.md`：保持 PR #62 的前端编排归属，并补充异步 Port 与存储保护。

文档不会把本地 Repository 描述成后端已提供的 WorkflowRun API。

## 验收条件

- Repository Port 的三个方法全部返回 Promise。
- 三个编排文件不存在本地 Adapter 的直接导入。
- 当前运行时不发送 `/workflows` 或 `/workflow-runs` 请求。
- localStorage 写入失败后，当前会话仍能读取刚保存的最新工作流。
- `randomUUID` 不存在时仍可创建工作流。
- 手动工作流初始不是“生成中”，进入生成节点后状态正确变化。
- 任意缺失必需字段或包含非法状态的持久化记录都不会被返回。
- 六类回归测试和完整前端验证全部通过。
- 用户原有未跟踪文件保持未修改、未暂存。
