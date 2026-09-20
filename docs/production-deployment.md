# 生产部署

更新 `VERSION` 的 PR 合并后,Version 工作流等待 Backend CI 和 Frontend CI 通过,创建 Tag 与 Release,再自动部署该版本。发布时机仍由版本 PR 决定,不按每个普通 PR 自动上线。本流程落实 #952,取代原手动部署步骤;按本次确认的自动部署要求,不额外设置部署审批。

## 配置

GitHub `Production` Environment 保存以下 Secrets:

- `WINDUP_DEPLOY_HOST`:现有生产 SSH 主机。
- `WINDUP_DEPLOY_USER`:生产登录用户。
- `WINDUP_DEPLOY_PASSWORD`:该用户现有 SSH 密码。
- `WINDUP_DEPLOY_KNOWN_HOSTS`:通过可信连接核验的 OpenSSH known_hosts 记录,不可在工作流里临时扫描并无条件信任。

沿用服务器现有密码认证,不修改登录策略。仅上游 main 的 CI 或 main 上的手动重试可进入发版流程。部署固定使用 `/root/workspace/Windup`、Compose 项目 `windup` 和前端目录 `/var/www/react-windup`;服务器需有 Python 3、Git、curl 与支持 `up --wait` 的 Docker Compose。

## 行为与验证

部署 job 直接 `needs: release`,因为 `GITHUB_TOKEN` 创建的 Release 不会触发另一个 release 工作流。Tag 必须对应本次 CI 的确切提交,且是正式、非草稿 Release。没有新版本的提交不部署。

Actions concurrency 与服务器文件锁串行部署。服务器核对 tag、SHA 与 main 祖先关系,拒绝覆盖已跟踪的本地修改,然后切换到 Release 提交的 detached HEAD。`.env` 与未跟踪的 Compose override 保留,不清理文件、镜像或数据卷。

镜像构建成功后,前端先在容器临时目录完成编译,再复制到 nginx 目录;保留旧哈希资源,避免已打开的页面丢失资源。之后重建 backend/worker 并等待健康检查。该流程不是零停机或原子切换,前后端切换间可能存在短暂版本差异;worker 目前没有业务级健康探针,Compose 只能确认进程运行。

本机健康检查成功后写入 `.git/windup-deployed.json` 和公开的 `/release.json` (`tag`、`sha`)。工作流还核对公开健康接口及版本标记,结果在 Actions 与 Production deployment 记录中可查。标记仅表示最后一次通过本机检查的发布,不是服务此后持续健康的保证。

## 失败与重试

任何构建、启动或探测错误都会让 job 失败。构建失败不会重启后端;启动或探测失败可能已有部分服务更新,不会声称自动恢复旧版,也不会尝试回退数据库。

优先在原 Version run 中选择 **Re-run failed jobs**,保留原版本与 SHA。重复执行已成功的版本只检查健康;旧版本不能覆盖记录中的更新版本。也可以重跑原发布 run 的全部 jobs。不要在 main 已前进后用无参数 workflow_dispatch 期待重试旧版,它只检查所选 main 提交。

需要回退应用时,通过 PR revert 有问题的改动,提升 patch 版本再发布。修复服务器本地变更冲突后重试,不要使用 `git clean` 或删除数据卷。此 PR 不改 `VERSION`,不会仅因为自动部署逻辑合入而发布一个新版本。
