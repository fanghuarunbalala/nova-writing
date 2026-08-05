/**
 * WorkspaceControllerAdapter
 *
 * 把现有 WorkspaceController（ui/src/workspace）适配到 ExternalStore 基类，
 * 让 workspace 域与其他域共用同一 store 抽象。只做快照镜像 + refresh 透传，
 * 选择/打开等动作仍由宿主持有的原 controller 执行。
 *
 * 这是 Phase 3 迁移完成前的桥接层；快照形状沿用现有 controller 定义。
 */
import { ExternalStore } from "../../../shared/state/ExternalStore.js";
import type { WorkspaceControllerSnapshot } from "../../../workspace/WorkspaceController.js";

export interface WorkspaceControllerPort {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkspaceControllerSnapshot;
  refresh(): Promise<void>;
}

export class WorkspaceControllerAdapter extends ExternalStore<WorkspaceControllerSnapshot> {
  private readonly controller: WorkspaceControllerPort;
  private readonly unsubscribe: () => void;

  constructor(controller: WorkspaceControllerPort) {
    super(controller.getSnapshot());
    this.controller = controller;
    this.unsubscribe = controller.subscribe(() => {
      this.setSnapshot(this.controller.getSnapshot());
    });
  }

  /** 解除镜像订阅；宿主卸载时调用。 */
  dispose(): void {
    this.unsubscribe();
  }

  refresh(): Promise<void> {
    return this.controller.refresh();
  }
}
