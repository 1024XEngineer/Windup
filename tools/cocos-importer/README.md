# Windup → Cocos Creator 2D 一键导入

本目录包含两种导入方式：

- Cocos Creator 扩展：网页配对后，点击一次即可完成打包、上传、事务写入、AssetDB 刷新、引用校验和 Prefab 定位。
- Node CLI：用于 CI、离线排查或手动导入，不依赖 Creator 运行时。

支持 Cocos Creator `>=3.8.8 <3.9.0`，导入目标固定在当前工程的 `assets/windup-imports/`。

## 扩展安装与使用

1. 构建扩展：

   ```bash
   cd tools/cocos-importer/extension
   npm test
   npm run build
   npm run verify-package
   ```

2. 在 Cocos Creator 3.8.x 的扩展管理器中导入并启用：

   `tools/cocos-importer/dist/windup-cocos-importer.zip`

3. 打开目标 2D 工程，在 Creator 菜单选择“Windup → 显示连接码”。
4. 在 Windup 网页输入 6 位连接码。连接码 5 分钟有效，成功后立即失效。
5. 点击“一键导入 Cocos”。成功后 Creator 会定位到生成的 Prefab。

扩展只监听 `127.0.0.1:17832`。未配对网页只能读取协议与配对状态；工程名称、Creator 版本和工程打开状态只返回给已配对来源。上传接口校验来源、Bearer token、协议版本、请求 UUID、大小和 SHA-256。

## 导入行为

每次导入先在工程 `temp/windup-importer/<request-id>/` 中生成完整结果，再以目录替换方式写入：

```text
assets/windup-imports/<角色>/<造型>/
├── textures/<角色>-master.png
├── animations/
│   ├── <动作>.anim
│   └── <动作>/<动作>_NNN.png
├── prefabs/<角色>-<造型>.prefab
├── cocos-import.json
├── meta.json
└── schema.json
```

若写入、刷新或引用校验失败，扩展会尽力恢复导入前目录，并把真实回滚结果返回网页。错误响应不会暴露本机绝对路径。ZIP 仅接受 Windup 使用的 STORED 格式，并校验 CRC、本地头、中央目录、重复路径和危险路径；同时限制 4096 个 ZIP 条目、32 MiB 单条目、128 个动作、4096 个总帧和 256 MiB 展开输出。

## CLI 回退

```bash
cd tools/cocos-importer
node bin/windup-cocos-import.mjs <input.zip|frames目录> --out <output-dir>
node bin/windup-cocos-import.mjs <input.zip|frames目录> --dry-run
```

覆盖已有输出目录时必须显式添加 `--force`。输出目录可复制到 Cocos 工程 `assets/`，但日常使用建议优先走扩展，以获得事务回滚、AssetDB 刷新和引用校验。

## 验证

```bash
cd tools/cocos-importer
npm test

cd extension
npm test
npm run build
npm run verify-package

cd ..
node test/verify-output.mjs <Creator工程assets/windup-imports下的资产目录> 256 256
```

2026-08-20 已用“网站看板娘 / 默认造型”真实 2D 资产在 Cocos Creator 3.8.8 完成导入：67 张 SpriteFrame、2 个 AnimationClip、64 个动作帧和 1 个 Prefab 均被 AssetDB 识别，输出引用校验通过。

## 边界

- 不支持 Cocos Creator 3.9+、3D 模型、骨骼动画或 DEFLATE ZIP。
- 同一角色/造型采用整包替换，不做逐文件增量合并。
- 浏览器无法连接扩展时，网页仍保留“下载 Cocos 包”作为回退。
