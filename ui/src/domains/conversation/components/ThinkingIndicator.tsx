/**
 * ThinkingIndicator
 *
 * 消息流内的思考进行中指示（替代思考块）：复用三态统一语言的思考态
 * （大脑 + info 蓝渐变 + 呼吸动效），与 composer 状态行一致。
 * 只在流式思考期间渲染（streaming && 有思考行），完成后消失。
 */
import { RuntimeStatusIndicator } from "./RuntimeStatusIndicator.js";
import styles from "./ThinkingIndicator.module.css";

export function ThinkingIndicator() {
  return (
    <div className={styles.indicator} role="status">
      <RuntimeStatusIndicator state="thinking" />
    </div>
  );
}
