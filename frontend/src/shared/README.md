# shared

与 Windup 业务无关、可被任意上层模块复用的基础代码。它是依赖方向的最底层，**不能反向依赖 `entities`、`features`、`pages` 或 `app`**。

## 判断标准

**如果一段代码需要理解 Windup 的业务词汇，它就不属于 shared。**

## 现有内容

- `pagination/` —— 与传输协议无关的分页请求与结果形状。
- `api/` —— 后端公共 HTTP 客户端：统一响应解包、业务码、分页、Bearer 请求头和传输错误。

`api/` 默认从 `VITE_API_BASE_URL` 读取服务地址，并在发出请求时调用可选的 `getAccessToken`。业务 API 统一使用 `getApiAccessToken`，后续登录模块通过 `registerApiAccessTokenProvider` 注册实际读取函数。公共层只保存这个函数，不决定 token 如何登录取得、保存或刷新。

## 后续允许放入

- `ui/` —— 按钮、弹窗、加载状态等不含业务含义的展示组件
- `hooks/` —— 通用浏览器或 React 行为，例如媒体查询、键盘快捷键
- `utils/` —— 纯函数工具，例如日期格式化、文件大小显示
- `config/` —— `api/` 之外的前端通用常量与运行时配置读取

**这些目录只在出现真实代码时创建，不为占位提前建空文件。**

## 不允许放入

- Project、Character、Generation、WorkflowRun 等业务数据
- `ProjectApis`、`CharacterApis` 这类业务接口集合
- 流程的推进、重启、中断和 Revision 规则
- 为开发与生产各维护一套实现的切换机制
- 只被单个页面或模块使用、却以「复用」名义提前抽出的代码
