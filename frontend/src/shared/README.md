# Shared 公共基础层

## 文件职责

`shared` 保存与 Windup 具体业务无关、可以被任意上层模块复用的前端基础代码。它是
依赖方向的最底层，不能反向依赖 `entities`、`workflow-controller`、`features`、
`pages` 或 `app`。

## 后续允许放入的内容

- `ui/`：按钮、弹窗、加载状态等不包含业务含义的展示组件。
- `hooks/`：通用浏览器或 React 行为，例如媒体查询、键盘快捷键。
- `utils/`：纯函数工具，例如日期格式化、文件大小显示、类型守卫。
- `config/`：前端通用常量与经过校验的运行时配置读取。

这些目录只在出现真实代码时创建，本次骨架 PR 不为了占位增加空文件。

## 不允许放入的内容

- Project、Character、Generation、Task、WorkflowRun 等业务数据。
- `ProjectAPIs`、`CharacterAPIs` 等业务接口集合或其实现。
- Workflow 的步骤推进、重启、中断和 Revision 规则。
- 为开发与生产环境各维护一套实现的切换机制。
- 只被单个 Page 或 Feature 使用、却为了“复用”名义提前抽出的代码。

判断标准是：如果代码需要理解 Windup 的业务词汇，它就不属于 `shared`。
