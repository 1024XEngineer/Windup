# WorkflowController

`WorkflowController` 是页面与实体接口之间的业务协调器。一个实例只绑定一条
`WorkflowRun`；它同时持有当前数据和修改这份数据的业务方法。

## 两种入口

- Workflow Editor 等待用户逐步调用生成、确认和审核方法。
- Quick Start 用 AI 自动做选择并连续调用同一组方法。

两者界面和交互不同，但不会各自维护另一套工作流状态机。Controller 本身也不保存
`driver`，因为“由谁点击”不改变节点图的业务规则。

## 页面读取方式

页面只有一个持续更新渠道：先用 `getWorkflow()` 取得首屏快照，再用 `subscribe()` 接收
后续保存和 SSE 写回。生成、确认、重做等方法是命令，只返回 `Promise<void>`；它们不再
额外返回另一份 `WorkflowRun`，因此页面不会在“命令返回值”和“Controller 当前状态”之间
做选择。

```tsx
const [workflow, setWorkflow] = useState(() => controller.getWorkflow())

useEffect(() => controller.subscribe(setWorkflow), [controller])

async function generateCharacter() {
  await controller.generateCharacterTemplate(setupNodeId, { spriteWidth: 64, spriteHeight: 64 })
  // 生成中和 SSE 终态都会由 subscribe 更新 workflow。
}
```

## 边界

- `entities/workflow-run` 定义纯数据和异步 CRUD，不包含推进方法。
- Controller 根据 `dependsOnNodeIds` 解锁节点，允许同一依赖下的多个 Action 并行。
- 新增 Action 一次创建动作首帧、动作生成方式、完整动画和审核四个 node，不会遗漏路线选择或用数组位置猜关系。
- 动作首帧使用已确认角色母版和动作提示词调用图片 Generation，一次生成三张候选；用户确认其中一张后，完整动画节点才使用该首帧调用 32 帧动作 Generation。
- Controller 方法与后端 Generation、WorkflowRun node 使用同一概念名：`characterTemplate`、`firstFrame`、`completeAnimation` 和 `review`，不再为同一概念保留另一套叫法。
- 当前视频裁剪路线继续调用既有 Generation；3D 转 2D 选择会随 WorkflowRun 落库，但接口提供前明确阻止生成。
- Generation 通过 `nodeId + taskId` 写回；节点重做后，旧任务的迟到结果会被丢弃。
- WorkflowRun 只有在后端 `update` 成功后才替换内存快照，保存失败不会向页面假报成功。
- `archiveAction()` 只标记已经完成并通过审核的 Action 四节点分支；它不删除 Character 资产，也不改动共享角色节点或其他 Action。
- Generation 已创建但任务引用暂时保存失败时，本实例会保留待附加记录；重试同一命令或
  `resume()` 会复用原任务，不会再次创建和重复计费。
- 中断只停止前端自动处理和 SSE，可由 `resume()` 继续。当前后端没有取消接口，因此不会伪装成已取消任务；
  恢复时先订阅再查询任务快照，既能拿终态，也不会漏掉查询与订阅之间的完成事件。
- Controller 不包含页面、Playtest、后端实现、发布和导出逻辑。

## 文件

- `controller.ts`：单 WorkflowRun 的业务方法、持久化串行化和 Generation 恢复。
- `controller.test.ts`：节点依赖、并行、中断、重做、异步竞争和持久化失败测试。
