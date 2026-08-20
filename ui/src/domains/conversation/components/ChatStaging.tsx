/**
 * ChatStaging
 *
 * 新创作中转页（demo .stagePage，类 Codex new-task 落地页）：点击「开始一段新的创作」
 * 后替代对话消息流的居中引导页——介绍 + 单独输入框 + 示例指令 + 用法说明。
 * 会话在首条消息提交后才由上层创建（ChatSurface 接力 create → binding 就绪 → 发送），
 * 此前侧栏不出现新会话行。草稿（文本 + 执行模式）为受控状态，壳层持有、切视图不丢。
 */
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import {
  BookOpen,
  Feather,
  Hourglass,
  ListTree,
  Quote,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../../../shared/primitives/Button.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import { ComposerModeBar } from "./ComposerModeBar.js";
import type { ComposerMode } from "../store/ComposerDraftStore.js";
import styles from "./ChatStaging.module.css";

export interface ChatStagingDraft {
  readonly text: string;
  readonly mode: ComposerMode;
}

export interface ChatStagingProps {
  /** 受控草稿（壳层持有：切视图不丢；创建失败留在中转页时文案仍在） */
  readonly draft: ChatStagingDraft;
  readonly onDraftChange: (draft: ChatStagingDraft) => void;
  /** 提交首条指令（text 已 trim 非空）；上层创建会话并接力发送 */
  readonly onSubmit: (draft: ChatStagingDraft) => void;
  /** 放弃中转：回到原会话 / 空态 */
  readonly onCancel: () => void;
  /** 当前工作区标题（上下文摘要卡）；undefined 时隐藏该卡 */
  readonly workspaceLabel?: string;
  /** 会话创建中（提交后等待 createConversation 收口）：禁用输入与发送 */
  readonly submitting?: boolean;
  /** 示例指令（跟随当前项目：真实角色名 / 最新章标题）；缺省回退通用文案 */
  readonly examples?: readonly string[];
}

/** 通用兜底示例（项目数据未载齐 / 角色或章节为空时；有数据时上层替换前两条） */
const EXAMPLES: readonly string[] = [
  "梳理当前大纲，找出没有正文的单元",
  "把最近写完的一章改写出两个版本",
  "为主角补充角色档案",
  "核对既有设定，找出前后矛盾",
];

interface StageTip {
  readonly icon: LucideIcon;
  readonly name: string;
  readonly desc: string;
}

const TIPS: readonly StageTip[] = [
  {
    icon: ShieldCheck,
    name: "三种执行模式",
    desc: "需审核 / 直接执行 / 设计——会话级生效，输入框左下角随时切换。",
  },
  {
    icon: Quote,
    name: "点名书稿实体",
    desc: "指令里直接提到角色、地点或章节（如「让林夏…」「第 2 章…」），Agent 会先读对应档案再动笔。",
  },
  {
    icon: ListTree,
    name: "右栏内容目录",
    desc: "对话视图可展开大纲树与人物、地点档案；正文里的实体标签可点击定位。",
  },
  {
    icon: Hourglass,
    name: "先审后落库",
    desc: "需审核模式下，档案写入与正文修改都会生成审批项，处理完自动继续。",
  },
];

export function ChatStaging({
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  workspaceLabel,
  submitting = false,
  examples,
}: ChatStagingProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const examplesList = examples ?? EXAMPLES;

  // 自动长高（同 ConversationComposer：随内容撑到 scrollHeight，140px 封顶内部滚动）
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
  }, [draft.text]);

  const submit = (): void => {
    const trimmed = draft.text.trim();
    if (trimmed === "" || submitting) return;
    onSubmit({ ...draft, text: trimmed });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const fillExample = (example: string): void => {
    onDraftChange({ ...draft, text: example });
    const node = inputRef.current;
    if (node !== null) {
      node.focus();
      node.setSelectionRange(example.length, example.length);
    }
  };

  return (
    <div className={styles.stagePage}>
      <div className={styles.stageInner}>
        <span className={styles.brand}>
          <span className={styles.brandIcon} aria-hidden="true">
            <Icon icon={Feather} size="sm" />
          </span>
          Novel Agent
        </span>
        <h2 className={styles.title}>开始一段新的创作</h2>
        <p className={styles.sub}>
          描述你想推进的任务——起草场景、修订正文、推进大纲节点。Agent
          会生成草稿与提议，经你审批后写入书稿档案。
        </p>
        {workspaceLabel !== undefined ? (
          <div className={styles.ctx}>
            <span className={styles.ctxIcon} aria-hidden="true">
              <Icon icon={BookOpen} size="sm" />
            </span>
            <b>《{workspaceLabel}》</b>
            <span className={styles.ctxSep} aria-hidden="true">
              ·
            </span>
            <span>当前工作区 · 新会话将在此书稿上工作</span>
          </div>
        ) : null}
        <div className={styles.composerWrap}>
          <form
            className={styles.composerBox}
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className={styles.srOnly} htmlFor="staging-input">
              新创作指令
            </label>
            <textarea
              id="staging-input"
              ref={inputRef}
              className={styles.input}
              value={draft.text}
              onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
              onKeyDown={handleKeyDown}
              placeholder="描述这次想推进的任务，例如：起草第一卷的开场场景"
              rows={2}
              disabled={submitting}
              aria-label="新创作指令"
            />
            {submitting ? <span className={styles.pendingHint}>正在创建会话…</span> : null}
            <div className={styles.bottomBar}>
              <ComposerModeBar
                mode={draft.mode}
                onChange={(mode) => onDraftChange({ ...draft, mode })}
                disabled={submitting}
              />
              <span className={styles.bottomSpacer} />
              <Button
                variant="primary"
                className={styles.sendBtn}
                aria-label="发送"
                title="发送（Enter）"
                leadingIcon={<Icon icon={Send} size="sm" />}
                onClick={submit}
                disabled={submitting || draft.text.trim() === ""}
              />
            </div>
          </form>
        </div>
        <div className={styles.examples}>
          {examplesList.map((example) => (
            <button key={example} type="button" className={styles.example} onClick={() => fillExample(example)}>
              {example}
            </button>
          ))}
        </div>
        <div className={styles.tips}>
          {TIPS.map((tip) => (
            <div key={tip.name} className={styles.tip}>
              <span className={styles.tipIcon} aria-hidden="true">
                <Icon icon={tip.icon} size="md" />
              </span>
              <span className={styles.tipText}>
                <b>{tip.name}</b>
                <small>{tip.desc}</small>
              </span>
            </div>
          ))}
        </div>
        <div className={styles.foot}>
          会话在发送首条消息后才会创建，并出现在左侧目录
          <button type="button" className={styles.cancel} onClick={onCancel}>
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
