# 四向八向独立方向资产修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 保证四向和八向从提示词、逐方向生成、质量校验、持久化、恢复、宫格展示到动作与导出消费都使用独立方向图片，并拒绝把多方向拼图当作单方向资产。

**Architecture:** 保留现有“一方向一任务”控制器和数据合同，在 Provider 提示与上传前质量闸门处阻止合成方向图进入系统；用共享的纯方向布局模型统一 Quick Start 与 Workflow Editor 的 1×1、2×2、3×3 展示。先建立全链路审计基线，再按测试先行修复已知缺口，最后用消费者回归测试关闭审计项。

**Tech Stack:** Python 3、Pydantic/SQLAlchemy 编排层、Pillow/NumPy 图像质量检测、React 19、TypeScript 6、Vitest、Testing Library、pytest、ruff、oxlint。

**Spec:** docs/superpowers/specs/2026-08-26-independent-direction-assets-design.md

## Global Constraints

- GitHub 提交人、PR head owner 和上传账号必须是 xyh202131。
- 不得直接提交或推送到 1024XEngineer/Windup；只推送 xyh202131/Windup 的既有 feat/full-direction-ui 分支。
- 不创建新分支，不合并、关闭或删除用户的 PR 或分支。
- PR 描述使用中文并关联 Issue；本计划只处理独立方向资产，不混入其他改动。
- 四向由东、西、北、南四张独立图片组成，以 2×2 四宫格展示。
- 八向由八张独立图片组成，以中心留空的 3×3 九宫格展示。
- 宫格只组合现有独立 URL，不创建、上传或裁切新的拼图媒体。
- 四向和八向不得使用镜像补齐；仅单向旧资产保留 east→west 镜像兼容。
- 不新增自动付费重试；失败只允许复用现有逐方向手动重试。
- 未经真实 Provider 验收的视觉朝向效果必须标记为“未真实验证”。

---

## File Structure

- docs/superpowers/audits/2026-08-26-independent-direction-assets.md：全链路检查点、证据和结论。
- backend/packages/common/src/windup_common/directions.py：八个方向唯一且明确的角色朝向语义。
- backend/packages/app/src/windup_app/server/orchestrator/executor.py：单图 Provider 合同和上传前主体数闸门。
- backend/tests/test_directional_generation.py、backend/tests/test_master_cutout.py：后端回归测试。
- frontend/src/features/quick-start-agent/planner.ts：角色身份描述与方向构图分离。
- frontend/src/entities/character/directions.ts：共享的单向、四向、八向布局模型。
- frontend/src/pages/quick-start/direction-sheet.ts、frontend/src/pages/quick-start/index.tsx：Quick Start 宫格。
- frontend/src/pages/workflow-editor/index.tsx：Workflow Editor 宫格。
- 对应测试以及角色详情、Playtest、发布和导出消费者测试：关闭下游审计。

---

### Task 1: 建立关联 Issue 和全链路审计基线

**Files:**
- Create: docs/superpowers/audits/2026-08-26-independent-direction-assets.md

**Interfaces:**
- Consumes: 已确认规格的全链路审计范围。
- Produces: GitHub Issue 编号和后续任务更新的审计矩阵。

- [ ] **Step 1: 核验 GitHub 身份和远端边界**

~~~powershell
gh api user --jq .login
git remote -v
git status --short --branch
~~~

Expected: 登录账号为 xyh202131；contributor 指向 xyh202131/Windup；当前分支为 feat/full-direction-ui 且工作区干净。

- [ ] **Step 2: 创建关联 Issue**

~~~powershell
$issueUrl = gh issue create --repo 1024XEngineer/Windup --title "fix: 保证四向八向使用独立方向图片" --body @"
## 问题

四向或八向流程可能把一张多视图拼图当作单方向资产，生成、确认、恢复或消费链路也可能只展示或复用东向图片。

## 目标

- 四向生成四张独立图片，以 2×2 四宫格展示。
- 八向生成八张独立图片，以中心留空的 3×3 九宫格展示。
- 多主体拼图在上传前失败。
- 审计提示词、任务、落库、恢复、动作、详情、Playtest、发布和导出全链路。

## 验收

以 docs/superpowers/specs/2026-08-26-independent-direction-assets-design.md 为准。
"@
$issueNumber = [int]($issueUrl.Trim().Split('/')[-1])
$issueNumber
~~~

Expected: 输出正整数 Issue 编号。

- [ ] **Step 3: 创建审计矩阵**

~~~markdown
# 独立方向资产全链路审计

状态只允许：已验证正确、发现并修复、已有 Issue 阻塞、无法真实验证。

| 边界 | 检查目标 | 状态 | 证据 |
| --- | --- | --- | --- |
| 提示词来源 | Planner、手工输入、上传母版、Workflow Editor 不把多视图构图交给单方向调用 | 无结论 | 初始审计 |
| 项目方向规格 | 单向、四向、八向枚举前后端一致 | 无结论 | 初始审计 |
| 任务编排 | 每个真实方向有独立任务、方向字段和恢复引用 | 无结论 | 初始审计 |
| Provider 调用 | 固定投影、同一身份锚点、一个调用只产一个方向 | 无结论 | 初始审计 |
| 图片处理 | 零主体或多主体在上传前失败 | 无结论 | 初始审计 |
| 结果与落库 | 方向、URL、候选索引和模板映射不串位 | 无结论 | 初始审计 |
| Quick Start | 生成中、待确认、已确认、刷新后宫格一致 | 无结论 | 初始审计 |
| Workflow Editor | 角色母版和动作首帧完成后仍显示完整方向集 | 无结论 | 初始审计 |
| 动作与详情 | 动作首帧、完整动作、角色详情读取对应方向 | 无结论 | 初始审计 |
| Playtest | 多方向动作不回落到 east 镜像 | 无结论 | 初始审计 |
| 发布与导出 | 四向八向只消费真实方向序列 | 无结论 | 初始审计 |
| 真实 Provider | 实际身份一致性与朝向质量 | 无结论 | 需要付费凭据和授权 |
~~~

最终提交前每行必须改成四种允许状态之一并附命令、测试或代码锚点。

- [ ] **Step 4: 提交审计基线**

~~~powershell
git add docs/superpowers/audits/2026-08-26-independent-direction-assets.md
git commit -m "docs(direction): 建立独立方向资产审计基线"
~~~

---

### Task 2: 明确八个方向的角色朝向语义

**Files:**
- Modify: backend/packages/common/src/windup_common/directions.py
- Test: backend/tests/test_directional_generation.py

**Interfaces:**
- Consumes: ActionDirection 八值枚举。
- Produces: direction_prompt(direction: ActionDirection) -> str。

- [ ] **Step 1: 写失败测试**

~~~python
@pytest.mark.parametrize(
    ("direction", "visible_surface"),
    [
        (ActionDirection.EAST, "right-facing side"),
        (ActionDirection.WEST, "left-facing side"),
        (ActionDirection.NORTH, "back of the head"),
        (ActionDirection.SOUTH, "face and chest"),
        (ActionDirection.NORTH_EAST, "back-right three-quarter"),
        (ActionDirection.NORTH_WEST, "back-left three-quarter"),
        (ActionDirection.SOUTH_EAST, "front-right three-quarter"),
        (ActionDirection.SOUTH_WEST, "front-left three-quarter"),
    ],
)
def test_every_direction_prompt_names_visible_character_surfaces(direction, visible_surface):
    prompt = direction_prompt(direction).lower()
    assert visible_surface in prompt
    assert "camera position" in prompt
    assert "projection unchanged" in prompt
~~~

- [ ] **Step 2: 运行测试并确认旧提示失败**

~~~powershell
Set-Location backend
uv run pytest tests/test_directional_generation.py -q
~~~

Expected: 新参数化测试因缺少身体表面语义失败。

- [ ] **Step 3: 实现八个唯一方向描述**

~~~python
_DIRECTION_PROMPTS = {
    ActionDirection.EAST: "The character has a right-facing side orientation; the face, torso, hips, and feet point right.",
    ActionDirection.WEST: "The character has a left-facing side orientation; the face, torso, hips, and feet point left.",
    ActionDirection.NORTH: "The character faces away; the back of the head, back, and backs of the legs are the main visible surfaces.",
    ActionDirection.SOUTH: "The character faces forward; the face and chest, abdomen, and fronts of the legs are the main visible surfaces.",
    ActionDirection.NORTH_EAST: "The character has a back-right three-quarter orientation.",
    ActionDirection.NORTH_WEST: "The character has a back-left three-quarter orientation.",
    ActionDirection.SOUTH_EAST: "The character has a front-right three-quarter orientation.",
    ActionDirection.SOUTH_WEST: "The character has a front-left three-quarter orientation.",
}
~~~

direction_prompt 继续追加固定 camera position、angle、projection 的合同，删除 screen-space-only 的模糊句子。

- [ ] **Step 4: 运行测试并提交**

~~~powershell
uv run pytest tests/test_directional_generation.py -q
git add packages/common/src/windup_common/directions.py tests/test_directional_generation.py
git commit -m "fix(direction): 明确八向角色朝向语义"
~~~

---

### Task 3: 强制单方向单主体输出并在上传前拒绝拼图

**Files:**
- Modify: backend/packages/app/src/windup_app/server/orchestrator/executor.py
- Test: backend/tests/test_master_cutout.py

**Interfaces:**
- Consumes: subject_blobs(frames) 和 Task 2 的 direction_prompt。
- Produces: 仅在每张候选主体数为 1 时上传的 _produce_image。

- [ ] **Step 1: 写零主体和四主体失败测试**

~~~python
@pytest.mark.parametrize("subjects", [0, 4])
def test_character_image_rejects_non_single_subject_before_upload(subjects):
    uploaded = []
    executor = ImageTaskExecutor(
        image=_Gen(_master(subjects=subjects)),
        matte=_BackgroundMatte(),
        upload=lambda png: uploaded.append(png) or "https://cdn/result.png",
    )
    with pytest.raises(ValueError, match="必须且只能包含一个角色主体"):
        executor._produce_image(
            CharacterImageInput(prompt="四向角色视图", width=64, height=64, num_images=1),
            ProjectConstraints(directions=4, sprite_w=64, sprite_h=64),
        )
    assert uploaded == []
~~~

复用测试文件已有的 PNG/matte 夹具及其真实签名，不复制第二套图像夹具。

- [ ] **Step 2: 写单图提示合同失败测试**

~~~python
def test_provider_prompt_ends_with_one_direction_asset_contract():
    seen = {}

    class _RecordingGen:
        def gen_image(self, prompt, refs):
            seen["prompt"] = prompt
            return _master()

    ImageTaskExecutor(
        image=_RecordingGen(),
        matte=_BackgroundMatte(),
        upload=lambda _png: "https://cdn/result.png",
    )._produce_image(
        CharacterImageInput(
            prompt="四向视图，朝上、朝下、朝左、朝右",
            width=64,
            height=64,
            num_images=1,
            direction=ActionDirection.WEST,
        ),
        ProjectConstraints(directions=4, sprite_w=64, sprite_h=64),
    )
    prompt = seen["prompt"]
    assert "one canvas" in prompt.lower()
    assert "one centered full-body character instance" in prompt.lower()
    assert "one standalone direction asset" in prompt.lower()
~~~

- [ ] **Step 3: 运行测试并确认失败**

~~~powershell
uv run pytest tests/test_master_cutout.py -q
~~~

- [ ] **Step 4: 在提示尾部追加正向单图合同**

~~~python
_SINGLE_DIRECTION_ASSET_PROMPT = (
    "One canvas contains one centered full-body character instance at one scale. "
    "This request produces one standalone direction asset for the requested orientation."
)
parts = [base, _image_view_prompt(cons), direction_prompt(input.direction), _SINGLE_DIRECTION_ASSET_PROMPT]
~~~

不要使用 negative_prompt 或否定式“不要拼图”。

- [ ] **Step 5: 在上传前校验主体数**

~~~python
blob_counts = subject_blobs(cut)
invalid = [(index, count) for index, count in enumerate(blob_counts) if count != 1]
if invalid:
    summary = "、".join(f"候选{index + 1}={count}" for index, count in invalid)
    raise ValueError(f"角色方向图必须且只能包含一个角色主体：{summary}")
urls = generation_io.upload_frames(upload, pngs)
return urls, {"subject_blobs": list(blob_counts)}
~~~

- [ ] **Step 6: 运行相关测试并提交**

~~~powershell
uv run pytest tests/test_master_cutout.py tests/test_generation_orchestration.py tests/test_generation_quota.py -q
git add packages/app/src/windup_app/server/orchestrator/executor.py tests/test_master_cutout.py
git commit -m "fix(generation): 拒绝多主体方向拼图"
~~~

Expected: 错误图片不上传；失败任务沿既有结算路径处理。

---

### Task 4: 阻止 Planner 把宫格构图写进角色身份提示

**Files:**
- Modify: frontend/src/features/quick-start-agent/planner.ts
- Test: frontend/src/features/quick-start-agent/planner.test.ts
- Test: frontend/src/features/quick-start-agent/planner.protocol.test.ts

**Interfaces:**
- Consumes: quickStartPlannerInstructions。
- Produces: 只描述单角色身份、外观和画风的 optimizedPrompt 指令合同。

- [ ] **Step 1: 写失败测试**

~~~typescript
it('keeps direction count and grid composition out of optimizedPrompt', () => {
  const instructions = quickStartPlannerInstructions(false, '像素艺术')
  expect(instructions).toContain('optimizedPrompt 只描述一个角色实例')
  expect(instructions).toContain('方向数量由宿主的方向控件单独传递')
  expect(instructions).toContain('不得加入多视图、转面表、精灵表或宫格构图')
})
~~~

- [ ] **Step 2: 运行并确认失败**

~~~powershell
Set-Location ../frontend
npm test -- src/features/quick-start-agent/planner.test.ts src/features/quick-start-agent/planner.protocol.test.ts
~~~

- [ ] **Step 3: 最小修改 Planner 指令**

~~~typescript
optimizedPrompt 只描述一个角色实例的稳定身份、完整身体、外观、服装、气质和美术风格。
方向数量由宿主的方向控件单独传递；不得加入多视图、转面表、精灵表或宫格构图。
~~~

不修改 Tool schema，不删除用户原始对话文本。

- [ ] **Step 4: 运行测试并提交**

~~~powershell
npm test -- src/features/quick-start-agent/planner.test.ts src/features/quick-start-agent/planner.protocol.test.ts src/features/quick-start-agent/runtime.test.ts
git add src/features/quick-start-agent/planner.ts src/features/quick-start-agent/planner.test.ts src/features/quick-start-agent/planner.protocol.test.ts
git commit -m "fix(quick-start): 分离角色描述与方向构图"
~~~

---

### Task 5: 建立共享的方向宫格布局模型

**Files:**
- Modify: frontend/src/entities/character/directions.ts
- Modify: frontend/src/entities/character/index.ts
- Modify: frontend/src/entities/index.ts
- Test: frontend/src/entities/character/directions.test.ts

**Interfaces:**
- Consumes: DirectionalMovement 和 ActionDirection。
- Produces: getDirectionGridLayout(movement: DirectionalMovement) -> DirectionGridLayout。

- [ ] **Step 1: 写布局失败测试**

~~~typescript
expect(getDirectionGridLayout('single')).toEqual({ columns: 1, cells: ['east'] })
expect(getDirectionGridLayout('four-way')).toEqual({
  columns: 2,
  cells: ['north', 'south', 'west', 'east'],
})
expect(getDirectionGridLayout('eight-way')).toEqual({
  columns: 3,
  cells: [
    'north_west', 'north', 'north_east',
    'west', null, 'east',
    'south_west', 'south', 'south_east',
  ],
})
~~~

- [ ] **Step 2: 运行并确认 helper 不存在**

~~~powershell
npm test -- src/entities/character/directions.test.ts
~~~

- [ ] **Step 3: 实现并导出只读布局模型**

~~~typescript
export interface DirectionGridLayout {
  readonly columns: 1 | 2 | 3
  readonly cells: readonly (ActionDirection | null)[]
}

const DIRECTION_GRID_LAYOUTS: Record<DirectionalMovement, DirectionGridLayout> = {
  single: { columns: 1, cells: ['east'] },
  'four-way': { columns: 2, cells: ['north', 'south', 'west', 'east'] },
  'eight-way': {
    columns: 3,
    cells: [
      'north_west', 'north', 'north_east',
      'west', null, 'east',
      'south_west', 'south', 'south_east',
    ],
  },
}

export function getDirectionGridLayout(movement: DirectionalMovement): DirectionGridLayout {
  return DIRECTION_GRID_LAYOUTS[movement]
}
~~~

- [ ] **Step 4: 运行测试、类型检查并提交**

~~~powershell
npm test -- src/entities/character/directions.test.ts
npm run typecheck
git add src/entities/character/directions.ts src/entities/character/directions.test.ts src/entities/character/index.ts src/entities/index.ts
git commit -m "feat(direction): 统一方向宫格布局模型"
~~~

---

### Task 6: 修复 Quick Start 全状态方向展示

**Files:**
- Modify: frontend/src/pages/quick-start/direction-sheet.ts
- Test: frontend/src/pages/quick-start/direction-sheet.test.ts
- Modify: frontend/src/pages/quick-start/index.tsx
- Test: frontend/src/pages/quick-start/index.test.tsx

**Interfaces:**
- Consumes: Task 5 的 getDirectionGridLayout、selectedImages、selectedFirstFrameUrls。
- Produces: 四向四个独立 img 的 2×2 宫格和八向八个独立 img 的空心九宫格。

- [ ] **Step 1: 写四向候选 URL 独立性测试**

~~~typescript
const sheets = buildDirectionSheetCandidates(candidates, 'four-way')
expect(sheets[0]?.selections).toEqual({
  east: 'east-0.png',
  west: 'west-0.png',
  north: 'north-0.png',
  south: 'south-0.png',
})
expect(new Set(Object.values(sheets[0]!.selections)).size).toBe(4)
~~~

- [ ] **Step 2: 写完成态失败测试**

~~~typescript
it('keeps four independent template images visible after confirmation', async () => {
  const run = workflow(setupAndTemplate({
    selectedImageUrl: 'east.png',
    selectedImages: {
      east: 'east.png', west: 'west.png', north: 'north.png', south: 'south.png',
    },
    status: 'passed',
    phase: 'completed',
    generations: [
      { taskId: 'template-east', role: 'character_template', direction: 'east' },
      { taskId: 'template-west', role: 'character_template', direction: 'west' },
      { taskId: 'template-north', role: 'character_template', direction: 'north' },
      { taskId: 'template-south', role: 'character_template', direction: 'south' },
    ],
  }))
  renderAt('/quick-start/run-1', serviceFor(run), agentFor(), projectReader(existingProject))
  const grid = await screen.findByRole('group', { name: '四向首帧集合' })
  expect(within(grid).getAllByRole('img')).toHaveLength(4)
  expect(grid.className).toContain('grid-cols-2')
  expect(within(grid).queryByLabelText('中心留空')).not.toBeInTheDocument()
})

it('keeps eight independent first frames and an empty center after confirmation', async () => {
  const run = workflowWithCompletedEightWayFirstFrames()
  renderAt(
    '/quick-start/run-1',
    serviceFor(run),
    agentFor(),
    projectReader({ ...existingProject, directionalMovement: 'eight-way' }),
  )
  const grid = await screen.findByRole('group', { name: '八向首帧集合' })
  expect(within(grid).getAllByRole('img')).toHaveLength(8)
  expect(within(grid).getByLabelText('中心留空')).toBeInTheDocument()
})
~~~

在测试文件内新增 `workflowWithCompletedEightWayFirstFrames()`，用现有 `workflow()` fixture 构造一个 `action-first-frame` 节点；其 `selectedFirstFrameUrls` 必须显式包含八个不同 URL，不能调用生产代码生成预期值。

- [ ] **Step 3: 运行测试并确认当前四向三列和完成态单图失败**

~~~powershell
npm test -- src/pages/quick-start/direction-sheet.test.ts src/pages/quick-start/index.test.tsx
~~~

- [ ] **Step 4: 用共享布局替换固定九宫格常量**

~~~typescript
const layout = getDirectionGridLayout(movement)
const gridColumns =
  layout.columns === 1 ? 'grid-cols-1' :
  layout.columns === 2 ? 'grid-cols-2' :
  'grid-cols-3'
~~~

DirectionFirstFrameGrid 和 DirectionSheetCandidatePicker 的每个非空 cell 继续读取 selections[direction]，中心 null 只渲染空格。

- [ ] **Step 5: 修复角色母版和动作首帧 passed 分支**

多方向 passed 状态渲染完整 grid；只有 single 才渲染单个 selectedImageUrl。不得创建 canvas、data URL 或合成媒体。

- [ ] **Step 6: 运行回归测试并提交**

~~~powershell
npm test -- src/pages/quick-start/direction-sheet.test.ts src/pages/quick-start/index.test.tsx src/pages/quick-start/service.test.ts
git add src/pages/quick-start/direction-sheet.ts src/pages/quick-start/direction-sheet.test.ts src/pages/quick-start/index.tsx src/pages/quick-start/index.test.tsx
git commit -m "fix(quick-start): 展示独立方向图片宫格"
~~~

---

### Task 7: 修复 Workflow Editor 的角色母版和动作首帧完成态

**Files:**
- Modify: frontend/src/pages/workflow-editor/index.tsx
- Test: frontend/src/pages/workflow-editor/index.test.tsx

**Interfaces:**
- Consumes: Task 5 的布局模型、selectedImages 和 selectedFirstFrameUrls。
- Produces: Workflow Editor 全状态完整方向宫格。

- [ ] **Step 1: 写角色母版四向完成态失败测试**

~~~typescript
it('renders four confirmed character templates as independent images', () => {
  const workflow = selectingTemplateWorkflow(4, 'template-east')
  workflow.nodes[1] = {
    ...(workflow.nodes[1] as CharacterTemplateWorkflowNode),
    status: 'passed',
    phase: 'completed',
    selectedImageUrl: 'https://assets.windup.test/east.png',
    selectedImages: {
      east: 'https://assets.windup.test/east.png',
      west: 'https://assets.windup.test/west.png',
      north: 'https://assets.windup.test/north.png',
      south: 'https://assets.windup.test/south.png',
    },
  }
  const project = { ...projectFixture(), directionalMovement: 'four-way' as const }
  defaultSessionLoader.mockResolvedValue(createSession(workflow, { project }))
  renderEditor('/workflow-editor/42')
  const grid = screen.getByRole('group', { name: '四向角色母版集合' })
  expect(within(grid).getAllByRole('img')).toHaveLength(4)
  expect(grid.className).toContain('grid-cols-2')
})
~~~

- [ ] **Step 2: 写动作首帧八向完成态失败测试**

~~~typescript
it('renders eight confirmed first frames with an empty center', () => {
  const workflow = completedFirstFrameWorkflowWithEightUrls()
  const project = { ...projectFixture(), directionalMovement: 'eight-way' as const }
  defaultSessionLoader.mockResolvedValue(createSession(workflow, { project }))
  renderEditor('/workflow-editor/42')
  const grid = screen.getByRole('group', { name: '八向动作首帧集合' })
  expect(within(grid).getAllByRole('img')).toHaveLength(8)
  expect(within(grid).getByLabelText('中心留空')).toBeInTheDocument()
})
~~~

在测试文件内新增 `completedFirstFrameWorkflowWithEightUrls()`，基于现有 `workflowFixture()` 只替换动作首帧节点，并显式写入八个不同的 `selectedFirstFrameUrls`。

- [ ] **Step 3: 运行并确认旧 completed 分支只展示 east**

~~~powershell
npm test -- src/pages/workflow-editor/index.test.tsx
~~~

- [ ] **Step 4: 使用共享 layout 修复两类完成态**

角色母版读取 node.selectedImages，动作首帧读取 node.selectedFirstFrameUrls。兼容字段 selectedImageUrl 和 selectedFirstFrameUrl 只为 east 提供旧数据回落，不能填充其他方向。

- [ ] **Step 5: 运行测试并提交**

~~~powershell
npm test -- src/pages/workflow-editor/index.test.tsx src/features/workflow-controller/controller.test.ts
git add src/pages/workflow-editor/index.tsx src/pages/workflow-editor/index.test.tsx
git commit -m "fix(workflow-editor): 保留完整方向集合展示"
~~~

---

### Task 8: 锁定逐方向任务、落库和下游消费合同

**Files:**
- Test: frontend/src/features/workflow-controller/controller.test.ts
- Test: frontend/src/pages/quick-start/service.test.ts
- Test: frontend/src/pages/character-detail/index.test.tsx
- Test: frontend/src/pages/playtest/workbench/model.test.ts
- Test: frontend/src/features/export/index.test.ts
- Test: frontend/src/features/export-package/progressive-export.test.ts
- Modify if its new contract test fails: frontend/src/features/workflow-controller/controller.ts
- Modify if its new contract test fails: frontend/src/pages/quick-start/service.ts
- Modify if its new contract test fails: frontend/src/pages/character-detail/index.tsx
- Modify if its new contract test fails: frontend/src/pages/playtest/workbench/model.ts
- Modify if its new contract test fails: frontend/src/features/export/index.ts
- Modify if its new contract test fails: frontend/src/features/export-package/progressive-export.ts
- Modify: docs/superpowers/audits/2026-08-26-independent-direction-assets.md

**Interfaces:**
- Consumes: generationDirections、逐方向任务引用、角色 templates 和动作 sequences。
- Produces: 多方向资产不被 east 或镜像替代的审计证据。

- [ ] **Step 1: 增加控制器四向任务独立性测试**

~~~typescript
expect(generationApis.create).toHaveBeenCalledTimes(4)
expect(generationApis.create.mock.calls.map(([input]) => input.direction)).toEqual(
  expect.arrayContaining(['east', 'west', 'north', 'south']),
)
expect(new Set(templateNode.generations.map((reference) => reference.taskId)).size).toBe(4)
~~~

同时断言 east 以外调用使用同一已确认母版 referenceMedia[0]，但各自保留 direction。

- [ ] **Step 2: 增加角色模板落库独立性测试**

~~~typescript
expect(updatedCharacter.templates).toEqual(
  expect.arrayContaining(
    ['east', 'west', 'north', 'south'].map((direction) =>
      expect.objectContaining({ direction, sourceDirection: null, mirrorX: false }),
    ),
  ),
)
expect(new Set(updatedCharacter.templates.map((template) => template.imageUrl)).size).toBe(4)
~~~

- [ ] **Step 3: 增加详情、Playtest、发布和导出消费者测试**

每个测试构造四个不同方向 URL/帧 URL，并逐项断言 sourceDirection 等于自身、mirrorX 为 false、帧 URL 含对应方向。单向兼容测试继续断言 west 使用 east 且 mirrorX 为 true。

~~~typescript
for (const direction of ['east', 'west', 'north', 'south'] as const) {
  expect(resultFor(direction).sourceDirection).toBe(direction)
  expect(resultFor(direction).mirrorX).toBe(false)
}
~~~

- [ ] **Step 4: 运行消费者测试并修复真实失败**

~~~powershell
npm test -- src/features/workflow-controller/controller.test.ts src/pages/quick-start/service.test.ts src/pages/character-detail/index.test.tsx src/pages/playtest/workbench/model.test.ts src/features/export/index.test.ts src/features/export-package/progressive-export.test.ts
~~~

Expected: 全部 PASS。若失败，只修改测试直接指向的消费者，并在审计文档记录失败原因、文件和测试名。

- [ ] **Step 5: 关闭非 Provider 审计项并提交**

将审计矩阵每个“无结论”替换为允许状态和实际证据。真实 Provider 行只有在获得付费授权并实际运行后才能标记“已验证正确”，否则为“无法真实验证”。

~~~powershell
git add frontend/src docs/superpowers/audits/2026-08-26-independent-direction-assets.md
git diff --cached --name-only
git commit -m "test(direction): 锁定全链路独立资产合同"
~~~

Expected: 暂存区不含压缩包、构建产物、截图缓存或无关文档。

---

### Task 9: 全量验证、回填 Issue 和创建 PR

**Files:**
- Modify: docs/superpowers/audits/2026-08-26-independent-direction-assets.md only if final evidence changes.

**Interfaces:**
- Consumes: Tasks 1–8 的代码、测试和审计矩阵。
- Produces: 干净 fork 分支、关联 Issue 的中文 Ready for review PR 和可核验 CI。

- [ ] **Step 1: 运行后端验证**

~~~powershell
Set-Location backend
uv run pytest tests/test_directional_generation.py tests/test_master_cutout.py tests/test_direction_set_orchestration.py tests/test_generation_api.py -q
uv run ruff check packages tests
uv run lint-imports
~~~

- [ ] **Step 2: 运行前端定向验证**

~~~powershell
Set-Location ../frontend
npm test -- src/entities/character/directions.test.ts src/features/quick-start-agent/planner.test.ts src/pages/quick-start/direction-sheet.test.ts src/pages/quick-start/index.test.tsx src/pages/quick-start/service.test.ts src/pages/workflow-editor/index.test.tsx src/features/workflow-controller/controller.test.ts src/pages/character-detail/index.test.tsx src/pages/playtest/workbench/model.test.ts src/features/export/index.test.ts src/features/export-package/progressive-export.test.ts
npm run typecheck
npm run lint
npm run format:check
~~~

- [ ] **Step 3: 运行前端全量测试和差异检查**

~~~powershell
npm test
Set-Location ..
git diff --check upstream/main...HEAD
git status --short
git diff --name-only upstream/main...HEAD
~~~

Expected: 测试 PASS，工作区干净；差异只包含规格、计划、审计和方向修复相关源码/测试。

- [ ] **Step 4: 推送既有 fork 分支**

~~~powershell
gh api user --jq .login
git push contributor feat/full-direction-ui
~~~

Expected: 登录账号为 xyh202131；不触碰 upstream。

- [ ] **Step 5: 创建中文 Ready for review PR**

~~~powershell
$issueNumber = gh issue list --repo 1024XEngineer/Windup --author xyh202131 --state open --search '保证四向八向使用独立方向图片 in:title' --json number --jq '.[0].number'
gh pr create --repo 1024XEngineer/Windup --head xyh202131:feat/full-direction-ui --base main --title "fix(direction): 四向八向使用独立方向图片" --body @"
## 变更

- 四向使用四张独立图片并以 2×2 四宫格展示
- 八向使用八张独立图片并以中心留空的 3×3 九宫格展示
- 强化逐方向提示并在上传前拒绝零主体或多主体拼图
- 修复 Quick Start 与 Workflow Editor 多方向完成态
- 补齐任务、落库、恢复和下游消费审计与回归测试

## 验证

- 后端定向测试、ruff、import-linter
- 前端定向测试、全量测试、类型检查、lint、格式检查

Closes #$issueNumber
"@
~~~

- [ ] **Step 6: 核验 PR 身份、范围和 CI**

~~~powershell
gh pr view --repo 1024XEngineer/Windup --json number,url,isDraft,headRefName,headRepositoryOwner,baseRefName,files,statusCheckRollup
~~~

Expected: head owner=xyh202131、head=feat/full-direction-ui、base=main、isDraft=false；Files changed 不含压缩包、构建目录或无关工程文件。只查看 CI，不合并、不关闭 PR。
