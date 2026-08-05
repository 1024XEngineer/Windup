# Windup 前端架构

本文记录当前前端的模块划分、依赖规则和已经落地的首个工作流纵切。

---

## 1. 模块划分

业务模块都在 `src/entities/` 下：

| 模块 | 职责 |
|---|---|
| `project` | 项目级全局约束：视角、朝向数、精灵尺寸、画风 |
| `character` | 角色资产。造型、动作、帧是它内部的一棵树 |
| `action-template` | 能跨角色复用的动作配方 |
| `generation` | 一次生成任务这份业务数据 |
| `media` | 已上传媒体的不透明引用 |
| `task` | 后端异步步骤的状态 |
| `workflow-run` | 制作流程的运行记录 |

**模块判据：这个东西能不能被单独取到。**

能单独取，说明它需要自己的一套取数逻辑，才值得一个模块；取不到的，它只是别人身上的一个字段。

按这条判据，`Outfit`、`Action`、`Frame` 没有独立模块——它们不能脱离 `Character` 被取到，所以是 `character` 内部的类型。`ActionTemplate` 有独立模块，因为它能被不同角色复用。

---

## 2. 层次

```text
pages -> features -> entities -> shared
```

| 层 | 内容 |
|---|---|
| `pages` | 八个路由页面 |
| `features` | 用户操作：角色设置、生成、审核、导出；以及流程推进 `workflow-controller` |
| `entities` | 上表业务模块 |
| `shared` | 无业务语义的形状，目前只有分页 |

`app` 只做启动和路由，不构造服务、不向下注入。

### 依赖规则

1. 只能向下依赖，不允许反向。
2. 同层模块之间不互相导入。要共用就往下沉。
3. 跨模块只从模块目录的 `index.ts` 进入；`entities` 统一从 `@/entities` 使用。
4. `entities` 内部模块之间可以互相导入，对外仍是一个门。

---

## 3. 接口命名

需要访问后端资源的模块暴露一组接口，统一叫 `XxxApis`：

```text
ProjectApis  CharacterApis  ActionTemplateApis  GenerationApis
TaskApis
```

**不使用 `Repository` / `Port` / `Adapter` 这些叫法**，也不做接口与实现的分离——实现跟着接口放在同一个模块里。

`WorkflowRun` 是前端运行态，不声明后端接口。后端不读取、不推进、也不持久化它。

---

## 4. 流程推进

`features/workflow-controller` 是快速开始与手动工作流共用的推进边界，不含界面。

Controller 围绕同一份 WorkflowRun 提供创建、读取、订阅、当前步骤更新、推进、
任务恢复、结果写回和中断。这些操作依赖同一份步骤数据，不拆成互不共享状态的独立模块。

步骤顺序固定八步：

```text
角色资料 → 角色图 → 候选选择 → 动作资料 → 首帧 → 完整动画 → 审核 → 导出
```

**步骤怎么走、运行状态如何保存都由前端决定。** 后端不参与 WorkflowRun，
只接收各节点发起的生成请求，并在最终确认时持久化角色与动作资产。固定八步是当前
产品流程，不是为了通用编排而写的可配置工作流。

当前存储版本只支持一个 Revision。从历史步骤重开尚未进入产品定义，Controller
不提前暴露该操作；实现时必须同步升级本地存储版本和迁移规则。

快速开始与手动模式将共用同一份推进逻辑，但连续自动推进属于 Quick Start 页面接入范围，
当前 Controller 只实现一次推进一个步骤。

Controller 的提交锁和任务订阅属于实例状态。页面接入时必须复用同一个 Feature 实例，
不能在组件渲染或路由切换时重复创建。

---

## 5. 当前实现范围

- `WorkflowRun` 的内存状态、版本化 localStorage 镜像和刷新校验
- `角色资料 → 角色图生成 → 候选选择` 的 Controller 纵切
- Store、Controller 和纵向流程测试

页面、Workflow Editor、Quick Start 自动推进、后五步和真实后端适配器仍未实现。

### 恢复边界

- 已取得 `taskId`：刷新后先查询任务当前状态，未结束才重新订阅。
- 请求已经发出但尚未取得 `taskId`：后端没有幂等键或按请求标识查询的能力，
  前端将本地 Run 标为失败，不自动重提，避免静默创建重复任务。
- localStorage 写入失败时当前会话继续使用内存快照；页面提示与重新持久化策略在 UI 接入时补充。

---

## 6. 未与后端对齐的部分

明细见 `frontend/API_CONTRACT.md`。
