## backend-architecture
本文涵盖后端技术架构以及对应职责划分。

`备注：`先初步建立层级目录，后续可按实际开发需求，进行增减。
## 后端技术架构
### 1.1 目录树

```
backend/                          # uv workspace 根
  pyproject.toml                   # workspace 定义 + 根依赖
  packages/
    common/                        # 独立包 · 共享内核(无内部依赖)
      src/windup_common/
        enums/  exceptions/  constants/  utils/
        models/        # 跨层契约 DTO/VO (pydantic)
        result/        # 统一返回 / 分页包装

    framework/                     # 独立包 · 基础设施  -> 依赖 common
      src/windup_framework/
        config/        # pydantic-settings
        db/            # SQLAlchemy engine/session/Base (postgres)
        vector/        # pgvector 客户端 + embedding 落库支撑
        mq/            # RocketMQ producer/consumer 封装
        storage/       # 对象存储客户端 (MinIO/OSS/S3)
        httpx_client/  # 外部 HTTP 客户端
        search/        # 外部检索客户端(SERPAPI 等)
        auth/          # JWT / 租户鉴权
        providers/     # AI 模型底层适配器(文本/图像/视频/embedding/抠图) behind interfaces
        logging/

    ai_engine/                     # 独立包 · 资产生产引擎  -> 依赖 common+framework,暴露 ports
      src/windup_ai_engine/
        ports/         # 对外接口 + callback ports(server/framework 实现,注入)
        graph/         # langgraph 图:节点 / 边 / 条件路由 / 反射 / 规划
        strategy/      # DerivationStrategy: SpriteSheetStrategy / VideoFrameStrategy
        postprocess/   # 抠图 / 背景去除 / 调色
        slicing/       # 精灵图集切帧、按动作×方向组织
        prompt/        # prompt 模板结构 + 渲染(运行时变量由入参注入)
        impl/          # CharacterGenerator 实现:装配 graph + ports,跑图

    app/                           # 应用包  -> 依赖 common/framework/ai_engine
      src/windup_app/
        server/        # 业务领域:租户 / 角色 / 生成任务 / 资产 / 样本 / 配额
          tenant/  character/  generation/  asset/  sample/  quota/
        web/           # FastAPI 表现层
          api/         # routers
          schemas/     # 请求/响应 schema(面向前端)
          middleware/  # 鉴权 / 租户上下文 / 异常处理
          sse/         # SSE/WS 进度推送
        worker/        # RocketMQ 消费入口(薄,委托 server)
          consumers/   # generate / resume 消费者
        bootstrap/     # 装配:create_app、依赖注入、路由挂载、port 实现绑定
  tests/
```

### 1.2 依赖图

> 约定:箭头 `A -> B` 表示 **A 依赖 B**。依赖只能向下指向 `common`。

```
app/bootstrap                         ← 装配根(无人依赖它)
    │
    ▼
app/{web, worker}                     ← 同层入口,互不依赖
    │
    ▼
app/server
    │
    ▼
ai_engine                             ← 暴露 ports 给 server
    │
    ▼
framework
    │
    ▼
common                                ← 根内核,所有人最终都依赖它

```
## 各层职责

### 2.1 common —— 共享内核
跨层契约,无内部依赖。
`enums`、`exceptions`、`constants`、`utils`、`models`(pydantic DTO/VO)、`result`(统一返回/分页/错误码)。

### 2.2 framework —— 基础设施
只提供通用客户端/适配器,**无业务语义**。
- `config`:pydantic-settings 读 .env。
- `db`:SQLAlchemy engine/session/Base(Postgres)。
- `vector`:pgvector 客户端 + embedding 落库支撑(复用 Postgres,不引新组件)。
- `mq`:RocketMQ producer/consumer 封装。
- `storage`:对象存储客户端(立绘、图集、帧等二进制落这里,不入 DB)。
- `search`:外部检索客户端(SERPAPI 等)。
- `auth`:JWT / 租户鉴权。
- `providers`:各 AI 模型底层适配器(文本 LLM / 图像 / 视频 / embedding / 抠图分割),均 behind interface,供 ai_engine 经 port 或直接调用。

### 2.2 ai_engine —— 资产生产引擎
拥有「prompt → 最终资产包」的**整条生产流水线**。不关心租户/配额/任务状态。

**ports(对外接口 + callback,server/framework 实现,调用时注入):**

> `server` 只 `import ai_engine/ports`,不碰 graph/strategy/impl。换掉 langgraph 只动 `impl/`,server 零改动。

**graph 内部(langgraph):**
```
ai_engine/graph/
  state.py            # GraphState(plan / scratchpad / reflections / tool_results / artifacts)
  intent_rewriter.py  # 意图改写节点
  planner.py          # Plan-and-Execute 规划
  executor.py         # 按 plan 逐步执行
  reflector.py        # 反射自评:重试 / 继续 / 触发 HITL
  react_loop.py       # (若走 ReAct 路线)推理-行动-观察循环
  tools/
    external/         # 走 framework(联网搜索等)
    business/         # 走 port(查租户历史角色 / 样本等)
  generate_base.py / derive.py / slice.py / postprocess.py / package.py
  routing.py          # 条件边:策略选择、反射重试、HITL interrupt
```

- **意图改写 / 反射 / ReAct / Plan-Execute**:纯图内路由与节点,依赖至多到 `framework/providers` 与业务 port,不碰 server。
- **外部工具**(联网搜索等)→ `framework/search`(允许边)。
- **业务数据工具**(查租户历史/样本)→ port,server 实现。
- **反射/ReAct/Plan-Execute 循环**配**最大迭代数**,防死循环。
- **prompt 模板结构**在 `prompt/`;**运行时变量**(租户风格预设等)由 server 作为入参注入,ai_engine 对租户无感。

### 2.3 app/server —— 业务领域
决定「生成什么、谁的、状态如何、配额够不够」,跟踪任务状态机;**调用** ai_engine 的 port,不关心流水线内部。
- `tenant`:租户管理、租户上下文。
- `character`:角色领域实体。
- `generation`:生成任务状态机 + 编排(同步建单 + 异步 `run` / `resume`)。
- `asset`:资产元数据、存储引用(二进制在对象存储)。
- `sample`:PromptSample 实体 + 保存逻辑(所有权 / 阈值 / 人工打标),实现 `PromptSampleRepository` port。
- `quota`:配额校验与扣减。

**任务状态机:** `PENDING → RUNNING →(REVIEWING → RUNNING)?→ SUCCESS / FAILED`

### 2.4 app/web —— 表现层
FastAPI 入口,委托 server,不写业务。
- `api`:routers(提交生成、查询任务、提交审核、下载资产等)。
- `schemas`:面向前端的请求/响应 schema。
- `middleware`:鉴权、租户上下文注入、统一异常处理。
- `sse`:SSE/WS 进度推送(订阅 MQ 完成事件 / 进度事件)。

### 2.5 app/worker —— 异步入口
RocketMQ 消费者,只委托 `server.orchestrator`。
- `consumers/generate`:消费生成消息 → `orchestrator.run(task_id)` → ai_engine `generate()`。
- `consumers/resume`:消费续跑消息 → `orchestrator.resume(task_id)` → ai_engine `resume()`。

### 2.6 app/bootstrap —— 装配根
`create_app`、依赖注入、路由挂载、port 实现绑定(把 server/framework 的 `ProgressReporter`/`ArtifactSink`/`CheckpointStore`/`PromptSampleRepository` 实现注入 ai_engine)。web 与 worker 两个入口共用同一套 server 逻辑。

---

## 技术选型

### 3.1 后端技术栈

**已选型**

| 类别 | 选型 | 说明 / 用途 |
|------|------|-------------|
| 编程语言 | Python | ≥ 3.12 |
| Web 框架 | FastAPI | 表现层,异步 API |
| LLM 框架 | LangChain | LLM 调用封装 |
| AI 编排 | LangGraph | ai_engine 图编排(节点 / 边 / 反射 / 规划) |
| ORM | SQLAlchemy | engine / session / Base |
| 关系数据库 | PostgreSQL | 主库 |
| 向量存储 | pgvector | 复用 Postgres,embedding 落库 |
| 对象存储 | 七牛云 | 立绘 / 图集 / 帧等二进制资产 |
| 消息队列 | RocketMQ | 异步生成任务 |
| 进度推送 | SSE / WebSocket | 进度 / 完成事件推送 |
| 数据校验 | Pydantic | DTO / VO / schema |
| 配置管理 | pydantic-settings | 读取 .env |
| 鉴权 | JWT | 租户鉴权 |
| HTTP 客户端 | httpx | 外部 HTTP 调用 |
| 外部检索 | SERPAPI | 联网搜索 |
| 包管理 | uv | workspace 多包管理 |
| 构建后端 | hatchling | 各子包构建 |
| 代码检查 | Ruff | lint / format |
| 分层约束 | import-linter | CI 防循环依赖 |
| 测试框架 | pytest | 单元 / 集成测试 |
| 容器化 | Docker | |

**待选型(留白)**

| 类别 | 选型 | 说明 / 用途 |
|------|------|-------------|
| CI / CD |  |  |
| 日志方案 |  |  |
| 监控 / 链路追踪 |  |  |
| 缓存 |  |  |
| 部署编排 |  |  |
| AI 模型服务 |  |  |





