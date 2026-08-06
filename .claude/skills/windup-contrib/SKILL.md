---
name: windup-contrib
description: Windup 仓库的贡献规范（分支/commit/PR/Issue/文档去向）。在准备提 PR、建分支、写 commit、往仓库新增或修改 md 文件、要写设计或架构文档、要决定"这份文档该进仓还是进 Issue"时加载。规范全文在仓库根目录 CONTRIBUTING.md，本文件只是索引。
---

# Windup 贡献规范（索引）

**规范全文见仓库根目录 `CONTRIBUTING.md`。现在就去读它，本文件不含规则。**

规范放在 `CONTRIBUTING.md` 而不是这里，是因为它要给全体贡献者看——不用 Claude Code 的人、GitHub 网页上开 PR 的人也得能读到。本 skill 的唯一作用是让 Claude 在该加载规范的时刻自动指过去。

## 读之前先知道三件事

1. **规则分三层**：CI 自动拦的 / 只能靠自觉的 / 需要人判断的。**第三层不要代答**，把问题列给人。
2. **最容易违反的是 `CONTRIBUTING.md` 的 2.1「工程文档不入仓」**。往仓库加任何 `.md` 之前先读那一节。默认是**不入仓**。
3. **不假报通过**：说"跑通了"必须说清跑了什么，没跑就写"未跑 + 原因"。

## 配套

- 执行器是个人 skill `windup-preflight`——它跑机械检查、列可预测追问，规则引用 `CONTRIBUTING.md` 而不复述。
- 冲突时以 `CONTRIBUTING.md` 为准；它与营规范原文或评审者当场意见冲突时以后者为准，并回写 `CONTRIBUTING.md`。
