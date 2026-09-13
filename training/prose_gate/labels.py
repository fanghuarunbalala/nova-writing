"""段级标注 schema v3：11 个缺陷标签 + 情绪线（逐段 0-3 绝对强度）。

v1 → v2：flatAffect（情绪无波动）从标注标签中移除——平直是窗口级序列属性，
逐段二元判不可锚定且证据不可引用。改为标注逐段情绪强度（描述性、有内容锚），
平直由规则派生（derive_flat，阈值常量可调，不冻死在标注时刻）。
转折线 = 情绪线相邻差分，同样派生。

v2 → v3：试标期完备性审计四观察入账，新增 4 标签——
- logicJump 逻辑断裂（话语连贯：连接词空转/事件跳步/指代悬空）；
- awkwardDiction 用词错位（CHI2025 Awkward Word Choice 收编：搭配/语域错配；
  与套话分界=有无模板血统）；
- voiceFlat 声音同腔（窗口内多角色对白同质化，判官可做的窗口内层）；
- surfaceError 表层瑕疵（标点/错字；规则层可查的照判，标注值兼作规则校准统计）。

来源：prose-quality.ts rubric 种子 + CHI2025（arXiv:2409.14509）七类缺陷分类交叉验证
+ 网文领域补充（uniformSyntax / vagueSpecificity）+ 试标期"其他"观察（v3）。
标注 prompt（annotate.py）由本文件单一来源生成，保证清单与 rubric 一字对应。
"""

from __future__ import annotations

from dataclasses import dataclass

LABELS_VERSION = "v3"


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
		key="logicJump",
		label="逻辑断裂",
		rubric=(
			"该段与上下文的因果/转折/时序衔接断裂：连接词空转（\"却/但/因此\"无对应逻辑支撑，"
			"对比轴未建立）、事件跳步需读者自行补桥、指代悬空（\"这件事\"无先行）。必须看上下文判定。"
		),
		examples=(
			"他暑假练了三个月的架子还算稳，可一想到要上台自我介绍，胃里就像塞了块凉铁。（\"可\"对比的身体/心态轴未点明）",
		),
		boundary="有意的悬念/倒叙留白不算；网文省略常识性过渡（\"三日后\"）不算；快节奏蒙太奇不算。",
	),
	LabelDef(
		key="awkwardDiction",
		label="用词错位",
		rubric=(
			"词语与语境不合：搭配不地道（书面语/学术腔焊在口语或身体感受上）、语域错配"
			"（跨文体进货，如言情腔进武道文）、生造词、明显别字近音字。"
		),
		examples=("心跳失序。", "他周身的气场骤然坍缩。"),
		boundary=(
			"有模板血统的现成件判套话（clicheExpression），纯搭配/语域错位才判本标签；"
			"人物口癖/方言/有意玩梗不算；网络流行语按本书风格基准判。"
		),
	),
	LabelDef(
		key="voiceFlat",
		label="声音同腔",
		rubric=(
			"窗口内多个角色的对白说话方式无差异——都像叙述腔念引号（用词习惯/句长/语气词/"
			"吐槽方式趋同），遮住署名分不清谁在说话。必须看窗口内多角色对白判定。"
		),
		examples=("甲：\"这个问题需要从长计议。\"乙：\"你的想法有一定道理。\"——两个损友聊成了两个客服。",),
		boundary="单角色/无对白窗口不判；同角色连续发言不算；角色设定本就少言/正式（老师、长官）不算；旁白转述不算对白。",
	),
	LabelDef(
		key="surfaceError",
		label="表层瑕疵",
		rubric="表层文字错误：重复或缺失标点（\"。。\"）、引号不配对、半全角混用、错别字、明显漏字。",
		examples=("脚步却在那扇场馆正门前慢了下来。。", "\"你走吧。——引号未闭合"),
		boundary="只判表层不判风格（标点风格设计如一句一段的句号流不算）；规则层可机器查到的照判——标注值兼作规则校准与统计。",
	),
)

LABEL_KEYS: tuple[str, ...] = tuple(d.key for d in PROSE_GATE_LABELS)


# ---------- 情绪线（v2 新增：逐段绝对强度，描述不评价） ----------

EMOTION_MAX = 3


@dataclass(frozen=True)
class EmotionLevel:
	"""情绪线档位：value 为强度、name 为展示名、anchor 为标注锚（内容锚定，非评价）。"""

	value: int
	name: str
	short: str
	anchor: str


EMOTION_LEVELS: tuple[EmotionLevel, ...] = (
	EmotionLevel(0, "平静", "平", "无情绪电荷：环境、过渡、纯信息段。"),
	EmotionLevel(1, "微澜", "微", "轻微冷暖：日常对话里的小嗔小喜、隐隐不安。"),
	EmotionLevel(2, "明显", "显", "明确情绪：怒、惧、狂喜，有身体反应与语气变化。"),
	EmotionLevel(3, "剧烈", "剧", "顶点：爆发、崩溃、生死时刻。"),
)

# 派生平直（窗口级，代码可调不进标注）：情绪线极差 ≤ FLAT_RANGE_MAX 判平直。
# 覆盖低位平直（全程死水）与高位平直（全程爆发=没有爆发）两种形态。
FLAT_RANGE_MAX = 1

# 派生转折（相邻差分）：|Δ| ≥ TURN_DELTA_MIN 视为一次有效情绪转折。
TURN_DELTA_MIN = 1


def clamp_emotion(value: object) -> int:
	"""任意输入 → 合法档位（非法/越界收到 0-3）。"""
	try:
		return max(0, min(EMOTION_MAX, int(value)))  # type: ignore[arg-type]
	except (TypeError, ValueError):
		return 0


def derive_flat(emotion: list[int]) -> bool:
	"""窗口平直 = max(情绪线) - min(情绪线) <= FLAT_RANGE_MAX。"""
	if not emotion:
		return False
	return max(emotion) - min(emotion) <= FLAT_RANGE_MAX


def derive_turns(emotion: list[int]) -> list[int]:
	"""转折线（派生）：相邻差分，|Δ| >= TURN_DELTA_MIN 记一次转折。"""
	turns = []
	for prev, cur in zip(emotion, emotion[1:]):
		turns.append(cur - prev if abs(cur - prev) >= TURN_DELTA_MIN else 0)
	return turns


def label_by_key(key: str) -> LabelDef:
	for d in PROSE_GATE_LABELS:
		if d.key == key:
			return d
	raise KeyError(f"未知标签 key: {key}（labels {LABELS_VERSION}）")
