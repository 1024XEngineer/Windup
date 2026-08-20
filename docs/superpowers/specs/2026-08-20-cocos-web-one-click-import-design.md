# Cocos Creator 网页一键导入设计

**日期：** 2026-08-20
**状态：** 已确认
**目标引擎：** Cocos Creator 3.8.8，2D 项目

## 1. 结论

Windup 采用“网页 + Cocos Creator 全局扩展 + localhost HTTP 桥接”。用户只在首次使用时安装扩展、输入一次连接码并允许浏览器访问本机服务；完成配对后，网页上的“一键导入 Cocos”按钮负责打包、上传、导入、刷新和定位 Prefab。

不采用纯浏览器静默写磁盘方案。浏览器目录授权不能覆盖所有浏览器，也不能可靠地驱动 Creator 的 AssetDB 刷新；它只作为扩展不可用时的降级方式。

## 2. 用户流程

### 首次使用

1. 用户下载 `windup-cocos-importer.zip`。
2. 在 Cocos Creator 3.8.8 的扩展管理器中安装为全局扩展并启用。
3. 扩展仅在 `127.0.0.1:17832` 启动 HTTP 服务。
4. 用户在 Creator 菜单选择“Windup / 显示连接码”，获得 6 位、5 分钟有效的一次性连接码。
5. 用户在 Windup 网页输入连接码；扩展记录网页的精确 Origin，并返回随机 256 位令牌。
6. 网页把令牌保存在该 Origin 的本地存储中。扩展把令牌摘要和 Origin 保存在 Creator 全局 Profile 中，不保存明文令牌。

### 后续使用

1. 用户打开目标 Cocos 工程和 Windup 资产页。
2. 点击“一键导入 Cocos”。
3. 网页复用现有质量门禁生成 Windup ZIP，不触发浏览器下载。
4. 网页计算 SHA-256，把 ZIP 发送到本地扩展。
5. 扩展生成 Cocos 原生资源，写入 `assets/windup-imports/<角色>/<造型>/`。
6. 扩展刷新 AssetDB，校验 Prefab、AnimationClip 和 SpriteFrame 引用，并在资源面板中选中 Prefab。
7. 网页显示工程名、资源路径、动作数、方向数和导入耗时。

## 3. 系统边界

```text
Windup exportGameAssets()
  -> 通用 ZIP + targets/cocos-creator/cocos-import.json
  -> cocos-bridge-client.ts
  -> POST http://127.0.0.1:17832/v1/imports
  -> Creator 扩展主进程
  -> 复用 tools/cocos-importer 的解析、规划、序列化核心
  -> 事务式写入 assets/windup-imports/
  -> Editor.Message asset-db 刷新与查询
  -> 网页轮询结果
```

网页不实现 `.meta`、`.anim` 或 `.prefab` 序列化。CLI 和 Creator 扩展必须调用同一套导入核心，避免两份 Cocos 格式实现发生漂移。

## 4. HTTP 协议

协议版本固定为 `windup-cocos-bridge/1.0.0`。

### 端点

- `GET /v1/health`：返回版本、Creator 版本、当前工程名、是否已配对；不返回本地绝对路径。
- `POST /v1/pair`：请求体 `{ "code": "123456" }`；只在连接码有效期内接受，成功后返回一次令牌。
- `POST /v1/imports`：请求体是原始 ZIP；成功接收后返回 `202` 和 `jobId`。
- `GET /v1/imports/:jobId`：返回 `queued | validating | converting | writing | refreshing | verifying | completed | failed`。

除 `/v1/health` 和有效配对窗口内的 `/v1/pair` 外，所有请求必须同时通过精确 Origin 和 Bearer token 校验。服务实现 `OPTIONS` 预检，只向已配对 Origin 返回 CORS 许可。

### 上传头

- `Authorization: Bearer <token>`
- `Content-Type: application/zip`
- `X-Windup-Protocol: windup-cocos-bridge/1.0.0`
- `X-Windup-Request-Id: <UUID>`
- `X-Windup-SHA256: <64 位小写十六进制>`

同一 `requestId` 的重复请求返回原任务，不重复写盘。单包最大 256 MiB、ZIP 条目最多 4096 个、单条目最大 32 MiB、解包后总量最大 512 MiB。

## 5. 导入事务

1. 完整接收 ZIP 后先校验 Content-Length、SHA-256、ZIP 路径和 manifest。
2. 转换结果写入 `<project>/temp/windup-importer/<requestId>/stage/`，不直接写入 `assets/`。
3. 检查生成结果中的所有 UUID、SpriteFrame、AnimationClip 和 Prefab 引用。
4. 目标目录由 manifest 的角色和造型生成，网页不能传入磁盘路径。
5. 若目标已存在，先移动到同一事务目录的 `backup/`，再把 stage 移入目标。
6. 调用 AssetDB 刷新目标 `db://assets/windup-imports/<角色>/<造型>` 并等待完成。
7. 查询导入后的 Prefab 和动画；成功后删除 backup，失败则恢复 backup 并再次刷新。
8. 任务结果仅保留最近 20 条，扩展卸载时关闭 HTTP 服务并清理未完成的 staging。

## 6. Cocos 2D 资产格式

- Prefab 根节点包含 `cc.UITransform`、`cc.Sprite` 和 `cc.Animation`。
- `cc.Sprite._sizeMode` 固定为 `0`（CUSTOM），UITransform 始终保持 Windup 画布尺寸，避免透明裁边导致角色播放时跳动。
- SpriteFrame 使用 PNG 的 `@f9941` 子资源 UUID；纹理使用 `@6c48a` 子资源 UUID。
- 默认帧率模式的关键帧时间必须使用精确的 `index / fps`，动画时长使用 `frameCount / fps`，不得使用 `Math.round(1000 / fps)` 累积。
- 只有确实提供逐帧时长时才使用累计 `duration_ms / 1000`。
- `anchor_cocos = { x: anchor.x, y: 1 - anchor.y }`；Prefab 的 UITransform 使用该锚点。
- 每个动作方向生成独立 AnimationClip，名称保持 `<动作>-<方向>`，单向动作保持原动作名。
- v1 使用逐帧 PNG 驱动动画；atlas 继续随包保留，但不作为动画引用源。

`cocos-import.json` 升级为 `windup-cocos-import-1.1.0`，新增 `timing_mode: "constant-fps" | "per-frame"`。常量帧率下 `duration_ms` 保持 `null`，由导入器用 fps 精确计算；旧 `1.0.0` 清单继续兼容。

## 7. 前端状态和降级

网页状态依次为：检测扩展、等待配对、检查资产、打包、上传、Creator 转换、写入工程、刷新资源库、校验、完成。

错误必须给出可执行的中文处理方式：

- 未找到扩展：显示插件下载与安装说明，同时保留“下载 Cocos 包”。
- Creator 未打开工程：提示先打开目标 2D 工程。
- 未配对或令牌失效：展示连接码输入框，不丢失当前导出上下文。
- 端口占用：Creator 菜单显示占用错误和进程处理建议。
- 版本不兼容：只允许下载 ZIP，不执行本地导入。
- 导入失败：显示失败阶段、稳定错误码和回滚结果，不暴露本地绝对路径。

## 8. 安全要求

- 只监听 `127.0.0.1`，不得监听 `0.0.0.0`、局域网 IP 或 IPv6 全地址。
- 不执行 ZIP 内脚本，不调用 shell，不接受网页传入的命令或绝对路径。
- 拒绝 `..`、绝对路径、盘符、反斜杠混淆、NUL、符号链接和重复归一化路径。
- Origin、令牌、协议版本、摘要和请求大小全部在读取/写盘前校验。
- 日志隐藏令牌、连接码、用户绝对路径和 ZIP 内容，只记录任务 ID、阶段和稳定错误码。
- 配对码使用密码学安全随机数，最多尝试 5 次；超过后立即失效。

## 9. 验收标准

使用用户提供的真实“网站看板娘-46-默认造型”2D 帧资产验收。

验收必须同时满足：

1. 网页首次配对成功，刷新网页后无需再次输入连接码。
2. 单击后导入 64 张 256×256 RGBA8 PNG，产生“待机”和“行走”两个 AnimationClip，各 32 帧。
3. 两个动画均能播放、循环并切换 SpriteFrame，控制台无错误或警告。
4. 动画期间 UITransform 始终为 256×256，角色锚点和脚底位置不跳动。
5. 重复导入同一资产只更新同一目录，不产生孤立 `.meta`、重复 UUID 或第二份 Prefab。
6. 人为制造摘要错误、路径穿越、刷新失败和引用缺失时均拒绝导入或完整回滚。
7. Chrome 当前稳定版通过首次本地网络权限后完成导入；插件不可用时 ZIP 下载仍可使用。
8. 新增模块尽可能覆盖成功、失败、重试、幂等和回滚分支；不得降低仓库现有覆盖率要求。

## 10. 非目标

- 不支持 Cocos Creator 2.x、3D 模型、骨骼动画或 Spine。
- 不自动修改场景、不自动把 Prefab 拖入当前场景、不保存用户场景。
- 不让远程网页读取工程文件或枚举本机目录。
- 不删除通用导出格式；Cocos target 仍是通用包上的引擎适配层。
