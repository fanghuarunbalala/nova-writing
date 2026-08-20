/**
 * 最小 Electron 入口：node 宿主装配（sqlite novel + 子进程 conversation + 门面），经 kkrpc/electron 暴露给 renderer。
 * - novel：SqliteNovelStore 落盘（userData/novel.db）
 * - conversation：spawnConversation 走子进程（desktop-child.mjs，真实 provider）；createOrResume 回退内存回显 loop
 */
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { expose, proxy, wrap, type RPCMessage } from "kkrpc/remote-refs";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  Conversation,
  ConversationManagerServer,
  EventPublisher,
  EventSubscriber,
  FileConversationJournalService,
  CONVERSATION_OUTPUT,
  conversationEventsAddr,
  NOVEL_CHANGED,
  NOVEL_EVENTS_ADDR,
  SqliteNovelStore,
  deriveChangeEntities,
  ConfigServer,
  createNovelApiServer,
  createProcessSpawner,
  BookImportService,
  createLibraryFace,
  LibraryService,
  electronIpcTransport,
  startConversationManagerWsServer,
  startNovelDbWsServer,
  type AgentLoop,
  type AnalystConversationSpawner,
  type ConversationApprovalDecision,
  type ConversationApprovalRequest,
  type ConversationJournalService,
  type CredentialCipher,
  resolveRuntimeAgents,
  serializeSkillsEnv,
  listSkills,
  PROJECT_SKILLS_DIR_NAME,
  serializeMcpEnv,
  testMcpConnection,
  createConsoleLogger,
  infoLog,
  type LLMessage,
  type NovelStore,
  type LoopEvent,
  type RunContext,
} from "@novel/core";
import { NodeApplicationConfigStore, NodeConfigHomeResolver, NodeWorkspaceStoreLocator, seedBuiltinSkills } from "@novel/core/node";
import {
  DesktopDesignFileService,
  DesktopDesignIpcController,
  type DesignIpcMain,
} from "./desktop/design/index.js";

// 双构建流程布局兼容（两条流程都受现役启动命令使用）：
// - build-minimal.mjs（根 gui:release / gui:debug）：esbuild CJS 打包到
//   dist/minimal/main.cjs，preload/renderer 同目录；CJS 下 __dirname 原生
//   可用、import.meta 被垫为空对象（fileURLToPath(import.meta.url) 必崩；
//   esbuild 的 import.meta 警告属预期——运行时被 typeof 短路不执行）；
// - gui pnpm build（tsc NodeNext ESM）：main 在 dist/main/、preload 在
//   dist/preload/、renderer 在 dist/minimal/；ESM 下无 __dirname。
// 按「文件实际存在」探测布局，两流程通用；childScript 两种布局同表达式
// （上三级到项目根再进 core/scripts），不变。
const baseDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
const preloadPath = existsSync(join(baseDir, "preload.cjs"))
  ? join(baseDir, "preload.cjs")
  : join(baseDir, "..", "preload", "preload.cjs");
const rendererHtml = existsSync(join(baseDir, "minimal.html"))
  ? join(baseDir, "minimal.html")
  : join(baseDir, "..", "minimal", "minimal.html");
const childScript = join(baseDir, "..", "..", "..", "core", "scripts", "desktop-child.mjs");
/** 内置技能根（gui/resources/builtin-skills；启动时预装到 userData/skills，已存在跳过） */
const builtinSkillsRoot = join(baseDir, "..", "..", "..", "gui", "resources", "builtin-skills");
const IPC_CHANNEL = "novel-rpc";
const CONFIG_CHANNEL = "config-rpc";
const WORKSPACE_CHANNEL = "workspace-rpc";
const UI_CHANNEL = "ui-rpc";
/** 会话事件火线裸推通道（main → renderer 单向 webContents.send；preload 同名白名单） */
const CONVERSATION_EVENTS_CHANNEL = "conversation-events";

/**
 * 回显 AgentLoop：followup 即时开 run 产 run-start/user.message → assistant.delta×N →
 * assistant.message/run-end → journal 快照落盘（验证流式链路 + journal 语义，无需真实 provider）。
 * 文本含「审批」时经 requestApproval 阻塞等 UI 决策（验证审批域端到端）。
 * 不发 reasoning delta（loop 层已丢弃，见 docs/PRD/gui-performance.md）。
 */
function createEchoLoop(
  conversationId: string,
  journal?: ConversationJournalService,
  requestApproval?: (req: ConversationApprovalRequest) => Promise<ConversationApprovalDecision>,
): AgentLoop {
  let seq = 0;
  const listeners = new Set<(e: LoopEvent) => void>();
  const emit = (e: LoopEvent): void => {
    for (const l of listeners) l(e);
  };
  const now = () => new Date().toISOString();
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  return {
    run: async () => ({ final: { role: "assistant" as const, content: "" }, usage: undefined }),
    followup: (text: string) => {
      // 即时开 run（seq 按输入时序）+ user 消息快照落盘 = 输入 rpc 的持久化回执
      const messages: LLMessage[] = [{ role: "user", content: text }];
      const run: RunContext = {
        seq: ++seq,
        messages,
        ts: now(),
        appendRunMessages: (m) => {
          messages.push(...m);
        },
      };
      emit({ type: "run-start", persist: true, seq: run.seq, runSeq: run.seq, conversationId, ts: now() });
      emit({ type: "user.message", persist: true, seq: run.seq, text, conversationId, ts: now() });

      // 审批路径：阻塞等 UI 决策（sendApprovalRequest 会发 approval.request 事件），
      // 决策回传后按结果收口（approval.resolved 事件由 Conversation 发出）
      if (text.includes("审批") && requestApproval !== undefined) {
        void requestApproval({
          requestId: `approval:${conversationId}:${run.seq}:b1`,
          toolCalls: [
            {
              toolCallId: `echo_${run.seq}`,
              toolName: "CharacterWrite",
              args: JSON.stringify({ values: [{ name: text.replace("审批", "苏眉").trim() || "苏眉" }] }),
            },
          ],
        })
          .then((decision) => {
            const reply = decision.kind === "approve" ? "（回声）已批准" : "（回声）已拒绝";
            messages.push({ role: "assistant", content: reply });
            emit({ type: "assistant.message", persist: true, seq: run.seq, text: reply, conversationId, ts: now() });
            emit({ type: "run-end", persist: true, seq: run.seq, runSeq: run.seq, conversationId, ts: now() });
            void journal?.appendRun(run);
          })
          .catch(() => {
            // 决策通道异常：收口失败回复，避免 run 悬挂
            const reply = "（回声）审批决策通道异常";
            messages.push({ role: "assistant", content: reply });
            emit({ type: "assistant.message", persist: true, seq: run.seq, text: reply, conversationId, ts: now() });
            emit({ type: "run-end", persist: true, seq: run.seq, runSeq: run.seq, conversationId, ts: now() });
            void journal?.appendRun(run);
          });
        return run;
      }

      // 异步排程发射（避免同步批量发完导致 generating 状态对 UI 不可见：
      // React 批量渲染只呈现最终快照；真实 provider 是秒级流不受影响，echo 演示需人工间隔）
      void (async () => {
        // 文本含「正文」时追加示例小说正文（```novel 块），验证正文草稿面板：
        // fence 打开即出现面板 + 闪烁光标，流式填充，完成后显示「复制正文」
        // （思考态已在 C2 移除，不再发 reasoning delta）
        const demoNovel = text.includes("正文")
          ? "\n\n```novel\n沈砚站在地下室的台阶上，手里的手电筒光柱晃了晃。他听见风从墙缝里钻进来的声音，像是什么人在远处叹气。\n\n他数着自己的脚步。七级台阶。墙面是青灰色的砖，砖缝里生着苔藓。但右手边的墙壁上，有一块砖的颜色比周围的都要浅。他伸出手，指腹贴上去，凉的。\n```"
          : "";
        const reply = `（回声）${text}${demoNovel}`;
        for (const ch of reply) {
          emit({ type: "assistant.delta", kind: "text", text: ch, conversationId, ts: now() });
          await sleep(24);
        }
        messages.push({ role: "assistant", content: reply });
        emit({ type: "assistant.message", persist: true, seq: run.seq, text: reply, conversationId, ts: now() });
        emit({ type: "run-end", persist: true, seq: run.seq, runSeq: run.seq, conversationId, ts: now() });
        // 同 seq 重写：assistant 完整快照（与真实 loop 的 journalListener 语义一致）
        void journal?.appendRun(run);
      })();
      return run;
    },
    steer: () => {},
    stop: () => {},
    cancel: () => {},
    onOutputEvent: (l: (e: LoopEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as AgentLoop;
}

/**
 * 从 config 默认 model profile 解析 provider 连接并写入 process.env（子进程 spawn 经 env 继承）。
 * 设置页保存 key 后重启生效（conversation 模式在启动时决定）。
 */
async function applyDefaultProviderEnv(configStore: NodeApplicationConfigStore): Promise<void> {
  const snapshot = await configStore.get();
  const profile =
    snapshot.profiles.find((p) => p.id === snapshot.defaultProfileId) ?? snapshot.profiles[0];
  if (profile === undefined) return;
  const apiKey = await configStore.resolveSecret(profile.credentialRef);
  if (apiKey === undefined) return;
  process.env.NOVEL_PROVIDER_API_KEY = apiKey;
  process.env.NOVEL_PROVIDER_TYPE = profile.provider;
  process.env.NOVEL_PROVIDER_MODEL = profile.model;
  if (profile.baseUrl !== undefined) process.env.NOVEL_PROVIDER_BASE_URL = profile.baseUrl;
  infoLog(`[main] provider resolved from config: ${profile.provider}/${profile.model}`);
}

/**
 * Agent 运行参数（档位/采样/压缩/能力）解析为 NOVEL_RUNTIME_SETTINGS env。
 * 配置每次变更后重写（onMutated）：下一个 spawn 的对话生效，运行中对话维持启动时快照。
 */
async function applyRuntimeEnv(configStore: NodeApplicationConfigStore): Promise<void> {
  await applyDefaultProviderEnv(configStore);
  const snapshot = await configStore.get();
  if (snapshot.profiles.length === 0) {
    delete process.env.NOVEL_RUNTIME_SETTINGS;
    return;
  }
  const resolved = await resolveRuntimeAgents(snapshot, (ref) => configStore.resolveSecret(ref));
  process.env.NOVEL_RUNTIME_SETTINGS = JSON.stringify(resolved);
  infoLog(`[main] runtime settings resolved: ${Object.keys(resolved.agents).join(",")}`);
}

/**
 * 技能装载设置解析为 NOVEL_SKILLS_SETTINGS env（应用级技能根目录 + 禁用名单；
 * 项目级目录 = <workspace>/skills 由子进程派生）。同 onMutated 重写语义。
 */
async function applySkillsEnv(
  configStore: NodeApplicationConfigStore,
  appSkillsRoot: string,
): Promise<void> {
  const snapshot = await configStore.get();
  process.env.NOVEL_SKILLS_SETTINGS = serializeSkillsEnv({
    appSkillsRoot,
    disabled: [...(snapshot.skillsDisabled ?? [])],
  });
}

/**
 * MCP 服务器解析为 NOVEL_MCP_SERVERS env（仅 enabled 项；子进程 spawn 时连接）。
 * 同 onMutated 重写语义。
 */
async function applyMcpEnv(configStore: NodeApplicationConfigStore): Promise<void> {
  const snapshot = await configStore.get();
  const servers = [...(snapshot.mcpServers ?? [])];
  if (servers.length === 0) {
    delete process.env.NOVEL_MCP_SERVERS;
    return;
  }
  process.env.NOVEL_MCP_SERVERS = serializeMcpEnv(servers);
}

/** manager：providerLive（启动时凭据已解析）spawnConversation 走子进程（真实 provider，novel-db 经 kkrpc/ws）；否则回退内存回显 loop */
function createManager(
  conversationsRoot: () => string | undefined,
  workspaceProvider: () => string | undefined,
  transports: {
    managerWs: { url: string; token: string; onConnected: Parameters<typeof createProcessSpawner>[1]["managerWs"]["onConnected"] };
    novelWs: { url: string; token: string };
  },
  providerLive: boolean,
): ConversationManagerServer {
  // server 先声明：内存模式 factory 的 managerWait 需闭包引用（进程内直连同一队列）
  let server: ConversationManagerServer | undefined;
  // gui main 无 pino 落盘：console Logger 接审批/mode 关键链路埋点（JSON 行，与 pino 同构）
  const logger = createConsoleLogger();
  const factory = {
    create: (o: { conversationId: string }) => {
      // 回显模式同样落盘：与子进程 journal 语义一致（history/回执互认）。
      // 审批触发经 conv 自引用：requestApproval → conv.sendApprovalRequest（无阻塞提交 + 驻留等待）
      // journal 根随 workspace 热重绑，每次创建时现取（未开工作区时不落盘）
      const root = conversationsRoot();
      const journal =
        root !== undefined
          ? new FileConversationJournalService({
              conversationId: o.conversationId,
              filePath: join(root, o.conversationId, "journal.jsonl"),
            })
          : undefined;
      void journal?.open();
      let conv: Conversation | undefined;
      const loop = createEchoLoop(o.conversationId, journal, (req) =>
        conv!.sendApprovalRequest(req),
      );
      conv = new Conversation({
        conversationId: o.conversationId,
        loop,
        sampling: { model: "echo" },
        journal,
        logger,
        // 内存模式：wait 提交走进程内 CMS 队列（与子进程同路由）；超时仅解除等待不退出
        managerWait: {
          submitApproval: (id, req) => server!.submitApprovalRequest(id, req),
          submitAsking: (id, req) => server!.submitAskingRequest(id, req),
          submitExitCompose: (id, req) => server!.submitExitComposeRequest(id, req),
        },
      });
      return conv;
    },
  };
  const spawner = providerLive
    ? createProcessSpawner(childScript, {
        managerWs: {
          url: transports.managerWs.url,
          token: transports.managerWs.token,
          onConnected: transports.managerWs.onConnected,
        },
        novelWs: transports.novelWs,
      })
    : undefined;
  server = new ConversationManagerServer(factory, spawner, {
    // 启动时无工作区：不扫描；open() 时经 rescope 重绑 <storeDir>/conversations
    storedirRoot: conversationsRoot(),
    workspaceProvider,
    logger,
  });
  return server;
}

// 崩溃兜底：main 进程任何未捕获异常/未处理 rejection 先留完整痕迹再退出
// （此前无此 handler 时崩溃只剩 exit 1 + 一行裸 undefined，无法定位）
process.on("uncaughtException", (e) => {
  console.error("[main] uncaught exception:", e);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandled rejection:", reason);
  process.exit(1);
});

async function main(): Promise<void> {
  await app.whenReady();

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "文件", submenu: [{ role: "quit", label: "退出" }] },
      {
        label: "编辑",
        submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }],
      },
      {
        label: "视图",
        submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
      },
    ]),
  );

  // novel 库随 workspace 热重绑（<storeDir>/novel.db，open/close 时切换）：
  // publishingStore 对象身份恒定（novel WS 子进程通道与 serverApi 不重建），内部委托当前库
  let currentNovelStore: SqliteNovelStore | undefined;
  const requireNovelStore = (): NovelStore => {
    if (currentNovelStore === undefined) throw new Error("未打开工作区（novel store 未初始化）");
    return currentNovelStore;
  };

  // novel.changed 广播：ZeroMQ PUB/SUB（mutate 成功 → publish；订阅 → rpc 通知 renderer 刷新）。
  // 派生规则：级联删除波及其他实体（如 storyUnit.delete 删段落）时补发对应实体事件。
  const novelLogger = createConsoleLogger();
  const novelPublisher = new EventPublisher(NOVEL_EVENTS_ADDR);
  await novelPublisher.bind();
  const publishingStore: NovelStore = {
    query: (q) => requireNovelStore().query(q),
    mutate: async (m) => {
      const result = await requireNovelStore().mutate(m);
      const entities = deriveChangeEntities(m, result);
      for (const entity of entities) {
        novelPublisher.publish(NOVEL_CHANGED, {
          type: "novel.changed",
          op: m.op,
          entity,
          id: result.changeId,
          version: result.version,
          ts: new Date().toISOString(),
        });
      }
      novelLogger.info("novel_db.mutated", { op: m.op, id: result.changeId, entities: entities.join(",") });
      return result;
    },
    // 批内原子：整批成功才逐项广播（失败回滚不广播）
    mutateBatch: async (ms) => {
      const results = await requireNovelStore().mutateBatch(ms);
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i]!;
        const result = results[i]!;
        for (const entity of deriveChangeEntities(m, result)) {
          novelPublisher.publish(NOVEL_CHANGED, {
            type: "novel.changed",
            op: m.op,
            entity,
            id: result.changeId,
            version: result.version,
            ts: new Date().toISOString(),
          });
        }
      }
      return results;
    },
  };
  // 会话存储根随 workspace 重绑（<storeDir>/conversations；未开工作区时 undefined）
  let currentJournalDir: string | undefined;

  // config：JSON 文件持久化（凭据暂明文，safeStorage cipher 后续接）
  const configHome = new NodeConfigHomeResolver(app.getPath("userData"));
  const plaintextCipher: CredentialCipher = {
    encrypt: async (secret) => secret,
    decrypt: async (ciphertext) => ciphertext,
  };
  const configStore = new NodeApplicationConfigStore({
    filePath: join(configHome.resolve(), "config.json"),
    cipher: plaintextCipher,
    // 配置变更 → 重写运行参数 env（新对话生效；回调失败不影响变更本身）
    onMutated: () => {
      applyRuntimeEnv(configStore).catch((e) => {
        infoLog(`[main] runtime env re-apply failed: ${e instanceof Error ? e.message : String(e)}`);
      });
      applySkillsEnv(configStore, join(app.getPath("userData"), "skills")).catch((e) => {
        infoLog(`[main] skills env re-apply failed: ${e instanceof Error ? e.message : String(e)}`);
      });
      applyMcpEnv(configStore).catch((e) => {
        infoLog(`[main] mcp env re-apply failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    },
  });
  await configStore.load();
  // 内置技能预装（builtin-skills → userData/skills；目标已存在跳过——用户编辑/删除优先，
  // 不覆盖不复活）。须在 applySkillsEnv 之前：首次启动先落盘再进 env/清单
  const builtinSeeded = await seedBuiltinSkills(
    builtinSkillsRoot,
    join(app.getPath("userData"), "skills"),
  );
  if (builtinSeeded.some((s) => s.seeded)) {
    infoLog(
      `[main] builtin skills seeded: ${builtinSeeded
        .filter((s) => s.seeded)
        .map((s) => s.name)
        .join(",")}`,
    );
  }
  // provider 运行形态（启动时快照，会话期间不变）：holder 先建、ConfigServer 闭包引用，
  // applyRuntimeEnv 之后赋值——renderer 首次 getRuntimeStatus 远晚于启动完成，值已定型。
  // 设置页据此提示回显模式（provider 修改需重启生效；spawner 在启动时一次决定不补建）
  let providerLive = false;
  // 技能清单扫描（设置页「技能」面板）：应用级 userData/skills + 项目级 <workspace>/skills
  //（workspace 随开合变化，闭包现取；禁用名单以 config 当前值为准）
  const appSkillsRoot = join(app.getPath("userData"), "skills");
  const configServer = new ConfigServer(configStore, {
    runtimeStatus: () => ({ providerLive }),
    skillsList: async () => {
      const snapshot = await configStore.get();
      const workspace = currentWorkspaceRoot;
      return listSkills({
        appRoot: appSkillsRoot,
        ...(workspace !== undefined
          ? { projectRoot: join(workspace, PROJECT_SKILLS_DIR_NAME) }
          : {}),
        disabled: [...(snapshot.skillsDisabled ?? [])],
      });
    },
    // MCP 测试连接（main 进程临时连接：initialize + tools/list，8s 超时）
    testMcp: (input) => testMcpConnection(input),
  });

  // provider 配置：默认 model profile 的凭据解析为子进程 env（NOVEL_PROVIDER_*） +
  // Agent 运行参数（NOVEL_RUNTIME_SETTINGS）+ 技能装载（NOVEL_SKILLS_SETTINGS）。
  // 设置页保存后经 onMutated 重写，对新 spawn 的对话生效（运行中对话维持启动时快照）。
  await applyRuntimeEnv(configStore);
  await applySkillsEnv(configStore, join(app.getPath("userData"), "skills"));
  await applyMcpEnv(configStore);
  providerLive = process.env.NOVEL_PROVIDER_API_KEY !== undefined;

  // novel-db WS：conversation 子进程经 kkrpc/ws + token 访问 canonical store（协议定稿 transport）
  const novelWs = await startNovelDbWsServer({ store: publishingStore, token: randomUUID() });

  // manager WS（conversation ↔ CMS 单连接双工；manager 与服务端互依 → holder）
  const managerHolder: { manager?: ConversationManagerServer } = {};
  const managerWs = await startConversationManagerWsServer({
    manager: () => managerHolder.manager!,
    token: randomUUID(),
  });

  // 当前工作区根路径（spawn 时经 env 注入子进程，agent 文件工具落点）
  let currentWorkspaceRoot: string | undefined;
  const manager = createManager(() => currentJournalDir, () => currentWorkspaceRoot, {
    managerWs: {
      url: managerWs.url,
      token: managerWs.token,
      onConnected: (listener) => managerWs.onConversationConnected(listener),
    },
    novelWs: { url: novelWs.url, token: novelWs.token },
  }, providerLive);
  managerHolder.manager = manager;
  // wait 队列变化 → 通知 renderer（Phase B 接线 onApprovalsChanged；此处留 hook）
  const uiNotifyHolder: { notify?: () => void } = {};
  manager.onWaitChange(() => {
    uiNotifyHolder.notify?.();
  });
  // ── 书库（完本解构，PRD library-完本解构）：全局书库根 + 工作区书单热重绑 ──
  // libraryRoot 跨工作区唯一（env 可覆盖；设置界面后续迭代）；BookAnalyst 解析会话经
  // CMS spawnConversation 派生（task/extraEnv 契约直接适配），analyst journal 需已开工作区。
  const libraryRoot = process.env.NOVEL_LIBRARY_ROOT ?? join(app.getPath("userData"), "library");
  mkdirSync(libraryRoot, { recursive: true });
  let libraryService = new LibraryService({ libraryRoot });
  // 解析进度 journal 信号：spawn 时记录 bookId → conversationId（storedir = storedirRoot/<cid>）
  const analystConversationOf = new Map<string, string>();
  const analysisSpawner: AnalystConversationSpawner = {
    spawn: (opts) => {
      const bookId = (opts.task as { bookId?: string } | undefined)?.bookId;
      return manager.spawnConversation(opts).then((ref) => {
        if (bookId !== undefined) analystConversationOf.set(bookId, ref.conversationId);
        return { conversationId: ref.conversationId };
      });
    },
  };
  /** 解析会话 journal 路径（Read 分段调用 = 确定性进度信号；未知/未落盘返回 undefined 静默降级） */
  const analysisJournalPathOf = (bookId: string): string | undefined => {
    const cid = analystConversationOf.get(bookId);
    const root = currentJournalDir;
    return cid === undefined || root === undefined ? undefined : join(root, cid, "journal.jsonl");
  };
  /** 解析会话可用：provider env 已就绪（applyDefaultProviderEnv）且已打开工作区 */
  const canSpawnAnalysis = (): boolean =>
    (process.env.NOVEL_PROVIDER_API_KEY ?? "").trim() !== "" && currentWorkspaceRoot !== undefined;
  /** 书库服务随 workspace 热重绑：open 带 workspaceRoot 走书单过滤；close 回管理侧全集 */
  const rebindLibraryService = (): void => {
    libraryService = new LibraryService({
      libraryRoot,
      ...(currentWorkspaceRoot !== undefined ? { workspaceRoot: currentWorkspaceRoot } : {}),
    });
  };
  // 导入源白名单（pickBookFile 登记；importBook 仅接受白名单路径——同 workspace 引用白名单模式）
  const allowedBookSources = new Set<string>();
  const libraryFace = createLibraryFace({
    service: () => libraryService,
    workspaceRoot: () => currentWorkspaceRoot,
    importer: () =>
      canSpawnAnalysis()
        ? new BookImportService({ service: libraryService, spawner: analysisSpawner, libraryRoot })
        : undefined,
    pickFile: async () => {
      const result = await dialog.showOpenDialog({
        title: "选择完本文本",
        properties: ["openFile"],
        filters: [{ name: "文本文档", extensions: ["txt"] }],
      });
      const path = result.canceled ? undefined : result.filePaths[0];
      if (path === undefined) return null;
      allowedBookSources.add(path);
      return path;
    },
    allowedSources: () => allowedBookSources,
    analysisJournalPath: analysisJournalPathOf,
  });
  infoLog(`[main] library root: ${libraryRoot}`);
  // journalDir 传函数形态：history 代读随 workspace 重绑现取当前会话根
  const serverApi = createNovelApiServer({ manager, novel: publishingStore, proxy, journalDir: () => currentJournalDir, library: libraryFace });

  // 主窗口引用（IPC sender 校验 + 定向发送；窗口创建晚于端点注册）
  let mainWindow: BrowserWindow | undefined;

  // kkrpc/electron 传输端点（main 侧：webContents.send / ipcMain.on）。
  // 安全：入站消息仅接受主窗口 sender（防注入 frame/webview 冒名调用）；
  // 出站定向主窗口（不广播所有窗口，防串窗）
  const endpoint = {
    send: (channel: string, msg: RPCMessage) => {
      const win = mainWindow;
      if (win !== undefined && !win.isDestroyed()) win.webContents.send(channel, msg);
    },
    on: (channel: string, listener: (_event: unknown, msg: RPCMessage) => void) => {
      ipcMain.on(channel, (event, msg) => {
        if (mainWindow === undefined || event.sender !== mainWindow.webContents) return;
        listener(event, msg);
      });
    },
    off: (channel: string, listener: (_event: unknown, msg: RPCMessage) => void) => {
      ipcMain.off(channel, listener);
    },
  };
  expose(serverApi, electronIpcTransport({ endpoint, channel: IPC_CHANNEL }));
  await configServer.start(electronIpcTransport({ endpoint, channel: CONFIG_CHANNEL }));

  // renderer 暴露面（main 直接 rpc 调用：审批/提问队列变化 / novel 数据变更通知）
  const uiApi = wrap<{
    onApprovalsChanged(): Promise<void>;
    onAskingsChanged(): Promise<void>;
    onNovelChanged(change: { entity: string }): Promise<void>;
  }>(
    electronIpcTransport({ endpoint, channel: UI_CHANNEL }),
  );
  uiNotifyHolder.notify = () => {
    void uiApi.onApprovalsChanged().catch(() => {
      // renderer 未就绪/已关窗时忽略
    });
    void uiApi.onAskingsChanged().catch(() => {
      // 同上
    });
  };
  // novel.changed 订阅：ZeroMQ → renderer 通知（拉取为准，通知仅触发刷新）
  const novelSubscriber = new EventSubscriber(NOVEL_EVENTS_ADDR, [NOVEL_CHANGED]);
  await novelSubscriber.connect();
  void (async () => {
    try {
      for await (const message of novelSubscriber) {
        const entity = (message.payload as { entity?: unknown } | null)?.entity;
        if (typeof entity !== "string") continue;
        novelLogger.info("novel_change.forwarded", { entity });
        void uiApi.onNovelChanged({ entity }).catch((err) => {
          // renderer 未就绪/已关窗：可见化失败（此前静默），数据仍由下次 loadWorkspace 兜底
          console.warn("[main] novel.changed 送达 renderer 失败:", err);
        });
      }
    } catch (e) {
      console.error("[main] novel subscriber stopped:", e);
    }
  })();

  // 会话事件火线（gui-performance-2 功能点八）：child 侧每会话一个 ZMQ PUB
  // （ipc://conversation-{id}-events，register 时已 bind）；main 在 register 报到后
  // SUB 接入，逐帧裸转发 renderer（无 kkrpc 远端回调往返）。会话进程退出拆除 SUB。
  const conversationSubscribers = new Map<string, EventSubscriber>();
  manager.onRegistered((conversationId) => {
    if (conversationSubscribers.has(conversationId)) return;
    const subscriber = new EventSubscriber(conversationEventsAddr(conversationId), [CONVERSATION_OUTPUT]);
    conversationSubscribers.set(conversationId, subscriber);
    void (async () => {
      try {
        await subscriber.connect();
        for await (const message of subscriber) {
          const win = mainWindow;
          if (win === undefined || win.isDestroyed()) continue;
          win.webContents.send(CONVERSATION_EVENTS_CHANNEL, message.payload);
        }
      } catch (e) {
        console.error(`[main] conversation subscriber stopped (${conversationId}):`, e);
      }
    })();
  });
  manager.onConversationExited((conversationId) => {
    const subscriber = conversationSubscribers.get(conversationId);
    conversationSubscribers.delete(conversationId);
    if (subscriber !== undefined) void subscriber.close().catch(() => {});
  });

  // 退出前有序关闭：zeromq 原生插件（addon.node）在进程退出时若 socket 未干净拆除会
  // fail-fast（0xC0000409，Event Log 已确认）。will-quit 先 preventDefault，等全部
  // close（含 SUB socket，其关闭令上方 for-await 自然结束）完成后再真正 quit；
  // 2s 兜底超时防 close 悬挂导致应用退不掉。
  let shutdownReady = false;
  app.on("will-quit", (e) => {
    if (shutdownReady) return;
    e.preventDefault();
    shutdownReady = true;
    try {
      currentNovelStore?.close();
    } catch (e2) {
      console.warn("[main] novel store close failed on quit:", e2);
    }
    void Promise.race([
      Promise.allSettled([
        novelPublisher.close(),
        novelSubscriber.close(),
        novelWs.close(),
        managerWs.close(),
      ]),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).finally(() => app.quit());
  });

  // workspace：目录选择器 + 定位器 + 最近列表（workspaces.json 持久化）。
  // 每项目存储根 = storageRoot/<workspaceId>（locator 派生）：novel.db + conversations/ 均落此处，
  // open/close 时热重绑（rebindWorkspace），实现数据库与会话的项目级隔离
  const storageRoot = join(app.getPath("userData"), "novel-storage");
  const locator = new NodeWorkspaceStoreLocator({ storageRoot });
  // 旧全局数据位置（项目隔离引入前）：首个打开的项目一次性继承（move 后原位置清空，幂等）
  const legacyGlobalDbPath = join(app.getPath("userData"), "novel.db");
  const legacyConversationsRoot = join(storageRoot, "conversations");

  interface WorkspaceRegistryEntry {
    workspaceId: string;
    workspaceRoot: string;
    label: string;
    lastOpenedAt: string;
  }
  // 最近工作区注册表：id→root 反查（openRecent 修复）+ 重启恢复（roots 重新入白名单）
  const registryPath = join(app.getPath("userData"), "workspaces.json");
  const registryEntries: WorkspaceRegistryEntry[] = (() => {
    try {
      const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as {
        entries?: WorkspaceRegistryEntry[];
      };
      return Array.isArray(parsed.entries)
        ? parsed.entries.filter(
            (entry) =>
              typeof entry.workspaceId === "string" &&
              typeof entry.workspaceRoot === "string" &&
              typeof entry.label === "string",
          )
        : [];
    } catch {
      return [];
    }
  })();
  const saveRegistry = (): void => {
    try {
      writeFileSync(registryPath, JSON.stringify({ version: 1, entries: registryEntries }), "utf8");
    } catch (e) {
      console.warn("[main] workspaces registry persist failed:", e);
    }
  };

  // 允许 open 的 referenceId 白名单：仅 pickWorkspace（原生目录对话框）返回的路径可设为工作区，
  // 以及注册表中曾经授权过的路径（重启恢复）；渲染进程直传任意路径会被拒绝
  // （防渲染端被污染后把 agent 文件工具指向任意目录）
  const allowedWorkspaceReferences = new Set<string>(registryEntries.map((e) => e.workspaceRoot));

  /** 旧全局数据一次性迁移进首个打开项目的 storeDir（失败跳过，按全新库处理） */
  const adoptLegacyData = (storeDir: string): void => {
    const hasLegacy = existsSync(legacyGlobalDbPath) || existsSync(legacyConversationsRoot);
    if (!hasLegacy) return;
    try {
      // 目录不存在视作空（可继承）；已有项目数据不覆盖
      if (existsSync(storeDir) && readdirSync(storeDir).length > 0) return;
      mkdirSync(storeDir, { recursive: true });
      if (existsSync(legacyGlobalDbPath)) renameSync(legacyGlobalDbPath, join(storeDir, "novel.db"));
      if (existsSync(legacyConversationsRoot)) {
        renameSync(legacyConversationsRoot, join(storeDir, "conversations"));
      }
      infoLog("[main] legacy global data adopted into workspace storeDir");
    } catch (e) {
      console.warn("[main] legacy data adoption failed (start fresh):", e);
    }
  };

  /** 数据库与会话目录随 workspace 重绑：关旧库 → 开新库（<storeDir>/novel.db）→ manager rescope；
   *  storeDir undefined（关闭工作区）= 全部清空回空态。open 返回前完成，渲染端随后 refetch 即新数据 */
  const rebindWorkspace = async (storeDir: string | undefined): Promise<void> => {
    try {
      currentNovelStore?.close();
    } catch (e) {
      console.warn("[main] novel store close failed on rebind:", e);
    }
    currentNovelStore = undefined;
    currentJournalDir = undefined;
    if (storeDir !== undefined) {
      currentJournalDir = join(storeDir, "conversations");
      mkdirSync(currentJournalDir, { recursive: true });
      currentNovelStore = new SqliteNovelStore(join(storeDir, "novel.db"));
    }
    await manager.rescope(currentJournalDir);
  };

  const workspaceApi = {
    pickWorkspace: async (): Promise<{ referenceId: string; label: string } | undefined> => {
      const result = await dialog.showOpenDialog({
        title: "打开小说项目",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return undefined;
      const root = result.filePaths[0]!;
      allowedWorkspaceReferences.add(root);
      return { referenceId: root, label: basename(root) };
    },
    // 新建项目直达「输入名字建目录」：save 型对话框选位置+命名 → 建目录 → 打开。
    // 已存在同名目录时 mkdir recursive 幂等（等价直接打开该项目）；同名文件会抛错。
    createWorkspace: async (): Promise<{ referenceId: string; label: string } | undefined> => {
      const lastRoot = [...registryEntries].sort((a, b) =>
        b.lastOpenedAt.localeCompare(a.lastOpenedAt),
      )[0]?.workspaceRoot;
      const result = await dialog.showSaveDialog({
        title: "新建项目文件夹",
        buttonLabel: "新建",
        defaultPath: lastRoot !== undefined ? join(dirname(lastRoot), "新建项目") : undefined,
        properties: ["createDirectory", "showHiddenFiles"],
      });
      if (result.canceled || result.filePath === undefined || result.filePath === "") {
        return undefined;
      }
      const root = result.filePath;
      try {
        mkdirSync(root, { recursive: true });
      } catch (e) {
        console.warn("[main] create workspace directory failed:", root, e);
        throw new Error(`无法在所选位置创建文件夹：${root}`);
      }
      allowedWorkspaceReferences.add(root);
      return { referenceId: root, label: basename(root) };
    },
    listRecent: async () =>
      Object.freeze(
        [...registryEntries]
          .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
          .slice(0, 8)
          .map((e) => ({
            id: e.workspaceId,
            label: e.label,
            lastOpenedAt: e.lastOpenedAt,
            rootPath: e.workspaceRoot,
          })),
      ),
    open: async (reference: { referenceId: string; label: string }) => {
      // referenceId 两种来源：最近列表传 workspaceId（哈希，注册表反查 root）；
      // 目录选择器传 root 路径（白名单校验）
      const registryHit = registryEntries.find((e) => e.workspaceId === reference.referenceId);
      const root = registryHit?.workspaceRoot;
      if (root === undefined && !allowedWorkspaceReferences.has(reference.referenceId)) {
        throw new Error(`未授权的 workspace 引用（请先经目录选择器打开）: ${reference.referenceId}`);
      }
      const workspaceRoot = root ?? reference.referenceId;
      const label = reference.label.trim() !== "" ? reference.label : basename(workspaceRoot);
      const location = await locator.resolve(workspaceRoot);
      adoptLegacyData(location.storeDir);
      await rebindWorkspace(location.storeDir);
      currentWorkspaceRoot = location.workspaceRoot;
      rebindLibraryService();
      const lastOpenedAt = new Date().toISOString();
      const existing = registryEntries.find((e) => e.workspaceId === location.workspaceId);
      if (existing !== undefined) {
        existing.label = label;
        existing.lastOpenedAt = lastOpenedAt;
      } else {
        registryEntries.push({
          workspaceId: location.workspaceId,
          workspaceRoot: location.workspaceRoot,
          label,
          lastOpenedAt,
        });
      }
      saveRegistry();
      return {
        id: location.workspaceId,
        label,
        lastOpenedAt,
        rootPath: location.workspaceRoot,
      };
    },
    close: async () => {
      currentWorkspaceRoot = undefined;
      rebindLibraryService();
      await rebindWorkspace(undefined);
    },
  };
  expose(workspaceApi, electronIpcTransport({ endpoint, channel: WORKSPACE_CHANNEL }));

  // 自绘窗口控制（PRD WC/决议5）：Windows 全 frameless；macOS 保留系统红绿灯
  // （titleBarStyle hidden）。最小窗口 1080×640（决议 6：断点收敛 1280/1080 两档），
  // 初始 1280×800。
  const isDarwin = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 640,
    ...(isDarwin
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 13, y: 13 } }
      : { frame: false }),
    webPreferences: {
      preload: preloadPath,
      // 显式安全声明（Electron 当前默认即此值；显式化防升级/配置漂移后静默回退）
      contextIsolation: true,
      nodeIntegration: false,
      // 失焦/最小化时不节流 renderer 定时器（gui-performance-2 功能点七）：
      // 32ms 流式发布节流依赖 setTimeout，系统级节流会导致后台流式冻结、
      // 恢复焦点时跳变追帧
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  // 窗口控制 IPC（window-controls:*）：仅主窗口 webContents 授权；
  // macOS 用系统红绿灯，renderer 侧不请求窗控（preload 仍暴露桥，win 才接 UI）
  const WINDOW_CONTROLS_CHANNEL = {
    minimize: "window-controls:minimize",
    toggleMaximize: "window-controls:toggle-maximize",
    close: "window-controls:close",
    state: "window-controls:maximized",
  } as const;
  const isMainWindowSender = (senderId: number): boolean => senderId === win.webContents.id;
  ipcMain.on(WINDOW_CONTROLS_CHANNEL.minimize, (event) => {
    if (isMainWindowSender(event.sender.id)) win.minimize();
  });
  ipcMain.on(WINDOW_CONTROLS_CHANNEL.toggleMaximize, (event) => {
    if (!isMainWindowSender(event.sender.id)) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(WINDOW_CONTROLS_CHANNEL.close, (event) => {
    if (isMainWindowSender(event.sender.id)) win.close();
  });
  const sendMaximizedState = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(WINDOW_CONTROLS_CHANNEL.state, win.isMaximized());
    }
  };
  win.on("maximize", sendMaximizedState);
  win.on("unmaximize", sendMaximizedState);
  win.webContents.once("did-finish-load", sendMaximizedState);
  // compose 设计草稿文件 IPC（novel.design.v1.*）：仅主窗口 webContents 授权，
  // workspace 根随当前打开项目切换；renderer 经 preload novelDesign.invoke 调用
  const designController = new DesktopDesignIpcController({
    service: new DesktopDesignFileService({
      resolveWorkspaceRoot: (senderId) =>
        senderId === win.webContents.id ? currentWorkspaceRoot : undefined,
    }),
    authorizeSender: (senderId) => senderId === win.webContents.id,
  });
  designController.register(ipcMain as unknown as DesignIpcMain);
  win.on("closed", () => {
    void designController.dispose();
  });
  win.webContents.on("console-message", (_e, ...args: unknown[]) => {
    // Electron 43 新旧签名兼容：旧 (event, level, message, ...) / 新 (event, details)
    const first = args[0];
    const level =
      typeof first === "object" && first !== null && "level" in first
        ? (first as { level: unknown }).level
        : first;
    const message =
      typeof first === "object" && first !== null && "message" in first
        ? (first as { message: unknown }).message
        : args[1];
    // 按级别分流：error/warning 进 stderr，info 级不再污染错误输出
    if (level === 3 || level === "error") console.error(`[renderer] ${String(message)}`);
    else if (level === 2 || level === "warning") console.warn(`[renderer] ${String(message)}`);
  });
  await win.loadFile(rendererHtml);
  infoLog("[main] minimal electron ready");
}

main().catch((e) => {
  console.error("[main] failed", e);
  app.quit();
});
