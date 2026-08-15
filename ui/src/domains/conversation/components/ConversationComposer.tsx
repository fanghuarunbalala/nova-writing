/**
 * ConversationComposer
 *
 * 悬浮输入区（原型 .composer，Codex 式贴底浮窗）：
 *   form（居中卡片）内自上而下 = gen-status + .composer-main（textarea + send）+ 执行模式下拉。
 * composer 容器绝对定位于聊天视图底部、透明、pointer-events none（点击穿透到时间线滚动），
 * form 恢复 pointer-events auto。发送后清空本地输入。
 * 模式栏为受控组件：mode 来自投影的会话级权威状态，切换由上层 enqueue
 * ConversationModeSetInputEvent（mode 不再随 onSend 丢弃）。
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "../../../shared/primitives/Button.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import { GenStatus, type GenStatusProps } from "./GenStatus.js";
import type { ComposerMode } from "../store/ComposerDraftStore.js";
import { ComposerModeBar } from "./ComposerModeBar.js";
import styles from "./ConversationComposer.module.css";

export interface ComposerInput {
  readonly text: string;
  readonly references: readonly { readonly kind: "character" | "location" | "outline"; readonly id: string; readonly label: string }[];
}

export interface ConversationComposerProps {
  readonly conversationId: string;
  readonly enabled: boolean;
  readonly onSend: (input: ComposerInput) => void;
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
}

export function ConversationComposer({
  conversationId,
  enabled,
  onSend,
  status,
  mode = "review",
  pendingMode,
  onModeChange = noopModeChange,
  sendDisabled = false,
  disconnected = false,
}: ConversationComposerProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动长高：随内容撑到 scrollHeight（CSS max-height 140px 封顶后内部滚动）
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
  }, [text]);

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    onSend({ text: trimmed, references: [] });
    setText("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.composer}>
      <form
        className={styles.form}
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
        {/* 底栏：模式（左） + 发送（右）——PRD CH-16 */}
        <div className={styles.bottomBar}>
          <ComposerModeBar mode={mode} pendingMode={pendingMode} onChange={onModeChange} disabled={!enabled} />
          <span className={styles.bottomSpacer} />
          <Button
            variant="primary"
            leadingIcon={<Icon icon={Send} size="sm" />}
            onClick={submit}
            disabled={!enabled || (disconnected ? false : sendDisabled) || text.trim() === ""}
          >
            发送
          </Button>
        </div>
      </form>
    </div>
  );
}

function noopModeChange(): void {
  /* 未提供 onModeChange 时保持只读展示。 */
}
