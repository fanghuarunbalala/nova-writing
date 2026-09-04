/**
 * 最小 Electron 入口：node 宿主装配（sqlite novel + 子进程 conversation + 门面），经 kkrpc/electron 暴露给 renderer。
 * - novel：SqliteNovelStore 落盘（userData/novel.db）
 * - conversation：spawnConversation 走子进程（desktop-child.mjs，真实 provider）；createOrResume 回退内存回显 loop
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen } from "electron";
import type { OpenDialogOptions, SaveDialogOptions } from "electron";
import { expose, proxy, wrap, type RPCMessage } from "kkrpc/remote-refs";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join, parse as parsePath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  Conversation,
  ConversationManagerServer,
  EventPublisher,
  EventSubscriber,
  FileConversationJournalService,
  bindFocusChannel,
  requestFocus,
  type FocusChannelHandle,
  CONVERSATION_OUTPUT,
  conversationEventsAddr,
  NOVEL_CHANGED,
  novelEventsAddr,
  workspaceFocusAddr,
  SqliteNovelStore,
  deriveChangeEntities,
  ConfigServer,
  createNovelApiServer,
  createProcessSpawner,
  BookImportService,
  createLibraryFace,
  LibraryService,
  RemoteNovelStore,
  electronIpcTransport,
  startConversationManagerWsServer,
  startNovelDbWsServer,
  type AgentLoop,
  type AnalystConversationSpawner,
  type ConversationApprovalDecision,
  type ConversationApprovalRequest,
  type ConversationJournalService,
  type CredentialCipher,
  runtimeCapabilities,
  novelSectionRegistry,
  NOVEL_TOOL_GROUP_CATALOG,
  ServerAuthClient,
  ServerAuthSession,
  ServerApprovalChannel,
  ServerEventBridge,
  ServerTokenStore,
  LeaseClient,
  seedJournalMirrorFromServer,
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
import {
  NodeApplicationConfigStore,
  NodeConfigHomeResolver,
  NodeWorkspaceStoreLocator,
  WorkspaceDirLock,
  seedBuiltinSkills,
} from "@novel/core/node";
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
/** server 认证状态推送（main → renderer 单向；设置页连接指示） */
const SERVER_AUTH_CHANNEL = "server-auth-changed";
/** server SSE 流事件转发（journal/approval/lease；renderer 侧进度视图/审批中心消费） */
const SERVER_EVENTS_CHANNEL = "server-events";

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

/** 内置 MCP 服务器 id（种子幂等键；用户删除后不复活） */
const BUILTIN_MCP_NOVEL_FETCH_ID = "builtin:novel-fetch";

/**
 * 内置 MCP 服务器预装（seed）：启动时把内置 novel-fetch（网文平台信息工具箱，
 * 当前支持起点）服务器配置种入 config——id 不存在时 upsert；已存在一律跳过
 * （用户编辑/禁用/删除优先，不覆盖不复活，对齐 seedBuiltinSkills 语义）。
 * 默认受信（免审批）：内置随应用分发 + 纯只读（fetch 公开页面），与内置工具
 * NovelRead/Read/skill 免审一致；非受信审批语义保留给用户自添加的第三方服务器，
 * 设置页可改回。server 入口随应用分发（mcp-servers/novel-fetch/，PRD
 * novel-fetch-外部工具）。
 */
async function seedBuiltinMcpServers(configStore: NodeApplicationConfigStore): Promise<void> {
  const snapshot = await configStore.get();
  const exists = (snapshot.mcpServers ?? []).some((s) => s.id === BUILTIN_MCP_NOVEL_FETCH_ID);
  if (exists) return;
  await configStore.mutate({
    op: "mcp.upsert",
    serverId: BUILTIN_MCP_NOVEL_FETCH_ID,
    server: {
      name: "novel-fetch",
      enabled: true,
      trusted: true,
      transport: {
        type: "stdio",
        // Electron 主进程的 execPath 是 electron.exe——须以 Node 模式运行 .mjs
        //（ELECTRON_RUN_AS_NODE=1；SDK env 为合并语义，PATH 等仍默认继承）
        command: process.execPath,
        args: [join(baseDir, "..", "..", "..", "mcp-servers", "novel-fetch", "index.mjs")],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
    },
  });
  infoLog("[main] builtin mcp server seeded: novel-fetch");
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
  serverMode?: {
    conversationLease: NonNullable<import("@novel/core").ConversationManagerServerOptions>["conversationLease"];
    approvals: NonNullable<import("@novel/core").ConversationManagerServerOptions>["serverApprovals"];
  },
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
    ...(serverMode?.conversationLease !== undefined ? { conversationLease: serverMode.conversationLease } : {}),
    ...(serverMode?.approvals !== undefined ? { serverApprovals: serverMode.approvals } : {}),
  });
  return server;
}

// 崩溃兜底：main 进程任何未捕获异常/未处理 rejection 先留完整痕迹再退出
// （此前无此 handler 时崩溃只剩 exit 1 + 一行裸 undefined，无法定位）。
// 追加同步文件日志（userData/crash.log）：stdout 走 pnpm 管道有缓冲，进程
// fail-fast（如 zeromq addon 0xC0000409）时运行期日志会整段丢失（2026-09-04 实测）
process.on("uncaughtException", (e) => {
  appendCrashLog(`uncaughtException ${String(e?.stack ?? e)}`);
  console.error("[main] uncaught exception:", e);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  appendCrashLog(`unhandledRejection ${String(reason)}`);
  console.error("[main] unhandled rejection:", reason);
  process.exit(1);
});

/** 崩溃/异常痕迹同步落盘（绕过 stdout 管道缓冲；每次追加，勿写敏感内容） */
function appendCrashLog(line: string): void {
  try {
    const { app: electronApp } = require("electron") as typeof import("electron");
    const path = join(electronApp.getPath("userData"), "crash.log");
    writeFileSync(path, `[${new Date().toISOString()}] ${line}\n`, { flag: "a" });
  } catch {
    // app 未就绪等极端场景：尽力而为
  }
}

/** 启动一个新的 GUI 实例（独立进程——多实例并行创作入口）。
 *  openWorkspaceRoot 提供时新实例启动即自动打开该项目（"在新窗口打开"），
 *  否则显示项目选择页。env 必须剔除实例命名空间（新实例以自身 pid 命名，否则
 *  会话事件管道跨实例撞名）与 NOVEL_OPEN_WORKSPACE（防向孙实例传播；本次派发
 *  用的上下文随后显式写入）。手动双击 exe 的第二实例天然无继承，不受影响 */
const spawnNewGuiInstance = (openWorkspaceRoot?: string): void => {
  try {
    const env = { ...process.env };
    delete env.NOVEL_EVENT_NAMESPACE;
    delete env.NOVEL_OPEN_WORKSPACE;
    if (openWorkspaceRoot !== undefined) env.NOVEL_OPEN_WORKSPACE = openWorkspaceRoot;
    // dev（electron CLI 带入口脚本）需重传脚本路径；打包 exe 裸启即可
    const args = process.defaultApp ? [process.argv[1] ?? join(__dirname, "main.cjs")] : [];
    const child = spawn(process.execPath, args, { detached: true, stdio: "ignore", env });
    child.unref();
    child.once("error", (e) => console.warn("[main] spawn new instance failed:", e));
  } catch (e) {
    console.warn("[main] spawn new instance failed:", e);
  }
};

/** 已打开项目再点击的弹窗告知（info 型原生框——不受 renderer 覆盖层状态影响，
 *  "弹窗告知已经打开了"的统一出口；失败忽略不阻断主流程） */
const notifyAlreadyOpen = (message: string, detail: string): void => {
  void dialog
    .showMessageBox({ type: "info", buttons: ["确定"], message, detail, noLink: true })
    .catch(() => {});
};

async function main(): Promise<void> {
  // 启动计时链（定位启动白屏/慢窗口期）：main 各阶段 + renderer 里程碑（[boot] 前缀
  // console.info 经 console-message 桥转发）相对 main() 进入的毫秒数
  const bootT0 = Date.now();
  const bootLog = (stage: string): void => {
    infoLog(`[boot] ${stage} (+${Date.now() - bootT0}ms)`);
  };
  // 多实例并行的事件管道命名空间（须先于任何 conversationEventsAddr 解析/子进程 spawn）：
  // 会话事件地址在 main 与子进程两侧解析而 pid 不同，只能经 env 继承对齐
  process.env.NOVEL_EVENT_NAMESPACE ??= String(process.pid);
  await app.whenReady();
  bootLog("app ready");

  // splash 启动遮罩：主窗口 hidden + ready-to-show 才显示（消除本地加载期的白屏）。
  // 原生 backgroundColor 同步置底色，splash 自身无白屏；所有启动路径（首启/手动双开/
  // 派生实例）共用。底色对齐 tokens --color-bg（默认浅色主题）近似 hex
  const APP_BG = "#faf9f6";
  const splash = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: true,
    backgroundColor: APP_BG,
  });
  const splashHtml =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%;display:grid;place-items:center;background:#faf9f6;' +
    'font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#2a2724;}' +
    '.box{display:flex;flex-direction:column;align-items:center;gap:18px;}' +
    '.mark{font-size:26px;font-weight:700;letter-spacing:.12em;}' +
    '.bar{width:132px;height:3px;border-radius:2px;background:#e6e2da;overflow:hidden;position:relative;}' +
    '.bar::after{content:"";position:absolute;left:-40%;width:40%;height:100%;background:#b48254;' +
    'animation:slide 1s ease-in-out infinite;}' +
    '@keyframes slide{to{left:100%;}}' +
    '.tip{font-size:13px;color:#8a857c;}' +
    '</style></head><body><div class="box"><div class="mark">Novel</div>' +
    '<div class="bar"></div><div class="tip">正在启动…</div></div></body></html>';
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);
  bootLog("splash created");

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "文件",
        submenu: [
          { label: "新建窗口", accelerator: "CmdOrCtrl+Shift+N", click: () => spawnNewGuiInstance() },
          { type: "separator" },
          { role: "quit", label: "退出" },
        ],
      },
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

  // novel 库随 workspace 热重绑（本地项目 = <storeDir>/novel.db；云项目 = main 内
  // RemoteNovelStore——纯云端化 FR4，UI 手动域写经 server oplog），open/close 时切换：
  // publishingStore 对象身份恒定（novel WS 子进程通道与 serverApi 不重建），内部委托当前库
  let currentNovelStore: NovelStore | undefined;
  const requireNovelStore = (): NovelStore => {
    if (currentNovelStore === undefined) throw new Error("未打开工作区（novel store 未初始化）");
    return currentNovelStore;
  };

  // 云项目 UI 域通道（纯云端化 FR4）：云项目打开时 rebindWorkspace 装配——写前懒申请
  // ui-<projectId> 编辑租约（conversation id 与会话租约不同、不互斥；域级并发由
  // entity_version 乐观锁兜底），关闭/切库时释放。sessionTag 带进程唯一后缀（重启后
  // 新投影不跳过自身旧操作，防重放丢数据）。
  let cloudDomain:
    | {
        projectId: string;
        store: RemoteNovelStore;
        lease?: { client: LeaseClient; token: string };
      }
    | undefined;
  const ensureCloudUiLease = async (): Promise<void> => {
    if (cloudDomain === undefined || cloudDomain.lease !== undefined) return;
    const url = await serverChannelActive();
    if (url === undefined) throw new Error("未登录 server（云端项目不可写，请先登录并确认 server 可达）");
    const conversationId = `ui-${cloudDomain.projectId}`;
    const client = new LeaseClient({
      url,
      conversationId,
      getAccessToken: () => serverAuthSession.ensureAccessToken(),
    });
    const { leaseToken } = await client.acquire(); // 409 他端 UI 编辑中 → 抛 LeaseHeldError（文案透传 UI）
    client.startHeartbeat(leaseToken);
    cloudDomain.lease = { client, token: leaseToken };
    infoLog(`[main] ui lease acquired: ${conversationId}`);
  };
  const releaseCloudDomain = async (): Promise<void> => {
    const channel = cloudDomain;
    cloudDomain = undefined;
    if (channel?.lease !== undefined) {
      await channel.lease.client.release(channel.lease.token);
      infoLog(`[main] ui lease released: ui-${channel.projectId}`);
    }
  };

  // novel.changed 广播：ZeroMQ PUB/SUB（mutate 成功 → publish；订阅 → rpc 通知 renderer 刷新）。
  // 派生规则：级联删除波及其他实体（如 storyUnit.delete 删段落）时补发对应实体事件。
  const novelLogger = createConsoleLogger();
  const novelPublisher = new EventPublisher(novelEventsAddr());
  await novelPublisher.bind();
  const publishingStore: NovelStore = {
    query: (q) => requireNovelStore().query(q),
    mutate: async (m) => {
      if (cloudDomain !== undefined) await ensureCloudUiLease();
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
      if (cloudDomain !== undefined) await ensureCloudUiLease();
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

  // config：JSON 文件持久化（凭据经 Electron safeStorage 加密；不可用时回退明文并告警）
  const configHome = new NodeConfigHomeResolver(app.getPath("userData"));
  const plaintextCipher: CredentialCipher = {
    encrypt: async (secret) => secret,
    decrypt: async (ciphertext) => ciphertext,
  };
  const cipher: CredentialCipher = safeStorage.isEncryptionAvailable()
    ? {
        encrypt: async (secret) => safeStorage.encryptString(secret).toString("base64"),
        // 旧版明文凭据兼容：safeStorage 接入前 config.json 存的是明文，解密失败按原文返回
        // （下次 credential.save 时自然重写为密文——渐进迁移，不炸启动）
        decrypt: async (ciphertext) => {
          try {
            return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
          } catch {
            return ciphertext;
          }
        },
      }
    : (infoLog("[main] safeStorage 不可用，凭据回退明文存储"), plaintextCipher);
  const configStore = new NodeApplicationConfigStore({
    filePath: join(configHome.resolve(), "config.json"),
    cipher,
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
      applyServerEnv().catch((e) => {
        infoLog(`[main] server env re-apply failed: ${e instanceof Error ? e.message : String(e)}`);
      });
      applyDefinitionEnv().catch((e) => {
        infoLog(`[main] definition env re-apply failed: ${e instanceof Error ? e.message : String(e)}`);
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
  // 内置 MCP 服务器预装（novel-fetch 网文平台信息工具箱；已存在跳过，不覆盖不复活）。
  // 须在 applyMcpEnv 之前：首次启动先落盘再进 env
  await seedBuiltinMcpServers(configStore);
  // provider 运行形态（启动时快照，会话期间不变）：holder 先建、ConfigServer 闭包引用，
  // applyRuntimeEnv 之后赋值——renderer 首次 getRuntimeStatus 远晚于启动完成，值已定型。
  // 设置页据此提示回显模式（provider 修改需重启生效；spawner 在启动时一次决定不补建）
  let providerLive = false;
  // 技能清单扫描（设置页「技能」面板）：应用级 userData/skills + 项目级 <workspace>/skills
  //（workspace 随开合变化，闭包现取；禁用名单以 config 当前值为准）
  const appSkillsRoot = join(app.getPath("userData"), "skills");
  // server 模式认证（FR1）：双令牌独立文件 + safeStorage 加密；未配置 url 时恒 unconfigured（本地模式零侵入）
  const serverAuthSession = new ServerAuthSession(
    new ServerTokenStore(join(configHome.resolve(), "server-auth.json"), cipher),
    (url) => new ServerAuthClient(url),
  );
  await serverAuthSession.restore((await configStore.get()).server?.url);
  const configServer = new ConfigServer(configStore, {
    runtimeStatus: () => ({ providerLive }),
    serverAuth: {
      session: serverAuthSession,
      clientFactory: (url) => new ServerAuthClient(url),
      deviceName: "桌面端",
      onLoginUrlPersist: async (url) => {
        await configStore.mutate({ op: "server.set", server: { url } });
      },
    },
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

  // server 模式 env（FR2）：配置了 server.url → 子进程注入 NOVEL_SERVER_URL（journal HTTP 上推）。
  // access token 不走 env（15min TTL，长 run 会过期）：main 周期轮换并落 server-access.json，子进程现读现用。
  const serverAccessFile = join(configHome.resolve(), "server-access.json");
  // bundle 模式（FR6）：server.agentMode=bundle → 子进程 NOVA_AGENT_MODE + 定义包文件。
  // server 在线时 resolve 拉最新兼容包（能力从注册表自动推导）覆盖本地缓存；离线用缓存。
  const definitionBundlePath = join(configHome.resolve(), "definitions", "bundle.json");
  const applyDefinitionEnv = async (): Promise<void> => {
    const snapshot = await configStore.get();
    if (snapshot.server?.agentMode !== "bundle") {
      delete process.env.NOVEL_AGENT_MODE;
      delete process.env.NOVEL_DEFINITION_BUNDLE;
      return;
    }
    process.env.NOVEL_AGENT_MODE = "bundle";
    const url = snapshot.server?.url;
    if (url !== undefined) {
      try {
        const token = await serverAuthSession.ensureAccessToken();
        if (token !== undefined) {
          const caps = runtimeCapabilities(novelSectionRegistry, NOVEL_TOOL_GROUP_CATALOG);
          const res = await fetch(`${url}/v1/definitions/resolve`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ agentType: "novel", capabilities: caps }),
          });
          if (res.ok) {
            const body = (await res.json()) as { bundle?: unknown };
            if (body.bundle !== undefined) {
              mkdirSync(dirname(definitionBundlePath), { recursive: true });
              writeFileSync(definitionBundlePath, JSON.stringify(body.bundle, null, 2), "utf8");
              infoLog("[main] definition bundle synced from server");
            }
          }
        }
      } catch {
        // 离线：沿用本地缓存
      }
    }
    if (existsSync(definitionBundlePath)) process.env.NOVEL_DEFINITION_BUNDLE = definitionBundlePath;
  };
  const applyServerEnv = async () => {
    const url = (await configStore.get()).server?.url;
    if (url !== undefined) {
      process.env.NOVEL_SERVER_URL = url;
      process.env.NOVEL_SERVER_ACCESS_FILE = serverAccessFile;
      // 云分支别名（纯云端化 FR5）：子进程 Remote 装配读 NOVA_* 前缀——两套并存注入
      process.env.NOVA_SERVER_URL = url;
      process.env.NOVA_SERVER_ACCESS_FILE = serverAccessFile;
    } else {
      delete process.env.NOVEL_SERVER_URL;
      delete process.env.NOVEL_SERVER_ACCESS_FILE;
      delete process.env.NOVA_SERVER_URL;
      delete process.env.NOVA_SERVER_ACCESS_FILE;
    }
  };
  await applyServerEnv();
  await applyDefinitionEnv();
  const writeServerAccessFile = async (): Promise<void> => {
    const token = await serverAuthSession.ensureAccessToken();
    if (token !== undefined) writeFileSync(serverAccessFile, JSON.stringify({ accessToken: token }), "utf8");
  };
  serverAuthSession.onStatusChange(() => {
    void writeServerAccessFile();
    void setupServerEventBridge();
  });
  // setInterval 之前先定义桥（onStatusChange 闭包引用；login 成功后即可起订）
  let serverEventBridge: ServerEventBridge | undefined;
  const setupServerEventBridge = async (): Promise<void> => {
    if (serverEventBridge !== undefined) return;
    const url = (await configStore.get()).server?.url;
    if (url === undefined) return;
    if ((await serverAuthSession.ensureAccessToken()) === undefined) return;
    serverEventBridge = new ServerEventBridge({
      url,
      getAccessToken: () => serverAuthSession.ensureAccessToken(),
      onEvent: (event) => {
        // approval_resolved（FR4）：他端（如手机）批掉 → 回填本地队列（幂等；先到者生效）
        if (event.type === "approval_resolved" && typeof event.requestId === "string") {
          const decision = event.decision === "approve" || event.decision === "reject" ? ({ kind: event.decision } as ConversationApprovalDecision) : undefined;
          if (decision !== undefined) {
            void manager.resolveApproval(event.requestId, decision).catch(() => {});
          }
        }
        // journal/lease 事件原样转发 renderer（进度视图/只读提示各自消费）
        const win = mainWindow;
        if (win === undefined || win.isDestroyed()) return;
        win.webContents.send(SERVER_EVENTS_CHANNEL, event);
      },
    });
    serverEventBridge.start();
  };
  // 启动即尝试起订（已登录过的恢复场景；未登录时 ensureAccessToken 返回 undefined 直接跳过）
  void setupServerEventBridge();
  // 过期前主动轮换并刷新 access 文件（5min < 15min TTL；无 server 配置时 ensureAccessToken 直通返回）
  setInterval(() => {
    void writeServerAccessFile();
  }, 5 * 60 * 1000).unref?.();

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
  // server 模式：会话租约注册表（FR5）+ 审批两段式通道（FR4）——配置了 server 且登录后才激活
  const conversationLeases = new Map<string, { client: LeaseClient; token: string }>();
  const serverChannelActive = async (): Promise<string | undefined> => {
    const url = (await configStore.get()).server?.url;
    if (url === undefined) return undefined;
    return (await serverAuthSession.ensureAccessToken()) === undefined ? undefined : url;
  };
  const getLeaseTokenFor = (conversationId: string): string | undefined =>
    conversationLeases.get(conversationId)?.token;
  const manager = createManager(() => currentJournalDir, () => currentWorkspaceRoot, {
    managerWs: {
      url: managerWs.url,
      token: managerWs.token,
      onConnected: (listener) => managerWs.onConversationConnected(listener),
    },
    novelWs: { url: novelWs.url, token: novelWs.token },
  }, providerLive, {
    conversationLease: {
      acquire: async (conversationId) => {
        const url = await serverChannelActive();
        if (url === undefined) return {} as Record<string, string>;
        // 云会话预播种（纯云端化 ④）：spawn 前把 server 账本增量落到本地镜像——
        // renderer 的一次性 projectedHistory 读取不必等子进程对账（首开即回显旧消息）；
        // 追加侧按 gs 去重，与子进程/他实例并发安全；离线/失败内部静默
        if (process.env.NOVA_PROJECT_ID !== undefined && currentJournalDir !== undefined) {
          await seedJournalMirrorFromServer({
            url,
            conversationId,
            mirrorPath: join(currentJournalDir, conversationId, "journal.jsonl"),
            getAccessToken: () => serverAuthSession.ensureAccessToken(),
          });
        }
        const client = new LeaseClient({ url, conversationId, getAccessToken: () => serverAuthSession.ensureAccessToken() });
        const { leaseToken } = await client.acquire(); // 409 他端持有 → 抛错阻止 spawn（会话转只读提示）
        client.startHeartbeat(leaseToken);
        conversationLeases.set(conversationId, { client, token: leaseToken });
        infoLog(`[main] lease acquired: ${conversationId}`);
        return { NOVEL_LEASE_TOKEN: leaseToken };
      },
      release: async (conversationId) => {
        const entry = conversationLeases.get(conversationId);
        if (entry === undefined) return;
        conversationLeases.delete(conversationId);
        await entry.client.release(entry.token);
        infoLog(`[main] lease released: ${conversationId}`);
      },
    },
    approvals: {
      submit: async (input) => {
        const url = await serverChannelActive();
        if (url === undefined) return;
        await new ServerApprovalChannel({
          url,
          getAccessToken: () => serverAuthSession.ensureAccessToken(),
          getLeaseToken: getLeaseTokenFor,
        }).submit(input);
      },
      resolve: async (requestId, decision, comment) => {
        const url = await serverChannelActive();
        if (url === undefined) return;
        await new ServerApprovalChannel({
          url,
          getAccessToken: () => serverAuthSession.ensureAccessToken(),
          getLeaseToken: getLeaseTokenFor,
        }).resolve(requestId, decision, comment);
      },
    },
  });
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
  /** 书库服务随 workspace 热重绑：open 带 workspaceRoot 走书单过滤；close 回管理侧全集。
   *  重建前先关旧实例——Windows 下未关句柄会锁 book.db（多次切换累积锁定） */
  const rebindLibraryService = (): void => {
    try {
      libraryService.close();
    } catch (e) {
      console.warn("[main] library service close failed on rebind:", e);
    }
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
      const result = await openDialogModal({
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
  //（纯云端化 FR7：项目导入 face 下线——本地目录语义与云-only 相悖；core 服务与测试保留，
  //  renderer 侧入口随后续 ui commit 移除，期间调用得到明确的「未装配」RPC 错误）
  const serverApi = createNovelApiServer({ manager, novel: publishingStore, proxy, journalDir: () => currentJournalDir, library: libraryFace });

  // 主窗口引用（IPC sender 校验 + 定向发送；窗口创建晚于端点注册）
  let mainWindow: BrowserWindow | undefined;

  // 系统对话框统一挂主窗口（模态）：不挂窗口的非模态框在 Windows 会被主窗口压到
  // 后面、用户找不到（表现：文件/保存框"看不见"，前端弹窗又在 pick/creating 期间
  // 锁定 → 整个流程无法取消）。窗口未建/已销毁时退回非模态。上方 face 的 pickFile
  // 等为惰性闭包，调用时 mainWindow 已赋值（同"窗口创建晚于端点注册"既有模式）。
  // show/done 日志：诊断"对话框关闭后前端 RPC 未 resolve"类断链（时间戳对照）。
  const openDialogModal = (options: OpenDialogOptions) => {
    const win = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined;
    infoLog(`[dialog] show kind=open modal=${win !== undefined} title=${String(options.title ?? "")}`);
    return (win !== undefined ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)).then(
      (result) => {
        infoLog(
          `[dialog] done kind=open canceled=${result.canceled} picked=${result.filePaths[0] ?? "-"}`,
        );
        return result;
      },
    );
  };
  const saveDialogModal = (options: SaveDialogOptions) => {
    const win = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : undefined;
    infoLog(`[dialog] show kind=save modal=${win !== undefined} title=${String(options.title ?? "")}`);
    return (win !== undefined ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)).then(
      (result) => {
        infoLog(
          `[dialog] done kind=save canceled=${result.canceled} picked=${result.filePath ?? "-"}`,
        );
        return result;
      },
    );
  };

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
  // server 认证状态变化 → renderer 推送（设置页连接指示；离线/需重登即时可见）
  serverAuthSession.onStatusChange((state) => {
    const win = mainWindow;
    if (win !== undefined && !win.isDestroyed()) win.webContents.send(SERVER_AUTH_CHANNEL, state);
  });
  // novel.changed 订阅：ZeroMQ → renderer 通知（拉取为准，通知仅触发刷新）
  const novelSubscriber = new EventSubscriber(novelEventsAddr(), [NOVEL_CHANGED]);
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

  // 同项目双开守卫（PRD gui-多实例多开）：storeDir 进程锁 + 焦点回切通道，
  // 随 open/close/quit 生命周期获取与释放（open 持有、切换/关闭让位）
  let workspaceLock: WorkspaceDirLock | undefined;
  let focusChannel: FocusChannelHandle | undefined;
  /** 焦点回切 ack 等待上限（跨进程 REQ/REP + 窗口操作；超时回退报错路径） */
  const FOCUS_ACK_TIMEOUT_MS = 500;
  /** 释放当前工作区守卫（锁 + 焦点通道；close/切换时调用） */
  const releaseWorkspaceGuards = (): void => {
    try {
      workspaceLock?.release();
    } catch (e) {
      console.warn("[main] workspace lock release failed:", e);
    }
    workspaceLock = undefined;
    const channel = focusChannel;
    focusChannel = undefined;
    if (channel !== undefined) void channel.close().catch(() => {});
  };

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
      if (currentNovelStore instanceof SqliteNovelStore) currentNovelStore.close();
    } catch (e2) {
      console.warn("[main] novel store close failed on quit:", e2);
    }
    // 双开守卫：锁同步释放（让位给其他实例），焦点通道异步拆除并入下方等待
    try {
      workspaceLock?.release();
      workspaceLock = undefined;
    } catch (e2) {
      console.warn("[main] workspace lock release failed on quit:", e2);
    }
    const focusClose = focusChannel?.close();
    focusChannel = undefined;
    // 会话级 ZMQ SUB 全量拆除：退出时若残留（会话进程尚未退出/刚注册），
    // addon.node 在进程退出阶段 fail-fast（0xC0000409，WER 实锤 2026-09-04）——
    // 曾是「关窗闪退」根因（will-quit 等待清单此前只含 novel/manager 四件）
    const subscriberCloses = [...conversationSubscribers.values()].map((s) => s.close().catch(() => {}));
    conversationSubscribers.clear();
    void Promise.race([
      Promise.allSettled([
        novelPublisher.close(),
        novelSubscriber.close(),
        novelWs.close(),
        managerWs.close(),
        ...(focusClose !== undefined ? [focusClose] : []),
        ...subscriberCloses,
      ]),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).finally(() => app.quit());
  });

  // workspace：目录选择器 + 定位器 + 最近列表（workspaces.json 持久化）。
  // 每项目存储根 = storageRoot/<workspaceId>（locator 派生）：novel.db + conversations/ 均落此处，
  // open/close 时热重绑（rebindWorkspace），实现数据库与会话的项目级隔离
  const storageRoot = join(app.getPath("userData"), "novel-storage");
  const locator = new NodeWorkspaceStoreLocator({ storageRoot });

  interface WorkspaceRegistryEntry {
    workspaceId: string;
    workspaceRoot: string;
    label: string;
    lastOpenedAt: string;
    /** 云项目（项目域上云）：server 上的项目 id——open 时注入 NOVA_PROJECT_ID 给会话子进程 */
    cloudProjectId?: string;
  }
  // 最近工作区注册表：id→root 反查（openRecent 修复）+ 重启恢复（roots 重新入白名单）
  const registryPath = join(app.getPath("userData"), "workspaces.json");
  const loadRegistryEntries = (): WorkspaceRegistryEntry[] => {
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
  };
  const registryEntries: WorkspaceRegistryEntry[] = loadRegistryEntries();
  // 多实例并发写收敛（PRD gui-多实例多开 功能点五）：写前重读磁盘按 workspaceId 合并
  // （lastOpenedAt 新者胜），避免另一实例刚登记的条目被本实例全量覆盖丢失。
  // config.json 维持单写者假设（两实例同时改设置的窗口极小，不做并发控制）
  const saveRegistry = (): void => {
    try {
      const merged = new Map(loadRegistryEntries().map((entry) => [entry.workspaceId, entry]));
      for (const entry of registryEntries) {
        const existing = merged.get(entry.workspaceId);
        if (existing === undefined || entry.lastOpenedAt >= existing.lastOpenedAt) {
          merged.set(entry.workspaceId, entry);
        }
      }
      const entries = [...merged.values()];
      // 内存同步收敛：本实例 listRecent 即时可见其他实例登记的项目
      registryEntries.length = 0;
      registryEntries.push(...entries);
      writeFileSync(registryPath, JSON.stringify({ version: 1, entries }), "utf8");
    } catch (e) {
      console.warn("[main] workspaces registry persist failed:", e);
    }
  };
  // 删除项目专用：saveRegistry 是并集合并（只增不删），移除须重读磁盘按 id 过滤后回写，
  // 并同步内存（另一实例恰在此窗口重开该项目会被其持锁——delete 前置 inspect 已拦）
  const removeRegistryEntry = (workspaceId: string): void => {
    try {
      const entries = loadRegistryEntries().filter((entry) => entry.workspaceId !== workspaceId);
      registryEntries.length = 0;
      registryEntries.push(...entries);
      writeFileSync(registryPath, JSON.stringify({ version: 1, entries }), "utf8");
    } catch (e) {
      console.warn("[main] workspaces registry removal persist failed:", e);
    }
  };

  // 云项目登记（项目域上云 FR4）：本地缓存目录（workspace 兜底面：设计稿/技能缓存/
  // journal sidecar）+ 注册表条目带 cloudProjectId；workspaceId = 缓存目录哈希（与
  // locator.resolve 同源，recordOpenInRegistry 幂等更新不丢 cloudProjectId）
  const registerCloudEntry = (projectId: string, name: string): { referenceId: string; label: string } => {
    const cacheRoot = join(app.getPath("userData"), "cloud-projects");
    const workspaceRoot = join(cacheRoot, projectId);
    mkdirSync(workspaceRoot, { recursive: true });
    const workspaceId = createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 12);
    const existing = registryEntries.find((e) => e.workspaceId === workspaceId);
    if (existing !== undefined) {
      existing.label = name;
      existing.lastOpenedAt = new Date().toISOString();
      existing.cloudProjectId = projectId;
    } else {
      registryEntries.push({
        workspaceId,
        workspaceRoot,
        label: name,
        lastOpenedAt: new Date().toISOString(),
        cloudProjectId: projectId,
      });
    }
    saveRegistry();
    allowedWorkspaceReferences.add(workspaceRoot);
    return { referenceId: workspaceId, label: name };
  };

  // 允许 open 的 referenceId 白名单：仅 pickWorkspace（原生目录对话框）返回的路径可设为工作区，
  // 以及注册表中曾经授权过的路径（重启恢复）；渲染进程直传任意路径会被拒绝
  // （防渲染端被污染后把 agent 文件工具指向任意目录）
  const allowedWorkspaceReferences = new Set<string>(registryEntries.map((e) => e.workspaceRoot));

  // 他实例"在新窗口打开"派发的启动上下文（spawn env 注入）：启动即摘取（防向会话子进程/
  // 孙实例传播）。值优先为 registry workspaceId（云-only 派发形态，registry 反查 label），
  // 兼容旧实例传的 root 路径（入 open 白名单——来源为他实例经注册表/选择器的授权），
  // 由 renderer 经 takeStartupWorkspace 取走后自动打开
  let startupWorkspace: { referenceId: string; label: string } | undefined;
  const startupWorkspaceRef = process.env.NOVEL_OPEN_WORKSPACE;
  if (startupWorkspaceRef !== undefined && startupWorkspaceRef.trim() !== "") {
    delete process.env.NOVEL_OPEN_WORKSPACE;
    const registryHit = registryEntries.find((e) => e.workspaceId === startupWorkspaceRef);
    if (registryHit !== undefined) {
      startupWorkspace = { referenceId: registryHit.workspaceId, label: registryHit.label };
    } else {
      allowedWorkspaceReferences.add(startupWorkspaceRef);
      startupWorkspace = { referenceId: startupWorkspaceRef, label: basename(startupWorkspaceRef) };
    }
    infoLog(`[main] startup workspace from spawn: ${startupWorkspaceRef}`);
  }

  // 新手引导完成标记：主进程文件（userData/onboarding.json）——localStorage 在多实例
  // 共享 userData 下 LevelDB 快照互不可见，第二实例读不到已完成标记会重复弹引导；
  // 文件对所有实例一致可见（renderer 旧 localStorage 标记由 NovelApp 一次性迁移）
  const onboardingMarkerPath = join(app.getPath("userData"), "onboarding.json");
  const isOnboardingDone = (): boolean => {
    try {
      return (
        (JSON.parse(readFileSync(onboardingMarkerPath, "utf8")) as { done?: boolean }).done === true
      );
    } catch {
      return false;
    }
  };

  /** 当前已绑定的 storeDir（与 currentNovelStore 配对；rebindWorkspace 幂等短路判定用） */
  let currentStoreDir: string | undefined;

  /** 数据库与会话目录随 workspace 重绑：关旧库 → 开新库 → manager rescope；
   *  storeDir undefined（关闭工作区）= 全部清空回空态。open 返回前完成，渲染端随后 refetch 即新数据。
   *  同 storeDir 且库仍打开 = 幂等重开直接返回——rescope 会无条件 terminate 全部会话，
   *  「导入创建 → openDirect 同项目」若重复 rebind 会把刚派生的 ProjectImporter 解构会话当场杀掉。
   *  云项目（纯云端化 FR4）：不落本地 novel.db，main 内 RemoteNovelStore 直连 server 域通道
   *  （UI 手动域写经 oplog；sessionTag 进程唯一），快照缓存落 workspace 缓存目录。 */
  const rebindWorkspace = async (
    storeDir: string | undefined,
    cloud?: { projectId: string; workspaceRoot: string },
  ): Promise<void> => {
    if (storeDir !== undefined && storeDir === currentStoreDir && currentNovelStore !== undefined) {
      return;
    }
    await releaseCloudDomain();
    try {
      if (currentNovelStore instanceof SqliteNovelStore) currentNovelStore.close();
    } catch (e) {
      console.warn("[main] novel store close failed on rebind:", e);
    }
    currentNovelStore = undefined;
    currentJournalDir = undefined;
    currentStoreDir = undefined;
    if (storeDir !== undefined) {
      currentJournalDir = join(storeDir, "conversations");
      mkdirSync(currentJournalDir, { recursive: true });
      if (cloud !== undefined) {
        const store = new RemoteNovelStore({
          url: (await configStore.get()).server?.url ?? "",
          projectId: cloud.projectId,
          sessionTag: `ui-${cloud.projectId}-${process.pid}`,
          getAccessToken: () => serverAuthSession.ensureAccessToken(),
          getLeaseToken: () => cloudDomain?.lease?.token,
          getConversationId: () => `ui-${cloud.projectId}`,
          cachePath: join(cloud.workspaceRoot, ".novel", "cache", "domain-snapshot.json"),
        });
        cloudDomain = { projectId: cloud.projectId, store };
        currentNovelStore = store;
      } else {
        currentNovelStore = new SqliteNovelStore(join(storeDir, "novel.db"));
      }
      currentStoreDir = storeDir;
    }
    await manager.rescope(currentJournalDir);
  };

  /** open 成功（含幂等成功）的注册表登记 + session 视图（normal 与幂等路径共用尾部） */
  const recordOpenInRegistry = (
    location: { workspaceId: string; workspaceRoot: string },
    label: string,
  ) => {
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
  };

  const workspaceApi = {
    pickWorkspace: async (): Promise<{ referenceId: string; label: string } | undefined> => {
      const result = await openDialogModal({
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
      const result = await saveDialogModal({
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
            ...(e.cloudProjectId !== undefined ? { cloud: true } : {}),
          })),
      ),
    // ---- 云项目（项目域上云 FR4）：server 为权威，本地仅缓存目录 + 注册表登记 ----
    cloudProjects: {
      list: async (): Promise<
        Array<{ id: string; name: string; lastActivityAt: number | null; archived: boolean; referenceId?: string }>
      > => {
        const url = (await configStore.get()).server?.url;
        const token = await serverAuthSession.ensureAccessToken();
        if (url === undefined || token === undefined) return [];
        try {
          const res = await fetch(`${url.replace(/\/+$/, "")}/v1/projects`, {
            headers: { authorization: `Bearer ${token}` },
          });
          if (!res.ok) return [];
          const body = (await res.json()) as {
            projects?: Array<{ id: string; name: string; lastActivityAt: number | null; archivedAt: string | null }>;
          };
          return (body.projects ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            lastActivityAt: p.lastActivityAt,
            archived: p.archivedAt !== null,
            // 本地登记条目（打开/删除要用的 workspace 引用；他端创建未打开时缺省）
            referenceId: registryEntries.find((e) => e.cloudProjectId === p.id)?.workspaceId,
          }));
        } catch {
          return [];
        }
      },
      /** 新建云项目：server 建实体 → 本地缓存目录 + 注册表登记（含 cloudProjectId）→ 打开引用 */
      create: async (name: string): Promise<{ referenceId: string; label: string } | undefined> => {
        const url = (await configStore.get()).server?.url;
        const token = await serverAuthSession.ensureAccessToken();
        if (url === undefined || token === undefined) throw new Error("未登录 server（先在登录页或设置 → Server 登录）");
        const trimmed = name.trim();
        if (trimmed.length === 0 || trimmed.length > 64) throw new Error("项目名需 1 – 64 字符");
        const res = await fetch(`${url.replace(/\/+$/, "")}/v1/projects`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `创建失败（HTTP ${res.status}）`);
        }
        const created = (await res.json()) as { id: string; name: string };
        return registerCloudEntry(created.id, trimmed);
      },
      /** 打开已有云项目（他端创建 / 本端未登记）：登记后返回打开引用 */
      openProject: async (projectId: string, name: string): Promise<{ referenceId: string; label: string }> => {
        const existing = registryEntries.find((e) => e.cloudProjectId === projectId);
        if (existing !== undefined) return { referenceId: existing.workspaceId, label: existing.label };
        return registerCloudEntry(projectId, name);
      },
      /** 删除云项目（纯云端化 FR6）：server 软删（权威）→ 本地缓存与注册表清理。
       *  在用（当前项目或他实例持锁）拒绝；未登记（他端创建未打开）只删 server 侧。 */
      remove: async (projectId: string): Promise<void> => {
        const url = (await configStore.get()).server?.url;
        const token = await serverAuthSession.ensureAccessToken();
        if (url === undefined || token === undefined) throw new Error("未登录 server（删除云端项目需登录）");
        const entry = registryEntries.find((e) => e.cloudProjectId === projectId);
        if (entry !== undefined && entry.workspaceRoot === currentWorkspaceRoot) {
          throw new Error("该项目正在使用中，请先关闭后再删除");
        }
        if (entry !== undefined) {
          // 跨实例占用检查（他窗口开着该云项目的缓存目录）
          const location = await locator.resolve(entry.workspaceRoot);
          const lockStatus = WorkspaceDirLock.inspect(location.storeDir);
          if (lockStatus !== undefined && lockStatus.alive) {
            throw new Error("该项目已在另一窗口打开，请先关闭该窗口后再删除");
          }
        }
        const res = await fetch(`${url.replace(/\/+$/, "")}/v1/projects/${encodeURIComponent(projectId)}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok && res.status !== 404) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(body.message ?? `删除失败（HTTP ${res.status}）`);
        }
        if (entry !== undefined) {
          const location = await locator.resolve(entry.workspaceRoot);
          if (location.storeDir.startsWith(storageRoot + sep)) {
            try {
              await rm(location.storeDir, { recursive: true, force: true });
            } catch (e) {
              console.warn("[main] cloud cache storeDir removal failed (leftover tolerated):", e);
            }
          }
          // 缓存目录（workspace 兜底面：设计稿/域快照缓存等）；盘根守卫同本地删除
          if (parsePath(entry.workspaceRoot).root !== entry.workspaceRoot) {
            try {
              await rm(entry.workspaceRoot, { recursive: true, force: true });
            } catch (e) {
              console.warn("[main] cloud cache folder removal failed (leftover tolerated):", e);
            }
          }
          removeRegistryEntry(entry.workspaceId);
          allowedWorkspaceReferences.delete(entry.workspaceRoot);
        }
        infoLog(`[main] cloud project removed: ${projectId}`);
      },
    },
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
      // 云项目标识（项目域上云 FR4）：当前项目绑 cloudProjectId → rebind 装 RemoteNovelStore +
      //  子进程注入 NOVA_PROJECT_ID（RemoteNovelStore/RemoteProjectFiles/journal HTTP 全套激活）
      const cloudEntry = registryEntries.find((e) => e.workspaceId === location.workspaceId);
      // 同项目双开互斥：先取新锁（失败时当前工作区原样保留），成功后才切换——
      // 释放旧守卫 → rebind → 绑新焦点通道（供他实例双开时回切本窗口）
      let lockResult = WorkspaceDirLock.acquire(location.storeDir, {
        workspaceId: location.workspaceId,
        workspaceRoot: location.workspaceRoot,
      });
      if (lockResult.status === "held" && lockResult.holderPid === process.pid) {
        // 本进程持锁：目录选择器手动选回当前项目 → 幂等成功（不 rebind，弹窗告知）；
        // 理论残留自锁（root 与当前不一致）→ 释放守卫后重取一次
        if (currentWorkspaceRoot === location.workspaceRoot) {
          notifyAlreadyOpen(`《${label}》已在当前窗口打开`, "无需切换，当前窗口正是该项目。");
          return recordOpenInRegistry(location, label);
        }
        releaseWorkspaceGuards();
        lockResult = WorkspaceDirLock.acquire(location.storeDir, {
          workspaceId: location.workspaceId,
          workspaceRoot: location.workspaceRoot,
        });
      }
      if (lockResult.status === "held") {
        // 他实例持有：优先回切持有窗口（应答即其窗口已被拉到前台）+ 弹窗告知；
        // 通道不可达（持有实例卡死/异常）回退报错（附 pid 与锁路径自救）
        const focused = await requestFocus(workspaceFocusAddr(location.workspaceId), FOCUS_ACK_TIMEOUT_MS);
        if (focused) {
          notifyAlreadyOpen(`《${label}》已在另一窗口打开`, "已为你切换到该窗口。");
          throw new Error("该项目已在另一窗口打开，已为你切换到该窗口");
        }
        throw new Error(
          `该项目已在另一个窗口打开（进程 ${lockResult.holderPid}），请切换到该窗口；` +
            `若确认未打开，可删除 ${lockResult.lockPath}`,
        );
      }
      releaseWorkspaceGuards();
      try {
        await rebindWorkspace(
          location.storeDir,
          cloudEntry?.cloudProjectId !== undefined
            ? { projectId: cloudEntry.cloudProjectId, workspaceRoot: location.workspaceRoot }
            : undefined,
        );
        focusChannel = await bindFocusChannel(workspaceFocusAddr(location.workspaceId), () => {
          const win = mainWindow;
          if (win === undefined || win.isDestroyed()) return;
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        });
      } catch (e) {
        lockResult.lock.release();
        throw e;
      }
      workspaceLock = lockResult.lock;
      currentWorkspaceRoot = location.workspaceRoot;
      if (cloudEntry?.cloudProjectId !== undefined) {
        process.env.NOVA_PROJECT_ID = cloudEntry.cloudProjectId;
        infoLog(`[main] cloud project active: ${cloudEntry.cloudProjectId}`);
      } else {
        delete process.env.NOVA_PROJECT_ID;
      }
      rebindLibraryService();
      return recordOpenInRegistry(location, label);
    },
    close: async () => {
      currentWorkspaceRoot = undefined;
      rebindLibraryService();
      await rebindWorkspace(undefined);
      releaseWorkspaceGuards();
    },
    // 在新 GUI 实例中打开（当前实例不动）：校验同 open，但不取锁不切换——
    // 新实例启动后经 takeStartupWorkspace 走完整 open 流程（含双开锁与焦点回切）
    openInNewWindow: async (reference: { referenceId: string; label: string }) => {
      const registryHit = registryEntries.find((e) => e.workspaceId === reference.referenceId);
      const root = registryHit?.workspaceRoot;
      if (root === undefined && !allowedWorkspaceReferences.has(reference.referenceId)) {
        throw new Error(`未授权的 workspace 引用（请先经目录选择器打开）: ${reference.referenceId}`);
      }
      const workspaceRoot = root ?? reference.referenceId;
      const label = reference.label.trim() !== "" ? reference.label : basename(workspaceRoot);
      // 派发前占用检查：已被活进程持有（本窗口或他实例）→ 置前持有窗口 + 弹窗告知，
      // 不白白 spawn 一个注定打不开的新实例
      const location = await locator.resolve(workspaceRoot);
      const status = WorkspaceDirLock.inspect(location.storeDir);
      if (status !== undefined && status.alive) {
        await requestFocus(workspaceFocusAddr(location.workspaceId), FOCUS_ACK_TIMEOUT_MS);
        if (status.holderPid === process.pid) {
          notifyAlreadyOpen(`《${label}》已在当前窗口打开`, "已把当前窗口置于前台。");
        } else {
          notifyAlreadyOpen(`《${label}》已在另一窗口打开`, "已为你切换到该窗口。");
        }
        return;
      }
      // 派发值优先 workspaceId（registry 反查形态）；目录选择器残留形态传 root（白名单）
      spawnNewGuiInstance(registryHit !== undefined ? registryHit.workspaceId : workspaceRoot);
    },
    // 启动项目上下文取出即清（renderer 启动取一次；StrictMode 双挂载/重复调用拿到 undefined）
    takeStartupWorkspace: async () => {
      const pending = startupWorkspace;
      startupWorkspace = undefined;
      return pending;
    },
    // 新手引导完成标记（跨实例持久化）：读文件判定 / 写完成
    getOnboardingDone: async () => isOnboardingDone(),
    markOnboardingDone: async () => {
      try {
        writeFileSync(
          onboardingMarkerPath,
          JSON.stringify({ done: true, at: new Date().toISOString() }),
          "utf8",
        );
      } catch (e) {
        console.warn("[main] onboarding marker persist failed:", e);
      }
    },
    // 删除项目（PRD workspace-删除项目）：仅非当前项目可删——彻底删除应用侧 storeDir
    // （novel.db + conversations/）与整个项目文件夹（含其中的用户文件），并移出注册表/
    // 白名单。多实例下"正在运行"= 本实例当前项目（root 比对）或任一其他实例持有该项目
    // 双开锁（inspect 探活）——均拒绝删除。文件系统根（极端场景：把盘根选作工作区）
    // 绝不触碰。rm 走 fs.promises（libuv 线程池）：整棵数据树的同步遍历会冻结主进程事件
    // 循环；失败容忍（杀毒/索引/资源管理器句柄占用），残留无副作用。先删数据后改注册表
    // ——中途崩溃时条目仍在列表可重试，不会留下「列表已无但数据半删」的暗残留
    delete: async (workspaceId: string): Promise<void> => {
      const index = registryEntries.findIndex((e) => e.workspaceId === workspaceId);
      if (index === -1) {
        throw new Error(`项目不存在或已被删除: ${workspaceId}`);
      }
      const entry = registryEntries[index]!;
      if (entry.workspaceRoot === currentWorkspaceRoot) {
        throw new Error("该项目正在使用中，请先关闭后再删除");
      }
      const location = await locator.resolve(entry.workspaceRoot);
      if (!location.storeDir.startsWith(storageRoot + sep)) {
        throw new Error(`storeDir 越界，拒绝删除: ${location.storeDir}`);
      }
      // 跨实例占用检查：另一窗口正开着该项目（活进程持锁）→ 拒绝，防误删运行中项目
      const lockStatus = WorkspaceDirLock.inspect(location.storeDir);
      if (lockStatus !== undefined && lockStatus.alive) {
        throw new Error(
          lockStatus.holderPid === process.pid
            ? "该项目正在当前窗口使用中，请先关闭后再删除"
            : "该项目已在另一窗口打开，请先关闭该窗口后再删除",
        );
      }
      try {
        await rm(location.storeDir, { recursive: true, force: true });
      } catch (e) {
        console.warn("[main] workspace storeDir removal failed (leftover tolerated):", e);
      }
      // 整个项目文件夹（含用户文件）一并删除；文件系统根守卫——盘根绝不做 recursive rm
      if (parsePath(entry.workspaceRoot).root !== entry.workspaceRoot) {
        try {
          await rm(entry.workspaceRoot, { recursive: true, force: true });
        } catch (e) {
          console.warn("[main] workspace folder removal failed (leftover tolerated):", e);
        }
      }
      removeRegistryEntry(entry.workspaceId);
      allowedWorkspaceReferences.delete(entry.workspaceRoot);
    },
  };
  expose(workspaceApi, electronIpcTransport({ endpoint, channel: WORKSPACE_CHANNEL }));

  // 自绘窗口控制（PRD WC/决议5）：Windows 全 frameless；macOS 保留系统红绿灯
  // （titleBarStyle hidden）。最小窗口 1080×640（决议 6：断点收敛 1280/1080 两档），
  // 初始 1280×800。
  const isDarwin = process.platform === "darwin";
  // 带启动上下文的派生实例（"在新窗口打开"spawn 而来）：级联偏移定位——默认位置与
  // 原窗口完全重叠，且 detached 子进程在 Windows 前台锁下可能拿不到前台而被压在
  // 原窗口后面，看起来像"没弹出来"
  const spawnedWithWorkspace = startupWorkspaceRef !== undefined;
  const cascadePosition = spawnedWithWorkspace
    ? (() => {
        const area = screen.getPrimaryDisplay().workArea;
        return { x: area.x + 48, y: area.y + 48 };
      })()
    : undefined;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 640,
    ...(cascadePosition !== undefined ? cascadePosition : {}),
    ...(isDarwin
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 13, y: 13 } }
      : { frame: false }),
    // 白屏消除第二半：hidden 直到本地页首帧绘制完成（ready-to-show），期间由 splash 遮罩；
    // 原生底色兜底首帧背景（对齐 splash 底色）
    show: false,
    backgroundColor: APP_BG,
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
  bootLog(`main window created${spawnedWithWorkspace ? " (spawned)" : ""}`);
  // 主窗口 reveal：本地页首帧绘制完成（ready-to-show）才显示并撤 splash——派生实例的
  // 前台强制（短暂置顶 → show → 取消置顶 → focus，绕过 SetForegroundWindow 前台锁的
  // 标准手法）也从创建时机移到这里（窗口此前 hidden）。20s 兜底防加载异常 splash 悬挂
  let mainWindowRevealed = false;
  const revealMainWindow = (trigger: string): void => {
    if (mainWindowRevealed || win.isDestroyed()) return;
    mainWindowRevealed = true;
    bootLog(`main window revealed (${trigger})`);
    if (spawnedWithWorkspace) {
      win.setAlwaysOnTop(true);
      win.show();
      win.setAlwaysOnTop(false);
    } else {
      win.show();
    }
    win.focus();
    try {
      splash.destroy();
    } catch {
      // splash 已销毁等场景忽略
    }
  };
  win.once("ready-to-show", () => revealMainWindow("ready-to-show"));
  setTimeout(() => revealMainWindow("20s-fallback"), 20_000).unref();
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
  // 崩溃观测（WER 只给 addon 帧不给上下文；此处同步落盘留现场）：
  // 渲染进程崩溃/被杀、GPU 进程异常——「窗口消失但 main 残留」类闪退的直接证据源
  win.webContents.on("render-process-gone", (_e, details) => {
    appendCrashLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  app.on("child-process-gone", (_e, details) => {
    appendCrashLog(`child-process-gone type=${details.type} reason=${details.reason} exitCode=${String(details.exitCode)}`);
  });
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
    // 按级别分流：error/warning 进 stderr；[boot]/[import-dialog] 前缀的 info 一并转发
    // （附启动相对毫秒，其余 info 不转发避免污染输出）
    if (level === 3 || level === "error") console.error(`[renderer] ${String(message)}`);
    else if (level === 2 || level === "warning") console.warn(`[renderer] ${String(message)}`);
    else if (String(message).startsWith("[boot]") || String(message).startsWith("[import-dialog]"))
      console.log(`[renderer] ${String(message)} (+${Date.now() - bootT0}ms)`);
  });
  win.webContents.on("dom-ready", () => bootLog("renderer dom-ready"));
  win.webContents.on("did-finish-load", () => bootLog("renderer did-finish-load"));
  bootLog("loadFile start");
  await win.loadFile(rendererHtml);
  bootLog("loadFile returned");
  infoLog("[main] minimal electron ready");
}

main().catch((e) => {
  console.error("[main] failed", e);
  app.quit();
});
