# Quick Start 与能力级 Adapter 设计

## 目标

Windup 当前由前端维护制作流程，后端只提供逐步落地的独立能力。Quick Start 与传统工作流不是
两套业务流程，而是同一套前端制作流程的两种控制方式：传统工作流由用户逐步驱动，Quick Start
由前端 Agent 自动连续驱动并隐藏内部节点。

本次只落地第一批边界：

- Quick Start 自动创建真实 Project，再用返回的 Project ID 创建 WorkflowRun。
- Quick Start 与手动流程以相同的素材节点开始；`driver` 只表示控制者，不跳过领域步骤。
- 为图片生成建立业务能力级 Port，使页面、Agent 和手动控制器以后依赖同一接口。
- 能力实现通过显式依赖注入选择，不依赖全局 Mock 环境变量；生产组合拒绝 Mock Adapter。

## 当前事实

- PR #62 明确 MS2 的 WorkflowRun 是前端页面编排模型，后端不提供同名资源。
- 后端 Generation HTTP 路径和 DTO 尚未冻结，因此本次不猜测真实 URL、请求壳或任务事件。
- Project 创建契约已经存在，Quick Start 可以通过现有 `createProject` 获得真实或同契约 Mock ID。
- 现有 `projectId: 'quick-start'` 不是后端 Project ID，会让产物无法归入项目和资产库。

## Quick Start 初始化

新增一个 Quick Start 用例，页面只提交自然语言输入。用例按以下顺序执行：

1. 由可替换的 Project Planner 把输入整理为 `CreateProjectInput`。
2. 调用现有 Project 能力创建项目。
3. 使用返回的 `project.id` 创建 `driver: 'ai'` 的 WorkflowRun。
4. 返回完整 Project 与 WorkflowRun，页面进入简化创作台。

当前尚无 Agent 参数规划接口，MS2 Planner 使用明确的临时默认值：侧视、四方向、64×64；项目名
由规范化提示词和短时间后缀组成，限制在 20 个 Unicode 字符内。Planner 是独立依赖，将来由 Agent
实现替换，不修改页面或启动用例。

Quick Start 与手动流程创建后都从 `asset` 节点开始并使用 `not_started`。将来 Quick Start Agent
自动提交“完成素材节点”命令后才进入 generation；自动完成不等于跳过内部步骤。

## 图片生成能力边界

图片生成以业务能力而不是 HTTP 路由或 Entity 目录为切换粒度：

```ts
interface ImageGenerationPort {
  readonly kind: 'real' | 'mock'
  generate(input: GenerateImagesInput): Promise<GeneratedImage[]>
}
```

输入只表达当前已知的前端业务信息：真实 Project ID、提示词和参考图 URL；输出只表达后端当前能
提供的图片 URL。真实 OpenAPI 冻结后由 Real Adapter 完成 DTO 映射，Port 的消费者不接触 URL 和
响应壳。

本次建立 Port、服务工厂和生产保护，不创建假的 Real Adapter，也不猜测后端端点。测试通过注入
内存 Fake 验证消费者契约；开发 Mock 实现等 Quick Start Agent 真正调用该能力时再添加。

## Mock 与生产保护

- 能力服务通过构造参数接收 Adapter，测试不读取 `import.meta.env`。
- 服务工厂在 `runtime: 'production'` 时拒绝 `kind: 'mock'`。
- Mock 实现不能被生产组合入口静态导入。
- Real Adapter 的 URL、响应壳和 DTO 映射必须由独立契约测试覆盖。
- 真实调用失败必须向上抛出，生产环境不得运行时降级到 Mock。

现有 Project 假 HTTP transport 暂时保留，避免路演前扩大重构范围；图片生成验证新模式后，再按
Project、Character、Review、Export 的业务能力逐步迁移，最后删除全局 `VITE_USE_MOCK`。

## 明确不做

- 不实现完整 Quick Start Agent 循环。
- 不新增或猜测 Generation HTTP 路径、Task/SSE 契约。
- 不上传参考图或实现 Project 重命名页面。
- 不迁移现有 Project transport。
- 不实现 Review、Export、Character 的能力 Adapter。

## 验收

- Quick Start 创建的 WorkflowRun 持有 Project 能力返回的真实 ID，不再出现 `'quick-start'`。
- Quick Start 初始素材节点为 active，生成状态为 `not_started`。
- Project 创建失败时不创建孤立 WorkflowRun，并向页面展示错误。
- 图片生成服务可注入 Adapter；生产 runtime 传入 Mock 时立即失败。
- 架构、单元、页面流程测试以及格式、Lint、类型检查和生产构建全部通过。
