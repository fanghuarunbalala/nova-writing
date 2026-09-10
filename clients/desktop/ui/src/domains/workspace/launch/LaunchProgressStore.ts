/**
 * LaunchProgressStore
 *
 * 打开 / 切换工作区的启动编排状态机（demo bootIntoApp / runLoading 的真实进度版）：
 * controller 进入 opening → 遮罩出现（「正在打开项目…」）→ 数据库就绪后各域 store
 * 开始装载，四个步骤按真实就绪序点亮（保底节奏对齐 demo 300ms/步 + 550ms 收尾）→
 * 全部 settle 后遮罩淡出 + 工作台 boot-in（约 1s）。controller 打开失败时立即中止
 * 回欢迎页报错。library 不参与门控（自身轮询解析进度，不阻塞进入工作台）。
 *
 * 步骤 → 域 store 映射（demo 文案）：
 * - 载入大纲树       ← novelOverview + storyOutlineTree
 * - 读取卷章与段落   ← manuscriptStructure
 * - 角色 / 地点档案  ← character + location
 * - 恢复最近会话     ← conversationCatalog
 *
 * 时序保证：步骤按展示顺序点亮（前缀未 settle 不点后续）；真实加载快于演出
 * 节奏时由定时器补点（每步 ≥ stepIntervalMs），慢于演出节奏时跟随真实事件。
 */
import type { WorkspaceControllerSnapshot } from "../controller/WorkspaceController.js";

/** 域 store 最小订阅面（WorkspaceDomainStore 实例天然满足） */
export interface LaunchPhaseSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => { readonly phase: "idle" | "loading" | "ready" | "error"; readonly workspaceId: string | undefined };
}

/** controller 最小订阅面（WorkspaceController 实例天然满足；测试可注入） */
export interface LaunchControllerSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WorkspaceControllerSnapshot;
}

export interface LaunchDomainStores {
  readonly novelOverview: LaunchPhaseSource;
  readonly storyOutlineTree: LaunchPhaseSource;
  readonly manuscriptStructure: LaunchPhaseSource;
  readonly character: LaunchPhaseSource;
  readonly location: LaunchPhaseSource;
  readonly conversationCatalog: LaunchPhaseSource;
}

/**
 * 启动阶段：
 * - idle     无启动进行（欢迎页或稳定工作台）
 * - opening  controller 正在打开数据库（遮罩出现，步骤全灭）
 * - loading  域 store 装载中（步骤逐步点亮）
 * - booting  装载完成：遮罩淡出 + 工作台 boot-in（launchId 供重放动画作 key）
 */
export type LaunchPhase = "idle" | "opening" | "loading" | "booting";

export interface LaunchStepView {
  readonly label: string;
  readonly lit: boolean;
}

export interface LaunchProgressSnapshot {
  readonly revision: number;
  /** 每次启动递增（应用内切换重放 boot-in 时可作 key） */
  readonly launchId: number;
  readonly phase: LaunchPhase;
  readonly title: string;
  readonly steps: readonly LaunchStepView[];
}

export interface LaunchProgressOptions {
  readonly controller: LaunchControllerSource;
  readonly domainStores: LaunchDomainStores;
  /** 步骤保底点亮间隔 ms（demo 300ms/步；测试注入） */
  readonly stepIntervalMs?: number;
  /** 末步点亮后的收尾停留 ms（demo 550ms） */
  readonly settleHoldMs?: number;
  /** boot-in 时长 ms（demo 1000ms；结束后回 idle 并撤遮罩） */
  readonly bootInMs?: number;
}

interface StepGroupSpec {
  readonly label: string;
  readonly stores: readonly (keyof LaunchDomainStores)[];
}

const STEP_GROUPS: readonly StepGroupSpec[] = [
  { label: "载入大纲树", stores: ["novelOverview", "storyOutlineTree"] },
  { label: "读取卷章与段落", stores: ["manuscriptStructure"] },
  { label: "角色 / 地点档案", stores: ["character", "location"] },
  { label: "恢复最近会话", stores: ["conversationCatalog"] },
];

const IDLE_TITLE = "";

export class LaunchProgressStore {
  private readonly controller: LaunchControllerSource;
  private readonly domainStores: LaunchDomainStores;
  private readonly stepIntervalMs: number;
  private readonly settleHoldMs: number;
  private readonly bootInMs: number;
  private readonly listeners = new Set<() => void>();
  private unsubscribes: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private snapshot: LaunchProgressSnapshot = freezeSnapshot({
    revision: 0,
    launchId: 0,
    phase: "idle",
    title: IDLE_TITLE,
    steps: STEP_GROUPS.map((group) => ({ label: group.label, lit: false })),
  });
  /** 本次启动开始时刻（Date.now；保底节奏基准） */
  private startedAt = 0;
  /** 全部步骤点亮的最早时刻（收尾停留基准） */
  private fullLitAt: number | undefined;

  constructor(options: LaunchProgressOptions) {
    this.controller = options.controller;
    this.domainStores = options.domainStores;
    this.stepIntervalMs = options.stepIntervalMs ?? 300;
    this.settleHoldMs = options.settleHoldMs ?? 550;
    this.bootInMs = options.bootInMs ?? 1000;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): LaunchProgressSnapshot => this.snapshot;

  /** 订阅 controller + 域 store（useEffect 装配；返回 detach） */
  attach(): () => void {
    if (this.unsubscribes.length > 0) return () => this.detach();
    const listener = (): void => this.evaluate();
    this.unsubscribes = [
      this.controller.subscribe(listener),
      ...STEP_GROUPS.flatMap((group) =>
        group.stores.map((key) => this.domainStores[key].subscribe(listener)),
      ),
    ];
    this.evaluate();
    return () => this.detach();
  }

  private detach(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
    this.clearTimer();
    this.fullLitAt = undefined;
    if (this.snapshot.phase !== "idle") {
      this.publish({ phase: "idle", title: IDLE_TITLE });
    }
  }

  private evaluate(): void {
    const controllerSnapshot = this.controller.getSnapshot();
    const now = Date.now();

    if (this.snapshot.phase === "idle") {
      if (controllerSnapshot.phase !== "opening") return;
      this.startedAt = now;
      this.fullLitAt = undefined;
      this.publish({
        launchId: this.snapshot.launchId + 1,
        phase: "opening",
        title: "正在打开项目…",
        steps: STEP_GROUPS.map((group) => ({ label: group.label, lit: false })),
      });
      return;
    }

    if (this.snapshot.phase === "booting") {
      // boot-in 计时由 enterBooting 的定时器负责，输入事件无需处理
      return;
    }

    // opening / loading：打开失败立即中止（回欢迎页报错由 controller 快照驱动）
    if (controllerSnapshot.phase === "error") {
      this.abort();
      return;
    }

    if (this.snapshot.phase === "opening") {
      if (controllerSnapshot.phase === "ready" && controllerSnapshot.current !== undefined) {
        // 数据库已打开：shell 已挂载并触发各域 loadWorkspace → 进入分步装载
        this.publish({
          phase: "loading",
          title: `正在打开《${controllerSnapshot.current.label}》`,
        });
      }
      return;
    }

    // loading：按真实就绪 + 保底节奏推进步骤
    const target = controllerSnapshot.current;
    if (target === undefined || controllerSnapshot.phase !== "ready") {
      // 防御：loading 阶段 current 丢失（异常关闭等）→ 中止
      this.abort();
      return;
    }
    const elapsed = now - this.startedAt;
    const steps: LaunchStepView[] = [];
    let prefixSettled = true;
    let lastLit = -1;
    for (let i = 0; i < STEP_GROUPS.length; i += 1) {
      prefixSettled =
        prefixSettled &&
        STEP_GROUPS[i]!.stores.every((key) => this.isSettled(key, target.id));
      const lit = prefixSettled && elapsed >= this.stepIntervalMs * (i + 1);
      if (lit) lastLit = i;
      steps.push({ label: STEP_GROUPS[i]!.label, lit });
    }
    if (lastLit === STEP_GROUPS.length - 1 && this.fullLitAt === undefined) {
      this.fullLitAt = now;
    }
    this.publish({ steps });
    if (this.fullLitAt === undefined) {
      this.scheduleNext(elapsed, lastLit);
      return;
    }
    const holdElapsed = now - this.fullLitAt;
    if (holdElapsed >= this.settleHoldMs) {
      this.enterBooting();
      return;
    }
    this.scheduleNext(elapsed, lastLit, this.fullLitAt + this.settleHoldMs - now);  }

  /** 域步骤 settle：ready/error 且 workspaceId 已切到目标（error 不阻塞进入） */
  private isSettled(key: keyof LaunchDomainStores, workspaceId: string): boolean {
    const snapshot = this.domainStores[key].getSnapshot();
    return (
      (snapshot.phase === "ready" || snapshot.phase === "error") &&
      snapshot.workspaceId === workspaceId
    );
  }

  /**
   * 单一定时器推进：收尾停留优先，否则等下一个保底节奏阈值；
   * 阈值已过而步骤未 settle 时纯事件驱动（不排定时器，避免 0ms 自旋）。
   */
  private scheduleNext(elapsed: number, lastLit: number, holdDelayMs?: number): void {
    const pacingDelay = this.stepIntervalMs * (lastLit + 2) - elapsed;
    const delay = holdDelayMs ?? (pacingDelay > 0 ? pacingDelay : undefined);
    this.clearTimer();
    if (delay === undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.evaluate();
    }, delay);
  }

  private enterBooting(): void {
    this.clearTimer();
    this.publish({ phase: "booting" });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fullLitAt = undefined;
      this.publish({ phase: "idle", title: IDLE_TITLE });
    }, this.bootInMs);
  }

  private abort(): void {
    this.clearTimer();
    this.fullLitAt = undefined;
    this.publish({ phase: "idle", title: IDLE_TITLE });
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private publish(update: Partial<Omit<LaunchProgressSnapshot, "revision">>): void {
    this.snapshot = freezeSnapshot({
      revision: this.snapshot.revision + 1,
      launchId: update.launchId ?? this.snapshot.launchId,
      phase: update.phase ?? this.snapshot.phase,
      title: update.title ?? this.snapshot.title,
      steps: update.steps ?? this.snapshot.steps,
    });
    for (const listener of [...this.listeners]) listener();
  }
}

function freezeSnapshot(snapshot: LaunchProgressSnapshot): LaunchProgressSnapshot {
  return Object.freeze({
    ...snapshot,
    steps: Object.freeze(snapshot.steps.map((step) => Object.freeze({ ...step }))),
  });
}
