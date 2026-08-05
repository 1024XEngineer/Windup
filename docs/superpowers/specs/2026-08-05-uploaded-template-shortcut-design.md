# 上传角色母版直达动作生成设计

## 目标

Quick Start 与 Workflow Editor 都允许用户在首次输入时选择一张角色图片。选择图片后，前端将其上传为角色母版，跳过角色图片生成和候选选择，直接创建角色并生成 32 帧动作资产。未选择图片时，原有角色图片生成流程保持不变。

## 用户交互

### Quick Start

- 在输入区域右下角增加图片上传按钮，只接受 `image/*`。
- 选择图片后显示文件名并允许替换或移除；文件在用户提交时上传。
- 有图片时，输入框文字解释为动作描述：非空生成 `custom` 动作，空白生成默认 `idle` 动作。
- 没有图片时，输入框仍是角色描述并继续现有候选图流程，因此必须填写文字。

### Workflow Editor

- 在 `character-setup` 节点增加图片选择入口。
- 有图片时，该节点中的文字解释为动作描述，并在一次提交后直接进入动作生成。
- 没有图片时，文字仍是角色描述，继续角色图生成和候选确认。

## 架构与数据流

1. App 只创建一个现有 `MediaApis` 实例，并通过页面 Service 注入，页面不直接拼 HTTP 请求。
2. 提交图片时调用现有 `MediaApis.upload(file, 'reference-image', signal)`，得到不透明的 `MediaReference`。
3. Workflow Controller 增加明确的“采用已上传角色母版”状态转换：
   - `character-setup` 标记为 `passed`，记录上传媒体引用；
   - `character-template` 标记为 `passed`，输出该上传图片；
   - `template-candidate` 标记为 `passed`，记录该图片已被选定；
   - `action-generation` 标记为 `active`。
4. 该转换不创建 Generation 图片任务，也不伪造后端生成成功。
5. Quick Start 复用现有角色创建与动作生成编排。Workflow Editor 委托同一用例，不维护第二套角色或动作生成逻辑。
6. 动作输入使用上传图片作为 `firstFrameUrl` 和参考媒体；文字非空时使用 `custom`，空白时使用 `idle`。
7. 动作完成后继续复用现有审核、角色更新、Playtest 发布和历史恢复流程。

## 一致性与失败处理

- 图片类型由前端提前检查，后端仍做最终校验。
- Quick Start 先创建项目，再上传图片；上传失败时不创建 WorkflowRun，也不开始生成。
- Workflow Editor 上传失败时保持 `character-setup` 为 `active`，用户可以重试。
- 重复点击提交时只允许一项在途上传；页面离开时中止仍在途请求。
- 上传成功但动作任务提交失败时，WorkflowRun 按现有动作生成失败规则记录错误，不静默回退到角色图生成。
- 历史 16 帧或无上传图片的 WorkflowRun 仍按原契约恢复。

## 测试范围

- Quick Start 页面：右下角上传按钮、选图后允许空文字提交、移除图片后恢复文字必填。
- Quick Start Service：上传后不调用角色图片 Generation，前三步合法通过，动作生成接收上传引用和动作描述；空文字生成 `idle`。
- Workflow Editor 页面：有图时一次提交直达上传用例，无图时仍调用原 `nextStep`。
- Workflow 状态：上传快捷转换保持固定五节点顺序，恰好一个 active 步骤，并可被本地存储恢复。
- 失败：上传失败不推进 WorkflowRun；动作提交失败沿用现有失败状态。
- App 装配：两个入口共享同一个真实 `MediaApis`，没有页面级假上传实现。

## 非目标

- 不增加新的媒体模块、后端上传接口或图片生成接口。
- 不修改 Playtest、导出格式、Cocos 或微信小程序导入。
- 不为上传图片增加裁剪、抠图或编辑器。
