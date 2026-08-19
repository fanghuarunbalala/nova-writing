/**
 * ConversationComposer
 *
 * 悬浮输入区（原型 .composer，Codex 式贴底浮窗）：
 *   form（居中卡片）内自上而下 = gen-status + 引用栏（拖入的实体 chips）+
 *   .composer-main（textarea + send）+ 执行模式下拉。
 * composer 容器绝对定位于聊天视图底部、透明、pointer-events none（点击穿透到时间线滚动），
 * form 恢复 pointer-events auto。发送后清空本地输入与引用。
 * 模式栏为受控组件：mode 来自投影的会话级权威状态，切换由上层 enqueue
 * ConversationModeSetInputEvent（mode 不再随 onSend 丢弃）。
 * 引用（PRD F5/F6）：右栏目录行/段落行 HTML5 拖入 → ComposerDraftStore
 * （按会话进程内持久化）；随消息发送（references），空文本纯引用可发；
 * 空输入退格移除末枚引用。
 */
import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type Ref } from "react";
import { Send } from "lucide-react";
import { debugLog } from "@novel/core/client";
import { Button } from "../../../shared/primitives/Button.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import { GenStatus, type GenStatusProps } from "./GenStatus.js";
import type { ComposerMode, ComposerReference } from "../store/ComposerDraftStore.js";
import { ComposerDraftStore } from "../store/ComposerDraftStore.js";
import { useComposerDraft } from "../hooks/useComposerDraft.js";
import { ComposerModeBar } from "./ComposerModeBar.js";
import { ReferenceChips } from "./ReferenceChips.js";
import {
  hasReferenceDragPayload,
  readReferenceDragPayload,
} from "../reference/referenceDnd.js";
import styles from "./ConversationComposer.module.css";

export interface ComposerInput {
  readonly text: string;
  readonly references: readonly ComposerReference[];
}

export interface ConversationComposerProps {
  readonly conversationId: string;
  readonly enabled: boolean;
  readonly onSend: (input: ComposerInput) => void;
  /** 引用草稿 store（右栏拖入的实体引用按会话持久化；缺省无引用能力） */
  readonly draftStore?: ComposerDraftStore;
  /** 生成状态（原型 .gen-status）；undefined 时不渲染。由 ChatSurface 注入运行时状态。 */
  readonly status?: GenStatusProps;
  /** 会话级权威 mode（来自投影 conversationMode）；缺省回退 review。 */
  readonly mode?: ComposerMode;
  /** 待生效模式（mode.pending 事件派生）：非 undefined 时模式栏显示「待生效」提示。 */
  readonly pendingMode?: ComposerMode;
  /** 切换 mode；由上层 enqueue ConversationModeSetInputEvent 到 core。 */
  readonly onModeChange?: (mode: ComposerMode) => void;
  /** 审批挂起时禁用发送（审核中）；打字与切 mode 不受影响。 */
  readonly sendDisabled?: boolean;
  /** 运行时传输断开（进程死亡/重启中）：解锁审批阻塞并提示已断开。 */
  readonly disconnected?: boolean;
  /** 根容器 ref（上层量实际高度 → 时间线底部预留自适应，避免悬浮盖住末条消息）。 */
  readonly containerRef?: Ref<HTMLDivElement>;
}

export function ConversationComposer({
  conversationId,
  enabled,
  onSend,
  draftStore,
  status,
  mode = "review",
  pendingMode,
  onModeChange = noopModeChange,
  sendDisabled = false,
  disconnected = false,
  containerRef,
}: ConversationComposerProps) {
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 未注入 draftStore（测试/独立预览）时兜底本地实例：拖放引用在本挂载内可用
  const fallbackStore = useMemo(() => new ComposerDraftStore(), []);
  const { draft, addReference, removeReference, clearReferences } = useComposerDraft(
    draftStore ?? fallbackStore,
    conversationId,
  );
  const references = draft?.references ?? EMPTY_REFERENCES;

  // 自动长高：随内容撑到 scrollHeight（CSS max-height 140px 封顶后内部滚动）
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
  }, [text]);

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "" && references.length === 0) return;
    onSend({ text: trimmed, references });
    setText("");
    clearReferences();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
    // 空输入退格 → 移除末枚引用（对齐常见 mention 输入习惯；IME 组合中不触发）
    if (
      event.key === "Backspace" &&
      text === "" &&
      references.length > 0 &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      removeReference(references[references.length - 1]!.id);
    }
  };

  // 拖入引用落点：仅接受引用载荷（自定义 MIME），dragOver 高亮整卡
  const handleDragOver = (event: DragEvent<HTMLFormElement>): void => {
    if (!hasReferenceDragPayload(event)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    if (!dragOver) debugLog("[refs] dragover: 输入框落点高亮");
    setDragOver(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLFormElement>): void => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDragOver(false);
  };
  const handleDrop = (event: DragEvent<HTMLFormElement>): void => {
    if (!hasReferenceDragPayload(event)) {
      debugLog("[refs] drop ignored: 无引用 MIME（检查拖拽源是否写入载荷）", {
        expected: "application/x-novel-ref",
        types: event.dataTransfer === null ? null : [...event.dataTransfer.types],
      });
      return;
    }
    event.preventDefault();
    setDragOver(false);
    const reference = readReferenceDragPayload(event);
    if (reference !== undefined) {
      try {
        addReference(reference);
      } catch {
        debugLog("[refs] drop: addReference 拒绝（非法引用）", { ...reference });
      }
    }
    inputRef.current?.focus();
  };

  return (
    <div className={styles.composer} ref={containerRef}>
      <form
        className={[styles.form, dragOver ? styles.formDragOver : ""].filter(Boolean).join(" ")}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {/* 状态行恒占位（grid 0fr↔1fr）：GenStatus 挂载/卸载不再引发输入区高度跳变 */}
        <div className={styles.statusWrap} data-open={status !== undefined || undefined}>
          <div className={styles.statusInner}>
            {status !== undefined ? <GenStatus {...status} /> : null}
          </div>
        </div>
        {references.length > 0 ? (
          <ReferenceChips
            references={references}
            removable
            onRemove={(reference) => removeReference(reference.id)}
          />
        ) : null}
        <div className={styles.mainRow}>
          <label className={styles.srOnly} htmlFor={`composer-input-${conversationId}`}>
            创作指令
          </label>
          <textarea
            id={`composer-input-${conversationId}`}
            ref={inputRef}
            className={styles.input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入创作指令，例如：让林夏在旧船坞发现货单、起草白鹭旅馆场景"
            disabled={!enabled}
            rows={1}
            aria-label="对话输入"
            data-conversation={conversationId}
          />
        </div>
        {disconnected ? (
          <span className={styles.pendingHint}>进程已断开，审批已结束</span>
        ) : sendDisabled ? (
          <span className={styles.pendingHint}>正在审批</span>
        ) : null}
        {/* 底栏：模式（左） + 发送（右，icon 钮）——PRD CH-16/20 */}
        <div className={styles.bottomBar}>
          <ComposerModeBar mode={mode} pendingMode={pendingMode} onChange={onModeChange} disabled={!enabled} />
          <span className={styles.bottomSpacer} />
          <Button
            variant="primary"
            className={styles.sendBtn}
            aria-label="发送"
            title="发送（Enter）"
            leadingIcon={<Icon icon={Send} size="sm" />}
            onClick={submit}
            disabled={!enabled || (disconnected ? false : sendDisabled) || (text.trim() === "" && references.length === 0)}
          />
        </div>
      </form>
    </div>
  );
}

const EMPTY_REFERENCES: readonly ComposerReference[] = [];

function noopModeChange(): void {
  /* 未提供 onModeChange 时保持只读展示。 */
}
