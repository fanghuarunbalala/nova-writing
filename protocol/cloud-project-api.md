# 云项目 API 契约（项目域上云 · 冻结供双端复用）

> 状态：v1（feat/cloud-projects）。Android M4 的 RemoteProjectFiles / RemoteNovelStore 直接消费本契约；
> 变更须双向同步本文件与两端实现，破坏性变更 bump 版本。

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
                       getLeaseToken, getConversationId, onReplaySkip? })
// implements NovelStore（query/mutate/mutateBatch）
```

- 复用各端本地域引擎做投影；每个成功 mutation 以 `{kind:"novel_mutation", id:"m_<uuid>", data:{sessionTag, mutation}}` 追加 oplog（§4 mutate）。
- 收敛：init=snapshot 全量重放；query 前 delta 增量；`sessionTag` 等于自身的条目跳过（已应用）；重放失败 `onReplaySkip` 跳过（前向兼容）。
- 上推失败抛错（server 权威不缺记；本地发散不传播——下次会话从 server 重放）。
- Android Kotlin 版对齐此语义（`:core:net`，M4）。

## 6. 会话子进程环境变量（gui main → child）

| env | 云项目含义 |
|---|---|
| `NOVA_PROJECT_ID` | 云项目 id：child 激活 RemoteNovelStore + RemoteProjectFiles（本地项目不设） |
| `NOVA_SERVER_URL` / `NOVA_SERVER_ACCESS_FILE` | server 基址与 access token 文件（M3 既有） |
| `NOVA_LEASE_TOKEN` | 会话租约（M3 既有；域写/账本写共用） |
| `NOVA_CONVERSATION_WORKSPACE` | 云项目 = 本地缓存目录（journal sidecar/设计稿缓存兜底；非权威数据） |
