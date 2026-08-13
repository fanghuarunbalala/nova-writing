/**
 * ConversationCardDescriptor
 *
 * 结构化卡片的可序列化描述（text/proposal/diff/table/quote/plan）。
 * 全部为纯数据：富文本以 RichText 节点树表示，由组件负责渲染。
 */
export type RichText =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "bold"; readonly children: readonly RichText[] }
  | { readonly kind: "highlight"; readonly children: readonly RichText[] }
  | { readonly kind: "code"; readonly text: string }
  | {
      readonly kind: "reference";
      readonly refKind: "character" | "location" | "outline";
      readonly id: string;
      readonly label: string;
    };

export interface ProposalOpData {
  readonly id: string;
  readonly mark: "add" | "mod" | "del" | "move" | "plan";
  readonly description: RichText;
  readonly kind:
    | "manuscript"
    | "outline"
    | "character"
    | "location"
    | "todo"
    | "plan"
    | "scope";
}

export interface TextCardContent {
  readonly richText: RichText;
}

export interface ProposalCardContent {
  readonly tag: "plan" | "proposal" | "applied";
  readonly title: string;
  readonly meta?: string;
  readonly ops: readonly ProposalOpData[];
  readonly changeSetId?: string;
}

export interface DiffCardContent {
  readonly changeSetId: string;
  readonly summary: string;
}

export interface TableCardContent {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly RichText[])[];
}

export interface QuoteCardContent {
  readonly text: RichText;
  readonly attribution?: string;
}

export interface PlanCardContent {
  readonly ops: readonly ProposalOpData[]; // only todo/plan/scope kinds
}

export type ConversationCardDescriptor =
  | { readonly kind: "text"; readonly id: string; readonly content: TextCardContent }
  | { readonly kind: "proposal"; readonly id: string; readonly content: ProposalCardContent }
  | { readonly kind: "diff"; readonly id: string; readonly content: DiffCardContent }
  | { readonly kind: "table"; readonly id: string; readonly content: TableCardContent }
  | { readonly kind: "quote"; readonly id: string; readonly content: QuoteCardContent }
  | { readonly kind: "plan"; readonly id: string; readonly content: PlanCardContent };
