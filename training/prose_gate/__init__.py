"""prose-gate 文风判官训练框架（PRD: docs/PRD/prose-gate-段级缺陷判官.md）。

数据侧（标签/词表/组窗/统计特征/LLM 标注）与模型侧（冻结编码器嵌入/torch 头训练/
推理验证）全 Python。与仓库其他部分的接口只有两个：
1. 读 evals/fixtures/books/*/book.json（书库夹具，章节文本）；
2. 复用 evals 的环境变量约定（NOVEL_EVAL_API_KEY / NOVEL_EVAL_BASE_URL /
   NOVEL_EVAL_JUDGE_MODEL）调标注 LLM。

产物 prose-gate-weights.v1.json 为语言无关契约，未来 TS runtime（M3）按同契约加载。
"""

__version__ = "0.1.0"
