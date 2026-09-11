# WebNovelBench：将 LLM 小说家置于网络小说的分布之上

> **中文译名**：WebNovelBench：将 LLM 小说家置于网络小说的分布之上
> **英文原题**：WebNovelBench: Placing LLM Novelists on the Web Novel Distribution
> **作者**：Leon Lin（南洋理工大学）、Jun Zheng（中山大学）、Haidong Wang（中山大学）
> **发表信息**：EACL 2026 Findings；arXiv:2505.14818v1 [cs.CL]，2025 年 5 月 20 日提交
> **arXiv 链接**：https://arxiv.org/abs/2505.14818
> **代码与数据**：https://github.com/OedonLestrange42/webnovelbench ／ https://huggingface.co/datasets/Oedon42/webnovelbench
>
> 本文件为 AI 辅助全文翻译，术语以首次出现时"中文（English）"标注。

---

## 摘要

稳健地评估大语言模型（Large Language Models, LLM）的长篇叙事能力仍然是一项重大挑战，因为现有基准（benchmark）往往缺乏必要的规模、多样性或客观度量。为此，我们提出 WebNovelBench——一个专为长篇小说生成评估而设计的新基准。WebNovelBench 利用一个包含 4,000 余部中文网络小说的大规模数据集，将评估构建为"梗概到故事"（synopsis-to-story）生成任务。我们提出了一个多维度框架，涵盖八个叙事质量维度，并通过"LLM 作为裁判"（LLM-as-Judge）方法自动评分。各维度得分经主成分分析（Principal Component Analysis, PCA）聚合后，映射为相对于人类作者作品的百分位排名（percentile rank）。我们的实验表明，WebNovelBench 能够有效区分人类名著、热门网络小说与 LLM 生成的内容。我们对 24 个最先进的 LLM 进行了全面分析，对它们的叙事能力进行排名，并为未来发展提供洞见。该基准为评估和推进 LLM 驱动的叙事生成提供了一种可扩展、可复现、数据驱动的方法论。

## 1 引言

大语言模型能否生成超越人类作品的故事？以 GPT-4o 和 DeepSeek-R1（DeepSeek-AI et al., 2025a）等模型为代表的最新突破，凸显了它们产出连贯、富有想象力且语境细腻的叙事的卓越能力。这引出了有趣的问题：当今的 LLM 在故事生成方面究竟有多强？其输出与人类作品相比又如何？

在这样一个开放性领域评估 LLM 的表现仍然是一项重大挑战。尽管已有研究探索过故事生成的评估（Guan et al., 2021; Liu et al., 2024; Paech, 2024; Ismayilzada et al., 2025），但这些工作往往面临数据集规模偏小或故事多样性不足等局限，阻碍了其被广泛采纳。这与代码生成和数学推理等领域形成对比——在这些领域，CodeForces Rating（Quan et al., 2025）和美国数学邀请赛 2024（American Invitational Mathematics Examination 2024, AIME 2024）（MAA, 2024）等基准已成为广为接受的标准。

受此类成功经验的启发，我们提出 WebNovelBench——一个遵循以下三项关键原则的全面而直观的故事生成基准：

- **广泛的数据基础（Broad Data Foundation）**：采用多样化、受欢迎的人类作者作品。
- **有代表性的任务（Representative Tasks）**：覆盖多样的叙事风格、题材与复杂度（详见 3.1 节）。
- **自动化且客观的评估（Automated and Objective Evaluation）**：通过稳健、一致的自动化方法将主观性降至最低。

我们利用 4,000 余部热门中文网络小说（每部读者数均超过 10,000）构建"梗概到故事"生成任务，并采用"LLM 作为裁判"方法从八个叙事维度评估故事。以茅盾文学奖（Mao Dun Literature Prize）获奖小说进行的验证获得了很高的分数（图 1），证实了该框架与人类判断的一致性。因此，WebNovelBench 无需大量人工干预即可自动评估 LLM 的叙事能力，建立起与人类作品进行比较的标准化框架。总而言之，我们的主要贡献如下：

- 我们提出 WebNovelBench，一个大规模、数据驱动的故事生成评估框架，通过分布分析对人类作者故事与 LLM 生成故事进行精确排名。

> **图 1**（原文图像见 PDF）：网络小说数据集分布与 LLM 定位。我们网络小说数据集的质量分布，分为低、中、高三个区间（95% 置信区间）。红色曲线（经典文学作品）用于验证高质量区间。24 个 LLM 的位置表示它们相对于该语料库的表现。

- 我们为中文故事质量定义了八个评估维度，并采用经过验证的"LLM 作为裁判"机制实现稳健的自动化评估。
- 我们对 24 个最先进的 LLM 进行了全面评估，将其叙事能力与人类作品进行对比排名，并为未来发展提供洞见。

## 2 相关工作

### 2.1 LLM 通用基准

MMLU（Hendrycks et al., 2021）及其变体（Wang et al., 2024; Yue et al., 2024）等通用 LLM 基准，以及 MixEval（Ni et al., 2024）等动态基准，对于评估推理、知识回忆等广泛能力极具价值。然而，它们往往缺乏有效评估长篇故事生成这类创造性、开放性任务所需的细致而专门的准则，尤其是在叙事质量、连贯性与创造力方面。这凸显了在创造性领域建立专门基准的必要性，类似于编程与数学领域的 CodeForces Rating（Quan et al., 2025）、SWE-Bench Verified（Jimenez et al., 2024）与 AIME 2024（MAA, 2024）。

### 2.2 故事生成基准

以往关于 LLM 生成故事评估的工作探索了创造力（Ismayilzada et al., 2025; Paech, 2024）以及自动指标与人类判断的相关性（Guan et al., 2021）。例如，Ismayilzada et al. (2025) 评估了 LLM 在短篇故事生成中的创造力，但每个 LLM 仅使用了四个样本；EQ-Bench（Paech, 2024）基于仅有的三十二条提示词给出创意写作分数；OpenMEVA（Guan et al., 2021）提供了一个评估自动指标的框架，但并未关注广泛的数据集多样性。这些既有工作往往受限于数据集规模偏小或故事多样性不足，难以建立起普遍接受的标准。我们的工作旨在填补这一空白：强调源自被广泛阅读的网络小说的大规模、多样化数据集，以及稳健的自动化评估流程。

### 2.3 LLM 作为裁判

面向开放性文本生成的自动化评估日益采用"LLM 作为裁判"（LLM-as-a-Judge）范式（Zheng et al., 2023），即由 LLM 在没有参考文本的情况下评估输出（Li et al., 2024; Kasner and Dusek, 2024）。虽然这一范式有望与人类偏好对齐，但其可靠性令人担忧，相关研究集中于公平性与潜在偏差（Shi et al., 2025; Zhang et al., 2023; Ye et al., 2024）。例如，Ye et al. (2024) 提出了 CALM 来识别和量化 LLM 裁判中的偏差。这些研究凸显了谨慎设计与验证 LLM 裁判组件的重要性，而我们在 WebNovelBench 中正是通过基于多维度准则的可靠、公平的故事评估来回应这一点。

## 3 基准构建

### 3.1 数据集

我们从 10,000 余部中文网络小说（发表于 2013–2020 年）中，经过若干预处理步骤筛选出一个数据集：

- **去重（Deduplication）**。一些文本文件可能在不同标题下包含高度相似的内容，表明它们实为同一部小说。直接进行精确字符匹配不足以识别重复项。为此，我们使用 difflib[^1] 计算两两相似度分数，并移除相似度大于 0.9 的小说。
- **章节解析（Chapter Parsing）**。网络小说通常是以连载章节形式呈现的长篇叙事。然而，原始抓取的文本缺少明确的章节分隔符。为提取章节，我们针对中文网络小说中常见的章节格式设计了正则表达式模式。章节数少于十章的小说被剔除，因为它们不符合我们对"长篇"（long-form）的定义，或提示解析不完整。
- **尾部作者移除（Tail Author Removal）**。通常可以观察到，成功的作者往往会随时间推移发表多部小说。基于这一观察，我们编制了所有作者的列表，并剔除了作品数量最少的那批作者所写的小说。经过这一过滤步骤，我们最终保留了 4,000 部网络小说。

经过筛选的 4,000 部小说覆盖了多样题材（如东方玄幻 1281 部、现实题材 1255 部、西方奇幻 670 部、历史 234 部，另有科幻、悬疑、言情等，并带有"原创世界设定"之类的多样子题），从而确保了"有代表性的任务"。这种广度反映了热门网络文学的复杂多样。

对于"梗概到故事"任务，我们使用豆包 Doubao-pro-32k[^2] 为每部小说中随机抽取的十个连续章节生成"梗概"（主要人物、关键情节要点、重要场景）。这样，每部小说得到十个 <章节内容, 梗概> 对（详见附录 A）。

### 3.2 评估指标

我们使用八个关键维度（表 1）评估叙事质量，覆盖风格与结构要素（如文学手法、角色一致性）。这提供了超越表层流畅度的细致评估。

### 3.3 评分方法

为了将 LLM 作品与我们的 4,000 部人类作者网络小说进行排名，我们结合主成分分析（PCA）（Hotelling, 1933）进行多维得分聚合，并使用经验累积分布函数（Empirical Cumulative Distribution Function, ECDF）（Conover, 1999）进行百分位排名。

**基于 PCA 的得分聚合。** 给定一个包含 N 个样本的数据集，其中每个样本沿 d 个维度被评估，我们首先使用 z 分数标准化（z-score standardization）对所有维度得分进行归一化：

$$z_{ij} = \frac{x_{ij} - \mu_j}{\sigma_j}, \qquad i \in [1, N],\ j \in [1, d], \tag{1}$$

其中 $x_{ij}$ 是第 $i$ 个样本在第 $j$ 个维度上的原始得分，$\mu_j$ 与 $\sigma_j$ 分别是第 $j$ 个维度在所有样本上的均值与标准差。

> 译注：提取文本中 σ 符号丢失，此处依上下文（"均值与标准差"）还原为 $\sigma_j$。

然后我们对标准化后的数据执行 PCA 以提取第一主成分，其归一化载荷向量 $w = (w_1, w_2, \ldots, w_d)$ 表示各维度的相对重要性。第 $i$ 个样本的聚合综合得分 $s_i$ 由加权和计算得到：

$$s_i = \sum_{j=1}^{d} w_j\, z_{ij} \tag{2}$$

**基于 ECDF 的百分位排名。** 为了将原始得分转换为可解释的相对排名，我们在所有聚合得分 $\{s_1, s_2, \ldots, s_N\}$ 上应用 ECDF：

$$\mathrm{ECDF}(x) = \frac{1}{N} \sum_{i=1}^{N} I(s_i \le x), \tag{3}$$

其中 $I(\cdot)$ 为指示函数（indicator function）。ECDF 给出 [0, 1] 区间内的百分位分数，表示得分小于或等于 x 的样本比例。

给定一个新的 LLM 生成样本，其聚合得分为 $s_{\text{new}}$，其百分位排名为 $P_{\text{new}} = \mathrm{ECDF}(s_{\text{new}})$。该百分位反映了模型相对于参考数据集完整经验分布的表现——即 LLM 所生成故事可与人类所写故事相媲美的水平。通过在多批测试样本上评估模型，我们可以估计该 LLM 的整体写作能力。

设 $B = \{s_{LM}^{(1)}, s_{LM}^{(2)}, \ldots, s_{LM}^{(M)}\}$ 为一批 M 个 LLM 生成样本的聚合得分集合。估计写作水平定义为平均百分位：

$$\hat{P}_{LLM} = \frac{1}{M} \sum_{m=1}^{M} \mathrm{ECDF}\!\left(s_{LM}^{(m)}\right) \tag{4}$$

> 译注：提取文本中式 (4) 及集合 B 的上下标符号存在乱码（如 "sL(1L)M"），此处按上下文还原为 $s_{LM}^{(m)}$。

$\hat{P}_{LLM} \in [0, 1]$ 的值表示 LLM 输出相对于参考数据集中人类文本分布的期望百分位排名。

> **图 2**（原文图像见 PDF）：我们方法的框架。我们的基准框架由四个主要部分组成：(1) 数据准备阶段：我们收集并整理一个大规模网络小说数据集，并使用豆包进行"故事到梗概"提取，构建包含 4,000 部小说的梗概-故事数据集。(2) 分布构建：使用 LLM 裁判从八个质量维度对每个故事打分，随后通过 PCA+ECDF 形成质量分布基准；经典文学作品用于验证分布的高端。(3) 模型评估：LLM 从数据集的选定子集生成故事，其输出被打分并映射到分布上，以评估模型表现。(4) 临时评估（Ad Hoc Evaluation）：新数据可被打分并与基准对齐，用于度量数据质量并支持进一步应用。

## 4 实验与结果

### 4.1 实验设置

由于资源限制，我们的评估数据集使用了 100 部网络小说（从 4,000 部小说的分布中每个百分位各取一部），每部小说 10 个梗概-故事对（共 1,000 个测试样本）。某个 LLM 的整体排名是其在这 100 本书上的平均百分位。

各 LLM（开源与闭源）均通过 API 访问，使用标准化的系统提示词和恒定的生成设置（最大 4096 token，温度 0.6，提示词中包含八条评估标准；见附录 A）。输出由 DeepSeek-V3 使用一致的评估提示词进行评估。关于稳健性分析的细节，见下文 5.3 节。

**表 1：叙事评估指标与 PCA 导出的权重。** 本表列出用于评估叙事质量的八个维度。每个权重反映该指标的相对重要性，由网络小说得分上的 PCA 导出。

| 指标 | 说明 | 权重 |
| --- | --- | --- |
| D1：文学手法运用（Use of Literary Devices） | 隐喻、象征等修辞手法的数量与质量 | 0.1304 |
| D2：感官细节丰富度（Richness of Sensory Detail） | 视觉、听觉及其他感官描写出现的频率 | 0.1160 |
| D3：角色出场均衡度（Balance of Character Presence） | 每个角色的出场频率、对话占比与心理刻画深度 | 0.1152 |
| D4：角色对话辨识度（Distinctiveness of Character Dialogue） | 对话是否体现鲜明的个性 | 0.1171 |
| D5：人物塑造一致性（Consistency of Characterisation） | 语言与行动是否契合角色身份 | 0.1377 |
| D6：氛围与主题契合度（Atmospheric and Thematic Alignment） | 场景是否支撑整体氛围与主题 | 0.1290 |
| D7：情境适切性（Contextual Appropriateness） | 设定是否与时代/地点/文化背景相符 | 0.1281 |
| D8：场景间连贯性（Scene-to-Scene Coherence） | 场景转换是否流畅自然 | 0.1263 |

### 4.2 主实验

我们在基准上共评估了 13 个开源模型和 11 个闭源模型。图 3 展示了这些前沿模型在八个不同叙事评估维度上的表现及总体效果。

顶尖模型（Qwen3-235B-A22B（Yang et al., 2025）、DeepSeek-R1（DeepSeek-AI et al., 2025a）、Gemini-2.5-Pro）在各维度上得分很高（3.5–4.6）；Qwen3-235B-A22B 取得 5.21 的归一化得分（norm score），表明其与高质量人类写作高度对齐。中游模型（如 GPT-4o、DeepSeek-V3（DeepSeek-AI et al., 2025b））表现不一（得分 2.5–3.8），凸显了感官细节与文学手法运用等方面仍有提升空间。排名较低的模型（如 GLM-4-9B-chat（GLM et al., 2024）、LLaMA-3-8B（Grattafiori et al., 2024））表现持续较差（归一化得分低于 2.0），尤其是在文学手法与角色对话方面，表明其——特别是开源或较小规模的 LLM——仍有很大改进空间。

我们分析中一个有趣的观察是，顶级闭源模型（如 Claude-3-7-Sonnet 与 GPT-4.1）与领先开源模型（Qwen 系列与 DeepSeek 模型）之间的表现差距相对较小，这表明开源社区正在迅速弥合专有模型传统上保持的性能差距。

总体而言，该基准有效捕捉了当前各 LLM 的独特优势与不足。尽管最先进的模型在我们的分布中取得了接近完美的分数，展示了它们在"故事到梗概"（story-to-synopsis）数据集上的强劲表现，但这并不减损该基准的价值。相反，这验证了我们最初的直觉。我们的主要目标是评估当代 LLM 的故事生成能力，而结果表明领先模型已达到与网络小说顶级作品相当的水平。本研究主要提出的是一个方法论框架；若要更细粒度的评估，未来的工作可以收集更高质量的参考文本或设计更细致的评估维度。

> **图 3**（原文图像见 PDF）：LLM 在各叙事维度上的表现热图。展示 24 个 LLM 在八个维度上的平均得分（1–5 分制），按百分位排名排序。最后一列为 PCA 加权得到的归一化得分。得分越高表示与高质量人类写作的对齐程度越好。

### 4.3 与其他基准的比较

为彰显我们的贡献，我们将 WebNovelBench 与现有的故事生成评估基准进行了比较，如表 2 所示。OpenMEVA（Guan et al., 2021）提供了一个使用现有 400 篇故事数据集来评估自动指标的框架。它与人类偏好对齐并使用 8 个评估维度。然而，它并未采用维度权重来聚合分数，这可能将叙事质量的各个方面视为同等重要，未必能反映细致的人类判断。AlignBench 写作能力（Liu et al., 2024）使用自建的 75 篇故事数据集。虽然它考虑了人类偏好并在 5 个维度上进行评估，但其数据集规模相对较小，可能限制其所覆盖的叙事风格与情境的多样性。与 OpenMEVA 类似，其评分未纳入维度权重。EQ-Bench 长篇创意写作（Paech, 2024）聚焦长篇创意写作，使用自建的 12 篇故事（每篇 8 章）数据集，采用 14 个维度的综合集合。然而，据可得信息，它并未明确使其数据集构建与广泛的人类偏好对齐（例如通过源文本的流行度指标），也缺乏对其众多维度得分进行加权聚合的方法。Ismayilzada et al. (2025) 的工作使用现有数据集评估创意短篇故事生成。虽然它与人类偏好对齐并使用 4 个评估维度，但每个 LLM 仅 4 篇故事的极小测试集严重限制了其结论的稳健性与泛化性，它同样未使用维度权重。相比之下，WebNovelBench 具有以下几项关键优势：

- **规模与多样性**：基于 4,000 余部网络小说构建，测试使用 100 个不同的故事（每个 10 章，共 1,000 个实例），确保广泛的题材/风格覆盖。
- **内在的人类偏好对齐**：以热门网络小说（每部读者超过 10,000 人）为来源，我们的基准天然涵盖了广泛的人类文学偏好。
- **数据驱动的维度加权**：PCA 为 8 个叙事维度导出权重，提供细致、客观的评估，反映各维度在人类作品中的相对重要性。
- **全面而聚焦的评估**：八个精心定义的维度对关键叙事要素提供了既全面又聚焦的评估。

**表 2：与其他基准的比较**

| 基准 | 数据来源 | 测试样本 | 人类偏好对齐 | 维度权重 | 评估维度数 |
| --- | --- | --- | --- | --- | --- |
| OpenMEVA（Guan et al., 2021） | 现有数据集 | 400 篇故事 | ✓ | ✗ | 8 |
| AlignBench 写作能力（Liu et al., 2024） | 自建 | 75 篇故事 | ✓ | ✗ | 5 |
| EQ-Bench 长篇创意写作（Paech, 2024） | 自建 | 12 篇故事，每篇 8 章 | ✗ | ✗ | 14 |
| Ismayilzada et al. (2025) | 现有数据集 | 4 篇故事 | ✓ | ✗ | 4 |
| WebNovelBench（本文） | 网络小说 | 100 篇故事，每篇 10 章 | ✓ | ✓ | 8 |

> 译注：原表中的对勾/叉号符号在 pdftotext 提取中丢失，上表的 ✓／✗ 依据正文对各基准的文字描述还原。

> **图 4**（原文图像见 PDF）：叙事指标的分布与拟合正态曲线。每个子图展示某个叙事评估维度在网络小说数据集上的经验分布（实线），以及相应的拟合正态分布（虚线）。该对比展示了真实数据分布形态的差异，并突显其偏离正态之处。右下面板展示平均得分的总体分布。

这些特性使 WebNovelBench 成为评估和推进 LLM 驱动叙事生成（尤其是中文网络小说领域的长篇故事）的稳健、可扩展且可复现的方案。

## 5 合理性分析

### 5.1 指标分析

为评估所提出的八个评估指标的合理性与有效性，我们进行了细致的统计分析，结合了主成分分析（PCA）与分布可视化。

**主成分分析。** PCA 显示第一主成分解释了 75.6% 的方差（前三个主成分合计超过 90%），表明这些指标捕捉到一个主导性的质量因子。导出的权重（11.5%–13.8%）较为均衡，其中"人物塑造一致性"（表 1）最高，反映了其区分能力。[^3]

**分布特征。** 通过核密度估计（kernel density estimation, KDE）（Parzen, 1962）得到的每个指标的概率密度函数（PDF），与其最佳拟合正态分布一同绘制，以评估其形态特征（图 4）。大多数指标（如 D2、D3、D4 和 D6）呈现近似高斯的行为，意味着平滑、良好的得分分布，有利于比较评估。

诸如 D1（文学手法运用）与 D7（情境适切性）等指标表现出对正态性的轻度偏离，出现偏态或轻微多峰的迹象。这些偏离很可能反映了内容子群的存在，例如人类文本与 LLM 生成文本之间文体密度的差异，或语境嵌入显式程度的差异。重要的是，对所有维度取平均后得到的聚合分布与高斯分布高度吻合，进一步验证了将这些指标整合为一个连贯的综合得分。**含义。** PCA 与分布分析证实我们的指标结构良好、多样、互补且稳健，适用于对人类与 LLM 叙事的大规模评估。

### 5.2 经典文学比较

我们以 25 部茅盾文学奖获奖小说（各取前 10 章）验证了基准。如图 1 所示，这些经典作品的得分始终位于高区间，证实了我们框架捕捉公认文学价值的能力。

这一比较分析不仅与人类评估判断相一致，也证实了研究所涉及的三类文本——经典作品、网络小说与 LLM 生成内容——之间预期的质量层级。这些发现验证了基准对文本质量细微差异的敏感性，及其在反映多元来源相对文学价值方面的稳健性。此外，基于该分布将 LLM 生成输出划分为三个不同的质量层级，也显得可信且有据。

### 5.3 LLM 作为裁判

为了在自动评估中排除人工参与，我们采用"LLM 作为裁判"范式，并选用 DeepSeek-V3 作为评估器——它目前是最先进的中文语言模型之一。根据我们的直觉与经验观察，不具备显式思维链（chain-of-thought）推理的模型在此类分类任务上往往执行得更高效、更有效。为缓解位置偏差（position bias）与上下文长度偏差（context-length bias）——Ye et al. (2024) 已证明这些问题会显著影响成对比较方法——我们采用直接评分方法，即由 LLM 独立评估每个生成输出。这一方法不仅降低了系统性偏差，还提升了灵活性与可扩展性。值得注意的是，它允许对单次生成的输出进行直接评估，这对于数据集清洗与筛选等任务尤为重要，而这些是开发高质量 LLM 的关键环节。

> **图 5**（原文图像见 PDF）：LLM 裁判的稳健性评估。选定中国经典小说归一化得分的箱线图，基于使用 LLM 裁判框架的 11 次重复评估。每个箱体展示四分位距（interquartile range, IQR），并标出中位数（实线）与均值（虚线）。大多数作品表现出持续的高分、狭窄的 IQR 和极少量的离群值，表明模型评估的稳健性与稳定性。

为展示 LLM 裁判方法的稳健性（这是一个具有广泛相关性的问题），我们使用一组经典作品进行了重复实验，这些作品落在我们的网络小说基准分布之外。具体而言，我们在同一数据集上使用完全相同的 DeepSeek-V3 配置进行了十一轮独立评估。如图 5 所示，箱线图表现出高度一致性，四分位距（IQR）低于 0.05，得分方差在 0.001 以内，证实了模型与评估提示词设计的稳定性。这些发现进一步强化了我们基准框架的可靠性与可信度。

### 5.4 长度分析

为避免引入偏差，我们对模型生成输出的长度进行了分析。结果表明，大多数模型严格遵守了所要求的长度或上下文窗口，输出平均在 800 至 1200 字之间。显著的例外包括 Claude 3.7 Sonnet 与 Gemini 2.5 Pro，它们持续生成明显更长的文本。总体而言，各模型的输出长度相对稳定，在 4096 token 约束下并未成为主要的区分因素。未来工作中可以引入基于输出长度的评分正则项以增强稳健性。[^4]

## 6 结论

WebNovelBench 应对了评估 LLM 长篇叙事能力的挑战。它使用 4,000 余部中文网络小说构建"梗概到故事"任务。带有八个 LLM 裁判叙事维度与 PCA+ECDF 评分的自动化流水线，提供了相对于人类内容的百分位排名。实验表明，WebNovelBench 能有效区分经典文学、网络文学与 LLM 输出，并为 24 个 SOTA LLM 提供了稳定的排名。WebNovelBench 是衡量进展、指导 LLM 创意叙事生成发展的宝贵工具。虽然它聚焦于中文网络小说，但其原则是可扩展的。未来工作包括多样化裁判模型、扩展题材，以及培育更具吸引力的 LLM 叙事者，从而推动机器生成叙事的创新。

## 局限性（Limitations）

在此我们概述本工作的若干局限。首先，我们的基准完全依赖中文网络小说作为评估数据集。虽然这为我们的目的提供了一个丰富、多样且具代表性的语料库，但未来工作应将基准扩展至其他语言与文学形式，以提升其泛化能力。其次，受资源与时间所限，我们的实验规模有限：我们仅使用单一的 LLM 裁判模型在子集上评估了表现。尽管结果展示了稳健性，但未来研究若能使用多个裁判模型评估更多子集，将进一步强化并验证我们的结论。最后，虽然我们提出基准可直接评估数据质量，但我们尚未探索其更广泛的应用。未来研究将探讨如何利用这些基准数据集来提升模型表现及其他下游任务。

## 参考文献（原文）

William Jay Conover. 1999. Practical nonparametric statistics. john wiley & sons.

DeepSeek-AI, Daya Guo, Dejian Yang, Haowei Zhang, Junxiao Song, Ruoyu Zhang, Runxin Xu, Qihao Zhu, Shirong Ma, Peiyi Wang, Xiao Bi, Xiaokang Zhang, Xingkai Yu, Yu Wu, Z. F. Wu, Zhibin Gou, Zhihong Shao, Zhuoshu Li, Ziyi Gao, and 181 others. 2025a. Deepseek-r1: Incentivizing reasoning capability in llms via reinforcement learning. Preprint, arXiv:2501.12948.

DeepSeek-AI, Aixin Liu, Bei Feng, Bing Xue, Bingxuan Wang, Bochao Wu, Chengda Lu, Chenggang Zhao, Chengqi Deng, Chenyu Zhang, Chong Ruan, Damai Dai, Daya Guo, Dejian Yang, Deli Chen, Dongjie Ji, Erhang Li, Fangyun Lin, Fucong Dai, and 181 others. 2025b. Deepseek-v3 technical report. Preprint, arXiv:2412.19437.

Team GLM, :, Aohan Zeng, Bin Xu, Bowen Wang, Chenhui Zhang, Da Yin, Dan Zhang, Diego Rojas, Guanyu Feng, Hanlin Zhao, Hanyu Lai, Hao Yu, Hongning Wang, Jiadai Sun, Jiajie Zhang, Jiale Cheng, Jiayi Gui, Jie Tang, and 40 others. 2024. Chatglm: A family of large language models from glm-130b to glm-4 all tools. Preprint, arXiv:2406.12793.

Aaron Grattafiori, Abhimanyu Dubey, Abhinav Jauhri, Abhinav Pandey, Abhishek Kadian, Ahmad AlDahle, Aiesha Letman, Akhil Mathur, Alan Schelten, Alex Vaughan, Amy Yang, Angela Fan, Anirudh Goyal, Anthony Hartshorn, Aobo Yang, Archi Mitra, Archie Sravankumar, Artem Korenev, Arthur Hinsvark, and 542 others. 2024. The llama 3 herd of models. Preprint, arXiv:2407.21783.

Jian Guan, Zhexin Zhang, Zhuoer Feng, Zitao Liu, Wenbiao Ding, Xiaoxi Mao, Changjie Fan, and Minlie Huang. 2021. Openmeva: A benchmark for evaluating open-ended story generation metrics. In Proceedings of the 59th Annual Meeting of the Association for Computational Linguistics and the 11th International Joint Conference on Natural Language Processing (Volume 1: Long Papers).

Dan Hendrycks, Collin Burns, Steven Basart, Andy Zou, Mantas Mazeika, Dawn Song, and Jacob Steinhardt. 2021. Measuring massive multitask language understanding. Proceedings of the International Conference on Learning Representations (ICLR).

Harold Hotelling. 1933. Analysis of a complex of statistical variables into principal components. Journal of Educational Psychology, 24:498–520.

Mete Ismayilzada, Claire Stevenson, and Lonneke van der Plas. 2025. Evaluating creative short story generation in humans and large language models. Preprint, arXiv:2411.02316.

Carlos E Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexin Pei, Ofir Press, and Karthik R Narasimhan. 2024. SWE-bench: Can language models resolve real-world github issues? In The Twelfth International Conference on Learning Representations.

Zdenek Kasner and Ondrej Dusek. 2024. Beyond traditional benchmarks: Analyzing behaviors of open llms on data-to-text generation. Preprint, arXiv:2401.10186.

Ruosen Li, Teerth Patel, and Xinya Du. 2024. Prd: Peer rank and discussion improve large language model based evaluations. Preprint, arXiv:2307.02762.

Xiao Liu, Xuanyu Lei, Shengyuan Wang, Yue Huang, Zhuoer Feng, Bosi Wen, Jiale Cheng, Pei Ke, Yifan Xu, Weng Lam Tam, Xiaohan Zhang, Lichao Sun, Xiaotao Gu, Hongning Wang, Jing Zhang, Minlie Huang, Yuxiao Dong, and Jie Tang. 2024. Alignbench: Benchmarking chinese alignment of large language models. Preprint, arXiv:2311.18743.

MAA. 2024. American invitational mathematics examination - aime. In American Invitational Mathematics Examination - AIME 2024.

Jinjie Ni, Fuzhao Xue, Xiang Yue, Yuntian Deng, Mahir Shah, Kabir Jain, Graham Neubig, and Yang You. 2024. Mixeval: Deriving wisdom of the crowd from llm benchmark mixtures. arXiv preprint arXiv:2406.06565.

Samuel J. Paech. 2024. Eq-bench: An emotional intelligence benchmark for large language models. Preprint, arXiv:2312.06281.

Emanuel Parzen. 1962. On estimation of a probability density function and mode. The annals of mathematical statistics, 33(3):1065–1076.

Shanghaoran Quan, Jiaxi Yang, Bowen Yu, Bo Zheng, Dayiheng Liu, An Yang, Xuancheng Ren, Bofei Gao, Yibo Miao, Yunlong Feng, and 1 others. 2025. Codeelo: Benchmarking competition-level code generation of llms with human-comparable elo ratings. arXiv preprint arXiv:2501.01257.

Jiawen Shi, Zenghui Yuan, Yinuo Liu, Yue Huang, Pan Zhou, Lichao Sun, and Neil Zhenqiang Gong. 2025. Optimization-based prompt injection attack to llmas-a-judge. Preprint, arXiv:2403.17710.

Yubo Wang, Xueguang Ma, Ge Zhang, Yuansheng Ni, Abhranil Chandra, Shiguang Guo, Weiming Ren, Aaran Arulraj, Xuan He, Ziyan Jiang, and 1 others. 2024. Mmlu-pro: A more robust and challenging multi-task language understanding benchmark. arXiv preprint arXiv:2406.01574.

An Yang, Anfeng Li, Baosong Yang, Beichen Zhang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Gao, Chengen Huang, Chenxu Lv, Chujie Zheng, Dayiheng Liu, Fan Zhou, Fei Huang, Feng Hu, Hao Ge, Haoran Wei, Huan Lin, Jialong Tang, and 41 others. 2025. Qwen3 technical report. Preprint, arXiv:2505.09388.

Jiayi Ye, Yanbo Wang, Yue Huang, Dongping Chen, Qihui Zhang, Nuno Moniz, Tian Gao, Werner Geyer, Chao Huang, Pin-Yu Chen, Nitesh V Chawla, and Xiangliang Zhang. 2024. Justice or prejudice? quantifying biases in llm-as-a-judge. Preprint, arXiv:2410.02736.

Xiang Yue, Tianyu Zheng, Yuansheng Ni, Yubo Wang, Kai Zhang, Shengbang Tong, Yuxuan Sun, Botao Yu, Ge Zhang, Huan Sun, Yu Su, Wenhu Chen, and Graham Neubig. 2024. Mmmu-pro: A more robust multi-discipline multimodal understanding benchmark. arXiv preprint arXiv:2409.02813.

Xinghua Zhang, Bowen Yu, Haiyang Yu, Yangyu Lv, Tingwen Liu, Fei Huang, Hongbo Xu, and Yongbin Li. 2023. Wider and deeper llm networks are fairer llm evaluators. Preprint, arXiv:2308.01862.

Lianmin Zheng, Wei-Lin Chiang, Ying Sheng, Siyuan Zhuang, Zhanghao Wu, Yonghao Zhuang, Zi Lin, Zhuohan Li, Dacheng Li, Eric P. Xing, Hao Zhang, Joseph E. Gonzalez, and Ion Stoica. 2023. Judging llm-as-a-judge with mt-bench and chatbot arena. Preprint, arXiv:2306.05685.

## 附录 A 系统提示词

为确保评估流水线的一致性与清晰性，我们对基准各阶段使用的提示词进行了标准化。图 9 展示了用于引导故事生成的系统提示词，图 10 给出了 LLM 裁判用于评估叙事质量的评估提示词。此外，图 8 展示了用于"故事到梗概"提取的系统提示词，它是构建我们生成数据集的基础。这些提示词经过精心设计，以最大限度减少歧义并确保基准结果的可复现性。

## 附录 B 数据样例

"故事到梗概"提取样例（由 Doubao-pro-32k 生成）：

**故事到梗概提取输入**
（中文小说正文样例；其在 pdftotext 文本提取中完全丢失「？」，仅余引号、省略号等标点残迹，原文见 PDF）

**故事到梗概提取输出**
（输出含主要人物、主要情节（带 (1)–(5) 编号事件）、重要场景等标签结构；中文内容在文本提取中丢失「？」，原文见 PDF）

LLM"梗概到故事"生成样例（以上述提取结果为输入示例）：

**Qwen3-235B-A22B 生成**
（中文正文在文本提取中丢失「？」，原文见 PDF）

**GPT-4.1 生成**
（中文正文在文本提取中丢失「？」，原文见 PDF）

**GLM-4-9B 生成**
（中文正文在文本提取中丢失「？」，原文见 PDF）

LLM 作为裁判的评估样例（以 DeepSeek-V3 为评审）：

**DeepSeek-V3 评估**
（评语为中文，在文本提取中丢失「？」，原文见 PDF。可辨识的残存结构依次为：评估意见标签、逐维度评语标签，以及八个维度的分数标签——其数值依次为 4、4、3、4、4、4、4、4）

## 附录 C 伦理考量

我们的 WebNovelBench 数据集包含 4,000 余部从互联网上自由获取的公开中文网络小说。对每部小说，我们仅提取 10 章——只占完整内容的极小一部分——以便在实现稳健评估的同时尽量减少数据使用。这些文本不含个人身份信息或私密数据，仅用于统计评估与基准测试目的，并未被用于模型训练或直接微调。

在推理测试期间，我们严格遵循每个 LLM 的使用许可或条款。模型基于我们的梗概-故事数据集生成科学产物，这些输出仅用于研究评估与能力评估，不会改作他用。

我们对这些材料的使用符合面向研究的合理使用原则。我们进行了检查，以确保不包含冒犯性或敏感的个人内容。虽然我们的基准专门针对中文网络小说，这可能限制泛化能力，但它在误用、隐私或偏差方面的风险极小。

## 附录 D 主成分分析细节

为确定每个评估维度的相对重要性，我们对网络小说数据集上的得分分布应用了主成分分析（PCA）。图 6 中的碎石图（scree plot）显示，第一主成分占总方差的比例超过 75%。这表明，虽然我们的八个评估维度各自捕捉叙事质量的一个独特且有意义的方面，它们也共同反映了一个强有力的潜在评估信号。较高的解释方差支持了我们指标设计的内部一致性，并为使用 PCA 导出的权重聚合叙事质量得分提供了依据。这种均衡表明各维度是互补而非冗余的，每一个都对整体叙事评估作出独特贡献。

同一图中嵌入的雷达图（radar chart）可视化了分配给八个叙事维度（D1–D8）的 PCA 导出权重。这些权重贯穿于我们的基准评分之中，反映每个维度对主要方差成分的贡献，因而代表它们在整体评估框架中的相对重要性。

> **图 6**（原文图像见 PDF）：评估指标的 PCA 分析。柱状图展示每个主成分的解释方差比（explained variance ratio）。雷达图可视化我们基准中使用的八个叙事维度的相对权重。

## 附录 E 长度分析细节

为支持 5.4 节的主要发现，我们在图 7 中提供了所有被评估模型平均输出长度的可视化汇总。绿色与红色虚线表示期望的长度界限（800–1200 字）。如图所示，绝大多数模型生成的输出都落在该范围内或其附近，表明对指定上下文长度的一致遵守。

鉴于这种总体一致性，我们在正文中不再深入进行基于长度的比较。显著的离群者如 Claude 3.7 Sonnet（约 2,700 字）与 Gemini 2.5 Pro（约 2,000 字）产生了明显更长的输出，而 LLaMA 3.3 与 GLM-4-9B-chat 等模型则倾向于生成不足。这些偏离是例外而非常态，对整体评估结果的影响有限。

虽然长度并未被视为叙事质量的主要区分因素，但基准的未来迭代可以考虑施加软约束或正则化机制，以惩罚过长或过短的输出。

> **图 7**（原文图像见 PDF）：各模型生成输出的平均长度。

## 提示词附图（图 8–10）

> **图 8**（原文图像见 PDF）：用于"故事到梗概"提取的系统提示词。

提示词的中文原文在 pdftotext 提取中丢失「？」；图中附带的英文版本译文如下：

> 你的任务是从给定的小说节选中提取关键信息——例如主要人物、主要情节要点和重要场景。这些信息将用于构建该小说的知识图谱与百科条目。请仔细阅读以下文本：<Novel> {text} </Novel>
>
> 提取信息时，请遵循以下步骤：1. 仔细通读整段小说节选。2. 识别主要人物，即在情节中发挥核心作用、故事重要部分围绕其展开的角色。3. 概述主要情节要点，即推动故事前进的核心事件与关键转折。4. 确定重要场景，即发生重要故事进展的关键地点与环境。5. 检查所提取信息的准确性与完整性。
>
> 请在 <Extraction> 标签内按以下格式输出提取结果：<Main Characters> [用逗号分隔列出主要人物姓名] </Main Characters> <Main Plots> [按事件时间顺序详细描述主要情节要点，不同事件之间换行，例如 (1)...(2)...] </Main Plots> <Important Scenes> [用逗号分隔列出重要场景名称] </Important Scenes>
>
> 请确保所提取的信息丰富、全面且准确。

> **图 9**（原文图像见 PDF）：用于生成的系统提示词。

提示词的中文原文在 pdftotext 提取中丢失「？」；图中附带的英文版本译文如下：

> 你是一位中文小说作家。你的任务是基于用户提供的信息展开并创作叙事。你的写作必须遵循以下准则：
>
> 1. 用户将以如下格式提供长篇小说的关键信息。请仔细阅读这些信息：<Main Characters> [主要人物姓名] </Main Characters> <Main Plots> [按时间顺序排列的主要情节要点] </Main Plots> <Important Scenes> [重要场景或地点名称] </Important Scenes>
>
> 2. 一位评审将依据以下标准评估你的写作：文学手法运用：依据隐喻、象征、悖论等复杂修辞手法的数量与精致程度评分。感官细节丰富度：依据视觉、听觉、嗅觉及其他感官描写的频率评分。角色出场均衡度：依据每个角色的出场频率、对话占比、心理刻画以及角色塑造的总体平衡评分。角色对话辨识度：依据每个角色的对话是否反映其个人个性、即使隐去姓名仍可区分来评分。人物塑造一致性：依据角色的言语与行动是否契合其身份与背景评分。氛围与主题契合度：依据场景描写是否支撑叙事的情感基调与主题连贯性评分。情境适切性：依据设定细节是否契合时代与地域背景评分。场景间连贯性：依据叙事在场景之间的转换是否自然、避免突兀或断裂的转换来评分。
>
> 3. 仅按以下格式返回生成的小说：<text> 你生成的故事内容 </text>

> **图 10**（原文图像见 PDF）：用于评估的系统提示词。

该提示词原文为中文，正文在 pdftotext 提取中丢失「？」。从残存的可辨片段可知：其评分量表为 1–5 分；待评章节以标签包裹的 {chapter} 占位符传入；提示词包含五个编号步骤与八条评估标准（对应 D1–D8）；输出格式为八组标签，各含一个维度分数（模板样例值为 1）。完整原文见 PDF。

## 脚注

[^1]: https://docs.python.org/3/library/difflib.html
[^2]: https://www.volcengine.com/product/doubao
[^3]: 更多细节见附录 D。
[^4]: 更多细节见附录 E。
