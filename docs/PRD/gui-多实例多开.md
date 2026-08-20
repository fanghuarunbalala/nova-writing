# gui-多实例多开 PRD —— v0.1

> 状态：✅ 已定稿（2026-08-20 实施落地；焦点通道实现为 zeromq REQ/REP 而非 Pair——Pair 严格 1:1，挑战方断开后持有方不再接受新连接）
> 关联：整体产品 PRD [`产品总览.md`](./产品总览.md)；技术设计 `docs/architecture.md`
> 前置调研结论：当前无单实例锁、无文件锁，无死锁风险；第二 GUI 实例启动即崩（`ipc://novel-events` 固定 ZeroMQ 管道二次 bind 失败，`core/src/event/topics.ts:13`、`gui/src/main/minimal.ts:318`）；数据层已按项目隔离（storeDir 哈希目录、WS 随机端口）。

---

## 1. 背景与目标

- 要解决的问题（痛点 / 现状）：
  - 一个 GUI 实例任一时刻只能有一个活跃项目：main 进程 `currentNovelStore/currentJournalDir/currentWorkspaceRoot` 是单变量（`minimal.ts:309,359,403`），打开另一项目 = `rebindWorkspace` 关旧库 + `manager.rescope` **终止旧项目全部运行中对话**（`minimal.ts:656-670`）。同时创作两本书在单实例内不可行。
  - 再启动一个程序实例则**启动即崩**：`novel.changed` 事件 PUB 地址固定 `ipc://novel-events`，第二个实例 `bind()` 失败 → `unhandledRejection` → 退出（`minimal.ts:285-288,318-319`）。
  - 同一项目被两个实例双开无任何防护：工作区 `novel.db` 非 WAL、无 busy_timeout → 并发写抛 SQLITE_BUSY；两边会话目录各自扫描编号 → 新会话目录撞车、journal 交错写入。
  - 两实例并发全量覆盖写 `workspaces.json` → "最近项目"条目互相丢失（last-writer-wins）。
  - 附带发现的缺陷：切换工作区时 `rebindLibraryService` 不关闭旧 `LibraryService`（`minimal.ts:445-450`），Windows 下 book.db 只读句柄累积锁定。
- 目标（一句话，可验收）：**同一台机器可同时运行多个 GUI 实例、各开一个不同项目并行创作；打开已被其他实例持有的项目时被拒绝——优先把持有窗口自动切到前台，失败才报错。**

## 2. 用户故事

- 作为写作者，我希望 同时打开两本书、每本书一个独立窗口并行创作，以便 两本书的运行中对话互不干扰，不需要在切换中丢失进度。
- 作为写作者，我误打开已在另一窗口打开的项目时，希望 应用自动把那个窗口带到前台，以便 我直接继续工作，而不是看到报错甚至造成数据损坏。
- 作为写作者，我希望 在文件菜单一键"新建窗口"，以便 不必手动再次启动程序。
- 作为写作者，我希望 两个窗口的"最近项目"列表都完整，以便 任一窗口都能直达我的书。

## 3. 流程图（必填）

### 3.1 主流程（打开项目，含同项目双开处置）

```mermaid
flowchart TD
    A[用户在某实例打开项目] --> B[locator.resolve 派生 storeDir/workspaceId]
    B --> C{workspace.lock 原子创建成功?}
    C -- 是 --> D[开库 + rescope + 绑定焦点回切通道] --> E[正常创作]
    C -- 否 --> F{锁内 pid 存活?}
    F -- 否（崩溃残留）--> G[删除锁文件, 重试一次] --> C
    F -- 是 --> H[connect 焦点通道发送 focus, 等 ack ≤500ms]
    H -- 收到 ack --> I[持有窗口被拉到前台] --> J[本实例提示: 该项目已在另一窗口打开, 已为你切换]
    H -- 超时 --> K[报错: 该项目已在另一窗口打开 进程 pid, 可删锁自救]
```

### 3.2 多主体交互（双开回切）

```mermaid
sequenceDiagram
    participant U as 用户
    participant B as 实例B（挑战者）
    participant A as 实例A（持有者）
    U->>B: 打开项目1（已在A中打开）
    B->>B: workspace.lock 创建失败, pid 存活
    B->>A: Pair connect ipc://novel-focus-<workspaceId> 发 focus
    A->>A: isMinimized→restore, show, focus
    A-->>B: ack focused
    B-->>U: 提示"已切换到已打开的窗口"（A 已在前台）
```

### 3.3 实例生命周期（多实例并行）

```mermaid
flowchart LR
    A[实例A 开项目1] -->|文件菜单-新建窗口| B[spawn 独立进程 实例B]
    B --> C[实例B 显示项目选择页 不自动恢复]
    C --> D[实例B 开项目2]
    A --> E[各自事件管道/WS端口/锁互不相干]
    D --> E
    A -.关闭或切走项目1.-> F[释放 workspace.lock + 焦点通道]
    F -.->|实例B 此后可开项目1| C
```

## 4. 功能明细

- 功能点一：事件地址按实例唯一化（修双实例启动崩溃，核心）
  - 触发：GUI main 进程启动装配事件通道时。
  - 输入：进程 pid；env `NOVEL_EVENTS_ADDR` / `NOVEL_EVENT_NAMESPACE`（均可覆盖，调试/测试用）。
  - 处理：`core/src/event/topics.ts` 中 `NOVEL_EVENTS_ADDR` 常量改为 `novelEventsAddr()` 函数，默认 `ipc://novel-events-<pid>`（该 PUB/SUB 均在 main 进程内：bind `minimal.ts:318`、connect `minimal.ts:519`，pid 天然一致）；`conversationEventsAddr(cid)` 拼入实例命名空间 `ipc://conversation-<ns>-<cid>-events`——**ns 必须经 env 传递**（该地址在 main 与会话子进程两侧解析：SUB `minimal.ts:543`、PUB `runDesktopRuntimeChildEntrypoint.ts:151`，子进程 pid 不同，靠 `NodeConversationProcessSupervisor.ts:56` 的 `{...process.env}` 继承对齐）。main 启动早期设 `process.env.NOVEL_EVENT_NAMESPACE ??= String(process.pid)`；ns 未设置时不拼（单进程/测试行为不变）。
  - 输出：任意数量实例的事件管道互不冲突；双实例均正常启动。
  - 异常：用户显式设置 `NOVEL_EVENTS_ADDR` 双开仍会撞地址——该 env 语义收窄为"单实例调试用"，代码注释注明。
- 功能点二：同项目进程锁
  - 触发：`workspaceApi.open`（`minimal.ts:720`）在 `locator.resolve` 之后、`rebindWorkspace` 之前。
  - 输入：storeDir（`userData/novel-storage/<父目录>-<项目名>--<hash8>`）。
  - 处理：新增 `core/src/node/workspace/WorkspaceDirLock.ts`：`openSync(<storeDir>/workspace.lock, "wx")` 原子排他创建，内容 `{pid, workspaceId, workspaceRoot, acquiredAt}`；已存在则读 pid 用 `process.kill(pid, 0)` 探活——活着（含 EPERM）返回占用（带持有者 pid）；已死（ESRCH）删除锁文件重试一次（防崩溃残留）。释放时机与锁获取点对称：`rebindWorkspace(undefined)`（关闭/切换，先释放旧锁再取新锁）与 `will-quit`（`minimal.ts:569`）。锁随 core 落地以复用 node 单测。
  - 输出：同项目同一时刻仅一个实例持有；持有实例退出（含切换走）后锁自动让出。
  - 异常：pid 被系统复用导致误判"活着"（概率极低）→ 错误文案给出锁文件路径，用户可手删自救；锁文件写失败 → open 抛错按现有错误路径展示。
- 功能点三：双开回切已开窗口（失败才报错）
  - 触发：锁被占用且持有进程存活时。
  - 输入：workspaceId（根路径确定性哈希，两实例对同一项目算出同值）。
  - 处理：`topics.ts` 增 `workspaceFocusAddr(workspaceId)` = `ipc://novel-focus-<workspaceId>`。持有侧：open 成功后 bind zeromq `Pair`，收到 `{type:"focus"}` 执行 `mainWindow.isMinimized() && mainWindow.restore(); mainWindow.show(); mainWindow.focus()` 并回 `{type:"focused"}`；生命周期与锁同步释放。挑战侧：connect 发 focus，等 ack ≤500ms 后关闭 socket；收到 ack → open 返回友好提示"该项目已在另一窗口打开，已为你切换到该窗口"；超时 → 抛错"该项目已在另一个窗口打开（进程 <pid>），请切换到该窗口；若确认未打开，可删除 <storeDir>/workspace.lock"。
  - 输出：用户几乎无感地回到已打开该书的前台窗口；持有实例异常（通道不通）时得到明确报错与自救路径。
  - 异常：持有实例僵尸但 pid 活着（窗口无响应）→ 超时报错兜底；Pair 消息丢失 → 同样超时兜底。
- 功能点四：文件菜单"新建窗口"
  - 触发：文件菜单点击"新建窗口"（菜单模板 `minimal.ts:293-305`）。
  - 输入：`process.execPath`、`process.defaultApp`、main 入口路径。
  - 处理：`spawn(process.execPath, args, { detached: true, stdio: "ignore", env })` + `unref()`；args 按 `process.defaultApp` 决定是否携带 main.cjs 路径（兼容 `gui:release` 的 `electron dist/minimal/main.cjs` 与未来打包 exe 形态）。**关键细节：env 中删除 `NOVEL_EVENT_NAMESPACE`**（否则新实例继承父实例命名空间，会话事件管道跨实例撞名）；手动双击 exe 的第二实例天然无继承、不受影响。新实例不自动恢复项目（现状设计），显示项目选择页。
  - 输出：出现第二个独立 GUI 窗口（独立进程），任务栏两个入口。
  - 异常：spawn 失败 → console.warn，不影响当前实例。
- 功能点五：最近项目注册表合并写（防多实例互踩）
  - 触发：`saveRegistry()`（`minimal.ts:623`）。
  - 输入：本实例内存中的 `registryEntries`。
  - 处理：写前重读磁盘 `workspaces.json`，按 workspaceId 合并（lastOpenedAt 新者胜）后写回，将两实例并发登记的条目收敛。
  - 输出：任一实例的"最近项目"列表不因另一实例写入而丢条目。
  - 异常：读失败（损坏/缺失）→ 按现状空表处理写本实例条目。
- 功能点六：附带加固两处（本次触碰区域的相邻缺陷，小改）
  - `rebindLibraryService`（`minimal.ts:445`）重建前 `libraryService.close()`，修 Windows 下 book.db 只读句柄泄漏（多次切换项目累积锁定）。
  - `SqliteNovelStore` 构造后执行 `PRAGMA busy_timeout = 3000`：两实例并发触发完本解析写共享 `library/book.db`（已 WAL）时等待重试而非抛 SQLITE_BUSY。
- 功能点七：打开位置选择（当前窗口 / 新窗口）与新实例启动自动打开
  - 触发：已有项目打开时，应用内"打开项目"对话框（`WorkspaceSelectionDialog`）选定项目（目录选择器或最近列表）后。
  - 输入：待打开的工作区引用（目录路径或最近项 workspaceId）。
  - 处理：对话框改两步式——选定后弹出选择面板 **[在当前窗口打开] [在新窗口打开] [取消]**，附提示"当前窗口打开会结束本项目全部运行中的对话；新窗口打开保持本窗口不动"。
    - 当前窗口：`WorkspaceController.open`（既有 rebind 切换语义，不变）。
    - 新窗口：`workspaceApi.openInNewWindow`（校验同 open，**不取锁不切换本实例**）→ `spawnNewGuiInstance(root)`：子进程 env 注入 `NOVEL_OPEN_WORKSPACE=<root>`。新实例启动时立即从 `process.env` 摘取该值（防向会话子进程/孙实例传播）并加入 open 白名单（来源为他实例用户经原生选择器/注册表的授权），renderer 经 `takeStartupWorkspace`（取出即清，防 StrictMode 双挂载重复打开）取走后走完整 open 流程——含同项目双开锁与焦点回切；若项目已被第三实例持有，新实例欢迎页显示双开提示且持有窗口被拉到前台，不崩溃。
    - `spawnNewGuiInstance` 派发 env 同时剔除 `NOVEL_EVENT_NAMESPACE` 与 `NOVEL_OPEN_WORKSPACE`（后者随后按需显式写入），防跨代传播。
    - 顺带修复：`WorkspaceController.openReference` 原先吞掉底层错误 message 换通用文案（双开提示实际不可见）——改为优先透传 `error.message`（kkrpc 保真远端 message），空/非 Error 回退通用文案。
  - 输出：当前窗口切换（原行为）或新窗口自动打开所选项目且本窗口不动；失败文案（双开提示等）直达 UI。
  - 异常：`openInNewWindow` 端口缺省报 `WORKSPACE_NEW_WINDOW_UNAVAILABLE`；派发失败（未授权引用等）报底层文案；新实例启动自动打开失败走欢迎页 error 态。
  - 边界：欢迎页（无当前项目）保持直达打开不加选择；菜单"新建窗口"保持无上下文 spawn（显示项目选择页）。
- 功能点八：切换目标过滤当前项目 + 已打开弹窗告知 + 新窗口独立弹到前台
  - 触发：已开项目时应用内"打开项目"对话框的列表与打开动作；"在新窗口打开"派生新实例。
  - 输入：最近列表 / 待打开引用。
  - 处理：
    - **过滤当前项目**：切换对话框"最近打开"渲染层排除 `snapshot.current`（id 为主、rootPath 兜底），过滤后为空显示"没有其他可切换的项目"；欢迎页（无 current）不受影响。
    - **已打开弹窗告知**（`dialog.showMessageBox` info 型，不受 renderer 覆盖层状态影响）：① `open` 锁被本进程持有且即当前项目（目录选择器手动选回）→ 幂等成功（不 rebind，更新 lastOpenedAt）+ 弹窗"《label》已在当前窗口打开"；② 被他实例持有且焦点回切应答 → 弹窗"《label》已在另一窗口打开，已为你切换到该窗口"后照旧抛错（对话框保持打开时错误区可见原因）；③ `openInNewWindow` 派发前经 `WorkspaceDirLock.inspect` 只读探测——已被活进程持有则不 spawn，置前持有窗口 + 按持有者（本窗口/他实例）分别弹窗，短路返回成功。
    - **新窗口独立弹到前台**：带启动上下文的派生实例窗口**级联偏移定位**（primary workArea + 48px，不再与原窗口完全重叠），创建后短暂 alwaysOnTop → show → 取消 → focus 强制前台（绕过 Windows SetForegroundWindow 前台锁，防 detached 子进程被压底不可见）。
    - **对话框失败不即关**：NovelApp 中 `open`/`openInNewWindow` 成功（含幂等/短路成功）才收起对话框，失败保持打开显示透传文案。
    - 新增 `WorkspaceDirLock.inspect(storeDir)`：只读探测（holderPid + 存活 + lockPath；无锁/损坏返回 undefined），不获取不改动。
  - 输出：切换列表不再出现当前书；已打开项目再点击有明确弹窗反馈且持有窗口置前；新窗口可见地独立弹出。
  - 异常：焦点通道超时（持有实例卡死）→ 派发侧短路按"未持有"处理 spawn（新实例 open 时再兜底报错）；幂等分支的残留自锁（root 不一致）→ 释放守卫重取。
  - 边界：任务栏两实例仍归组同一图标（Windows 默认，同 Word 多文档），不改 AppUserModelID（打包后需保持归组支持固定到任务栏）。
- 功能点九：splash 启动遮罩 + 引导标记跨实例持久化
  - 触发：任意启动路径（首启 / 手动双开 / "在新窗口打开"派生实例）。
  - 输入：无（启动流程内置）。
  - 处理：
    - **splash**：`whenReady` 后立即创建（420×260 frameless、不可拖动/聚焦、skipTaskbar、alwaysOnTop，原生 backgroundColor 置底色），加载内联 data: URL 品牌页（"Novel" 字标 + 加载条 + "正在启动…"）；主窗口改 `show: false` + `backgroundColor: "#faf9f6"`（≈ tokens 默认浅色主题 `--color-bg`），`ready-to-show`（本地页首帧绘制完成）才 reveal（派生实例的前台强制从创建时机移至 reveal）并销毁 splash；20s 兜底定时器防加载异常 splash 悬挂，reveal 幂等。
    - **引导标记**：完成标记由 renderer localStorage（多实例共享 userData 下 LevelDB 快照互不可见，第二实例每次重复弹引导）改为主进程文件 `userData/onboarding.json`，经 `workspaceApi.getOnboardingDone/markOnboardingDone` 读写；ui 侧 NovelApp 新增可选 `onboardingPort`（isCompleted/markCompleted）——判定链：端口已完成 → 不弹；端口未完成但 localStorage 已完成 → 补写文件迁移后不弹；端口异常/未提供（测试与他宿主）→ 回退 localStorage；都无记录 → 弹。向导关闭（完成/跳过/ESC/X）localStorage 与主进程文件双写。
    - **事件 socket 落点迁移**：`ipc://` 地址在本机映射为 Unix domain socket 文件，原先的相对路径名（`novel-events-<pid>` 等）落在进程 CWD（gui/ 仓库目录），不干净退出残留污染（实测已积累 6 个 focus + 十余个 conversation 残留）。`topics.ts` 统一改派生 `<tmpdir>/novel-*` 绝对路径——干净关闭由 zeromq 自动删除、残留由 OS 兜底清理、同名重绑不受残留影响（已实测）。旧实例（CWD 相对地址）与新实例（tmpdir 地址）过渡期焦点回切会失联一次（回退报错文案），旧实例重启后对齐。
    - **页内启动占位 + 启动计时日志**（修"reveal 后仍 3-4s 全白"）：`ready-to-show` 只等空 HTML 首帧——React 挂载完成前 reveal 的窗口是纯白底（实测 cold 启动 bundle 求值 + mount 可达 1-3s）。`minimal.html` 内联同款品牌占位（React createRoot 首次 commit 清空 #root 子节点，占位与首帧 UI 同 commit 替换，无接缝）；main 侧增 `[boot]` 计时链（app ready / splash / window created / loadFile / dom-ready / ready-to-show / revealed，相对 main() 进入的毫秒数），renderer 增里程碑（modules evaluated / root render start / app mounted，console.info 经 console-message 桥按 `[boot]` 前缀转发并附毫秒）。实测（温启）：reveal(+2196ms) 晚于 mount(+1226ms)——splash 直达完整 UI；冷启/慢机 reveal 早于 mount 时由页内占位覆盖，结构性消除白屏。
  - 输出：启动全程无白屏（splash → 首帧就绪的主窗口）；引导只在真正首次使用时弹一次，任何实例完成即全局生效。
  - 异常：标记文件读写失败 → 回退 localStorage 行为（同实例不重弹）；splash 兜底 20s 后强制 reveal。
  - 边界：splash/主窗口底色取默认浅色主题色——深色主题用户启动瞬间有浅色 splash → 深色界面的短暂过渡（主进程读不到 renderer 的主题选择），仍优于纯白屏。

## 5. 边界与非目标

- 明确不做：
  - 单进程多窗口（main 进程"当前项目"单例全面会话化，改造量约为本方案 3-5 倍；本期的命名空间/数据隔离为其铺路，后续另立 PRD）。
  - 允许同项目双开（含"只读模式双开"）：锁一律拒绝；不做 WAL 化工作区库、跨进程会话编号协调等并发加固。
  - `config.json` 多实例并发写控制（两实例同时改设置窗口极小，维持单写者假设，代码注释注明）。
  - 打开项目时自动恢复上次活跃项目（维持现状：显示项目选择页）。
  - Windows 之外的 `ipc://` 地址回归测试（Linux/macOS 由 CI/后续覆盖）。

## 6. 验收标准

- [x] 单测：WorkspaceDirLock——首次获取成功；占用中二次获取被拒（伪造存活 pid）；持有 pid 已死时锁回收重试成功。
- [x] 单测：`novelEventsAddr()` 默认带 pid、env 覆盖生效；`conversationEventsAddr` 有/无 `NOVEL_EVENT_NAMESPACE` 两种形态。
- [ ] 双实例冒烟：实例 A 开项目1 → 菜单"新建窗口"起实例 B → B 开项目2，两窗口各自发起对话、输出流均正常（命名空间隔离生效），任一窗口关掉另一窗口不受影响。（启动冒烟已过：双实例并存无崩溃、无 bind 冲突，交互流待人工验收）
- [ ] 双开回切冒烟：B 再开项目1 → A 窗口自动置前（含 A 最小化时 restore）→ B 显示"已切换"提示；A 拔掉/卡死场景（模拟通道超时）→ B 得到含 pid 与删锁路径的报错。
- [ ] 锁生命周期冒烟：A 关闭项目1（或退出应用）后 B 可正常打开项目1；A 切换到项目3 后项目1 立即可被 B 打开。
- [ ] 注册表冒烟：A、B 交替打开不同项目后，两边"最近项目"列表条目齐全无丢失。
- [x] core typecheck+test（750/750）、ui check+test（408/408）、全仓构建 + 双实例启动冒烟通过（2026-08-20，Windows）。
- [x] 单测：WorkspaceController——pick 仅选择不打开（相位回落可交互）、open/openInNewWindow（成功派发不动 current / 端口缺省 / 失败透传文案）、openStartupWorkspace（有则打开/取出即清/无端口静默）、open 错误 message 透传（2026-08-20）。
- [x] 单测：WorkspaceSelectionDialog——选定目录后出现打开位置面板、新窗口/当前窗口分别派发对应回调、最近项进面板、取消清面板（2026-08-20）。
- [x] 单测：`WorkspaceDirLock.inspect`——无锁/损坏/活 pid/死 pid 四态，只读不改动；切换对话框过滤当前项目（id/rootPath 双匹配 + 空态文案）（2026-08-20）。
- [x] 单测：NovelApp 引导门控——端口已完成不弹 / 端口未完成 + localStorage 已完成迁移补写不弹 / 都无记录弹（2026-08-20）。
- [ ] 功能点九冒烟：启动先见品牌 splash（无白屏）→ 主窗口首帧就绪后 splash 消失；完成一次引导后 spawn 第二实例 → 不再弹引导且 `userData/onboarding.json` 内容正确。
- [ ] 功能点八冒烟：对话框"最近打开"不含当前项目；A 对 B 持有的项目"在新窗口打开"→ 不 spawn、B 置前、A 弹窗告知；目录选择器手动选回当前项目 → 幂等 + 弹窗"已在当前窗口打开"；新窗口以 48px 级联偏移出现在前台并自动打开。
- [ ] 功能点七冒烟：A 开项目1 → 应用内"打开项目"→ 选项目2 →"在新窗口打开"→ 新实例自动打开项目2 且 A 保持项目1；同流程选"在当前窗口打开"→ A 切换（原会话终止）；新实例启动自动打开失败（双开）时欢迎页显示提示。（spawn 上下文主链路已冒烟：env 派发 → 启动摘取 → 自动 open → 锁落盘，见功能点七）

## 7. 开放问题

- 焦点回切 ack 超时 500ms 是否够（跨进程 Pair 建连 + 窗口操作）？可先 500ms，实测调整。
- 锁持有 pid 被系统复用误判"活着"的兜底：仅靠报错文案给删锁路径是否足够？v1 不做 pid 起始时间比对。
- ~~"新建窗口"入口是否需要同时在欢迎页/切换对话框露出按钮？~~ 已由功能点七解决：切换对话框选定项目后选择"在新窗口打开"；欢迎页（无当前项目）保持直达打开。
- 提示与报错文案措辞（"已为你切换到该窗口"等）是否符合产品语气，实施时以现网文案风格微调。
- 主题选择（`novel.theme`）仍是 localStorage：多实例下第二实例可能回落默认主题（LevelDB 快照互不可见，同引导标记问题）；如用户反馈明显再按功能点九同款"主进程文件 + 端口"模式迁移。
