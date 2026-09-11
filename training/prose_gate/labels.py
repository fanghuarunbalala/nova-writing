"""8 个段级缺陷标签定义（PRD F2，v1 冻结）。

来源：prose-quality.ts rubric 种子 + CHI2025（arXiv:2409.14509）七类缺陷分类交叉验证
+ 网文领域补充（uniformSyntax / vagueSpecificity / flatAffect）。
标注 prompt（annotate.py）由本文件单一来源生成，保证清单与 rubric 一字对应。
"""

from __future__ import annotations

from dataclasses import dataclass

LABELS_VERSION = "v1"


@dataclass(frozen=True)
class LabelDef:
	"""单个缺陷标签：key（模型头输出位）、label（中文展示名）、rubric（判定标准）、
	examples（正例句）、boundary（不算缺陷的边界条款）。"""

	key: str
	label: str
	rubric: str
	examples: tuple[str, ...]
	boundary: str


PROSE_GATE_LABELS: tuple[LabelDef, ...] = (
	LabelDef(
		key="clicheExpression",
		label="万能套话",
		rubric=(
			"可套用到任何场景的模板表达——万能表情动作（嘴角勾起一抹冷笑/眼中闪过一丝精光/"
			"眉头微挑）、\"心中涌起一股X\"、\"(情绪)在空气中弥漫\"。"
		),
		examples=("她眼底闪过一丝不易察觉的失落。", "他嘴角勾起一抹意味深长的冷笑。"),
		boundary="人物档案设定的招牌动作不算；戏仿引用不算。",
	),
	LabelDef(
		key="idiomStack",
		label="四字格堆砌",
		rubric="单段密集四字成语/对仗短语（连续 2 个以上），叙述腔脱离白描口语基准。",
		examples=("他不动声色，运筹帷幄，一切尽在掌握。", "电光火石间，天翻地覆。"),
		boundary="单个自然四字词（\"不由分说\"）不算。",
	),
	LabelDef(
		key="adjPile",
		label="修饰语堆叠",
		rubric=(
			"形容词/副词层层叠加（\"冰冷的、锋利的、泛着寒光的\"），或程度副词连用"
			"（非常/极其），动词驱动被淹没。"
		),
		examples=("那是一把冰冷的、锋利的、泛着森森寒气的匕首。",),
		boundary="单个精准形容词是正常白描。",
	),
	LabelDef(
		key="uniformSyntax",
		label="句式同构",
		rubric=(
			"该段与前后段构成连续同长同构串（≥3 段句长接近、句式开头重复、节奏无变化）。"
			"必须看上下文判定。"
		),
		examples=("连续 6 段每段都是\"他+动词+宾语。\"且段长 8-12 字",),
		boundary="有意的短促排比（rhythm 设计值）不算；对话轮替段的天然等齐不算。",
	),
	LabelDef(
		key="explainTelling",
		label="直白解说",
		rubric=(
			"情绪/动机/因果写成旁白陈述（\"他心里想：…\"\"这让他感到十分悲伤\"），"
			"而非通过动作与选择透出。"
		),
		examples=("他心里想：这个人心机太深，得防着点。", "这让他感到十分悲伤。"),
		boundary="极简陈述（\"他没说话。\"）不算；低密度直陈可容忍。",
	),
	LabelDef(
		key="genericMetaphor",
		label="万能比喻",
		rubric="换任何场景都成立的空泛比喻/排比抒情（\"命运像一条河流\"\"仿佛整个世界都…\"）。",
		examples=("夜色像墨一样浓，思念像水一样长。", "命运像一条河流，裹挟着他向前。"),
		boundary="绑定场景内具体物象的比喻是本书风格特征（好写法），不算。",
	),
	LabelDef(
		key="vagueSpecificity",
		label="空泛不具体",
		rubric=(
			"段落停留在概括层，无可感细节（无具体动作/物象/数字/感官），读者无法成像"
			"（如\"街上很热闹，充满了生活的气息\"）。"
		),
		examples=("街上很热闹，人来人往，充满了生活的气息。", "他的内心十分复杂，久久不能平静。"),
		boundary="承上启下的过渡段、极简对话段天然短虚，看是否\"该具体处不具体\"。",
	),
	LabelDef(
		key="flatAffect",
		label="情绪无波动",
		rubric=(
			"该段处于情绪强度无起伏的连续串中——整个窗口情绪一条直线（紧张度无升降、"
			"无蓄势与释放），且非有意留白蓄势。必须看整个窗口的情绪走向判定。"
		),
		examples=("整窗 8 段读下来紧张度始终居中，无任何升降与转折",),
		boundary=(
			"克制白描把情绪藏在动作物象里≠无情绪（判走向变化，不判形容词浓淡）；"
			"过渡/铺垫段天然低强度不算；与\"空泛不具体\"独立（细节具体也可能情绪平直）。"
		),
	),
)

LABEL_KEYS: tuple[str, ...] = tuple(d.key for d in PROSE_GATE_LABELS)


def label_by_key(key: str) -> LabelDef:
	for d in PROSE_GATE_LABELS:
		if d.key == key:
			return d
	raise KeyError(f"未知标签 key: {key}（labels v{LABELS_VERSION}）")
