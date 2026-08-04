# Media Upload 前端适配模块

Refs #109

## 做了什么

- 为 Quick Start / Generation 提供真实的参考图片上传适配器。
- 按后端 `POST /media/upload` 契约提交 `file` 表单文件，并通过查询参数传递 `category`。
- 区分 HTTP 状态码和后端业务码，保留后端错误信息，不把失败降级为假成功。
- 对成功响应执行运行时校验，确认完整媒体元数据后才返回 `MediaReference`。
- 支持 `AbortSignal`，调用方可取消仍在途的上传。
- 通过 `@/entities` 公共入口暴露适配器；后端地址缺失时明确失败，不误发到访问者本机。

## 改动边界

- `frontend/src/entities/media/**`
- `frontend/src/shared/api/upload.ts`
- `_PR说明.md`

没有修改页面、WorkflowRun、Controller、App 或后端，也没有复制后端实现。

## 验收

在 `frontend` 目录依次运行：

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test -- src/entities/media/api.test.ts
npm.cmd test
npm.cmd run build
```
