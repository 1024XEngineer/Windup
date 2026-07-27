# Windup MS2 前端架构定义（最终冻结版）

本文记录当前已确认的前端目标架构，并区分已落地代码与尚待后端/业务实现的接口。不存在的能力只保留接口和说明，不伪造成功结果。

## 1. 技术边界

- 前端：React + Vite + TypeScript + Tailwind CSS。
- 后端：Python；WorkflowRun、Provider Job、质量门禁和导出任务最终由后端保存或执行。
- 分层：app -> pages -> features -> entities -> shared。
- Quick Start 与手动 Workflow 是两种输入入口，最终进入同一套 WorkflowRun、Revision、生成、质检、历史、Playtest 和导出流程。
- 当前后端 WorkflowRun 尚未提供，本地 adapter 只用于开发和联调前的骨架验证。

## 2. 分层职责

| 层 | 职责 | 当前状态 |
|---|---|---|
| app | 启动、Router、Provider、全局布局、错误边界 | 已有基础实现 |
| pages | 完整路由页面、URL、页面临时状态和模块组合 | 已有部分页面，Workflow steps 待实现 |
| features | 用户对业务对象执行的完整操作 | 已有占位 Feature，按真实实现增量拆分 |
| entities | 业务对象、查询、命令、选择器和领域规则 | Project 已接后端；WorkflowRun Revision/门禁已由本地 adapter 实现 |
| shared | 通用 API transport、UI、工具和测试辅助 | 已有基础 API/UI，upload/stream 边界待补 |

Account、Billing 和资产库复用 Feature 当前只在本文中预留，不创建代码入口。

## 3. 依赖规则

1. 代码只能依赖更低层：app -> pages -> features -> entities -> shared。
2. 同一层不同 Slice 默认不能互相 import。
3. 对外统一从 Slice 根 index.ts 进入。
4. entities 对外使用统一门面 @/entities；Entity 内部默认不产生其他 Entity 的运行时依赖。
5. Entity 之间通过 ID、类型契约或输入对象传递关系，不直接调用另一个 Entity 的内部 API。
6. shared 不得依赖任何 Windup 业务层。
7. Page、Feature、Entity 不直接调用 fetch；网络访问只能经 shared/api。
8. 生产代码不得导入 tests 或 shared/testing。
9. 不允许深层路径绕过公开入口，不允许循环依赖。
10. 未实现能力不得返回伪造成功结果。

当前仓库已有 AST 架构检查；新增规则在当前代码可验证时加入，依赖未来后端/generated client 的规则先作为文档验收项。

## 4. 路由与页面

当前确认的路由：

~~~
/                                Home（目标入口）
/quick-start                     Quick Start
/projects                        项目列表
/projects/:projectId             项目详情
/workflow-editor/:runId          当前 Revision 的工作流入口
/workflow-editor/:runId/:stage   当前 Revision 的指定节点
/playtest/:characterId           独立核验台
/asset-library                   资产库预留页面
~~~

/ 不再承担 Quick Start 具体业务；Quick Start 使用 /quick-start。项目详情保留当前的 /projects/:projectId，不改为 /project/:projectId。

Home 只提供 Quick Start 和从项目开始两个入口，不保存业务状态。Quick Start 负责自然语言输入和初始计划解析，创建与手动入口完全相同的 WorkflowRun 后跳转到 /workflow-editor/:runId。

ProjectsPage、ProjectDetailPage 和 AssetLibraryPage 当前直接使用 Entity；不提前创建 features/project 或 features/asset-library。出现复杂复用后再提取 Feature。

## 5. Workflow Editor

目录边界：

~~~
pages/workflow-editor/
├─ index.tsx
├─ canvas/
└─ steps/
   ├─ asset-step/
   ├─ generation-step/
   ├─ candidate-step/
   ├─ review-step/
   └─ export-step/
~~~

五个节点当前先写死，但通过有序 nodes 数组表达，后续可扩展节点类型。步骤页面负责 URL、布局、Feature 组合和页面临时状态；生成、质检、审核、修复和导出操作归对应 Feature。

未解锁的后续节点访问时重定向到当前可执行节点；已执行历史节点允许只读查看；已通过节点允许重新开始。

## 6. WorkflowRun、Revision 与节点

前端领域层所有业务 ID 使用 string；后端 DTO 保留真实类型，由 Entity mapper 转换。

同一个 runId 下可以有多个 Revision：

~~~
run-1
├─ revision-1：历史完整流程
└─ revision-2：从某节点重新开始的当前流程
~~~

已经跑通的 Revision 永久保留、可查看；重新开始不会覆盖旧 Revision。

当前节点类型：

~~~
asset | generation | candidate | review | export
~~~

节点状态：

~~~
locked | available | active | passed | failed
~~~

用户从节点 N3 重新开始时：

1. N1、N2 的结果和输入可以作为新 Revision 的参考。
2. N3 的旧结果可以作为重新执行的参考输入，但新 N3 必须重新通过。
3. N4 及之后从新 Revision 的当前执行线上移除，不得作为新生成参考。
4. 旧 Revision 的 N4 及之后仍保留，只能历史查看。
5. 新 Revision 必须从 N3 重新跑到末尾，才能形成新的完整结果。

流程门禁统一由 entities/workflow-run 的 selector/command 负责。Page 和 Feature 不复制门禁逻辑。

## 7. 生成、质检、历史、Playtest 与导出

当前需要真实联通两个 Provider，后续可扩展。前后端都可以持有凭据：

~~~
client | server
~~~

API Key 不写入 localStorage、WorkflowRun、Revision、Job 或历史记录。后端持有时前端只使用短期 sessionId；前端持有时只存于内存，刷新后重新建立 session。

生成候选必须先经过系统质检：

~ ~ ~
generation
  -> quality-gate
      -> 第 1 次失败：自动重试
      -> 第 2 次失败：阻断并请求重新生成
      -> 通过：交付人工审核
~ ~ ~

质检通过后立即将 Revision 标记为生成完成并进入历史。人工审核和 Playtest 可以发现问题并发起新的 Revision，但不是逐帧强制通过门槛。

状态拆分：

~ ~ ~
generationStatus: in_progress | completed | failed
exportStatus: not_exported | exporting | exported | failed
playtestStatus: not_tested | passed | issues_found
~ ~ ~

Playtest 可从 Quick Start、Workflow 或历史 Revision 导入。URL 形式：

~ ~ ~
/playtest/:characterId?runId=:runId&revision=:revisionId
~ ~ ~

Playtest 保存独立核验记录，可回流到对应 Revision 的 Review，但不修改历史结果。Playtest 未通过不阻断导出，只在导出时给出重新生成建议。

## 8. API 与数据边界

~ ~ ~
shared/api/
├─ request.ts       JSON 请求
├─ upload.ts        文件上传
├─ stream.ts        SSE/流式任务预留
├─ generated/       预留，不伪造生成代码
└─ client/
   ├─ real/
   ├─ mock/
   └─ mappers/
~ ~ ~

- shared/api 负责 HTTP、响应壳、分页、通用错误和 transport。
- entities 负责业务 DTO 到领域模型的转换和非法状态校验。
- 非法节点、状态、Revision 或 ID 必须抛出契约错误，不能用默认值伪造成功。
- JSON、上传、SSE 分别走 request/upload/stream，业务层禁止直接 fetch。
- Mock 只在开发/测试显式启用；生产只能使用真实 API，失败不得回退 Mock。
- generated 只作为未来 OpenAPI 客户端接入点，不创建不存在的代码。

## 9. 状态归属和查询抽象

- WorkflowRun、Revision、节点、命令和门禁归 entities/workflow-run。
- Project、Character、ActionTemplate、Wearable 归各自 Entity。
- URL、画布缩放、节点选中、资产筛选和当前审核位置归对应 Page。
- Generation、Review、Playtest 的局部交互状态归对应 Feature 或 Playtest Page。
- 不建立 Redux、Zustand 等全局业务 Store。
- 先保留 query key、query function、mutation 和 data/loading/error/refresh 语义，暂不绑定 React Query。

## 10. 目录增量规则

计划中的 Feature 子目录可以现在创建，但不写伪实现：

- 有公开职责的目录使用 index.ts/index.tsx，只包含类型、Props、签名和注释。
- 没有可定义接口的目录使用 README.md 说明职责、输入输出和禁止事项。
- shared/ui 不提前创建 Button、Modal、Toast 等空组件；只维护真实存在的组件，并用 README 说明未来规范。
- Account/Billing 只在本文预留，不创建页面、Feature 或 Entity。
- 资产库复用 Feature 只在本文预留，不创建 features/asset-library。

## 11. 测试策略

优先覆盖：

1. Entity 状态机、Revision、节点重启、历史只读和门禁。
2. Quick Start 与手动 Workflow 共用同一个 WorkflowRun。
3. 质检连续失败 2 次、生成完成、导出状态和 Playtest 非阻断规则。
4. 页面路由参数、历史模式和 Playtest 导入。
5. 后端接通后补真实 API、Provider、SSE 和跨入口 E2E。

架构测试立即检查当前可验证的 import、fetch、测试依赖和循环依赖；generated client、真实 Python API 和 Mock/Real 完整能力一致性在对应代码出现后启用。

## 12. 当前实现状态

已实现：

- 本地 WorkflowRun adapter、Revision、有序五节点和字符串领域 ID。
- 节点门禁、历史只读、从节点重启和后续执行线移除。
- 系统质检连续失败两次的领域规则，以及质检通过后的生成完成状态。
- Quick Start 创建统一 WorkflowRun 并进入 generation。
- Workflow Editor 节点路由、历史 Revision URL 和重启交互。
- Playtest 的完整 Revision 导入门禁、核验结论记录和非阻断导出提示。
- 生产构建强制使用真实 API transport，业务层禁止直接 fetch。

仍待真实后端或业务实现：

- Python WorkflowRun API adapter。
- 两个 Provider 的真实 Session、模型验证、Job runtime 和 SSE。
- 后端 quality-gate 报告和生成产物。
- Character/Action/Frame 正式接口、Review 修复任务和真实播放器。
- ExportJob、文件生成和下载。

未实现部分只能保留类型和公开边界，不得返回假成功或伪造后端结果。
