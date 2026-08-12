/** 系统提示词分段：静态不重复渲染，动态每次 provider call 重新生成 */
export interface PromptSection {
  /** 分段类型：static 静态 / dynamic 动态 */
  kind: "static" | "dynamic";
  /** 分段内容 */
  content: string;
}
