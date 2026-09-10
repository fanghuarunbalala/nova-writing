# 云项目 API 契约（项目域上云 · 冻结供双端复用）

> 状态：v1.1（feat/cloud-projects · 纯云端化）。Android M4 的 RemoteProjectFiles / RemoteNovelStore 直接消费本契约；
> 变更须双向同步本文件与两端实现，破坏性变更 bump 版本。
> v1.1（纯云端化）：journal replay 增量参数、history 分页语义（latest/before）、main 侧 UI 域通道、
> 本地性能缓存（journal 镜像 + 域快照缓存）与 env 注入表更新。

## 1. 认证与通用约定

- 所有路由经 `authGuard`（`Authorization: Bearer <JWT>`；SSE 另支持 `?access_token=`）。
- 项目 owner-only：非所有者 403 `forbidden`；软删项目对一切路由表现为 404。
- 错误体统一 `{ code, message, ...extras }`；乐观冲突 409 附当前值。

## 2. 项目生命周期（FR1）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/projects` `{name}` | 201 `{id, name}`；空白名回落「未命名项目」，>64 字 400 `bad_name` |
| GET | `/v1/projects` | `{projects:[{id,name,createdAt,lastActivityAt,archivedAt}]}`（非删除，按活跃度倒序） |
| PATCH | `/v1/projects/:id` `{name?, archived?}` | 改名/归档；200 返回 `{project}` |
| DELETE | `/v1/projects/:id` | 软删（`deleted_at`）→ 204 |

## 3. 文件 API + 路径沙箱（FR2）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/projects/:id/files/*` | 读单文件 `{path, content, updatedAt}`；404 不存在 |
| GET | `/v1/projects/:id/files?prefix=` | 列表 `{files:[{path, updatedAt, size}]}`（prefix 须在 allowlist 边界内） |
| PUT | `/v1/projects/:id/files/*` `{content, expectedUpdatedAt?}` | 写；200 `{path, updatedAt}`；413 `too_large`；409 `stale_file`+`currentUpdatedAt` |
| DELETE | `/v1/projects/:id/files/*` `{expectedUpdatedAt?}` | 软删回收 → 204 |

**沙箱规则（server 权威判定，`sandbox.ts` 纯函数）**：

- 归一：`\`→`/`、折叠重复分隔符、剥前导 `./`；decode 后判定。
- 拒绝：空、`..` 段、绝对（`/`、盘符 `C:`、UNC `\\`）、空字节、空段、路径 >240。
- 黑名单段：`.git`、`.env*`。
- allowlist 顶层：`chapters/ notes/ memory/ design/ .novel/cases/` + `NOVEL.md`。
- 单文件 ≤512KiB。
- 特例（两层记忆 PRD 保留）：`NOVEL.md` 写 403 `novel_md_requires_approval`（审批提案唯一写径）；`memory/<name>.md` 写需 `source`（真实账本 seq），`memory/MEMORY.md` 索引 server 维护且不可直写/删。
- 路由层会先归一拦下一切 `..` 形态（404）；沙箱是 handler 级第二道。

**SSE**：`{type:"file_changed", projectId, path, op:"write"|"delete", updatedAt}`（无 conversationId → 全局订阅者；会话级订阅按过滤自然屏蔽）。

**双端对拍纪律**：`cloud/server/src/files-parity.test.ts` —— 逃逸类输入「桌面拒绝 ⟺ server 拒绝」；server 收紧档（黑名单/allowlist）允许比桌面更严。

## 4. 域 API（FR3，domain_entities 通用实体存储）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/projects/:id/domain/snapshot` | 全量 `{cursor, entities:[{id,kind,entityVersion,data,seq,updatedAt,deletedAt?}]}`（按 seq） |
| GET | `/v1/projects/:id/domain/delta?since=N` | 增量（seq>N）+ 最新 cursor |
| POST | `/v1/projects/:id/domain/mutate` `{conversationId, leaseToken, mutations[]}` | 批量（≤64）；mutation `{kind,id,op:"put"\|"delete",data?,baseVersion?}`；200 `{results, seq}`；409 `stale_revision`+`currentVersion` |

- kind 模式：`/^[a-z][a-z0-9_]{0,31}$/`（novel 域用 `novel_mutation`，见下）。
- 乐观锁：put 已存在需 baseVersion（v+1）；新建带 baseVersion → 409(0)；delete 需 baseVersion（软删，再 put 复活为 v1）。
- 域写须持该 conversationId 租约（与账本写同权）。
- 同事务记账（journal kind `domain-mutation`）+ SSE `{type:"domain_changed", projectId, seq, count}`。

## 5. 桌面端复用契约（FR5/FR6 接口形状）

### ProjectFiles port（files 四件套后端）

```ts
interface ProjectFiles {
  read(relPath: string): Promise<string>;            // 全文；不存在/越界抛错
  list(prefix: string): Promise<{path: string; updatedAt?: number}[]>;
  write(relPath: string, content: string): Promise<void>;  // last-write-wins
}
```

- `LocalProjectFiles(workspace)`：本地（沙盒 = resolveInWorkspace，绝对/UNC/盘符显式拒绝 + symlink realpath 防护）。
- `RemoteProjectFiles({url, projectId, getAccessToken})`：即本文件 §3 的 REST 封装；server 规则文案原样抛给模型。

### RemoteNovelStore（投影 + oplog）

```ts
new RemoteNovelStore({ url, projectId, sessionTag, getAccessToken,
                       getLeaseToken, getConversationId, onReplaySkip?, cachePath? })
// implements NovelStore（query/mutate/mutateBatch）
```

- 复用各端本地域引擎做投影；每个成功 mutation 以 `{kind:"novel_mutation", id:"m_<uuid>", data:{sessionTag, mutation}}` 追加 oplog（§4 mutate）。
- 收敛：init=snapshot 全量重放；query 前 delta 增量；`sessionTag` 等于自身的条目跳过（已应用）；重放失败 `onReplaySkip` 跳过（前向兼容）。
- 上推失败抛错（server 权威不缺记；本地发散不传播——下次会话从 server 重放）。
- **sessionTag 必须进程内唯一**（如 `<conversationId>-<pid>`）：固定值会让重启后的空投影跳过自身旧操作（丢数据）。
- **域快照缓存（cachePath，可选）**：`{version:1, cursor, entities}` 持久化——命中时 init 载入投影+cursor 后仅 delta 补齐；
  tmp+rename 原子写（多进程共写安全，(cursor,entities) 成对一致，落后版本由 delta 自愈；损坏按未命中回退全量）。
- Android Kotlin 版对齐此语义（`:core:net`，M4）。

### journal 本地镜像 + main 预播种（纯云端化 ④）

- 行协议与各端本地 journal.jsonl 同构（snapshot 行带 run / append 行带 messages），行内嵌
  `gs` = server 账本全局行号（读侧忽略；做增量游标与并发写者去重键）。
- 写侧原语（`journalMirror` 模块）：`appendMirrorRows`（**追加前重扫尾序，gs ≤ 尾的行丢弃**——多写者竞态安全）、
  `rewriteMirrorRows`（收缩/rewrite 全量重建）、`seedJournalMirrorFromServer`（main 在会话 spawn 前预播种：
  尾扫 → `GET replay?since=tail` → 收缩（lastSeq<尾）全量重建 → 去重追加）。
- 镜像位置：`<storeDir>/conversations/<cid>/journal.jsonl`——各端一次性历史读取（UI 回显/恢复上下文）
  不等子进程对账。

## 6. 会话子进程环境变量（gui main → child）

| env | 云项目含义 |
|---|---|
| `NOVA_PROJECT_ID` | 云项目 id：child 激活 RemoteNovelStore + RemoteProjectFiles（本地项目不设） |
| `NOVA_SERVER_URL` / `NOVA_SERVER_ACCESS_FILE` | server 基址与 access token 文件（main `applyServerEnv` 与 `NOVEL_*` 前缀双注入——M3 旧名，云分支读 `NOVA_*`） |
| `NOVA_LEASE_TOKEN` | 会话租约（M3 既有；域写/账本写共用） |
| `NOVA_CONVERSATION_WORKSPACE` | 云项目 = 本地缓存目录（journal 镜像/设计稿/域快照缓存兜底；非权威数据） |

## 7. journal 账本读取（纯云端化 ①/v1.1）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/journal/:conversationId/replay?since=N` | 增量（seq>N，按 seq 升序）；缺省 since=0 全量（向后兼容）。响应 `{events, lastSeq}`——`lastSeq` 为该会话当前最大 seq（客户端据此判定「账本被 rewrite 收缩」→ 镜像全量重建）。owner 判定用未过滤存在性查询（since 滤空不放行非 owner 探测） |

**history 分页语义（各端读侧契约，run 粒度）**：

- `fromSeq + limit`：前向头部页（resume/断档补拉，语义不变）。
- `latest: true + limit`：最近 limit 个 run（首开首屏）。
- `before: N + limit`：seq < N 的最近 limit 个 run（向上翻页游标 = 当前已载最早 run seq）。
- 调用方以 `limit+1` 探测是否还有更早（多出的最早 run 丢弃即 hasMore=true）。

## 8. main 侧 UI 域通道（纯云端化，桌面特有）

- 云项目打开时桌面 main 进程内构造 `RemoteNovelStore`（renderer 的 novel RPC 不再落本地 novel.db）：
  - `sessionTag = ui-<projectId>-<pid>`（进程唯一，见 §5 约束）；租约 conversationId = `ui-<projectId>`（稳定）。
  - UI 手动域写（建角色/卷章等）经 server oplog；写前懒申请 `ui-` 租约（LeaseClient 心跳维持，项目关闭释放）。
  - `ui-` 租约与会话租约 conversation id 不同、不互斥；域级并发由 entity_version 乐观锁兜底。
- 打开云项目后 main 后台预播种最近 K=5 个会话的镜像 + 预热读侧折叠缓存（fire-and-forget）。
