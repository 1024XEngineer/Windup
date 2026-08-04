# 资产库 UI 层级验证 · 实现说明

面向实现者的一次性说明。目标是把资产库的信息层级做成能在浏览器里点开的界面，用来验证层级本身是否成立。

**分层、模块边界、依赖方向、接口调用方式一律按真实架构写，只有数据是 mock。** 这轮做出来的东西要能在接口实现落地后直接换掉数据源继续用，不是丢弃式原型。

读之前先读 `frontend-architecture-v3.md`，分层与依赖规则以它为准。

---

## 一、这轮验证什么

一句话：**用户打开一个项目，看到的这棵树对不对。**

具体要能回答四个问题：

1. 项目下的角色以什么粒度成卡，一屏能不能看明白这个项目有什么。
2. 造型该不该单独占一层。本期每个角色只有一套造型，那这一层是多余的，还是不摆出来用户就理解不了「同一个人换装还是同一个人」。
3. 动作列表以动作实例为行，帧作为行内的一排缩略图——这个粒度够不够看，还是帧需要自己的地方。
4. 三个入口（加角色、加动作、项目级导出）分别摆在哪一层才自然。

这四个问题都靠看和点得出结论，不需要真实接口返回真实数据。

## 二、这轮不做什么

- 不接后端，不写 `entities/*/api.ts`（原因见第七节第 3 条）。
- 不做生成、不做导出、不写后端。动作模板保存只进入本地验证状态。
- 不做响应式细调、不做动效打磨。桌面宽度下层级清楚即可。
- 不做权限、登录、分页交互（分页形状仍按接口声明保留，见第六节）。

---

## 三、事实基线

不要凭印象假设，以下都是仓库当前状态。

**路由**（`frontend/src/app/app.tsx`，全部在 `AppShellRoute` 内）：

```
/projects                        ProjectsPage        占位
/projects/:projectId             ProjectDetailPage   占位
/projects/:projectId/assets      AssetLibraryPage    占位
/playtest/:characterId/:outfitId PlaytestPage
```

本轮要改成嵌套结构，见 5.1。

**领域类型**（`frontend/src/entities/`，只有类型与接口，无实现）：

- `Project` — `id / ownerId / name / perspective / directionalMovement / spriteSize / gameStyle / sampleImageUrl / createdAt / updatedAt`。`CHARACTER_PERSPECTIVE`、`DIRECTIONAL_MOVEMENT`、`SPRITE_SIZES` 是现成的页面文案常量，直接用，不要另写一份中文映射。
- `Character` — `id / projectId / outfits[] / createdAt / updatedAt`，**本轮新增 `name`，见第七节第 1 条**。
- `Outfit` — `id / characterId / name / candidateCharacterTemplates[] / characterTemplateUrl / baseFrames / actions[]`。ID 只在所属 Character 内唯一。
- `Action` — `id / outfitId / name / kind / type / fps / keyFrameIndex / frames[]`。ID 只在所属 Outfit 内唯一。
- `Frame` — `imageUrl / durationMs / rootMotion`。

接口：`ProjectApis`（`list / get / create / update / remove`，`list` 返回 `Paged<Project>`）、`CharacterApis`（`get / listByProject / create / update`）。

一律从 `@/entities` 导入，不要深入子路径。分页形状在 `@/shared/pagination`。

**后端现状**（`backend/packages/app/src/windup_app/server/character/model.py`）：整棵资产树存在 `character_data` 这一个 JSONB 字段里，`outfits[] → actions[] → frames[]`，造型和动作都没有独立表。前后端差异清单见 `frontend/API_CONTRACT.md`。

**分层**：`pages -> features -> entities -> shared`。这轮的东西基本都落在 `pages/` 下；只有确实要被第二个页面复用的展示组件才下沉到 `shared/ui`，下沉前先问一句是不是真有第二个用处。

---

## 四、信息层级

这轮要摆出来的就是这棵树，不多也不少：

```
项目 Project                    ← 常驻外框，任何一层都看得见自己在哪个项目里
└── 角色 Character              ← 资产库主页的卡片粒度
    └── 造型 Outfit             ← 角色详情页的一层，本期只有一套
        ├── 母版 characterTemplateUrl
        └── 动作 Action         ← 动作列表的一行
            └── 帧 Frame        ← 行内的一排缩略图
```

**资产库是项目的下属，不独立存在。** 这是本轮的硬约束，落在路由与布局上，见 5.1。

**08-04 当前定义：保留造型层，但不向用户暴露穿戴。** 本期造型直接代表人物的视觉资产，不建立 Wearable 分类、卡片、提取或复用入口。

**动作模板是当前唯一可复用资产。** 角色动作可以保存为 ActionTemplate；模板未来由 WorkflowEditor 的「增加节点」读取并成为可选节点卡片。当前 WorkflowEditor 尚未实现这段能力，只保留 `ActionTemplateApis.listAvailable(projectId)` 接口边界，角色详情不直接应用模板。

---

## 五、页面

### 5.1 项目详情：资产库的外框 `/projects/:projectId`

**资产库不能脱离项目打开。** 把 `ProjectDetailPage` 改成项目的常驻外框（布局路由），资产库与角色详情都作为它的子路由渲染在 `<Outlet />` 里：

```
/projects/:projectId                        ProjectDetailPage   项目外框
  index                                     → 重定向到 assets
  /projects/:projectId/assets               AssetLibraryPage    资产库主页
  /projects/:projectId/assets/:characterId  CharacterDetailPage 角色详情
```

外框固定渲染：项目名，以及视角、朝向数、精灵尺寸、画风这四项约束。这四项决定了下面所有角色长什么样，用户在任何一层都必须看得见。只读，本轮不做编辑入口。文案走 `CHARACTER_PERSPECTIVE` / `DIRECTIONAL_MOVEMENT`。

外框内再给一条面包屑或返回路径，让用户从角色详情能回到资产库。

**直接在地址栏敲子路由也必须带着项目外框出现**——这是这条约束成立与否的判据，验收要按这个走。

### 5.2 资产库主页 `/projects/:projectId/assets`

替换 `frontend/src/pages/asset-library/index.tsx` 现有的占位内容。它只渲染资产库主体，项目那一层由外框负责，不要在这里重复画一遍项目名。

**角色卡片网格。** 每张卡：

- 封面 —— 第一套造型的 `characterTemplateUrl`；为 `null` 时给明确的未定稿占位，不要用灰块糊过去。
- 标题 —— `Character.name`。
- 副信息 —— 造型数、动作总数。
- 整卡是链接，指向角色详情。

**空态。** 新项目进来就是空的，这是这个页面的主要形态之一，要认真做：一句说明加一个「新建角色」。

**两个动作按钮**（都是占位，点击不产生任何副作用，但必须在页面上）：

- 新建角色 —— 项目下已有角色后再加角色，从资产库加。
- 导出全部角色资产 —— 项目级一键导出，摆在项目这一层而不是角色卡上。

### 5.3 角色详情 `/projects/:projectId/assets/:characterId`

新增页面 `frontend/src/pages/character-detail/`。

**造型层。** 即使本期每个角色只有一套造型，也把这一层摆出来——`Outfit` 的类型注释明确要求 MVP 页面保留这层。做成可切换的造型条，当前只有一项时也照样显示。选中造型后右侧显示它的母版图。

**动作列表。** 一行一个动作实例，行内包含：

- 动作名与业务类型（`type`，中文文案在页面里定，别改 `entities`）。
- `fps` 与帧数。
- 一排帧缩略图，按 `frames` 数组顺序，下标即帧序号。
- 行尾一个「重新生成」占位按钮。

**列表末尾一个加号：「加动作」。** 它只说明新动作由生成工作流产出；动作模板的复用入口属于未来 WorkflowEditor 的「增加节点」，不在角色详情重复实现。

动作展开后提供「保存为动作模板」。保存后模板进入项目的动作模板分类；当前只做本地验证状态，不写后端。

**帧不单独开页面。** 缩略图铺在行内，够看即可。要看动画播放就跳已有的 `/playtest/:characterId/:outfitId`，在动作行上给一个「预览」链接过去，不要在资产库里再造一个播放器。

---

## 六、数据：真接口，假实现

**架构按真实的写，只有数据源是 mock。** 具体要求：

页面不得直接 import 一个写死的数组。页面调用的是 `ProjectApis` / `CharacterApis` 这两个接口，拿到的是 Promise，因此页面必须处理加载中与空结果两种状态——这些状态在接口实现落地后同样存在，现在跳过去，到时候要重写。

Mock 实现放在 `frontend/src/pages/asset-library/mock/` 下，**必须标注为接口类型**：

```ts
export const mockCharacterApis: CharacterApis = { ... }
export const mockProjectApis: ProjectApis = { ... }
```

靠 `tsc` 保证它和真实现是同一个形状。`ProjectApis.list` 照常返回 `Paged<Project>`（`items / total / page / pageSize`），即使这轮页面不做分页交互。写操作（`create` / `update` / `remove`）返回 rejected Promise 或抛出未实现错误即可，本轮不会被调用。

**不要在 `entities/` 下建 `api.ts`。** 原因见第七节第 3 条。

假数据本身放 `mock/fixtures.ts`，标注为 `Project[]` / `Character[]` 等真实类型，**不允许出现类型上没有的字段**。

要覆盖到的形态，缺一个这轮就验不全：

1. 空项目 —— 一个角色都没有。
2. 只有母版、没有任何动作的角色 —— 刚建完的状态。
3. `characterTemplateUrl` 为 `null` 的造型 —— 母版还没选定。
4. 有多个动作、每个动作帧数不同的角色 —— 至少一个动作帧数上到 8 帧以上，用来看缩略图排布会不会塌。
5. 某个动作的 `keyFrameIndex` 非 null、某些帧 `durationMs` 为 null —— 这两种取值页面要能安全渲染，不能崩。

图片用可离线打开的占位（纯色 data URI 或 `public/` 下的本地文件均可），不要引外链。

---

## 七、三条真实问题

**1. `Character` 增加 `name` 字段。** 已定，按有 name 实现。

在 `frontend/src/entities/character/index.ts` 的 `Character` 上加：

```ts
/**
 * 角色的显示名，跨造型稳定。
 * 07-30 评审曾按后端当时无此字段删除过一次，08-04 因资产库卡片无标题可用重新加回；
 * 后端 windup_character 表目前只有 description，映射方式待对齐，见 API_CONTRACT.md。
 */
name: string
```

同时把 `CreateCharacterInput` 加上 `name`，并把 `frontend/API_CONTRACT.md`「已分工」里那条 `[x] 前端删除 Character.name` 改写成当前结论、在「待确认」里补一条后端落点——那份文档是三方对齐的记录，留着旧结论会误导后端。

注意 `entities/character/index.ts` 在未合并的 PR #96、#90 里也被改过，这一处大概率会冲突，提 PR 时说明一句。

**2.「加动作」无法定位。** 按 08-03 会议纪要第八节，加号应当带着该角色已有的 workflow run 打开画布并自动定位到身份模板节点。但 workflow run 与 character 的关联还在服务端待办里，现在拿不到。这轮加号只做占位按钮，不要接任何跳转，也不要造一个假的 run id。

**3. `entities/character/api.ts` 归属未定。** main 上 `entities/character` 与 `entities/project` 只有 `index.ts`（类型与接口），实现在未合并的 PR #96 里。这轮的 mock 实现 `CharacterApis` 接口、放在 pages 层，不碰 `entities/`——避免和 #96 写出第二份实现。等 #96 合并后，换掉页面里注入的实现即可，其余代码不动。

---

## 八、验收

**跑起来看。** 这是 UI 验证，不是写完就算。`npm run dev` 起本地服务，在浏览器里逐页走一遍，至少截四张图：资产库空态、资产库有角色、角色详情（有动作）、角色详情（无动作）。截图附进 PR。

**项目外框始终在。** 直接在地址栏访问 `/projects/:projectId/assets/:characterId`，项目名与四项约束必须照常出现；从角色详情能返回资产库。

**层级读得懂。** 找一个没参与讨论的人看截图，能说出「项目下有角色、角色下有造型、造型下有动作、动作由帧组成」，这轮就成立。

**工程检查全过**（CI 会跑同样这几项）：

```
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

**测试。** 两个页面各加一个渲染测试，断言层级关键元素在场（角色卡数量、造型条存在、动作行数、空态文案）；外框再加一个，断言子路由渲染时项目约束仍在。参照 `frontend/src/pages/home/index.test.tsx` 的写法。

---

## 九、交付

- 从 `main` 切分支，与 PR #104（首页与顶栏）无关，不要基于它。
- 按营方规范先立 issue 再提 PR，issue 标题带 `feat:` 前缀，PR 里写清 Why、改动说明、实现取舍、截图、测试。
- 提交按 Angular 风格拆原子提交，commit message 用英文，不带任何 AI 署名或尾巴。
- PR 里必须单独有一节交代第七节三条的处理结果，以及 `Character.name` 加上之后卡片标题是否真的够用——这轮的产出是结论，不只是页面。
