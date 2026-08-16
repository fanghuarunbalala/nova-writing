/**
 * AskRecordCard
 *
 * 提问留影卡（askRecord 时间线项）：AskUserQuestion 工具回填后由投影层的
 * ask 载荷派生，journal 重放同路径——重开会话后富答案记录在精确历史位置重建。
 * result 为工具回填文本（行格式「- 『题目』选择：…」），逐行解析为「题目 → 答案」；
 * 解析不入的行（如首行汇总、全跳过文案）原样弱化呈现。
 */
import { memo } from "react";
import type { AskQuestionSpec } from "@novel/core";
import { Check, CircleHelp } from "lucide-react";
import styles from "./AskQuestionCard.module.css";

export interface AskRecordCardProps {
	readonly toolCallId: string;
	readonly questions: readonly AskQuestionSpec[];
	readonly result: string;
}

/** 单行解析结果：q（题目）与 a（答案）成对；不成对行原样落入 a */
interface RecordLine {
	readonly q?: string;
	readonly a: string;
	readonly quiet?: boolean;
}

const ANSWER_LINE_RE = /^-\s*「(.+?)」(.*)$/;

function parseResultLines(result: string): readonly RecordLine[] {
	return result
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.map((line): RecordLine => {
			const match = ANSWER_LINE_RE.exec(line);
			if (match === null || match[1] === undefined || match[2] === undefined) {
				return { a: line };
			}
			return { q: match[1], a: match[2] };
		});
}

export const AskRecordCard = memo(function AskRecordCard({
	toolCallId,
	questions,
	result,
}: AskRecordCardProps) {
	const lines = parseResultLines(result);
	const allSkipped = result.includes("作者跳过了全部问题");
	return (
		<section className={[styles.card, styles.done].join(" ")} data-tool-call-id={toolCallId}>
			<header className={styles.head}>
				<span className={styles.headIcon}>
					{allSkipped ? (
						<CircleHelp size={15} strokeWidth={1.8} />
					) : (
						<Check size={15} strokeWidth={2} />
					)}
				</span>
				<b>向作者提问</b>
				<span className={[styles.count, styles.countDone].join(" ")}>
					{allSkipped ? "已跳过" : `已作答 · ${questions.length} 问`}
				</span>
			</header>
			<div className={styles.recordList}>
				{lines.map((line, index) => (
					<div key={index} className={styles.recordRow}>
						{line.q !== undefined ? (
							<>
								<span className={styles.recordQ}>{line.q}</span>
								<span className={styles.recordArrow}>→</span>
							</>
						) : null}
						<span className={[styles.recordA, line.q === undefined ? styles.recordQuiet : ""].join(" ")}>
							{line.a}
						</span>
					</div>
				))}
			</div>
		</section>
	);
});
