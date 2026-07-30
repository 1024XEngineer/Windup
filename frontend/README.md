# Windup Frontend

当前前端只提交粗架构、公开接口和必要业务类型，不包含具体业务实现、测试、页面壳或依赖安装入口。

## 目录

```text
src/
  workflow-controller/ 两套制作界面共享的整体流程接口
  entities/            Project、Character、WorkflowRun、Generation、Task 等业务数据
  shared/              无业务含义的公共基础层边界说明
```

Quick Start 与 Workflow Editor 使用同一种 WorkflowRun，但页面独立：Quick Start 隐藏步骤并由自动流程决策，Workflow Editor 逐步展示操作。当前没有服务端调用实现；后续按业务模块拆分小 PR 接入。

## 文件说明

- `API_CONTRACT.md`：业务 APIs 和 WorkflowController 的公开签名说明。
- `MODULES.md`：app、pages、features、workflow-controller、entities、shared 的职责边界。
- `src/shared/README.md`：公共基础层允许和禁止承载的内容。
- `../frontend-architecture-v3.md`：本次粗架构 PR 的总体设计与未冻结范围。
