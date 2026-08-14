/**
 * ExitComposeApprovalView
 *
 * ExitComposeMode 审批详情：提交设计草稿（DesignCard 全文渲染，无上限）。
 * 内容不经审批 payload 传输——经 platform designFile 能力按会话读 design 文件；
 * 无能力时降级只读提示（web 等非桌面场景，DesignCard 自带）。
 */
import { DesignCard } from "../../conversation/components/DesignCard.js";
import styles from "./ExitComposeApprovalView.module.css";

export interface ExitComposeApprovalViewProps {
  /** 发起会话 id（design 文件按会话定位） */
  readonly conversationId: string;
}

/** 退出设计模式审批视图：pending 态 DesignCard（md 全文 + 阶段徽标「待审批」） */
export function ExitComposeApprovalView({ conversationId }: ExitComposeApprovalViewProps) {
  return (
    <div className={styles.view}>
      <DesignCard conversationId={conversationId} phase="pending" />
    </div>
  );
}
