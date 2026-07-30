# Pages 页面入口层

## 模块职责

`pages` 是路由进入业务界面的第一层。页面负责读取路由参数，组合粗粒度 Feature，并把用户带到对应的业务场景。页面不应该沉下去实现实体规则，也不应该把一个大流程拆成互相不知道彼此状态的小服务。

## 已确认的页面入口

- `HomePage`：首页和主要入口。
- `QuickStartPage`：自然语言快速创建流程；无 `runId` 时创建流程，有 `runId` 时继续查看或推进同一条流程。
- `ProjectsPage`：项目列表。
- `ProjectDetailPage`：项目详情；读取 `projectId` 后组合项目、角色和工作流记录。
- `AssetLibraryPage`：项目资产库；读取 `projectId` 后展示该项目下可复用资产。
- `WorkflowEditorPage`：手动工作流编辑入口；读取 `runId` 和可选 `stage`，通过 Workflow Controller 推进同一份 WorkflowRun。
- `PlaytestPage`：只读核验入口；读取 `characterId` 和 `outfitId`，展示 PlaytestInspection 结论。
- `NotFoundPage`：兜底页面。

## 不允许放入的内容

- 不在页面里重新定义 Project、Character、WorkflowRun 等实体类型。
- 不在页面里绕过 Workflow Controller 直接改 WorkflowStep。
- 不在页面里实现可复用业务能力；可以组合 Feature，但不要把 Feature 的内部逻辑写散在页面里。

判断标准是：页面负责“把场景摆出来”，具体业务能力交给 Feature、Workflow Controller 和 Entity APIs。
