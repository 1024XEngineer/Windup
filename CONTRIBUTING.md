# 为 Windup 贡献代码

给人和 AI agent 共用的操作手册。**不是法条**，每条都带一句"为什么"——记不住理由的规则执行不下去。

规则按**谁来管**分三层：

| 层 | 谁兜底 | 你要做什么 |
|---|---|---|
| 一 | CI 自动拦 | 不用手查，红了照提示改 |
| 二 | 只能靠自觉 | **本文主体**，每条有判据和动作 |
| 三 | 需要人判断 | 列成问题，自己想清楚再答 |

---

## 一、CI 已经拦住的：别再手动检查

`.github/workflows/naming.yml` 两个 job 机械把关，本地不用再自己 grep：

**`Branch name`** —— 分支名须 `<type>/<描述>`，type ∈ `feat fix docs doc chore refactor test style perf ci build revert explore wip`。
豁免：`main` / `master` / `develop`、`release/*`、`hotfix/*`、`fennoai/*`、以及**不含斜杠的扁平名**（如 `upstream-sync`）。
红了怎么改：`git branch -m feat/新名字`，push 新分支后把 PR 的 head 换过去（或关掉重开）。

**`Commit messages`** —— Conventional Commits `type(scope)!: 描述`，type ∈ `feat fix docs chore refactor test style perf ci build revert`。
检查范围按 `merge-base` 算，只覆盖你这条分支的提交；merge 提交豁免；结尾带 `(#NN)` 的上游 squash 提交豁免（贡献者改不动上游历史）。
红了怎么改：`git rebase -i <base>` 逐条 `reword`，或提交少时 `git commit --amend`。注意**标题前不能有空格**。

**`Docs Gate`**（`.github/workflows/docs-gate.yml`）—— 拦住工程文档进仓，是下面 2.1 的机器兜底。
只管两个位置：`docs/**` 下的新增与修改、仓库根目录的**新增** md。子目录里的 README / MODULES.md 一律不管，删除永远放行。
红了怎么改：见 2.1 的"动作"，或给 PR 打 `user-doc` label 放行（仅限确实是用户文档时）。
**它刻意保守，宁可漏拦也不误伤**——所以它放行不等于你合规，2.1 还是要自己过一遍。

另有 `backend.yml`（`uv sync --frozen` → `ruff check .` → `lint-imports` → `pytest -q`）和 `frontend-ci.yml`（`npm ci` → `format:check` → `lint` → `typecheck` → `test` → `build`）。**这些命令建议本地先跑一遍**——不是因为 CI 查不出，而是等 CI 告诉你要多花十几分钟一轮。

> 为什么这层写在这里：让你知道**哪些事不用自己操心**。清单最大的失效方式是又长又有一半是废话，读的人整份跳过。

---

## 二、CI 拦不住、只能靠自觉的（本文主体）

### 2.1 工程文档不入仓 ⭐ 最容易违反的一条

**规则**：设计 / 架构决策类文档写进 **Issue 正文**，靠 Issue 描述区的编辑历史做版本管理，定稿后只读。**不 commit 成仓库里的 md**。

**为什么**：Issue 正文是活文档，能被评论逐条挑战、能被 `Refs #NN` 挂靠、改了有编辑历史。同一份内容 commit 进仓之后就分叉了——代码演进而 md 不动，半年后没人知道哪份算数，评审时还要额外维护一条 diff。团队明确选了"Issue 是唯一真理来源"。

**判据（怎么算违反）** —— 你这个 PR 新增或修改的 md，满足任一即属工程文档：

- 讲**为什么这么设计**、有备选方案 / 取舍 / 决策理由的
- 模块拆分方案、分层契约、目录结构规划（如 `module-split*.md`、`architecture*.md`、`*-guardrails.md`）
- 接口 / 数据契约的**设计说明**（契约本身应落在代码类型或 OpenAPI，说明落 Issue）
- 时序 / 流程说明（如 `*-flow.md`）
- **AI 生成的中间产物**：plan、spec、research、todo、任何 `docs/<工具名>/plans/`、`docs/<工具名>/specs/` 目录下的东西 —— 这类最危险，因为它们是自动生成的，不留神就整批进了 diff
- 日期命名的一次性文档（`2026-08-05-xxx.md`）—— 天然是过程产物，不是仓库资产

**可以入仓的**：

- `README.md`（根 + 各包）——面向使用者的入口说明
- **用户文档**（怎么用这个工具）；PR 打 `user-doc` label 让 Docs Gate 放行，功能对应的 Issue 补 `Documented` 标签
- `LICENSE`、本文件 `CONTRIBUTING.md`
- `.github/**`（CI、模板）、`.claude/**`（agent 工具配置）——**这是工具配置不是工程文档**，它必须和代码同仓、随代码演进才有意义
- 代码内注释和 docstring——想解释实现细节，写在代码旁边，不要另起 md

> 两个 label 别混：`user-doc` 是**打在 PR 上**的门禁豁免开关；`Documented` 是**打在 Issue 上**的生命周期状态（用户文档已提供）。语义不同，不要互相代用。

**边界情况怎么判**（灰区，判不了就问，别自己拍）：

- *"这份 README 里写了架构决策"* → 拆开：README 留"怎么跑起来 / 目录长啥样"，决策理由搬进 Issue 并在 README 留一行 `设计见 #NN`
- *"未对齐点要显式落 README / MODULES.md"* → 这条是团队实证结论，和本条**确有张力**。当前口径：**记录"结论是什么"可以入仓（一两行 + Issue 链接），记录"怎么争论出来的"进 Issue**。Docs Gate 也据此故意不拦子目录 md。拿不准就在 PR 描述里问一句。
- *"我需要给 AI 一份上下文文档"* → 放 `.claude/`（工具配置），或者让它读 Issue
- *"这是实验记录 / 调研笔记"* → 放个人 research hub 仓库，由 Issue 链接引用；**探索不受此束**，但别进主仓

**动作（发现了怎么办）**：

1. 提 PR 前：`git diff --name-only <base>...HEAD | grep -E '\.md$'`，逐个按上面判据过一遍
2. 命中的：内容贴进对应 Issue 正文（新建也行），然后 `git rm` 掉，PR 描述里写"内容已迁到 #NN"
3. 已经合进去的存量：单独开一个 PR 删，理由写清楚，别夹在功能 PR 里
4. 确实是用户文档：正常入仓，PR 打 `user-doc`，并给对应 Issue 打 `Documented`

**真实反面例（就发生在本仓，2026-08-06）**：

- PR **#128** 干了对的事：删掉 `docs/module-split.md`，说明"内容已迁到 Issue"，当天合并。
- PR **#126**（大范围源码快照整合，271 文件）把 `docs/module-split.md` **又改了回来**，并新增 `docs/module-split-plan.md`、`docs/sse-generation-flow.md`、`docs/superpowers/plans/2026-08-05-*.md`（2 份）、`docs/superpowers/specs/2026-08-05-*.md`（2 份）、根目录 `api-reference.md`。

**教训不是"谁不小心"，是"大 PR 天然会把工程文档一起卷进来"**：改动一大，md 就藏在两百多个文件里没人看见。所以真正的动作是——**PR 小而频繁**，以及提交前**单独看一眼 md 的 diff**。

存量说明：根目录 `frontend-architecture-v3.md` 是同类存量问题，处理它要单独开 PR，别顺手夹带。

### 2.2 代码走 fork + PR，不在主仓建分支

**规则**：Fork 到自己名下 → 建分支 → 向 upstream 提 PR，PR 关联对应 Issue。**不在主仓直接建分支。**

**判据**：`git remote -v` 里 push 目标是 `1024XEngineer/Windup` 就是错的；PR 页面 head 显示 `1024XEngineer:xxx` 而不是 `<你的账号>:xxx` 就是错的。

**动作**：已经推到主仓了 → 在自己 fork 重开分支重提 PR，删掉主仓那条分支。

**现状（记录既成事实，不是纠偏）**：截至 2026-08-06，仓库全部 open PR 的 head 都在各自 fork，**无人往主仓推分支**。这条写在这里是给新加入的人和 agent 看的基线，不是在说谁。

**为什么**：主仓分支列表是公共空间，个人探索堆进去谁都看不清主线；主仓有分支保护，直推会被挡；fork 隔离后你可以随便 force-push 自己的分支。历史上有直接开到 `upstream:main` 的 PR 被关掉。

### 2.3 分支落后 base → 会夹带、会重复报同一个 bug

**判据**：`git fetch origin && git log --oneline HEAD..origin/main | head` 有输出 = 落后。

**动作**：`git rebase origin/main`（或 merge，但本仓习惯 rebase），冲突解完重跑本地门禁。

**为什么**：落后的分支 diff 里会混进"别人已经改过但你这边还是旧版"的行，reviewer 分不清哪些是你的改动。更实际的坑：同一个 bug 因为没 rebase，在几个并行 PR 里被各报了一遍，修了一次又在另一条分支复活。

还有一个具体后果：Docs Gate 按 merge-base 算差异，**陈旧的 base 会把"早就在 main 上的文件"算成新增**，于是门禁报一个你根本没干过的违规。rebase 后自动消失。

**stack 分支要显式声明**：PR 描述写"本分支 stack 在未合并的 #NN 之上，合并后 rebase"。别让 reviewer 自己猜 diff 里哪部分是上游的。

### 2.4 改动范围与 Issue 一致，不夹带

**判据**：`git diff --stat <base>...HEAD` 列出的包 / 模块，能不能一一对应到 Issue 里写的目标？出现"顺手改的"就是夹带。典型夹带：格式化整个文件、顺手升依赖、顺手删注释、顺手把 IDE 自动加的 import 提交了。

**动作**：拆 PR。真的很小又必要（比如挡住 CI 的一行）就在 PR 描述里显式说明"额外包含 X，因为 Y"。

**为什么**：PR 合并标准里写死了"改动可追溯到需求"。夹带的直接代价是 review 变慢；间接代价是 revert 的时候连累无关改动。

**门禁 / 基础设施类修复要从功能 PR 里拆出来立刻单独修**——这类问题堵住的是所有人，混在功能 PR 里等于陪着一起排队。

### 2.5 对外产出去 PII

**规则**：提交进仓库、发到 Issue / PR / 群里的内容，**不写姓名、雇主、地理位置、职业身份**。署名用**模块-角色**（如"后端 / 生成管线"）。

**判据**：搜自己的 diff 和 PR 描述有没有真实姓名、公司名、城市、"我在 X 实习"这类。截图和日志里的路径也算（`/Users/<真名>/...`）。

**动作**：改成第二人称或 impersonal 表述；路径换成 `<repo>/...`。

**发群 / 公共文档的额外要求**：用**纯文本**——去 markdown 符号、表格拍平成"字段：值"逐行。原因很实际：群和企业文档不渲染 markdown，贴进去是一堆 `#` 和 `|`。

### 2.6 两种 PR 别混：review-only vs 会合并

- **review-only PR**：设计草案 / 原型，用来逐行行内评论。**明确不合并**，标题或描述里写清楚。讨论定稿后把内容**回写对应 Issue 正文**，并在 Issue 里附该 PR 链接。
- **实现 PR**：会合并入库的代码。

**为什么**：把设计塞进会合并的 PR，等于把工程文档 commit 进仓（回到 2.1）。review-only 这个模式在本仓已复用多次，是让设计享受"逐行评论"又不污染仓库的办法。

**定稿一定回写 Issue**——评审结论留在 PR 评论里等于丢了，Issue 才是唯一真理来源。

### 2.7 机器审的每条回复要能闭环

自动 review bot 是**第一道机器审**，不是设计者：它擅长抓文档自相矛盾、契约缺口、运行时真 bug、CI 门禁自身的漏洞；它**不判方向、不做取舍**，也常因为环境缺依赖只跑了子集。

**动作**：它报的每一条，用**修复的 commit hash** 回复闭环；不认同的说明理由，别沉默跳过。它说"只跑了子集"时，关键测试自己本地补跑并如实列出。

**汇报纪律（这条对人和 AI 一样）**：说"跑通了"必须说清跑了什么。没跑就写"未跑 + 原因"。**不假报通过。**

---

## 三、需要人判断的：这些不要让 agent 代答

以下没有机械判据，agent 应当**把问题列给人**，不要自己拍板：

**Issue 生命周期 label**
- 这个 Issue 现在该是哪个状态？`proposal` → `Proposal-Accepted` / `Proposal-Denied` / `Proposal-NoPlan`
- 接受了的，规格粒度是 `FullSpec` 还是 `MiniSpec`？（影响面大 vs 小改动）
- 功能做完了但用户文档没写 → 该打 `Need-Document` 了吗？补完打 `Documented` 了吗？
- 提案被拒是正常结果，不是失败——它同样是一次有记录的决策，别删了重开。

**Issue 的建立顺序**
- 这个 Issue 有没有上游？（战略 → 架构 → 实验矩阵 → 具体实验 → 实现）
- 上游还没定就建下游，下游会被推翻返工。先确认上游 Issue 编号，用 `Refs #NN` 挂靠。
- 该挂哪个 Milestone？（建 Milestone 通常需要管理员权限）

**文档归属的灰区**
- 见 2.1 的"边界情况"。判不了就在 PR 描述里问，不要默认入仓——**默认应当是不入仓**。

**范围与拆分**
- 这个 PR 是不是已经大到没人能 review？（"小而频繁"没有硬阈值，但 200+ 文件肯定过了）
- 拆出来的部分，各自对应哪个 Issue？

**对外发布**
- 这份产出是发给谁看的？群 / Issue / 公开仓库，去 PII 的严格程度不同。

---

## 四、配套的 agent 工具

- **本文件 = 规范的唯一真理来源。** 规则变了改这里。
- `.claude/skills/windup-contrib/` —— 让 Claude Code 在该加载规范时自动指到本文件，本身不含规则。
- `windup-preflight`（个人 skill）—— **执行器**：跑命令、报 PASS/FAIL、按改动类型列可预测的追问。它引用本文件的规则，不复述。

说法冲突时，**以本文件为准**；本文件与营规范原文或评审者当场意见冲突时，**以后者为准**，并回写本文件。

---

## 附：真理来源优先级

1. 评审者 / 导师当场意见
2. 营方《GitHub 过程管理规范》等官方规范原文
3. 对应 Issue 正文（定稿后只读）
4. 本文件
5. 个人 skill / 清单 / 模板

冲突时上位覆盖下位，并**回写下位**——别让过期结论继续流通。
