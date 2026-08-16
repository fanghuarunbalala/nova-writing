/**
 * AskQuestionCard
 *
 * 时间线内提问卡（形态对齐 docs/design/ask-user-question-demo.html 的流内组卡）：
 * pending 态逐问折叠（首问展开）、单选/多选/「其他」自填/开放填空、提交或跳过；
 * answered/skipped/expired 态原地留痕为简约单行记录（时间线即审计）。
 * context 与 option.description 走 react-markdown 渲染（与助手正文同管道，无专属特性）。
 */
import { memo, useMemo, useState } from "react";
import type { AskQuestionAnswer, AskQuestionSpec, AskingQueueItem } from "@novel/core";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronDown, CircleHelp } from "lucide-react";
import styles from "./AskQuestionCard.module.css";

export interface AskQuestionCardProps {
  /** CMS wait 队列的 asking 条目（pending = 交互态；其余 = 留痕态） */
  readonly asking: AskingQueueItem;
  /** 提交回答（pending 态） */
  readonly onResolve: (requestId: string, answers: readonly AskQuestionAnswer[]) => void;
  /** 跳过全部（pending 态） */
  readonly onSkip: (requestId: string) => void;
}

/** 单问作答草稿（本地态；picks 为选项下标集合，other/text 为自填） */
interface DraftAnswer {
  readonly picks: ReadonlySet<number>;
  readonly other: string;
  readonly text: string;
}

const EMPTY_DRAFT: DraftAnswer = { picks: new Set(), other: "", text: "" };

/** markdown 渲染（memo：context/description 原值比较，历史卡片零重解析） */
const MarkdownText = memo(function MarkdownText({ text }: { readonly text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>;
});

function isOpenQuestion(q: AskQuestionSpec): boolean {
  return q.options === undefined || q.options.length === 0;
}

function draftAnswered(q: AskQuestionSpec, draft: DraftAnswer | undefined): boolean {
  if (draft === undefined) return false;
  return isOpenQuestion(q)
    ? draft.text.trim() !== ""
    : draft.picks.size > 0 || draft.other.trim() !== "";
}

export const AskQuestionCard = memo(function AskQuestionCard({
  asking,
  onResolve,
  onSkip,
}: AskQuestionCardProps) {
  const pending = asking.status === "pending";
  const questions = asking.questions;
  const [drafts, setDrafts] = useState<ReadonlyMap<number, DraftAnswer>>(new Map());
  const [openIndex, setOpenIndex] = useState<number>(() => {
    const firstUnanswered = questions.findIndex(
      (q, i) => !draftAnswered(q, (new Map<number, DraftAnswer>()).get(i)),
    );
    return firstUnanswered === -1 ? 0 : firstUnanswered;
  });

  const answeredCount = useMemo(
    () => questions.filter((q, i) => draftAnswered(q, drafts.get(i))).length,
    [questions, drafts],
  );

  const setDraft = (index: number, patch: (prev: DraftAnswer) => DraftAnswer): void => {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(index, patch(prev.get(index) ?? EMPTY_DRAFT));
      return next;
    });
  };

  const toggleOption = (index: number, optionIndex: number): void => {
    const q = questions[index];
    if (q === undefined || isOpenQuestion(q)) return;
    setDraft(index, (prev) => {
      const picks = new Set(prev.picks);
      if (q.multiSelect === true) {
        if (picks.has(optionIndex)) picks.delete(optionIndex);
        else picks.add(optionIndex);
      } else {
        picks.clear();
        picks.add(optionIndex);
      }
      return { ...prev, picks };
    });
  };

  const submit = (): void => {
    const answers = questions.map((q, index): AskQuestionAnswer => {
      const draft = drafts.get(index);
      if (draft === undefined) return { question: q.question, selections: [], skipped: true };
      if (isOpenQuestion(q)) {
        const text = draft.text.trim();
        return text === ""
          ? { question: q.question, selections: [], skipped: true }
          : { question: q.question, selections: [], text };
      }
      const labels = (q.options ?? [])
        .filter((_, oi) => draft.picks.has(oi))
        .map((o) => o.label);
      const other = draft.other.trim();
      if (labels.length === 0 && other === "") {
        return { question: q.question, selections: [], skipped: true };
      }
      return {
        question: q.question,
        selections: labels,
        ...(other === "" ? {} : { text: other }),
      };
    });
    onResolve(asking.requestId, answers);
  };

  const skipAll = (): void => {
    onSkip(
      asking.requestId,
    );
  };

  return (
    <section className={[styles.card, pending ? "" : styles.done].join(" ")}>
      <header className={styles.head}>
        <span className={styles.headIcon}>
          {pending ? <CircleHelp size={15} strokeWidth={1.8} /> : <Check size={15} strokeWidth={2} />}
        </span>
        <b>向作者提问</b>
        <span className={[styles.count, pending ? "" : styles.countDone].join(" ")}>
          {pending
            ? `${questions.length - answeredCount} 问待答`
            : headStateLabel(asking)}
        </span>
        {pending ? (
          <span className={styles.hint}>首问已展开 · 提交后生成继续</span>
        ) : null}
      </header>
      {pending ? (
        questions.map((q, index) => {
          const answered = draftAnswered(q, drafts.get(index));
          const open = openIndex === index;
          return (
            <div
              key={`${index}-${q.question}`}
              className={[
                styles.item,
                answered ? "" : styles.itemPending,
                open ? styles.itemOpen : "",
              ].join(" ")}
            >
              <button
                type="button"
                className={styles.itemBar}
                onClick={() => setOpenIndex(open ? -1 : index)}
              >
                <span className={styles.chip}>{q.header}</span>
                <span className={styles.itemText}>
                  <b>{q.question}</b>
                  {q.multiSelect === true && !isOpenQuestion(q) ? (
                    <span className={styles.tag}>多选</span>
                  ) : null}
                </span>
                <span
                  className={[
                    styles.pill,
                    answered ? styles.pillChosen : styles.pillPending,
                  ].join(" ")}
                >
                  {answered ? "已选" : "待答"}
                </span>
                <span className={styles.chev}>
                  <ChevronDown size={13} strokeWidth={2.2} />
                </span>
              </button>
              <div className={styles.itemBody} data-open={open}>
                <div className={styles.itemBodyInner}>
                  <div className={styles.itemBodyPad}>
                    <QuestionForm
                      question={q}
                      draft={drafts.get(index) ?? EMPTY_DRAFT}
                      onToggleOption={(oi) => toggleOption(index, oi)}
                      onOtherChange={(other) => setDraft(index, (prev) => ({ ...prev, other }))}
                      onTextChange={(text) => setDraft(index, (prev) => ({ ...prev, text }))}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className={styles.recordList}>
          {questions.map((q) => (
            <div key={q.question} className={styles.recordRow}>
              <span className={styles.recordQ}>{q.question}</span>
              <span className={styles.recordArrow}>→</span>
              <span
                className={[
                  styles.recordA,
                  recordAnswerSelf(q) ? styles.recordSelf : "",
                  recordAnswerQuiet(asking, q) ? styles.recordQuiet : "",
                ].join(" ")}
              >
                {recordAnswerText(asking, q)}
              </span>
            </div>
          ))}
        </div>
      )}
      {pending ? (
        <footer className={styles.actions}>
          <span className={styles.actionHint}>跳过的问 = 授权助手自行决断并继续</span>
          <button type="button" className={styles.btnGhost} onClick={skipAll}>
            跳过全部
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={submit}
            title="提交回答（未作答的问按跳过处理）"
          >
            <Check size={12} strokeWidth={2.4} />
            提交回答（{answeredCount}/{questions.length}）
          </button>
        </footer>
      ) : null}
    </section>
  );
});

/** 单问表单体：完整问题标题 + 选择题（选项 + 其他）或开放填空（context + textarea） */
function QuestionForm({
  question,
  draft,
  onToggleOption,
  onOtherChange,
  onTextChange,
}: {
  readonly question: AskQuestionSpec;
  readonly draft: DraftAnswer;
  readonly onToggleOption: (optionIndex: number) => void;
  readonly onOtherChange: (other: string) => void;
  readonly onTextChange: (text: string) => void;
}) {
  return (
    <div>
      <div className={styles.qTitle}>{question.question}</div>
      {question.context !== undefined && question.context.trim() !== "" ? (
        <div className={styles.context}>
          <MarkdownText text={question.context} />
        </div>
      ) : null}
      {isOpenQuestion(question) ? (
        <textarea
          className={styles.openInput}
          rows={3}
          placeholder={question.placeholder ?? ""}
          value={draft.text}
          onChange={(e) => onTextChange(e.target.value)}
        />
      ) : (
        <div className={styles.optList}>
          {(question.options ?? []).map((option, oi) => (
            <div
              key={`${oi}-${option.label}`}
              className={[
                styles.opt,
                question.multiSelect === true ? styles.optMulti : "",
                draft.picks.has(oi) ? styles.optSelected : "",
              ].join(" ")}
              onClick={() => onToggleOption(oi)}
            >
              <span className={styles.optMark} />
              <span className={styles.optLabel}>
                {option.label}
                {/（推荐）$/.test(option.label) ? <span className={styles.recBadge}>推荐</span> : null}
              </span>
              <span className={styles.optDesc}>
                <MarkdownText text={option.description} />
              </span>
            </div>
          ))}
          <div
            className={[styles.opt, draft.other.trim() !== "" ? styles.optSelected : ""].join(" ")}
            onClick={() => {
              /* 其他 = 输入即选中；点击聚焦输入框 */
            }}
          >
            <span className={styles.optMark} />
            <span className={styles.optLabel}>其他</span>
            <input
              className={styles.otherInput}
              placeholder="自填你的答案"
              value={draft.other}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onOtherChange(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** 留痕答案文本：选择/自填（开放题原文、选择题带「其他：」前缀）/跳过/未回答 */
function recordAnswerText(asking: AskingQueueItem, question: AskQuestionSpec): string {
  const answer = asking.answers?.find((a) => a.question === question.question);
  if (answer === undefined) {
    return asking.status === "expired" ? "未获回答（会话中断）" : "跳过 · 授权自行决断";
  }
  if (answer.skipped === true) return "跳过 · 授权自行决断";
  const parts: string[] = [...answer.selections];
  if (answer.text !== undefined && answer.text.trim() !== "") {
    parts.push(isOpenQuestion(question) ? answer.text.trim() : `其他：${answer.text.trim()}`);
  }
  if (parts.length === 0) return "跳过 · 授权自行决断";
  const multiSuffix =
    question.multiSelect === true && answer.selections.length > 1
      ? `（多选 ${answer.selections.length} 项）`
      : "";
  return parts.join("、") + multiSuffix;
}

/** 开放题回答用正文衬线体呈现（作者原文） */
function recordAnswerSelf(question: AskQuestionSpec): boolean {
  return isOpenQuestion(question);
}

/** 跳过/未回答的弱化呈现 */
function recordAnswerQuiet(asking: AskingQueueItem, question: AskQuestionSpec): boolean {
  const answer = asking.answers?.find((a) => a.question === question.question);
  return answer === undefined || answer.skipped === true;
}

function headStateLabel(asking: AskingQueueItem): string {
  const total = asking.questions.length;
  switch (asking.status) {
    case "answered": {
      const answered = asking.answers?.filter((a) => a.skipped !== true).length ?? 0;
      return `已作答 ${answered}/${total}`;
    }
    case "skipped":
      return "已跳过";
    default:
      return "已中断";
  }
}
