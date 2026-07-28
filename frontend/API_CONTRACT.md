# 前端 API 契约状态

本文是前端当前调用和需求签名的清单，不替代未来由后端 OpenAPI 生成的客户端。
在 OpenAPI 落地前，只有标为“已核对”的接口可以按真实后端接口联调；其余接口
不能被描述为已接通后端。它们在开发或测试中可以由 Mock transport 承载，但生产请求
仍需等待明确的后端契约。

## 通用约定

- 开发环境以 `/api` 为基址；Vite 将其代理到 `http://127.0.0.1:8000`。
- 单项响应：`{ code, message, data, timestamp? }`；只有 `code === 200` 才是成功。
- 列表响应额外包含 `total`、`page` 和 `page_size`。
- 生产构建只使用真实 transport；不会回退到 Mock 数据。

## 已核对：项目与上传

以下接口的路径、方法、字段和响应壳已与后端 PR #57 对照。该 PR 尚未合并或部署，
因此它们是“可联调契约”，不是当前已验证可访问的服务。

### 项目

- `GET /projects?page=1&page_size=20&user_id=1`
- `GET /projects/{id}`
- `POST /projects`
- `DELETE /projects/{id}`

创建项目示例：

```json
{
  "user_id": 1,
  "workflow_id": null,
  "project_name": "Knight",
  "character_perspective": 1,
  "directional_movement": 1,
  "sprite_width": 64,
  "sprite_height": 64,
  "game_style": null,
  "sprite_sample_url": null
}
```

`user_id` 目前是演示值；接入认证后应由后端从令牌推导，前端不再传递它。

### 参考图片上传

- `POST /upload/image`
- `multipart/form-data`，字段名为 `file`
- 允许 `image/jpeg`、`image/png`、`image/webp`、`image/gif`
- 最大 10 MiB；前端会在发起网络请求前拒绝超限文件。

```ts
const url = await uploadImage(file)
// 成功响应：{ code: 200, message: 'success', data: { url } }
```

## 未对齐：WorkflowRun

前端目前有以下调用与 DTO：

- `POST /workflows`
- `GET /workflows/{id}`
- `POST /workflows/{id}/commands`

它们服务于 Quick Start 和 Workflow Editor 的页面状态，并在 Mock transport 中有完整状态机。
生产 transport 会向这些路径发出真实请求，但当前仓库没有与之对应的后端路由、OpenAPI
或 SSE 事件契约；后端目标架构也倾向让 MS2 前端直接调用项目、媒体、角色、生成、审核与
导出等独立能力接口。因此这些路径在后端提供明确契约前不得视为可联调接口。

命令请求的形式为：

```json
{
  "kind": "restart-from-node",
  "source_revision_id": "revision-1",
  "node_id": "node-generation"
}
```

后端如选择支持该接口，必须先确认 `WorkflowRunDto`、节点状态枚举、命令幂等性、错误码
和进度事件；否则前端应改接独立业务 API。

## 仅有需求签名：角色与资产

以下函数当前会明确抛出 `not implemented`，不存在真实网络调用：

- `GET /characters/{id}`、`POST /characters`
- `GET /projects/{id}/characters`
- `POST /characters/{id}/template/confirm`
- `POST /characters/{id}/actions`、`POST /actions/{id}/confirm`
- `GET /projects/{id}/action-templates`
- `GET /projects/{id}/wearables`

SSE 也只有前端 transport 预留，尚无订阅地址、事件名称或字段契约。
