# 敏感词过滤模块（第一版）

日期：2026-08-27

状态：设计草案（未落地）

参考：[敏感词过滤方案总结（JavaGuide）](https://javaguide.cn/system-design/security/sentive-words-filter.html)。结论对齐该文的多模式匹配主线（Trie → AC），按本仓库体量裁剪：不引入 DAT、布隆初筛、超长文分段。

相关代码（实现时改，本文不落地）：

- [`backend/packages/app/src/windup_app/web/api/agent.py`](../../../backend/packages/app/src/windup_app/web/api/agent.py) — `POST /ai/chat`
- [`backend/packages/app/src/windup_app/web/api/generation.py`](../../../backend/packages/app/src/windup_app/web/api/generation.py) — `/generation` 提交口
- [`backend/packages/app/src/windup_app/server/orchestrator/service.py`](../../../backend/packages/app/src/windup_app/server/orchestrator/service.py) — 建任务 + 冻结积分
- [`backend/packages/framework/src/windup_framework/db/redis.py`](../../../backend/packages/framework/src/windup_framework/db/redis.py) — `get_redis()`
- [`frontend/src/features/quick-start-agent/planner.ts`](../../../frontend/src/features/quick-start-agent/planner.ts) — 会发 `system` / `instructions`，后端不能默默丢掉
- [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) — Issue → 分支 → PR

## 目标

在 `server` 下抽出独立的敏感词模块，作为 **系统内部调用** 的闸门：用户填进 Agent 与生成接口的 prompt，在付费调用发生前做一次多模式字符串匹配。命中则拒绝，不建任务、不冻积分、不调模型。

不挂管理端 HTTP。词库 CRUD 留在 service 接口上，供以后管理端直接调用同一实现。本期词库靠启动种子 + SQL / 种子文件追加。

**匹配在进程内跑 AC；词库用 Redis 做缓存与多进程热更新源。** Postgres 仍是唯一真相。不要把热路径改成每次请求读 Redis：Redis 不会跑 AC，也省不下应用机上抠图 / 解码那几 GB。落地必须先开 Issue、同步上游再开分支、PR 用 `Closes #` 关 Issue，见文末「落地流程」。

## 问题边界

用户填的 prompt 有两类风险，关键词匹配只能覆盖已知样本：

- **内容违规**：色情 / 暴力 / 仇恨等，进图生图或聊天会出合规与账单问题。
- **提示词注入**：`ignore previous instructions`、`你现在是 DAN`、让模型吐 system 等。词库能拦常见套话，拦不住新变体、谐音、图里写字。

本模块做的是 **入站多模式字符串匹配 + 命中即拒绝**。

不做输出审核、不做 LLM 二次判别、不改前端 Agent 的 `system` / `instructions` 协议。Quick Start Agent 依赖 client 侧 system 消息；后端扫它的文本，但不删这条角色。

## 现状

全仓无敏感词实现。

- `POST /ai/chat` 把 client `messages` / `tools` 原样 `ainvoke`。单条文本上限 8k，最多 16 条消息。
- `/generation` 的 `prompt` / `negative_prompt` / `custom_prompt` 在 `AiGenerationService` 里先 `create_task` 再 `reserve_for_task`。拦在 API 层不够：以后别的调用方会绕过；拦在冻结之后会白冻积分。

拦截必须发生在 **冻结积分 / 调模型之前**。

## 范围

做：

- 新包 `windup_app.server.sensitive_word`：先 model，再 interface，再 matcher / service / seed。对齐 `character` / `quota`。
- 纯 Python Aho-Corasick（HashMap 子节点）。匹配热路径只读内存自动机，不查库、不查 Redis。
- 表 `windup_sensitive_word` 为唯一真相；启动时表空则写入种子。
- Redis 缓存启用词列表 + Pub/Sub 通知其它 web 进程重建 AC。缓存 miss（含 LRU 淘汰）必须回源 Postgres。
- 内部接口：`scan` / `assert_clean`（无 session）；`list_words` / `add_word` / `set_enabled` / `reload`（有 session，不挂 HTTP）。
- 接入 `POST /ai/chat` 与 generation 提交路径（image / image-set / four-view / eight-view / action）。
- 检测副本上做最小预处理：NFKC、小写、去掉 FORMAT / 零宽字符。
- 词库变更后：写库 → SET 缓存 → 本进程原子替换自动机 → PUBLISH。

不做：

- 任何 `/sensitive-word` HTTP。现在没有管理端。
- 输出侧过滤、替换打码、人工审核队列。
- 禁止 client `system` 角色、服务端改写 system prompt。
- 双数组 Trie（DAT）、布隆初筛、超长文分段并行、OpenCC 繁简、谐音库、同形异码归一。
- 引入 `pyahocorasick` 等 C 扩展。
- 角色描述 / 项目起名等其它 LLM 入口（需要时复用同一 `assert_clean`）。
- Worker / executor 再扫一遍。外部用户进不了未过滤的任务行。Worker 不订阅词库频道。
- 热路径每次请求 GET Redis / `SISMEMBER` 再匹配。
- 把 AC 自动机 pickle 进 Redis。缓存只存 `word` + `category` 的 JSON。
- 把 Redis 当词库唯一真相（现网 `allkeys-lru` 会踢键）。

## 算法取舍

JavaGuide 按词库规模与吞吐把方案分成几档。本仓库词库从种子起步，待检文本短（Agent ≤ 8k，生成 prompt 更短），不按搜索引擎量级选型。

| JavaGuide 方案 | 对本仓库 |
|---|---|
| 暴力匹配 | 不做。词数 × 文本长会随词库线性变差。 |
| 纯 Trie | 不做。匹配失败要回退到下一位置，最坏 O(L×m)。 |
| **AC 自动机** | **采用。** 一次扫描 O(L+z)，fail 指针补全转移，嵌套词不会漏。约百行纯 Python 即可。HashMap 子节点适合汉字大字符集。 |
| 双数组 Trie（DAT） | 不做。远不到「万级词库省内存」的门槛；构建有冲突处理，热更新更烦。 |
| Hutool DFA 封装 | 不引入 Java / Hutool。语义上 AC 已是补全 fail 的多模式 DFA。 |
| 变形词预处理 | **做最小集**（见下）。繁简、谐音、同形异码列为后续。 |
| 原子热替换 | **做。** 读线程拿当前自动机引用；写路径先建新再替换。旧实例靠 GC 回收。 |
| 超长文分段并行 | 不做。没有文章级输入。 |
| 布隆初筛 | 不做。对短文本，子串枚举本身与 Trie 同阶，假阳性还会多一次精确匹配。 |

命中策略：**拒绝，不打码替换。** 生成场景打码后仍会把残缺 prompt 送进付费 API；注入短语替换后仍可能生效。

空词库：启动打 WARN；热路径放行（产品不能因种子失败而全站 400）。匹配器自身异常：**fail-closed**（拒绝本次请求，不调模型）。

## 模块位置

```
backend/packages/app/src/windup_app/server/sensitive_word/
  model.py       ORM + View + Hit
  interface.py   ABC
  matcher.py     预处理 + AC（无 SQL，可单测）
  service.py     读库编译自动机、CRUD、scan / assert_clean
  seed.py        启动时表空则写入种子
  __init__.py
```

模块级单例：`service = SqlAlchemySensitiveWordService()`，与 `character.service` / `quota.service` 相同。无状态服务对象；session 由调用方按请求传入（仅写路径）。

装配：

- [`bootstrap/app.py`](../../../backend/packages/app/src/windup_app/bootstrap/app.py) 必须 import ORM，否则 `Base.metadata.create_all` 建不出表。
- [`schema_sync.py`](../../../backend/scripts/schema_sync.py) 的 `_load_models` 同样 import。缺整张表由 `create_all` 建，不归 schema_sync。
- lifespan 在 `create_all` 之后：表空则 seed，然后 `reload`（先 Redis 后回源库），并订阅词库频道（与 SSE subscriber 同类，只挂 web）。

```text
POST /ai/chat  ──scan / assert_clean（无 session）──►  SensitiveWordService
POST /generation/* ──提交且冻结积分前─────────────►        │
                                                          ▼
                                                   内存 AC 自动机
                                                          ▲
                              reload 编译 AC ◄── Redis 缓存（可丢）
                              seed / CRUD ──► Postgres windup_sensitive_word（真相）
                              写完 ── SET Redis + PUBLISH ──► 其它 web 进程 rebuild
```

## Redis 词库缓存

应用机 4C8G 的压力来自抠图 / 解码 / Chromium，不是词表。几千词的 HashMap AC 通常是 **几百 KB**。把匹配搬到 Redis **省不下** 那几 GB，也跑不了子串 AC：`SISMEMBER` 只能精确等于；每次请求 `GET` 再扫等于拆掉自动机还多一跳。

Redis 已经在独立 DB 机上（[`docker-compose.db.yml`](../../../docker-compose.db.yml)）：`maxmemory 256mb` + **`allkeys-lru`**。词表必须当可丢的缓存。client_bake 帧会占数 MB，词表键没有 TTL 仍可能被 LRU 踢掉。

职责：

| 层 | 键 / 表 | 职责 |
|---|---|---|
| Postgres | `windup_sensitive_word` | 唯一真相。seed / CRUD 只写这里。 |
| Redis 缓存 | `windup:sensitive_word:enabled` | 启用词列表 JSON：`[{"word":"...","category":1}, ...]`。无 TTL。 |
| Redis Pub/Sub | `windup:pubsub:sensitive-word-reload` | 对齐 [`sse/bridge.py`](../../../backend/packages/framework/src/windup_framework/sse/bridge.py) 的 `windup:pubsub:...`。payload 可只是版本戳或空消息，收到后从 Redis 重建 AC。 |
| 进程内 AC | （无键） | `scan` / `assert_clean` 零 Redis、零 SQL。 |

加载（lifespan / `reload`）：

```text
GET windup:sensitive_word:enabled
  命中且 JSON 合法 → 编译 AC
  未命中或损坏 → SELECT enabled 行 → SET 缓存 → 编译 AC
```

写路径：`flush` Postgres → `SET` 缓存 → 本进程换自动机 → `PUBLISH`。Redis `SET` / `PUBLISH` 失败只打 ERROR，**不阻断**本次写库、不 rollback。缓存 miss **必须**回源库：否则 LRU 踢键后闸门变成空词库放行。

订阅只在 **web** lifespan 起。Worker 按规格不扫 prompt，不必订这个频道。客户端用已有 [`get_redis()`](../../../backend/packages/framework/src/windup_framework/db/redis.py)。

不把自动机 pickle 进 Redis：Python 对象序列化没有收益，缓存只要词列表，各进程自己编译。

## 数据模型

表名 `windup_sensitive_word`，命名与 `windup_character` 一致。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BigInteger（SQLite variant Integer） | PK，自增 | |
| `word` | String | UNIQUE，非空 | 入库前规范化：strip、NFKC、小写。空串禁止。 |
| `category` | SmallInteger | 非空 | v1 两个值：`content`（违规内容）、`injection`（越狱 / 注入套话）。用整数枚举，不要存自由字符串。 |
| `enabled` | Boolean | 非空，默认 true | 不做物理删除。管理端以后只禁用。 |
| `create_at` | DateTime(timezone=True) | 非空 | 字段名与现有表一致，不是 `created_at`。 |
| `update_at` | DateTime(timezone=True) | 非空，onupdate | 同上。 |

视图：`SensitiveWordView`（id / word / category / enabled / 时间戳）。

匹配结果：`SensitiveHit(word, category, start, end)`。`start` / `end` 是 **预处理后文本** 上的下标。v1 不要求映射回原文；JavaGuide 说的位置映射表，留给以后要高亮时再做。

`word` 列长度取 128 足够：注入套话通常短，超长「词」应当拆，不该进自动机当一条模式。

### 种子

模块内一份 JSON（注入套话 + 少量内容样例）。启动时若表为空则写入；表里已有行则 **不覆盖**，避免把运营追加的词冲掉。

**不在仓库里塞完整色情 / 暴力词表。** 那是合规 / 运营资产。没有管理端时用 SQL 或改种子文件再部署。种子里的注入样例只覆盖常见套话，不是攻击百科。

## 内部接口

`SensitiveWordService`（ABC）。API 层与 orchestrator 只依赖这个抽象。

### 热路径（不接收 session）

```
scan(text: str) -> list[SensitiveHit]
assert_clean(text: str) -> None
```

- `scan`：空串 / 仅空白 → 空列表。先预处理再跑当前自动机。
- `assert_clean`：`scan` 非空则抛 `BizException(code=BizCode.BAD_REQUEST)`。
- **对外文案固定**，不回显命中词，避免帮攻击者探测词库。建议：「请求包含不允许的内容」。
- 命中只打日志：`user_id` + 命中 `word` + `category`，**不落全文**。`user_id` 由调用方写入 log extra / 已有 request 日志，service 不必强行要 `user_id` 参数；需要的话 `assert_clean` 可加可选 `user_id` 以便日志，不要把它变成鉴权。

不新增 `BizCode` 成员。项目约定少枚举，调用方需要其它码时直接传 int。

### 写路径（有 session，不挂 HTTP）

```
list_words(session, *, enabled=None, category=None) -> list[SensitiveWordView]
add_word(session, word, category) -> SensitiveWordView
set_enabled(session, word_id, enabled) -> SensitiveWordView | None
reload(session) -> None
```

- `add_word`：规范化后插入。同一 `word` 已存在且 enabled：幂等返回已有行。已存在但 disabled：重新启用并 `reload`，不要再插一行（UNIQUE）。
- `set_enabled`：找不到返回 `None`。调用方（以后的管理端）再决定 404。
- 写方法 `flush` 后调用 `reload`。事务仍由 `get_session` 负责 commit / rollback；本实现不 commit。
- `reload`：优先 `GET` Redis 缓存；miss / 损坏则读 `enabled=true` 的 `word` + `category`，`SET` 回 Redis，再重建 AC 并原子替换内存引用。构建失败保留旧自动机，打 ERROR。本进程替换成功后再 `PUBLISH`（订阅方不要在收到自己发出的通知时死循环重建——实现上可忽略本 pid，或 reload 做成幂等）。

并发：每个 web 进程各有一份内存自动机。CRUD 只保证本进程立刻可见；其它 web 进程靠 Pub/Sub 从 Redis 重建。Redis 不可用时本进程仍以 Postgres 编译，其它进程等到下次启动 / 下次成功 PUBLISH。

## 匹配器

`matcher.py` 不 import SQLAlchemy。单测可以直接喂词列表。

### 预处理

只处理 **检测副本**，不改调用方原文（原文仍进模型或进任务入参——前提是没被拒绝）。

1. `unicodedata.normalize("NFKC", text)`：全角 / 兼容字符。
2. `casefold()`（或 `lower()`）：英文注入套话。
3. 去掉 Unicode 类别为 FORMAT 的码位（零宽连接符等）。
4. **不**删标点、**不**只留汉字与字母。删标点会把 `ignore previous` 与夹杂符号的变体拼成新词，也更容易误报。v1 用 NFKC + 去零宽已经能挡住 `ｉｇｎｏｒｅ` 和 `ign\u200bore`。插入 `f*u*c*k` 这类靠以后加「去非字母数字再匹配」的第二通道，不要默默改第一通道。

词库入库用同一套规范化，保证「库里的词」与「扫到的文本」在同一空间。

### AC 自动机

三步，与 JavaGuide 一致：

1. 把所有 enabled 词插入 Trie，末节点记录 `word` + `category`。
2. BFS 建 fail 指针；子节点合并 fail 节点的 outputs，避免匹配时再沿 fail 链遍历。
3. 单次扫描文本：失配沿 fail 回退；每次转移收集该状态已合并的 outputs。

空自动机（零词）的 `match` 返回空列表，不抛错。这是「空词库放行」的实现落点。

不实现贪婪 / 密度匹配开关。敏感词闸门要的是「有没有命中」，不是「最长还是最短」。`scan` 返回全部命中即可。

## 失败语义

### Generation

走现有统一信封：HTTP 200，body `code=400`，`message` 为固定文案。`BizException` 已由全局处理器转换。

发生在 `create_task` / `reserve_for_task` **之前**，因此：

- 不出现 PENDING 任务
- 不冻结积分
- 不入 generation Stream

匹配器抛出非 `BizException` 的异常：同样拒绝本次提交，打 ERROR。不要吞掉后继续生成。

### Agent

`/ai/chat` **不用** `Response` 信封（OpenAI 兼容）。命中时：

- HTTP **400**
- `{"error": {"message": "请求包含不允许的内容", "type": "invalid_request_error", "code": "content_policy_violation"}}`
- 带上已有的 `X-Request-Id`

与现有 413 / 422 / 502 / 503 同一套 `_error_response`。不要改成 HTTP 200 + 业务码，前端 AI SDK 认的是协议错误形。

匹配器异常：同样 400 + `content_policy_violation`（fail-closed），不要变成 502 去调上游。502 留给真正的上游失败。

## 接入点

实现阶段改这些调用点。本文把字段写死，避免漏扫 `negative_prompt` 或只改了 API、service 被别的入口绕过。

### Generation → `orchestrator/service.py`

不要只改 `web/api/generation.py`。闸门放在 `AiGenerationService` 各 `generate_*`（及 `_submit_view_sheet`）里，`create_task` 之前。

| 方法 | 待检字段 |
|---|---|
| `generate_character_image` | `prompt`、`negative_prompt` |
| `generate_character_direction_set` | 同上 |
| `generate_character_four_view` / `eight_view` | 同上（走 `_submit_view_sheet` 一处即可） |
| `generate_character_action` | `custom_prompt`；空 / None 跳过 |

空 prompt 合法（image 默认 `""`）：`assert_clean("")` 通过。custom 动作的空 prompt 仍由 API 层现有校验拒绝，不归本模块。

`retry_failed_directions` 不重扫：入参是已通过闸门的任务行。若以后管理端能改历史 `input_payload`，再另说。

Worker / `executor.py` 不再扫。漏网只可能来自直接写库，不是外部 HTTP。

### Agent → `web/api/agent.py` 的 `chat()`

该文件目前没有 server 层，直接在 `ainvoke` 前调用内部 service。不要为此新建 `server/agent`。

待检文本拼在一起或逐段 `assert_clean`（逐段更好：命中日志能对上字段，拼在一起可能跨字段误报）：

- 每条 message：string `content`；multimodal 的 `type=text` part。`image_url` 不扫。
- 每个 tool：`function.name`、`function.description`。`parameters` JSON 不扫（schema 结构，不是用户散文；扫它容易误伤类型名）。

不禁止 `role=system`。

## 调用时序

```
认证通过
  →（generation）项目 / 角色 / 尺寸校验
  → assert_clean(待检字段)
       命中 → 400 / content_policy_violation 或 BizException 400，结束
       匹配器崩溃 → 同样拒绝，结束
  →（generation）create_task + reserve_for_task + 入队
  →（agent）ainvoke
```

Generation 的项目归属校验仍在 API 层、闸门在 service 层：顺序是 API 校验 → service 过滤 → 建任务。未认证请求到不了这两步（现有 AuthMiddleware）。

## 可观测

| 事件 | 级别 | 内容 |
|---|---|---|
| 命中拒绝 | INFO 或 WARNING | `user_id`、命中词、category、入口（`ai.chat` / `generation.image` 等）。不落原文。 |
| 空词库 reload | WARN | 启用词数为 0。 |
| Redis 缓存 miss / JSON 损坏 | WARN | 已回源 Postgres 并 SET。 |
| Redis SET / PUBLISH 失败 | ERROR | 库已写成功；其它进程可能暂用旧词库。 |
| reload 构建失败 | ERROR | 保留旧自动机。 |
| 匹配器异常 | ERROR | 带堆栈；请求已拒绝。 |

v1 不强制独立 Prometheus 指标。日志能 grep 即可。空词库放行后，WARN 必须能被看见，否则等于静默关闭闸门。

## 测试（实现时）

规格不写测试代码，但实现必须能用这些验收，否则闸门是摆设：

- matcher：嵌套词（`she` / `he`）、失配回退、NFKC 全角、零宽字符插入、大小写、空串、空词库。
- service：seed 只在表空时写入；`add_word` 幂等；disable 后 `scan` 不再命中；reload 失败保留旧机。
- Redis：缓存命中则不查库编译；缓存 miss / 坏 JSON 回源 Postgres 并 SET；`SET`/`PUBLISH` 抛错不回滚已 flush 的词行。
- Pub/Sub：本进程 `add_word` 后，订阅方从缓存重建后能命中新词（单测 mock `get_redis` 即可，不必真起第二进程）。
- generation：命中的 prompt **不**建任务、**不**冻积分。`negative_prompt` 单独命中同样拒绝。
- agent：user 文本命中 → 400 `content_policy_violation`，provider 零请求；system 文本同样扫；图片 URL 不扫。

## 后续（明确不是本期）

- 管理端 HTTP：列表 / 新增 / 启用禁用，调同一 `SensitiveWordService`。词库热更新通道本期已有（Redis 缓存 + pub/sub）。
- 繁简转换、谐音、去标点第二通道；命中位置映射回原文。
- 词库分级（拦截 / 审核 / 只记日志）。v1 全部 enabled 即拦截。
- 输出侧过滤；其它 LLM 入口（角色起名、prompt rewrite）。
- 白名单（子串误杀）。有真实误报再加，不要先做。

## 落地流程

对齐 [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)：`Proposal → Issue → 分支 → PR → Review → 合并`。**先立 Issue，再拉代码。** 不要在 main 上直接改。

### 1. 开 Issue

`gh issue create`。标题写清「敏感词过滤闸门」，禁止空泛标题。正文必须有背景、方案、验收（草稿见下一小节）。指定 assignee；等 triage 挂 milestone / label。没有 milestone 的 Issue 不在计划内。

### 2. 同步上游再开分支

Fork 协作：开发分支只在个人 fork。开分支前：

```bash
git fetch upstream
git checkout main
git rebase upstream/main
git checkout -b feat/#<issue>-sensitive-word-filter
```

`<issue>` 换成上一步的编号，例如 `feat/#1234-sensitive-word-filter`。

### 3. 按规格实现

顺序见下一节。范围只覆盖该 Issue，不夹带。后端若动了对外契约，在 `backend/` 下跑 `uv run python -m scripts.export_openapi` 并提交（本模块不挂新 HTTP，通常不必；Agent 错误码若进了 OpenAPI 再导出）。

### 4. 提 PR 并关闭 Issue

向主仓库开 PR，标题/正文写 `Closes #<n>`（GitHub 合入即关 Issue）。必须 CI 通过、获得 approve；合并人见 CONTRIBUTING。**禁止把未经 review / 未合并的代码部署到生产。**

关闭 Issue 时若 PR 已 `Closes #`，合入即可。其它关闭原因要注明：被其他 Issue 取代 / 组内确认不再需要。

### Issue 正文草稿

创建时把下面贴进 `gh issue create --body`（可按编号改分支名）。

```markdown
## 背景

`POST /ai/chat` 与 `/generation` 提交口都接受用户 prompt，当前没有入站过滤。

- 违规内容（色情 / 暴力 / 仇恨等）会进图生图或聊天，有合规与账单风险。
- 常见注入套话（忽略之前的指令、DAN 等）会进付费模型调用。
- generation 在 `AiGenerationService` 里先建任务再冻积分；闸门必须在这之前，否则白冻积分。
- Agent 把 client messages/tools 原样 `ainvoke`。Quick Start 会发 system 消息，后端不能丢掉该角色，但要扫文本。

关键词匹配只拦已知样本，拦不住新变体、谐音、图里写字。本期只做入站多模式匹配 + 命中拒绝，不做输出审核、不做 LLM 二次判别。

## 方案

独立模块 `windup_app.server.sensitive_word`（先 model，再 interface，再 matcher/service），不挂管理端 HTTP。

- 纯 Python AC；`scan` / `assert_clean` 只读进程内自动机。
- Postgres `windup_sensitive_word` 为唯一真相；Redis `windup:sensitive_word:enabled` 缓存启用词 JSON；`windup:pubsub:sensitive-word-reload` 通知其它 web 进程重建。缓存 miss（`allkeys-lru`）必须回源库。
- generation：在 `orchestrator/service.py` 的 `create_task` / `reserve` 之前扫 `prompt` / `negative_prompt` / `custom_prompt`。命中 → HTTP 200 + body `code=400`，不建任务、不冻积分。
- Agent：`ainvoke` 前扫 message 文本与 tool name/description。命中 → HTTP 400，`code=content_policy_violation`。不扫图片 URL，不禁止 `role=system`。
- 命中不打码、不回显命中词。匹配器异常 fail-closed。空词库 WARN 后放行。

设计细节：`docs/superpowers/specs/2026-08-27-sensitive-word-filter.md`。

## 验收

- matcher：嵌套词、失配回退、NFKC / 零宽 / 大小写、空串、空词库。
- seed 只在表空时写入；`add_word` 幂等；disable 后不再命中；reload 失败保留旧自动机。
- Redis 缓存命中不回源；miss / 坏 JSON 回源 Postgres 并 SET；SET/PUBLISH 失败不回滚已写库的词。
- add_word 后订阅方能从缓存重建并命中新词（mock Redis）。
- generation 命中不建任务、不冻积分；`negative_prompt` 单独命中同样拒绝。
- agent 命中 400 `content_policy_violation`，provider 零请求；system 文本要扫；图片 URL 不扫。
```

## 实现顺序（落地时）

规格本身不改代码。真正做模块时：

1. 按「落地流程」开 Issue、同步 `upstream/main`、从 `feat/#<n>-sensitive-word-filter` 开始
2. `model.py` — 表与 View / Hit
3. `interface.py` — ABC
4. `matcher.py` — 预处理 + AC，先单测
5. `service.py` + `seed.py` — CRUD、reload（Redis GET/SET + 回源）、PUBLISH、模块单例
6. 装配：`create_all` import、lifespan seed + reload、web 订阅 `windup:pubsub:sensitive-word-reload`、`schema_sync._load_models`
7. 接入 `orchestrator/service.py` 与 `web/api/agent.py`
8. 测试按上面验收补齐；PR 正文 `Closes #<n>`
