# Media Upload

这个目录提供 Quick Start 和 Generation 上传参考图片时共用的最小适配能力，不包含上传按钮或页面状态。

## 用户点击上传后发生什么

页面把用户选中的 `File` 交给 `createMediaApis().upload(...)`。适配器先确认浏览器报告的 MIME 类型是 `image/*`，再把原文件装进 `FormData`，把用途分类放进 `category` 查询参数，通过 `POST /media/upload?category=...` 发送给后端。这一位置来自当前 `main` 的 FastAPI 路由声明：`file` 是表单文件，`category` 是查询参数。

上传复用 `shared/api` 的统一客户端，因此会携带当前 access token，并在后端返回业务码 `401` 时使用登录会话刷新令牌后重放一次请求。后端会再次校验图片类型，并把文件写入已配置的对象存储。只有后端返回业务码 `200`，且 `url`、对象 key、文件名、图片 MIME 类型和文件大小都符合契约时，前端才把 `url` 作为 `MediaReference` 交给 Quick Start 或 Generation。业务失败、HTTP 失败、非法 JSON 和缺字段响应都会抛出错误，不会伪造成功。

调用方可以传入 `AbortSignal`。用户取消、离开页面或用新文件替换旧文件时，可终止仍在途的上传；浏览器的 `AbortError` 会原样返回，便于页面单独处理“取消”状态。

## 文件范围

- 接受范围与当前后端一致：MIME 类型为 `image/*` 的文件。
- 当前契约没有声明扩展名白名单或大小上限，前端不擅自增加限制。
- 默认分类是 `general`；参考图应传 `reference-image`。另有 `outfit-preview` 和 `action-frame`，与后端枚举一致。
- 本模块不负责裁剪、压缩、预览、重试、进度显示或持久化，也不直接调用生成接口。

## 依赖

- 浏览器原生 `File`、`FormData` 和 `AbortSignal`，网络传输统一走 `shared/api`。
- 必须配置 `VITE_API_BASE_URL`。缺失时上传会明确报错，不会退回访问者本机的 `127.0.0.1`。
- 后端 `POST /media/upload` 以及后端配置的对象存储。没有可用后端或对象存储时，上传应真实失败。

## 验收命令

在 `frontend` 目录执行：

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test -- src/entities/media/api.test.ts
npm.cmd test
npm.cmd run build
```
