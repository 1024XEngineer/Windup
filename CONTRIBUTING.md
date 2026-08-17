# 参与贡献 / Contributing

欢迎参与 Windup 的开发。项目按 `Proposal → Issue → 分支 → PR → Review → 合并` 推进:所有改动从 Issue 出发,代码经 PR 合入 main。第一次参与,按本文档顺序读下来即可跑通全流程。

## 开始之前:Fork 与上游同步

协作采用 Fork + PR:fork 主仓库到个人账号,开发分支只存在于个人 fork,向主仓库提 PR。先把仓库拉到本地并连上上游:

```bash
git clone git@github.com:<你的账号>/Windup.git
cd Windup
git remote add upstream git@github.com:1024XEngineer/Windup.git
```

开新分支、提 PR 之前,先同步上游再 rebase:

```bash
git fetch upstream
git checkout main
git rebase upstream/main
git checkout -b <分支名>
```

## 本地开发与联调

前后端启动方式见 README「本地开发」;后端依赖 Postgres 与 Redis,用根目录的 docker-compose.yml 起依赖容器。

- 前端通过 `VITE_API_BASE_URL` 指向后端;本地联调时指向本地后端,**禁止直连生产 API**。
- 后端 PR 合并后,按上一节的方式同步上游,再继续联调。
- 接口疑问优先查根目录 `openapi.json` 与后端 `/docs`,并在对应 PR / Issue 中讨论。

## 提 Issue

- 每个 Issue 写清背景、目标和验收标准,禁止空泛标题。
- 新 Issue 由自动化 triage 挂 milestone 和 label;请为每个 Issue 指定 owner(assignee)——没有 milestone 的 Issue 不在计划内。
- 关闭 Issue 时注明原因:已被 PR 解决(注明 PR 号)/ 被其他 Issue 取代(注明替代者)/ 组内确认不再需要。
- 每个 Milestone 结束时归置遗留 Issue:已完成的关闭;划入下个 Milestone 的挂过去并指定 owner;其余打 `Proposal-NoPlan`。

## 提 PR

- 每个 PR 关联对应 Issue,改动范围与 Issue 一致,不夹带无关改动。
- main 开启了分支保护:必须走 PR、必须获得 approve、CI 必须通过,没有捷径。
- PR 合并由 @nighca / @minorcell / @huyanxius 负责,提交后找其中一位即可。
- **禁止把未经 review / 未合并的代码部署到生产环境。**

## 接口契约

- 前后端以根目录 `openapi.json` 为唯一契约源,由代码自动生成,禁止手写。
- 后端 PR 变更接口(路由、参数、模型、描述)时,在 backend/ 下运行 `uv run python -m scripts.export_openapi` 重新生成并提交;CI 会校验漂移,不一致即失败。

## 发版

- Tag 统一使用 `vX.Y.Z`;每个 Milestone 结束发一次 Release,描述列清本轮交付。
- 生产部署必须先发版本:打 Tag → 创建 Release(写清变更内容)→ 部署。**任何部署只认 Release。**
- 生产部署暂为手动,由发布人唯一执行;CD 自动化另立 Issue 跟进。

## 规范本身

本文档经 [#334](https://github.com/1024XEngineer/Windup/issues/334) 团队确认后生效。需要修改时,先开 Issue 讨论,达成一致后更新本文档。
