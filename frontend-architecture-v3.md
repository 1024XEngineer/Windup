# Windup 前端架构

本文记录当前前端的模块划分与依赖规则。2026-07-30 按当日评审意见重写为只提交模块边界与接口；实现按模块拆成后续 PR 陆续落地，首页是第一个。

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

外壳套在哪些页面上也是路由决策：`AppShellRoute` 写在 `app.tsx` 的路由表里，谁在里面谁就有顶栏。首页、快速开始、Workflow Editor 与 Playtest 使用全局外壳；`/projects/:projectId/*` 是独立项目工作区，由 `ProjectDetailPage` 提供项目级导航，不重复套全局顶栏。外壳组件自身不读 pathname，不判断自己该不该出现；顶栏内部读 pathname 只为高亮当前项。外壳也不统一夹居中容器，宽度与留白由页面自己决定。

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
```

**不使用 `Repository` / `Port` / `Adapter` 这些叫法**，也不做接口与实现的分离——实现跟着接口放在同一个模块里。

`WorkflowRun` 是前端运行态，不声明后端接口。后端不读取、不推进、也不持久化它。

---

## 4. 流程推进

`features/workflow-controller` 是快速开始与手动工作流共用的推进边界，不含界面。

Controller 围绕同一份 WorkflowRun 提供推进、更新、重启和中断。这些操作依赖同一份步骤数据，不拆成互不共享状态的独立模块。

步骤顺序固定八步：

```text
角色资料 → 角色图 → 候选选择 → 动作资料 → 首帧 → 完整动画 → 审核 → 导出
```

**步骤怎么走、运行状态如何保存都由前端决定。** 后端不参与 WorkflowRun，只接收各节点发起的生成请求，并在最终确认时持久化角色与动作资产。

从历史步骤重开会追加一个新 Revision，旧 Revision 保留为只读历史，不会被改写成失败或完成。

快速开始与手动模式共用同一份推进逻辑，区别只是前者连续调用、后者一次一步。隐藏步骤不等于跳过步骤——门禁写在流程模型里，不在界面里。

---

## 5. 当前实现范围

- `ProjectApis` 与 `CharacterApis` 实现 PR #75 的 Project、Character HTTP 契约；snake_case 只存在于各实体模块内部的 DTO 映射。
- 项目中心、项目工作区、角色资产库、角色详情按 `Project → Character → Outfit → Action → Frame` 层级读取真实接口。
- 测试通过 HTTP 替身返回契约数据；本模块的生产代码不包含 Mock API、演示实体或 livedemo 资产。

本轮不包含新建项目流程、Workflow Editor 实现、Action Template 后端能力、导出接线、图片上传与登录流程。穿戴道具不作为独立资产层暴露。

首页仍不依赖 `entities` 与 `features`，两张入口卡片只做路由跳转。首屏三段制作路径是 `WORKFLOW_STEP_ORDER` 八步的粗粒度概括，改流程时要一并改。

---

## 6. 未与后端对齐的部分

PR #75 尚未合并，因此本实现要求先合并该后端 PR；契约明细与仍需后端处理的问题见 `frontend/API_CONTRACT.md`。
