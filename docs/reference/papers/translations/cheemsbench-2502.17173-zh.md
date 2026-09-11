# Cheems：从零构建并评估中文奖励模型的实用指南

> **中文译名**：Cheems：从零构建并评估中文奖励模型的实用指南
> **英文原题**：CHEEMS: A Practical Guidance for Building and Evaluating Chinese Reward Models from Scratch
> **作者**：Xueru Wen¹,²、Jie Lou³\*、Zichao Li¹,²、Yaojie Lu¹\*、Xing Yu³、Yuqiu Ji³、Guohai Xu³、Hongyu Lin¹、Ben He¹,²、Xianpei Han¹、Le Sun¹、Debing Zhang³
> **发表信息**：ACL 2025；arXiv:2502.17173v3 [cs.CL]，2025 年 5 月 26 日
> **arXiv 链接**：https://arxiv.org/abs/2502.17173
>
> 本文件为 AI 辅助全文翻译，术语以首次出现时"中文（English）"标注。

**作者单位**：¹ 中国科学院软件研究所中文信息处理实验室（北京）；² 中国科学院大学（北京）；³ 小红书（Xiaohongshu Inc.）

**联系方式**：{wenxueru2022,lizichao2022}@iscas.ac.cn；{luyaojie,hongyu,sunle,xianpei}@iscas.ac.cn；benhe@ucas.edu.cn；loujie0822@gmail.com；dengyang@xiaohongshu.com

注：这些作者对本文作出了同等贡献（原文中以符号标注，该符号在文本提取时丢失「？」）；\* 为通讯作者。

---

## 摘要

奖励模型（Reward Model, RM）对于大语言模型（Large Language Model, LLM）与人类偏好对齐至关重要。然而，大多数 RM 研究以英语为中心，并严重依赖合成资源，导致面向中文的数据集与基准数量有限且可靠性不足。为填补这一空白，我们提出 CheemsBench——一个完全由人工标注的中文情境 RM 评测基准，以及 CheemsPreference——一个通过人机协作标注的大规模、多样化偏好数据集，用以支持中文 RM 训练。我们在 CheemsBench 上系统评估了开源的判别式与生成式 RM，发现它们在捕捉中文情境下的人类偏好方面存在明显局限。此外，基于 CheemsPreference，我们构建了一个在 CheemsBench 上取得最优（state-of-the-art）性能的 RM，证明了人类监督在 RM 训练中的必要性。我们的研究发现，规模化扩展的 AI 生成数据难以完全捕捉人类偏好，凸显了高质量人类监督在 RM 开发中的重要性。

## 1 引言

随着大语言模型（Yang et al., 2024a; Grattafiori et al., 2024）的快速进步，后训练（post-training）已成为确保其安全性、可靠性以及与人类价值观对齐的关键挑战（Hou et al., 2024; Lin et al., 2024）。奖励模型（Palan et al., 2019; Ouyang et al., 2022）作为 LLM 后训练的核心组件，在捕捉人类偏好、引导模型更紧密地贴合人类需求（Bai et al., 2022）方面发挥着关键作用。通过提供奖励信号，RM 可以在训练过程中引导参数优化（Ibarz et al., 2018; Ouyang et al., 2022），或在解码过程中直接干预输出（Khanov et al., 2024; Li et al., 2024a）。

> **图 1（原文图像见 PDF）**：CheemsBench 与现有 RM 资源在构建方式与使用方式上的差异。

尽管 RM 在后训练中作用重大，当前研究仍主要聚焦于英语。例如，Skywork-Reward（Liu et al., 2024a）与 UltraRM（Cui et al., 2023）利用高质量的英文偏好数据集（preference dataset）（Zheng et al., 2023; Ji et al., 2024）与基准（benchmark）（Lambert et al., 2024）取得了优越的性能。相比之下，由于缺乏大规模、高质量的偏好数据集与全面的评测基准，中文 RM 的发展面临重大挑战。现有中文资源往往规模较小（Huozi-Team, 2024; Yucheng, 2023），或局限于特定领域（Yang, 2024; Xinlu Lai, 2024; Xu et al., 2023），难以满足 LLM 后训练的需求。此外，现有 RM 主要依赖合成数据，难以准确反映人类偏好。

**表 1**：CheemsBench 与 CheemsPreference 的统计信息：提示数、每条提示的平均回答数、比较数（不含平局），以及提示、chosen 回答与 rejected 回答的平均字符长度。

| 数据集 | 子集 | 提示数 | 每条提示平均回答数 | 比较数 | 提示平均字符数 | Chosen 平均字符数 | Rejected 平均字符数 |
|---|---|---|---|---|---|---|---|
| CheemsBench | Open Prompt | 1,146 | 5 | 7,838 | 186.58 | 437.50 | 454.01 |
| CheemsBench | Human Instruction | 1,346 | 5 | 9,762 | 197.04 | 436.96 | 446.43 |
| CheemsPreference | GPT | 27,861 | 5.29 | 332,370 | 175.56 | 457.92 | 394.18 |
| CheemsPreference | Human | 3,260 | 5.07 | 37,618 | 164.08 | 440.18 | 432.84 |

为填补这一关键空白，本文从零构建¹了一套全面且以人为核心的中文 RM 资源。它包含两个关键数据集：(1) CheemsBench，一个完全由人工标注、规模可观的中文 RM 评测基准，用于检验 RM 是否准确捕捉并反映人类偏好；(2) CheemsPreference，一个大规模、多样化的中文偏好数据集，为训练中文 RM 提供监督信号，使其能够有效学习并建模人类偏好。

¹ CHEEMS 代表中文奖励模型基准与偏好数据集（Chinese reward model benchmark and preference dataset）。

如图 1 所示，与大多数依赖机器生成标注的 RM 资源（Zhou et al., 2024）不同，CheemsBench 与 CheemsPreference 构建于人类监督之上，因而能更准确地捕捉真实的人类价值观。此外，传统 RM 基准（Lambert et al., 2024）通常依赖成对比较（pairwise comparison），而近期研究（Wen et al., 2024）已指出其在反映下游性能方面的局限。CheemsBench 引入了多回答评测机制，与下游任务紧密契合。

在 CheemsBench 中，我们将开源提示（prompt）与真实世界的人类指令（human instruction）相结合，并配合全面的类别体系来评测 RM 性能。为了更好地对齐下游任务并降低偏好引起的噪声（Zhang et al., 2024a），我们为每条提示从多种开源与闭源 LLM 中采样五个回答，并进行五轮由人工驱动的三元比较（triple-wise comparison）。为解决潜在的标注冲突，我们设计了一种基于图的冲突消解算法（conflict-resolving algorithm），可生成唯一且一致的偏序（partial ranking）。借助 CheemsBench，我们评估了奖励模型与偏好数据集在中文语境下的进展，并发现中文 RM 仍有相当大的改进空间。

对于 CheemsPreference，我们依照多层提示类别体系收集了 2.7 万条人类指令，并为每条提示从多种 LLM 中采样超过 5 个回答，以确保提示与回答的多样性。为了在降低人力成本的同时缓解 GPT 标注的不一致性与偏差（Stureborg et al., 2024），我们设计了一种远程监督（distant supervision）算法来提升数据质量。具体而言，人类标注者首先标注一个小规模的金标准（golden）偏好数据集，随后用它训练一个 RM 来过滤更大规模的 GPT 标注数据。人工标注与 GPT 标注的数据共同构成 CheemsPreference，它在 CheemsBench 上取得了最优（state-of-the-art）结果，并在英文 RewardBench（Lambert et al., 2024）上表现良好。

我们的贡献总结如下：

- 我们提出 CheemsBench，这是首个专为中文奖励模型设计的大规模综合性基准。
- 我们构建了 CheemsPreference，这是首个大规模、多样化、高质量的中文偏好数据集。
- 我们对中文 RM 的训练与评测进行了全面研究。本工作相关的代码与数据可在 https://github.com/AlignRM/CheemsRM 获取。

> **图 2（原文图像见 PDF）**：中文 RM 基准的构建流程。我们利用开源提示与人类指令，并为每条提示从多种模型中采样五个回答。这些回答随后经过五轮三元人工比较，并通过冲突消解算法生成唯一的偏序。

## 2 相关工作

**基于人类反馈的强化学习（Reinforcement Learning from Human Feedback, RLHF）**。RLHF 已被广泛用于 LLM 对齐（Ouyang et al., 2022; Bai et al., 2022）。以往研究多聚焦于摘要（Stiennon et al., 2022）、问答（Nakano et al., 2022）等特定任务。近期研究将 RLHF 的应用扩展到更广泛的领域（Hou et al., 2024; Lin et al., 2024; Yu et al., 2024），使 LLM 变得更有帮助、更诚实、更无害。RLHF 通过融入奖励模型所捕捉的人类偏好（Ng and Russell, 2000; Brown and Niekum, 2019; Palan et al., 2019），使模型能够更紧密地对齐人类预期。因此，准确反映人类偏好的奖励模型是 RLHF 方法的基础。

**奖励模型的训练与评测**。为开发能够捕捉人类偏好的 RM，现有工作通过人工标注（Bai et al., 2022; Zheng et al., 2023）或蒸馏先进 LLM（Zhu et al., 2023; Cui et al., 2023）来收集偏好数据。这些工作大多聚焦英语，忽视了中文语境。现有中文偏好数据集普遍规模较小（Huozi-Team, 2024; Yucheng, 2023）或局限于特定任务（Yang, 2024; Xinlu Lai, 2024; Xu et al., 2023）。除训练数据之外，RM 评测对后训练同样至关重要。典型的 RM 评测是在固定测试集上计算准确率（accuracy）（Lambert et al., 2024）。近期研究（Son et al., 2024; Kim et al., 2024; Zhou et al., 2024; Liu et al., 2024b; Frick et al., 2024; Gureja et al., 2024）尝试增强与下游性能的相关性。然而，这些基准聚焦英语，其在中文语境下的适用性存疑。

## 3 中文 RM 基准

本节介绍 CheemsBench——一个旨在全面评测中文 RM 的基准。我们的基准具有如下特点：(1) 高覆盖度：我们纳入了广泛的提示与采样模型，确保在多样场景下的全面评测；(2) 高质量标注：我们通过多轮人工三元比较与冲突消解，得到可靠的偏好排序。图 2 展示了整体构建流程。

### 3.1 数据构建

**提示收集**。我们从多个开源数据集中采样中文提示，包括 HumanevalXL（Peng et al., 2024）、MathOctopus（Chen et al., 2024）、GAOKAO-Bench（Zhang et al., 2024b）、HalluQA（Cheng et al., 2023）、Flames（Huang et al., 2023）、CLiB（Lee, 2023）、AlignBench（Liu et al., 2023）与 COIG-CQIA（yuelin bai, 2023）。我们人工将其原始类别映射为图 8 所示的统一体系。我们还纳入真实世界的人类指令，用于分布外（out-of-distribution）评测。为确保在不同场景下的充分覆盖，我们构建了如图 9 所示的全面分类体系。最终，我们从开源数据集中选出 1,146 条提示，从人类指令中获得 1,346 条。

**回答收集**。为确保回答质量与分布的广泛性，我们从多种模型中为每条提示采样 5 个回答。(1) 开源模型：Qwen2-7B/72B-Instruct（Yang et al., 2024a）、Meta-Llama-3.1-8B/70B-Instruct（Grattafiori et al., 2024）、Llama3.1-8B/72B-Chinese-Chat（Wang et al., 2024b）、Internlm2-chat-1.8b（Cai et al., 2024）与 GLM-4-9b-chat（GLM et al., 2024）；(2) 闭源模型：GPT-4（OpenAI et al., 2024）、GPT-3.5-turbo、GPT-4-turbo 与 Claude-3-5-sonnet（Anthropic, 2024）。我们观察到，部分开源模型的中文能力有限，容易出现语码转换（code-switching）甚至严重乱码²。对此，我们在标注过程中依靠人工标注者过滤此类回答。具体而言，标注者被要求丢弃包含大段无意义内容的回答，而保留那些虽有轻微语码转换但不损害语义的回答。这一流程使我们能够在 RM 评测中顾及 LLM 的语码转换行为。

² LLaMA 系列表现出更高的语码转换与无意义输出倾向，这可能源于其分词器词表以及中文语料训练不足。

### 3.2 基准标注

**人工标注**。为准确捕捉人类偏好，CheemsBench 的标注过程完全依赖人类判断。给定一条提示及其对应的 5 个回答，我们预先设计了五个标注任务，每个任务包含对三个相邻回答的三元比较。这些任务被分发给不同的标注者，由他们独立进行偏好比较。所有标注结果随后被用于构建回答的排序列表。

**冲突消解**。然而，由于人类偏好的模糊性与潜在的标注错误，可能出现冲突。为得到可靠的结果，我们开发了专门的冲突消解算法，见算法 1。具体而言，我们首先将标注结果转换为有向偏好图，其中回答与偏好分别表示节点与边。然后，我们采用深度优先搜索（depth-first search）识别图中的环，环即指示冲突。这些环被合并为更大的节点，重复该过程直至图中不再存在环。最后，我们进行拓扑排序（topological sorting）以获得偏序³。

³ 关于算法与标注者的详细信息分别见附录 C 与附录 D。

### 3.3 评测指标

给定每条提示的多个回答，存在多种潜在的评测指标（Wen et al., 2024）。我们首先将偏序转换为多个成对比较，并按照典型设定（Lambert et al., 2024）计算准确率：

$$\text{Accuracy} = \frac{1}{N}\sum_{i=1}^{N} \mathbb{I}(r_w^i > r_l^i) \tag{1}$$

其中 $N$ 为转换后成对比较的总数，指示函数 $\mathbb{I}$ 检验被偏好回答 $r_w^i$ 的奖励分数是否大于其对应回答 $r_l^i$ 的奖励分数。此外，还可以采用完全匹配率（exact match rate），它衡量所有成对比较都被正确排序的提示所占比例：

$$\text{Exact Match} = \frac{1}{M}\sum_{j=1}^{M} \prod_k \mathbb{I}(r_{w,k}^j > r_{l,k}^j) \tag{2}$$

（式中 $\prod_k$ 为按上下文还原，原文文本提取中该符号缺失「？」）

其中 $M$ 为提示数量，指示函数检验所有比较是否排序正确。我们通过对不同类别子集上的指标取平均来得到最终结果。

## 4 中文偏好数据集

本节介绍 CheemsPreference 的构建过程，如图 3 所示。我们的数据集具有如下特点：(1) 规模与多样性：我们收集了 2.7 万条真实人类指令，配备全面的多层分类体系，并为每条提示从多种模型中采样多个回答；(2) 高质量标注：我们采用远程监督算法，结合人工标注与 GPT-4o，建立可靠的偏序。

> **图 3（原文图像见 PDF）**：中文偏好数据集的构建流程。每条提示的不同回答及其标注结果构成一个有向图。偏好图中的圆圈表示冲突。我们利用在人工标注数据上训练的奖励模型过滤 GPT 标注，从而产生有向无环图。

### 4.1 数据构建

**提示收集**。多样化、高质量的指令数据对确保 RM 的稳健性至关重要。为此，我们收集了 27,861 条真实世界的人类指令。为确保对下游场景的广泛覆盖，我们开发了全面的多层分类体系，涵盖八个大类与数十个细分小类，如图 10 所示。

**回答收集**。我们从广泛的模型中采样回答：(1) 开源模型：Qwen2-7B/72B-Instruct（Yang et al., 2024a）、Qwen2.5-7B/14B/32B/72B-Instruct（Team, 2024）、Meta-Llama-3.1-8B/70B-Instruct（Grattafiori et al., 2024）、Llama3.1-8B/72B-Chinese-Chat（Wang et al., 2024b）、Internlm2-chat-1.8b（Cai et al., 2024）与 GLM-4-9b-chat（GLM et al., 2024）；(2) 闭源模型：GPT-4（OpenAI et al., 2024）、GPT-3.5-turbo、GPT-4-turbo、GPT-4o 与 Claude-3-5-sonnet（Anthropic, 2024）。为保证回答质量，我们采用基于规则的方法来检测异常冗长或含有过多非中文字符的回答。尽管该方法对涉及数学或代码的提示可能准确率较低，我们仍优先保证高召回率，以过滤掉更多低质量回答。最终，每条提示平均拥有超过 5 个回答。

### 4.2 远程监督

偏好数据的质量（Gao et al., 2024）对 RM 的训练至关重要。人工标注能保证高质量，但成本高昂且难以大规模获取；相反，基于 GPT 的标注可扩展，却常常不一致且有偏（Stureborg et al., 2024）。为构建大规模、高质量的中文偏好数据，我们实施了一种远程监督标注策略。我们最初聘请人工标注者按照 3.2 节详述的规程标注一个小规模数据子集；随后，采用 GPT-4o 标注更大规模的数据集。对于由 $N$ 个回答组成的集合，GPT-4o 会对每一对回答执行 $\binom{N}{2}$ 次成对比较⁴。为缓解位置偏差（positional bias）（Li et al., 2024b），每次比较中回答的顺序都被随机化。尽管这些 GPT-4o 标注可能出现不一致，即偏好图中出现环，我们利用一个在人工标注数据上训练的 RM 来过滤这些标注，建立一致的偏序。此外，我们提出一种长度去偏（length-debias）的事后过滤策略，以缓解长度偏差（length bias）（Dubois et al., 2024）。具体做法是：将数据集划分为两组——chosen 回答长于 rejected 回答的一组与短于的一组——然后对较大的组进行下采样，以平衡数据集。

⁴ 标注提示见附录 B。

## 5 中文奖励模型

本节介绍我们的奖励模型训练方法。与通过成对比较构建的典型偏好数据集（Cui et al., 2023; Ji et al., 2024）不同，CheemsPreference 具有两个鲜明特点：(1) 每条提示关联多个回答；(2) 这些回答仅构成一条部分偏好链。因此，我们依据 Bradley-Terry 模型（Bradley-Terry Model）（Bradley and Terry, 1952）采用如下损失：

$$L = -\mathbb{E}_{x \sim X} \sum_{y_w, y_l \sim Y_x} \log \sigma \left(r(x, y_w) - r(x, y_l)\right) \tag{3}$$

（式中 $\sigma$ 为按上下文还原，原文文本提取中该符号缺失「？」）

其中 $X$ 表示提示 $x$ 的分布，$Y_x$ 表示给定提示 $x$ 时回答 $y$ 的分布。我们采用一种基于样本的贪心批处理逻辑（greedy sample-based batch logic）来计算该损失。具体而言，在每次前向传播中，我们判断某条提示的所有回答能否被纳入同一个批次：若可行，则将其加入该批次；否则，多余的回答被分配到后续批次。这种方法可能会跳过一些成对比较，但能确保没有任何回答在批次间被重复，从而缓解过拟合风险（Ouyang et al., 2022）。更重要的是，这种基于样本的批组织方式通过减少冗余的前向传播提升了计算效率。为进一步稳定训练，我们引入了一个额外的正则化项（Hou et al., 2024），对奖励分数的分布施加高斯先验（Gaussian prior）：

$$L = L + \lambda\, \mathbb{E}_{x \sim X,\, y \sim Y_x}\, r^2(x, y) \tag{4}$$

（式中 $\lambda$ 为按上下文还原，原文文本提取中该系数符号缺失「？」）

## 6 实验

我们首先评估开源 RM 与数据集在 CheemsBench 上的表现（6.1 节）。接着，我们考察基准与下游任务的相关性（6.2 节）。对于 CheemsPreference，我们通过消融研究证明其有效性（6.3 节），并测试其扩展趋势（6.4 节）。

### 6.1 基准结果

**奖励模型评测**。我们全面评估了当前 RM 在中文语境下的表现，包括判别式奖励模型（discriminative reward model）与作为奖励模型的生成式模型（generative model as reward model）⁵（Zheng et al., 2023）。表 2 展示了排名靠前的 RM 在 CheemsBench 上的结果。我们发现：(1) 领先模型的准确率在应用于 CheemsBench 时显著下降。这一性能差距表明 RM 在中文场景下仍有相当大的改进空间。(2) 这些 RM 在开源提示上的表现优于在人类指令上的表现。这符合预期，因为我们的人类指令收集自真实世界，相比开源提示更处于分布外。(3) 对于答案相对确定的提示，RM 能够更准确地评估回答质量。图 4 详细展示了这些 RM 在不同子类上的表现。在开源提示子集上，RM 在"推理（Reasoning）"类上表现胜任，但在其他类别上较为吃力；在人类指令子集上，模型在"推理"与"复杂指令（Complex Instructions）"上表现出色，但在涉及"理解（Understanding）"的任务上表现不佳。这些观察强调了对这些任务进行针对性增强的必要性。

⁵ 模型与数据集的完整结果及引用见附录 E。

> **图 4（原文图像见 PDF）**：排名靠前的奖励模型在 CheemsBench 不同类别子集上的准确率。左右两个子图分别展示在开源提示与人类指令上的结果。

**偏好数据集评测**。我们基于 Qwen2.5-72B-Instruct（Team, 2024）训练 RM⁶，在 CheemsBench 上评测了多种中文与英文偏好数据集。实验结果见表 3。值得注意的是，在中文数据集中，"Huozi"（Huozi-Team, 2024）表现最佳；与此同时，"Ultrafeedback"（Cui et al., 2023）在英文数据集中领先。对表现最优的英文与中文偏好数据集在 CheemsBench 上的比较，揭示了英文与中文偏好数据集之间的关键差距，凸显了对更好的中文偏好数据集的需求。

⁶ 不同实验的超参数设置详见附录 F。

**表 2**：判别式与生成式 RM 在 CheemsBench 上的表现。Overall 指标是 Open Prompt 与 Human Instruction 子集上准确率（Acc.）与完全匹配率（Exact.）的平均值。CheemsRM 指在我们的 CheemsPreference 数据集上训练的 RM。

| 模型名称 | RewardBench | Open Prompt 准确率 | Open Prompt 完全匹配率 | Human Instruction 准确率 | Human Instruction 完全匹配率 | Overall |
|---|---|---|---|---|---|---|
| **作为奖励模型的生成式模型** | | | | | | |
| Skywork-Critic-Llama-3.1-70B | 0.933 | 0.755 | 0.320 | 0.731 | 0.258 | 0.516 |
| CompassJudger-1-14B-Instruct | 0.841 | 0.745 | 0.327 | 0.692 | 0.239 | 0.501 |
| CompassJudger-1-32B-Instruct | 0.852 | 0.742 | 0.322 | 0.685 | 0.231 | 0.495 |
| Qwen2.5-72B-Instruct | - | 0.734 | 0.306 | 0.678 | 0.229 | 0.487 |
| Skywork-Critic-Llama-3.1-8B | 0.890 | 0.726 | 0.288 | 0.696 | 0.229 | 0.485 |
| GPT-4o | 0.846 | 0.640 | 0.163 | 0.727 | 0.300 | 0.457 |
| Doubao-pro-128k | - | 0.720 | 0.280 | 0.662 | 0.164 | 0.456 |
| Qwen2.5-7B-Instruct | - | 0.713 | 0.262 | 0.637 | 0.163 | 0.444 |
| **判别式奖励模型** | | | | | | |
| Skywork-Reward-Gemma-2-27B | 0.938 | 0.754 | 0.329 | 0.748 | 0.311 | 0.535 |
| Skywork-Reward-Gemma-2-27B-v0.2 | 0.943 | 0.751 | 0.321 | 0.735 | 0.294 | 0.525 |
| Llama-3.1-Nemotron-70B-Reward-HF | 0.941 | 0.750 | 0.317 | 0.722 | 0.271 | 0.515 |
| Llama-3-OffsetBias-RM-8B | 0.894 | 0.734 | 0.310 | 0.689 | 0.239 | 0.493 |
| RM-Mistral-7B | 0.804 | 0.721 | 0.285 | 0.700 | 0.259 | 0.491 |
| URM-LLaMa-3-8B | 0.899 | 0.727 | 0.310 | 0.688 | 0.230 | 0.489 |
| ArmoRM-Llama3-8B-v0.1 | 0.904 | 0.715 | 0.308 | 0.677 | 0.246 | 0.487 |
| Skywork-Reward-Llama-3.1-8B-v0.2 | 0.931 | 0.721 | 0.283 | 0.701 | 0.237 | 0.486 |
| CheemsRM（本文） | 0.919 | 0.857 | 0.508 | 0.832 | 0.431 | 0.657 |

**表 3**：各数据集的表现结果。每个数据集分别在 Open Prompt 与 Human Instruction 子集下评测，结果以准确率（Acc.）与完全匹配率（Exact.）呈现。

| 数据集 | Open Prompt 准确率 | Open Prompt 完全匹配率 | Human Instruction 准确率 | Human Instruction 完全匹配率 |
|---|---|---|---|---|
| **中文偏好数据集** | | | | |
| HH-RLHF-cn | 0.704 | 0.306 | 0.646 | 0.212 |
| Huozi | 0.728 | 0.302 | 0.682 | 0.237 |
| Kyara | 0.705 | 0.258 | 0.664 | 0.198 |
| Zhihu | 0.463 | 0.105 | 0.487 | 0.080 |
| **英文偏好数据集** | | | | |
| ChatbotArena | 0.745 | 0.342 | 0.718 | 0.288 |
| HH-RLHF | 0.753 | 0.351 | 0.740 | 0.299 |
| MathPreference | 0.566 | 0.179 | 0.502 | 0.103 |
| Nectar | 0.716 | 0.288 | 0.664 | 0.222 |
| PKU-SafeRLHF | 0.737 | 0.311 | 0.678 | 0.240 |
| Skywork | 0.757 | 0.343 | 0.749 | 0.271 |
| MathStackExchange | 0.749 | 0.340 | 0.719 | 0.256 |
| UltraFeedback | 0.768 | 0.356 | 0.748 | 0.303 |
| HelpSteer2 | 0.713 | 0.279 | 0.736 | 0.292 |

### 6.2 下游相关性

在本节中，我们通过 Best-of-32 采样策略在三项任务上进行优化，以探究 CheemsBench 与各种下游任务的相关性：人类胜率（Human Win-rate）、MT-bench-zh（Huozi-Team, 2024）与 MT-bench（Zheng et al., 2023）。对于人类胜率任务，我们使用 87 条未包含在 CheemsBench 中的独立中文指令。对于每条提示，我们先从 Qwen2-72B-Instruct 获得一个固定的基线回答，然后从同一模型采样 32 个回答，并让人类标注者为每个回答打分：若回答优于基线则记 1 分，否则记 -1 分，据此计算胜率。对于 MT-bench-zh 与 MT-bench，回答从 Qwen2-7B-Instruct 采样，由 RM 在两轮提示上执行 Best-of-32 采样，并采用 GPT-4o 作为评判者（judge）。我们选择了 26 个不同的开源 RM（其训练数据与结构各不相同）进行相关性评估。我们的基线包括 RewardBench（Lambert et al., 2024）、RMB（Zhou et al., 2024），以及由 GPT-4o 标注的我们基准的替代版本，分别命名为 Open Prompt GPT 与 Human Instruction GPT。图 5 的结果表明：(1) 无论在中文还是英文任务上，我们的基准与下游任务的相关性都显著强于其他基线；(2) 由 GPT 标注的基准表现出欠佳的相关性，这凸显了人类判断的必要性——人类判断能够在下游任务上取得更好的泛化。

> **图 5（原文图像见 PDF）**：不同 RM 基准与三项下游任务表现之间的相关性（Spearman 秩相关）。

### 6.3 数据集构建消融

我们进行消融研究，以评估 4.2 节所述数据集构建策略的有效性。我们基于 Qwen2.5-72B-Instruct（Team, 2024）训练 RM 进行实验，并在表 4 中汇报结果。结果揭示了几个关键发现：(1) 单独使用 Human 子集或 GPT 子集都不足够。GPT 子集在我们的基准上表现欠佳，表明 GPT-4o 无法完全捕捉人类偏好；相反，Human 子集在 RewardBench 上表现较差，这可能由于其规模较小，限制了分布外性能。(2) 长度去偏策略提升了性能。我们在附录 D.3 中研究了 GPT 与人类标注者的偏差，凸显了长度去偏策略的必要性。(3) 远程监督策略显著提升了性能，凸显了融入人类监督的重要性。(4) 整合全部策略的表现最佳，证明了我们方法的有效性。

**表 4**：在我们的数据集上训练的 RM 的表现，以及不同处理策略的消融研究。CheemsPreference 表示经过完整处理的 GPT 子集与人工子集的组合。

| 模型 | RewardBench | Open Prompt 准确率 | Open Prompt 完全匹配率 | Human Instruction 准确率 | Human Instruction 完全匹配率 | Overall |
|---|---|---|---|---|---|---|
| **最优基线** | | | | | | |
| RewardBench@1 | 0.943 | 0.751 | 0.321 | 0.735 | 0.294 | 0.525 |
| RewardBench@2 | 0.941 | 0.750 | 0.317 | 0.722 | 0.271 | 0.515 |
| **使用 CheemsPreference 训练的模型** | | | | | | |
| Human subset | 0.897 | 0.852 | 0.502 | 0.823 | 0.412 | 0.647 |
| GPT subset | 0.822 | 0.778 | 0.373 | 0.743 | 0.303 | 0.549 |
| w/ Length debiasing | 0.865 | 0.790 | 0.402 | 0.768 | 0.322 | 0.571 |
| w/ Distant supervision | 0.909 | 0.837 | 0.464 | 0.821 | 0.404 | 0.632 |
| w/ All strategies | 0.917 | 0.837 | 0.458 | 0.826 | 0.416 | 0.634 |
| CheemsPreference | 0.919 | 0.857 | 0.508 | 0.832 | 0.431 | 0.657 |

### 6.4 扩展趋势

我们在 CheemsPreference 上验证扩展趋势。图 6 表明，在 Open Prompt 与 Human Instruction 子集上，RM 性能随数据量增加而提升，说明更大的训练数据集带来更优的性能。这一现象也凸显了我们远程监督方法的潜力。随后，我们通过在不同规模的 Qwen-2.5 系列模型（Team, 2024）上训练 RM 来评估模型扩展趋势。图 7 表明，将模型规模从 0.5B 增加到 72B 显著提升了性能，说明更大的模型能更有效地捕捉复杂的偏好模式。此外，从预训练模型或指令模型开始训练并无显著差异。

> **图 6（原文图像见 PDF）**：以比较对数量衡量的数据规模扩展对准确率的影响。
>
> **图 7（原文图像见 PDF）**：模型规模扩展对 RM 准确率的影响。

## 7 结论

本文通过引入 CheemsBench（一个全面的 RM 基准）与 CheemsPreference（一个高质量的中文偏好数据集），应对了开发中文 RM 的挑战。利用这些资源，我们评估了 RM 在中文语境下的进展，并验证了我们的数据集构建策略的有效性。我们的工作缩小了英文与中文 RM 之间的差距，并为未来研究奠定了基础。

## 局限性（Limitations）

本工作致力于解决中文奖励模型的资源不足问题。然而，由于主要聚焦中文，这些数据集可能无法完全覆盖所有地域变体，可能引入语言与文化偏差。此外，尽管人工标注的重要性显而易见，人类判断的主观性以及所涉标注者群体的特殊性可能导致有偏的偏好。而且，我们的发现虽针对中文情境量身定制，仍需进一步验证以确保其适用于中文和英文以外的语言。

## 伦理考虑（Ethical Considerations）

若干伦理考量是本工作的核心。首先，发布真实人类指令与来自开源模型的回答，存在含有有害内容的风险，因此需要仔细过滤。我们的标注过程主要聚焦中文语境，可能无法准确反映来自多种文化与多元人群的偏好，这凸显了更大包容性的必要性。此外，奖励模型虽旨在与人类偏好对齐，但可能无法完全捕捉真正的人类价值观，这可能在下游应用中导致意外后果。我们承认这些潜在问题，并指出它们在研究界普遍存在且需要审慎对待。通过强调这些担忧，我们希望促进该领域更稳健的解决方案。

## 致谢（Acknowledgment）

我们衷心感谢审稿人提出的深刻意见与宝贵建议。本工作受北京市自然科学基金（L243006）、北京市科技计划项目（Nos. Z231100010323002）以及国家自然科学基金（No. 62306303、62476265、62272439）资助。

## 参考文献（原文）

Anthropic. 2024. Claude 3.5 sonnet. https://www.anthropic.com/claude/sonnet.

Yuntao Bai, Andy Jones, Kamal Ndousse, Amanda Askell, Anna Chen, Nova DasSarma, Dawn Drain, Stanislav Fort, Deep Ganguli, Tom Henighan, Nicholas Joseph, Saurav Kadavath, Jackson Kernion, Tom Conerly, Sheer El-Showk, Nelson Elhage, Zac Hatfield-Dodds, Danny Hernandez, Tristan Hume, Scott Johnston, Shauna Kravec, Liane Lovitt, Neel Nanda, Catherine Olsson, Dario Amodei, Tom Brown, Jack Clark, Sam McCandlish, Chris Olah, Ben Mann, and Jared Kaplan. 2022. Training a helpful and harmless assistant with reinforcement learning from human feedback. Preprint, arXiv:2204.05862.

Ralph Allan Bradley and Milton E. Terry. 1952. Rank analysis of incomplete block designs: I. the method of paired comparisons. Biometrika, 39(3/4):324.

Daniel S. Brown and Scott Niekum. 2019. Deep bayesian reward learning from preferences. Preprint, arXiv:1912.04472.

Zheng Cai, Maosong Cao, Haojiong Chen, Kai Chen, Keyu Chen, Xin Chen, Xun Chen, Zehui Chen, Zhi Chen, Pei Chu, Xiaoyi Dong, Haodong Duan, Qi Fan, Zhaoye Fei, Yang Gao, Jiaye Ge, Chenya Gu, Yuzhe Gu, Tao Gui, Aijia Guo, Qipeng Guo, Conghui He, Yingfan Hu, Ting Huang, Tao Jiang, Penglong Jiao, Zhenjiang Jin, Zhikai Lei, Jiaxing Li, Jingwen Li, Linyang Li, Shuaibin Li, Wei Li, Yining Li, Hongwei Liu, Jiangning Liu, Jiawei Hong, Kaiwen Liu, Kuikun Liu, Xiaoran Liu, Chengqi Lv, Haijun Lv, Kai Lv, Li Ma, Runyuan Ma, Zerun Ma, Wenchang Ning, Linke Ouyang, Jiantao Qiu, Yuan Qu, Fukai Shang, Yunfan Shao, Demin Song, Zifan Song, Zhihao Sui, Peng Sun, Yu Sun, Huanze Tang, Bin Wang, Guoteng Wang, Jiaqi Wang, Jiayu Wang, Rui Wang, Yudong Wang, Ziyi Wang, Xingjian Wei, Qizhen Weng, Fan Wu, Yingtong Xiong, Chao Xu, Ruiliang Xu, Hang Yan, Yirong Yan, Xiaogui Yang, Haochen Ye, Huaiyuan Ying, Jia Yu, Jing Yu, Yuhang Zang, Chuyu Zhang, Li Zhang, Pan Zhang, Peng Zhang, Ruijie Zhang, Shuo Zhang, Songyang Zhang, Wenjian Zhang, Wenwei Zhang, Xingcheng Zhang, Xinyue Zhang, Hui Zhao, Qian Zhao, Xiaomeng Zhao, Fengzhe Zhou, Zaida Zhou, Jingming Zhuo, Yicheng Zou, Xipeng Qiu, Yu Qiao, and Dahua Lin. 2024. Internlm2 technical report. Preprint, arXiv:2403.17297.

Maosong Cao, Alexander Lam, Haodong Duan, Hongwei Liu, Songyang Zhang, and Kai Chen. 2024. Compassjudger-1: All-in-one judge model helps model evaluation and evolution. arXiv preprint arXiv:2410.16256.

Nuo Chen, Zinan Zheng, Ning Wu, Ming Gong, Dongmei Zhang, and Jia Li. 2024. Breaking language barriers in multilingual mathematical reasoning: Insights and observations. Preprint, arXiv:2310.20246.

Qinyuan Cheng, Tianxiang Sun, Wenwei Zhang, Siyin Wang, Xiangyang Liu, Mozhi Zhang, Junliang He, Mianqiu Huang, Zhangyue Yin, Kai Chen, and Xipeng Qiu. 2023. Evaluating hallucinations in chinese large language models. CoRR, abs/2310.03368.

Ganqu Cui, Lifan Yuan, Ning Ding, Guanming Yao, Wei Zhu, Yuan Ni, Guotong Xie, Zhiyuan Liu, and Maosong Sun. 2023. Ultrafeedback: Boosting language models with high-quality feedback. Preprint, arXiv:2310.01377.

Hanze Dong, Wei Xiong, Deepanshu Goyal, Rui Pan, Shizhe Diao, Jipeng Zhang, Kashun Shum, and Tong Zhang. 2023. Raft: Reward ranked finetuning for generative foundation model alignment. arXiv preprint arXiv:2304.06767.

Nicolai Dorka. 2024. Quantile regression for distributional reward models in rlhf. arXiv preprint arXiv:2409.10164.

Yann Dubois, Balázs Galambosi, Percy Liang, and Tatsunori B. Hashimoto. 2024. Length-controlled alpacaeval: A simple way to debias automatic evaluators. Preprint, arXiv:2404.04475.

Evan Frick, Tianle Li, Connor Chen, Wei-Lin Chiang, Anastasios N. Angelopoulos, Jiantao Jiao, Banghua Zhu, Joseph E. Gonzalez, and Ion Stoica. 2024. How to evaluate reward models for rlhf. Preprint, arXiv:2410.14872.

Deep Ganguli, Liane Lovitt, Jackson Kernion, Amanda Askell, Yuntao Bai, Saurav Kadavath, Ben Mann, Ethan Perez, Nicholas Schiefer, Kamal Ndousse, Andy Jones, Sam Bowman, Anna Chen, Tom Conerly, Nova DasSarma, Dawn Drain, Nelson Elhage, Sheer El-Showk, Stanislav Fort, Zac Hatfield-Dodds, Tom Henighan, Danny Hernandez, Tristan Hume, Josh Jacobson, Scott Johnston, Shauna Kravec, Catherine Olsson, Sam Ringer, Eli Tran-Johnson, Dario Amodei, Tom Brown, Nicholas Joseph, Sam McCandlish, Chris Olah, Jared Kaplan, and Jack Clark. 2022. Red teaming language models to reduce harms: Methods, scaling behaviors, and lessons learned. Preprint, arXiv:2209.07858.

Yang Gao, Dana Alon, and Donald Metzler. 2024. Impact of preference noise on the alignment performance of generative language models. Preprint, arXiv:2404.09824.

Team GLM, Aohan Zeng, Bin Xu, Bowen Wang, Chenhui Zhang, Da Yin, Diego Rojas, Guanyu Feng, Hanlin Zhao, Hanyu Lai, Hao Yu, Hongning Wang, Jiadai Sun, Jiajie Zhang, Jiale Cheng, Jiayi Gui, Jie Tang, Jing Zhang, Juanzi Li, Lei Zhao, Lindong Wu, Lucen Zhong, Mingdao Liu, Minlie Huang, Peng Zhang, Qinkai Zheng, Rui Lu, Shuaiqi Duan, Shudan Zhang, Shulin Cao, Shuxun Yang, Weng Lam Tam, Wenyi Zhao, Xiao Liu, Xiao Xia, Xiaohan Zhang, Xiaotao Gu, Xin Lv, Xinghan Liu, Xinyi Liu, Xinyue Yang, Xixuan Song, Xunkai Zhang, Yifan An, Yifan Xu, Yilin Niu, Yuantao Yang, Yueyan Li, Yushi Bai, Yuxiao Dong, Zehan Qi, Zhaoyu Wang, Zhen Yang, Zhengxiao Du, Zhenyu Hou, and Zihan Wang. 2024. Chatglm: A family of large language models from glm-130b to glm-4 all tools. Preprint, arXiv:2406.12793.

Aaron Grattafiori, Abhimanyu Dubey, Abhinav Jauhri, Abhinav Pandey, Abhishek Kadian, Ahmad AlDahle, Aiesha Letman, Akhil Mathur, Alan Schelten, Alex Vaughan, Amy Yang, Angela Fan, Anirudh Goyal, Anthony Hartshorn, Aobo Yang, Archi Mitra, Archie Sravankumar, Artem Korenev, Arthur Hinsvark, Arun Rao, Aston Zhang, Aurelien Rodriguez, Austen Gregerson, Ava Spataru, Baptiste Roziere, Bethany Biron, Binh Tang, Bobbie Chern, Charlotte Caucheteux, Chaya Nayak, Chloe Bi, Chris Marra, Chris McConnell, Christian Keller, Christophe Touret, Chunyang Wu, Corinne Wong, Cristian Canton Ferrer, Cyrus Nikolaidis, Damien Allonsius, Daniel Song, Danielle Pintz, Danny Livshits, Danny Wyatt, David Esiobu, Dhruv Choudhary, Dhruv Mahajan, Diego Garcia-Olano, Diego Perino, Dieuwke Hupkes, Egor Lakomkin, Ehab AlBadawy, Elina Lobanova, Emily Dinan, Eric Michael Smith, Filip Radenovic, Francisco Guzmán, Frank Zhang, Gabriel Synnaeve, Gabrielle Lee, Georgia Lewis Anderson, Govind Thattai, Graeme Nail, Gregoire Mialon, Guan Pang, Guillem Cucurell, Hailey Nguyen, Hannah Korevaar, Hu Xu, Hugo Touvron, Iliyan Zarov, Imanol Arrieta Ibarra, Isabel Kloumann, Ishan Misra, Ivan Evtimov, Jack Zhang, Jade Copet, Jaewon Lee, Jan Geffert, Jana Vranes, Jason Park, Jay Mahadeokar, Jeet Shah, Jelmer van der Linde, Jennifer Billock, Jenny Hong, Jenya Lee, Jeremy Fu, Jianfeng Chi, Jianyu Huang, Jiawen Liu, Jie Wang, Jiecao Yu, Joanna Bitton, Joe Spisak, Jongsoo Park, Joseph Rocca, Joshua Johnstun, Joshua Saxe, Junteng Jia, Kalyan Vasuden Alwala, Karthik Prasad, Kartikeya Upasani, Kate Plawiak, Ke Li, Kenneth Heafield, Kevin Stone, Khalid El-Arini, Krithika Iyer, Kshitiz Malik, Kuenley Chiu, Kunal Bhalla, Kushal Lakhotia, Lauren Rantala-Yeary, Laurens van der Maaten, Lawrence Chen, Liang Tan, Liz Jenkins, Louis Martin, Lovish Madaan, Lubo Malo, Lukas Blecher, Lukas Landzaat, Luke de Oliveira, Madeline Muzzi, Mahesh Pasupuleti, Mannat Singh, Manohar Paluri, Marcin Kardas, Maria Tsimpoukelli, Mathew Oldham, Mathieu Rita, Maya Pavlova, Melanie Kambadur, Mike Lewis, Min Si, Mitesh Kumar Singh, Mona Hassan, Naman Goyal, Narjes Torabi, Nikolay Bashlykov, Nikolay Bogoychev, Niladri Chatterji, Ning Zhang, Olivier Duchenne, Onur Çelebi, Patrick Alrassy, Pengchuan Zhang, Pengwei Li, Petar Vasic, Peter Weng, Prajjwal Bhargava, Pratik Dubal, Praveen Krishnan, Punit Singh Koura, Puxin Xu, Qing He, Qingxiao Dong, Ragavan Srinivasan, Raj Ganapathy, Ramon Calderer, Ricardo Silveira Cabral, Robert Stojnic, Roberta Raileanu, Rohan Maheswari, Rohit Girdhar, Rohit Patel, Romain Sauvestre, Ronnie Polidoro, Roshan Sumbaly, Ross Taylor, Ruan Silva, Rui Hou, Rui Wang, Saghar Hosseini, Sahana Chennabasappa, Sanjay Singh, Sean Bell, Seohyun Sonia Kim, Sergey Edunov, Shaoliang Nie, Sharan Narang, Sharath Raparthy, Sheng Shen, Shengye Wan, Shruti Bhosale, Shun Zhang, Simon Vandenhende, Soumya Batra, Spencer Whitman, Sten Sootla, Stephane Collot, Suchin Gururangan, Sydney Borodinsky, Tamar Herman, Tara Fowler, Tarek Sheasha, Thomas Georgiou, Thomas Scialom, Tobias Speckbacher, Todor Mihaylov, Tong Xiao, Ujjwal Karn, Vedanuj Goswami, Vibhor Gupta, Vignesh Ramanathan, Viktor Kerkez, Vincent Gonguet, Virginie Do, Vish Vogeti, Vítor Albiero, Vladan Petrovic, Weiwei Chu, Wenhan Xiong, Wenyin Fu, Whitney Meers, Xavier Martinet, Xiaodong Wang, Xiaofang Wang, Xiaoqing Ellen Tan, Xide Xia, Xinfeng Xie, Xuchao Jia, Xuewei Wang, Yaelle Goldschlag, Yashesh Gaur, Yasmine Babaei, Yi Wen, Yiwen Song, Yuchen Zhang, Yue Li, Yuning Mao, Zacharie Delpierre Coudert, Zheng Yan, Zhengxing Chen, Zoe Papakipos, Aaditya Singh, Aayushi Srivastava, Abha Jain, Adam Kelsey, Adam Shajnfeld, Adithya Gangidi, Adolfo Victoria, Ahuva Goldstand, Ajay Menon, Ajay Sharma, Alex Boesenberg, Alexei Baevski, Allie Feinstein, Amanda Kallet, Amit Sangani, Amos Teo, Anam Yunus, Andrei Lupu, Andres Alvarado, Andrew Caples, Andrew Gu, Andrew Ho, Andrew Poulton, Andrew Ryan, Ankit Ramchandani, Annie Dong, Annie Franco, Anuj Goyal, Aparajita Saraf, Arkabandhu Chowdhury, Ashley Gabriel, Ashwin Bharambe, Assaf Eisenman, Azadeh Yazdan, Beau James, Ben Maurer, Benjamin Leonhardi, Bernie Huang, Beth Loyd, Beto De Paola, Bhargavi Paranjape, Bing Liu, Bo Wu, Boyu Ni, Braden Hancock, Bram Wasti, Brandon Spence, Brani Stojkovic, Brian Gamido, Britt Montalvo, Carl Parker, Carly Burton, Catalina Mejia, Ce Liu, Changhan Wang, Changkyu Kim, Chao Zhou, Chester Hu, ChingHsiang Chu, Chris Cai, Chris Tindal, Christoph Feichtenhofer, Cynthia Gao, Damon Civin, Dana Beaty, Daniel Kreymer, Daniel Li, David Adkins, David Xu, Davide Testuggine, Delia David, Devi Parikh, Diana Liskovich, Didem Foss, Dingkang Wang, Duc Le, Dustin Holland, Edward Dowling, Eissa Jamil, Elaine Montgomery, Eleonora Presani, Emily Hahn, Emily Wood, Eric-Tuan Le, Erik Brinkman, Esteban Arcaute, Evan Dunbar, Evan Smothers, Fei Sun, Felix Kreuk, Feng Tian, Filippos Kokkinos, Firat Ozgenel, Francesco Caggioni, Frank Kanayet, Frank Seide, Gabriela Medina Florez, Gabriella Schwarz, Gada Badeer, Georgia Swee, Gil Halpern, Grant Herman, Grigory Sizov, Guangyi, Zhang, Guna Lakshminarayanan, Hakan Inan, Hamid Shojanazeri, Han Zou, Hannah Wang, Hanwen Zha, Haroun Habeeb, Harrison Rudolph, Helen Suk, Henry Aspegren, Hunter Goldman, Hongyuan Zhan, Ibrahim Damlaj, Igor Molybog, Igor Tufanov, Ilias Leontiadis, Irina-Elena Veliche, Itai Gat, Jake Weissman, James Geboski, James Kohli, Janice Lam, Japhet Asher, Jean-Baptiste Gaya, Jeff Marcus, Jeff Tang, Jennifer Chan, Jenny Zhen, Jeremy Reizenstein, Jeremy Teboul, Jessica Zhong, Jian Jin, Jingyi Yang, Joe Cummings, Jon Carvill, Jon Shepard, Jonathan McPhie, Jonathan Torres, Josh Ginsburg, Junjie Wang, Kai Wu, Kam Hou U, Karan Saxena, Kartikay Khandelwal, Katayoun Zand, Kathy Matosich, Kaushik Veeraraghavan, Kelly Michelena, Keqian Li, Kiran Jagadeesh, Kun Huang, Kunal Chawla, Kyle Huang, Lailin Chen, Lakshya Garg, Lavender A, Leandro Silva, Lee Bell, Lei Zhang, Liangpeng Guo, Licheng Yu, Liron Moshkovich, Luca Wehrstedt, Madian Khabsa, Manav Avalani, Manish Bhatt, Martynas Mankus, Matan Hasson, Matthew Lennie, Matthias Reso, Maxim Groshev, Maxim Naumov, Maya Lathi, Meghan Keneally, Miao Liu, Michael L. Seltzer, Michal Valko, Michelle Restrepo, Mihir Patel, Mik Vyatskov, Mikayel Samvelyan, Mike Clark, Mike Macey, Mike Wang, Miquel Jubert Hermoso, Mo Metanat, Mohammad Rastegari, Munish Bansal, Nandhini Santhanam, Natascha Parks, Natasha White, Navyata Bawa, Nayan Singhal, Nick Egebo, Nicolas Usunier, Nikhil Mehta, Nikolay Pavlovich Laptev, Ning Dong, Norman Cheng, Oleg Chernoguz, Olivia Hart, Omkar Salpekar, Ozlem Kalinli, Parkin Kent, Parth Parekh, Paul Saab, Pavan Balaji, Pedro Rittner, Philip Bontrager, Pierre Roux, Piotr Dollar, Polina Zvyagina, Prashant Ratanchandani, Pritish Yuvraj, Qian Liang, Rachad Alao, Rachel Rodriguez, Rafi Ayub, Raghotham Murthy, Raghu Nayani, Rahul Mitra, Rangaprabhu Parthasarathy, Raymond Li, Rebekkah Hogan, Robin Battey, Rocky Wang, Russ Howes, Ruty Rinott, Sachin Mehta, Sachin Siby, Sai Jayesh Bondu, Samyak Datta, Sara Chugh, Sara Hunt, Sargun Dhillon, Sasha Sidorov, Satadru Pan, Saurabh Mahajan, Saurabh Verma, Seiji Yamamoto, Sharadh Ramaswamy, Shaun Lindsay, Shaun Lindsay, Sheng Feng, Shenghao Lin, Shengxin Cindy Zha, Shishir Patil, Shiva Shankar, Shuqiang Zhang, Shuqiang Zhang, Sinong Wang, Sneha Agarwal, Soji Sajuyigbe, Soumith Chintala, Stephanie Max, Stephen Chen, Steve Kehoe, Steve Satterfield, Sudarshan Govindaprasad, Sumit Gupta, Summer Deng, Sungmin Cho, Sunny Virk, Suraj Subramanian, Sy Choudhury, Sydney Goldman, Tal Remez, Tamar Glaser, Tamara Best, Thilo Koehler, Thomas Robinson, Tianhe Li, Tianjun Zhang, Tim Matthews, Timothy Chou, Tzook Shaked, Varun Vontimitta, Victoria Ajayi, Victoria Montanez, Vijai Mohan, Vinay Satish Kumar, Vishal Mangla, Vlad Ionescu, Vlad Poenaru, Vlad Tiberiu Mihailescu, Vladimir Ivanov, Wei Li, Wenchen Wang, Wenwen Jiang, Wes Bouaziz, Will Constable, Xiaocheng Tang, Xiaojian Wu, Xiaolan Wang, Xilun Wu, Xinbo Gao, Yaniv Kleinman, Yanjun Chen, Ye Hu, Ye Jia, Ye Qi, Yenda Li, Yilin Zhang, Ying Zhang, Yossi Adi, Youngjin Nam, Yu, Wang, Yu Zhao, Yuchen Hao, Yundi Qian, Yunlu Li, Yuzi He, Zach Rait, Zachary DeVito, Zef Rosnbrick, Zhaoduo Wen, Zhenyu Yang, Zhiwei Zhao, and Zhiyu Ma. 2024. The llama 3 herd of models. Preprint, arXiv:2407.21783.

Srishti Gureja, Lester James V. Miranda, Shayekh Bin Islam, Rishabh Maheshwary, Drishti Sharma, Gusti Winata, Nathan Lambert, Sebastian Ruder, Sara Hooker, and Marzieh Fadaee. 2024. M-rewardbench: Evaluating reward models in multilingual settings. Preprint, arXiv:2410.15522.

Zhenyu Hou, Yilin Niu, Zhengxiao Du, Xiaohan Zhang, Xiao Liu, Aohan Zeng, Qinkai Zheng, Minlie Huang, Hongning Wang, Jie Tang, and Yuxiao Dong. 2024. Chatglm-rlhf: Practices of aligning large language models with human feedback. Preprint, arXiv:2404.00934.

Kexin Huang, Xiangyang Liu, Qianyu Guo, Tianxiang Sun, Jiawei Sun, Yaru Wang, Zeyang Zhou, Yixu Wang, Yan Teng, Xipeng Qiu, Yingchun Wang, and Dahua Lin. 2023. Flames: Benchmarking value alignment of chinese large language models. Preprint, arXiv:2311.06899.

Huozi-Team. 2024. Huozi: Leveraging large language models for enhanced open-domain chatting. https://github.com/HIT-SCIR/huozi.

Borja Ibarz, Jan Leike, Tobias Pohlen, Geoffrey Irving, Shane Legg, and Dario Amodei. 2018. Reward learning from human preferences and demonstrations in atari. Preprint, arXiv:1811.06521.

Jiaming Ji, Donghai Hong, Borong Zhang, Boyuan Chen, Josef Dai, Boren Zheng, Tianyi Qiu, Boxun Li, and Yaodong Yang. 2024. Pku-saferlhf: Towards multi-level safety alignment for llms with human preference. arXiv preprint arXiv:2406.15513.

Maxim Khanov, Jirayu Burapacheep, and Yixuan Li. 2024. Args: Alignment as reward-guided search. Preprint, arXiv:2402.01694.

Sunghwan Kim, Dongjin Kang, Taeyoon Kwon, Hyungjoo Chae, Jungsoo Won, Dongha Lee, and Jinyoung Yeo. 2024. Evaluating robustness of reward models for mathematical reasoning. Preprint, arXiv:2410.01729.

Nathan Lambert, Valentina Pyatkin, Jacob Morrison, LJ Miranda, Bill Yuchen Lin, Khyathi Chandu, Nouha Dziri, Sachin Kumar, Tom Zick, Yejin Choi, Noah A. Smith, and Hannaneh Hajishirzi. 2024. Rewardbench: Evaluating reward models for language modeling. Preprint, arXiv:2403.13787.

Nathan Lambert, Lewis Tunstall, Nazneen Rajani, and Tristan Thrush. 2023. Huggingface h4 stack exchange preference dataset.

Jein Lee. 2023. chinese-llm-benchmark. https://github.com/jeinlee1991/chinese-llm-benchmark.

Bolian Li, Yifan Wang, Ananth Grama, and Ruqi Zhang. 2024a. Cascade reward sampling for efficient decoding-time alignment. Preprint, arXiv:2406.16306.

Zongjie Li, Chaozheng Wang, Pingchuan Ma, Daoyuan Wu, Shuai Wang, Cuiyun Gao, and Yang Liu. 2024b. Split and merge: Aligning position biases in llmbased evaluators. Preprint, arXiv:2310.01432.

Mingan Lin, Fan Yang, Yanjun Shen, Haoze Sun, Tianpeng Li, Tao Zhang, Chenzheng Zhu, Tao Zhang, Miao Zheng, Xu Li, Yijie Zhou, Mingyang Chen, Yanzhao Qin, Youquan Li, Hao Liang, Fei Li, Yadong Li, Mang Wang, Guosheng Dong, Kun Fang, Jianhua Xu, Bin Cui, Wentao Zhang, Zenan Zhou, and Weipeng Chen. 2024. Baichuan alignment technical report. Preprint, arXiv:2410.14940.

Chris Yuhao Liu, Liang Zeng, Jiacai Liu, Rui Yan, Jujie He, Chaojie Wang, Shuicheng Yan, Yang Liu, and Yahui Zhou. 2024a. Skywork-reward: Bag of tricks for reward modeling in llms. Preprint, arXiv:2410.18451.

Xiao Liu, Xuanyu Lei, Shengyuan Wang, Yue Huang, Zhuoer Feng, Bosi Wen, Jiale Cheng, Pei Ke, Yifan Xu, Weng Lam Tam, Xiaohan Zhang, Lichao Sun, Hongning Wang, Jing Zhang, Minlie Huang, Yuxiao Dong, and Jie Tang. 2023. Alignbench: Benchmarking chinese alignment of large language models. Preprint, arXiv:2311.18743.

Yantao Liu, Zijun Yao, Rui Min, Yixin Cao, Lei Hou, and Juanzi Li. 2024b. Rm-bench: Benchmarking reward models of language models with subtlety and style. Preprint, arXiv:2410.16184.

Xingzhou Lou, Dong Yan, Wei Shen, Yuzi Yan, Jian Xie, and Junge Zhang. 2024. Uncertainty-aware reward model: Teaching reward models to know what is unknown. arXiv preprint arXiv:2410.00847.

Reiichiro Nakano, Jacob Hilton, Suchir Balaji, Jeff Wu, Long Ouyang, Christina Kim, Christopher Hesse, Shantanu Jain, Vineet Kosaraju, William Saunders, Xu Jiang, Karl Cobbe, Tyna Eloundou, Gretchen Krueger, Kevin Button, Matthew Knight, Benjamin Chess, and John Schulman. 2022. Webgpt: Browser-assisted question-answering with human feedback. Preprint, arXiv:2112.09332.

Andrew Y. Ng and Stuart J. Russell. 2000. Algorithms for inverse reinforcement learning. In Proceedings of the Seventeenth International Conference on Machine Learning, ICML '00, page 663–670, San Francisco, CA, USA. Morgan Kaufmann Publishers Inc.

OpenAI, Josh Achiam, Steven Adler, Sandhini Agarwal, Lama Ahmad, Ilge Akkaya, Florencia Leoni Aleman, Diogo Almeida, Janko Altenschmidt, Sam Altman, Shyamal Anadkat, Red Avila, Igor Babuschkin, Suchir Balaji, Valerie Balcom, Paul Baltescu, Haiming Bao, Mohammad Bavarian, Jeff Belgum, Irwan Bello, Jake Berdine, Gabriel Bernadett-Shapiro, Christopher Berner, Lenny Bogdonoff, Oleg Boiko, Madelaine Boyd, Anna-Luisa Brakman, Greg Brockman, Tim Brooks, Miles Brundage, Kevin Button, Trevor Cai, Rosie Campbell, Andrew Cann, Brittany Carey, Chelsea Carlson, Rory Carmichael, Brooke Chan, Che Chang, Fotis Chantzis, Derek Chen, Sully Chen, Ruby Chen, Jason Chen, Mark Chen, Ben Chess, Chester Cho, Casey Chu, Hyung Won Chung, Dave Cummings, Jeremiah Currier, Yunxing Dai, Cory Decareaux, Thomas Degry, Noah Deutsch, Damien Deville, Arka Dhar, David Dohan, Steve Dowling, Sheila Dunning, Adrien Ecoffet, Atty Eleti, Tyna Eloundou, David Farhi, Liam Fedus, Niko Felix, Simón Posada Fishman, Juston Forte, Isabella Fulford, Leo Gao, Elie Georges, Christian Gibson, Vik Goel, Tarun Gogineni, Gabriel Goh, Rapha GontijoLopes, Jonathan Gordon, Morgan Grafstein, Scott Gray, Ryan Greene, Joshua Gross, Shixiang Shane Gu, Yufei Guo, Chris Hallacy, Jesse Han, Jeff Harris, Yuchen He, Mike Heaton, Johannes Heidecke, Chris Hesse, Alan Hickey, Wade Hickey, Peter Hoeschele, Brandon Houghton, Kenny Hsu, Shengli Hu, Xin Hu, Joost Huizinga, Shantanu Jain, Shawn Jain, Joanne Jang, Angela Jiang, Roger Jiang, Haozhun Jin, Denny Jin, Shino Jomoto, Billie Jonn, Heewoo Jun, Tomer Kaftan, Lukasz Kaiser, Ali Kamali, Ingmar Kanitscheider, Nitish Shirish Keskar, Tabarak Khan, Logan Kilpatrick, Jong Wook Kim, Christina Kim, Yongjik Kim, Jan Hendrik Kirchner, Jamie Kiros, Matt Knight, Daniel Kokotajlo, Lukasz Kondraciuk, Andrew Kondrich, Aris Konstantinidis, Kyle Kosic, Gretchen Krueger, Vishal Kuo, Michael Lampe, Ikai Lan, Teddy Lee, Jan Leike, Jade Leung, Daniel Levy, Chak Ming Li, Rachel Lim, Molly Lin, Stephanie Lin, Mateusz Litwin, Theresa Lopez, Ryan Lowe, Patricia Lue, Anna Makanju, Kim Malfacini, Sam Manning, Todor Markov, Yaniv Markovski, Bianca Martin, Katie Mayer, Andrew Mayne, Bob McGrew, Scott Mayer McKinney, Christine McLeavey, Paul McMillan, Jake McNeil, David Medina, Aalok Mehta, Jacob Menick, Luke Metz, Andrey Mishchenko, et al. 2024. Gpt-4 technical report. Preprint, arXiv:2303.08774.

Long Ouyang, Jeff Wu, Xu Jiang, Diogo Almeida, Carroll L. Wainwright, Pamela Mishkin, Chong Zhang, Sandhini Agarwal, Katarina Slama, Alex Ray, John Schulman, Jacob Hilton, Fraser Kelton, Luke Miller, Maddie Simens, Amanda Askell, Peter Welinder, Paul Christiano, Jan Leike, and Ryan Lowe. 2022. Training language models to follow instructions with human feedback. Preprint, arXiv:2203.02155.

Malayandi Palan, Nicholas C. Landolfi, Gleb Shevchuk, and Dorsa Sadigh. 2019. Learning reward functions by integrating human demonstrations and preferences. Preprint, arXiv:1906.08928.

Junsoo Park, Seungyeon Jwa, Meiying Ren, Daeyoung Kim, and Sanghyuk Choi. 2024. Offsetbias: Leveraging debiased data for tuning evaluators. Preprint, arXiv:2407.06551.

Qiwei Peng, Yekun Chai, and Xuhong Li. 2024. Humaneval-xl: A multilingual code generation benchmark for cross-lingual natural language generalization. Preprint, arXiv:2402.16694.

Guijin Son, Hyunwoo Ko, Hoyoung Lee, Yewon Kim, and Seunghyeok Hong. 2024. Llm-as-a-judge & reward model: What they can and cannot do. Preprint, arXiv:2409.11239.

Nisan Stiennon, Long Ouyang, Jeff Wu, Daniel M. Ziegler, Ryan Lowe, Chelsea Voss, Alec Radford, Dario Amodei, and Paul Christiano. 2022. Learning to summarize from human feedback. Preprint, arXiv:2009.01325.

Rickard Stureborg, Dimitris Alikaniotis, and Yoshi Suhara. 2024. Large language models are inconsistent and biased evaluators. Preprint, arXiv:2405.01724.

Qwen Team. 2024. Qwen2.5: A party of foundation models.

Haoxiang Wang, Wei Xiong, Tengyang Xie, Han Zhao, and Tong Zhang. 2024a. Interpretable preferences via multi-objective reward modeling and mixture-of-experts. In EMNLP.

Shenzhi Wang, Yaowei Zheng, Guoyin Wang, Shiji Song, and Gao Huang. 2024b. Llama3.1-8b-chinese-chat.

Zhilin Wang, Alexander Bukharin, Olivier Delalleau, Daniel Egert, Gerald Shen, Jiaqi Zeng, Oleksii Kuchaiev, and Yi Dong. 2024c. Helpsteer2preference: Complementing ratings with preferences. Preprint, arXiv:2410.01257.

Zhilin Wang, Yi Dong, Olivier Delalleau, Jiaqi Zeng, Gerald Shen, Daniel Egert, Jimmy J. Zhang, Makesh Narsimhan Sreedhar, and Oleksii Kuchaiev. 2024d. Helpsteer2: Open-source dataset for training top-performing reward models. Preprint, arXiv:2406.08673.

Xueru Wen, Jie Lou, Yaojie Lu, Hongyu Lin, Xing Yu, Xinyu Lu, Ben He, Xianpei Han, Debing Zhang, and Le Sun. 2024. Rethinking reward model evaluation: Are we barking up the wrong tree? Preprint, arXiv:2410.05584.

shareAI Xinlu Lai. 2024. The dpo dataset for chinese and english with emoji. https://huggingface.co/datasets/shareAI/DPO-zh-en-emoji.

Wei Xiong, Hanze Dong, Chenlu Ye, Ziqi Wang, Han Zhong, Heng Ji, Nan Jiang, and Tong Zhang. 2024. Iterative preference learning from human feedback: Bridging theory and practice for rlhf under kl-constraint. Preprint, arXiv:2312.11456.

Guohai Xu, Jiayi Liu, Ming Yan, Haotian Xu, Jinghui Si, Zhuoran Zhou, Peng Yi, Xing Gao, Jitao Sang, Rong Zhang, Ji Zhang, Chao Peng, Fei Huang, and Jingren Zhou. 2023. Cvalues: Measuring the values of chinese large language models from safety to responsibility. Preprint, arXiv:2307.09705.

An Yang, Baosong Yang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Zhou, Chengpeng Li, Chengyuan Li, Dayiheng Liu, Fei Huang, Guanting Dong, Haoran Wei, Huan Lin, Jialong Tang, Jialin Wang, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Ma, Jin Xu, Jingren Zhou, Jinze Bai, Jinzheng He, Junyang Lin, Kai Dang, Keming Lu, Keqin Chen, Kexin Yang, Mei Li, Mingfeng Xue, Na Ni, Pei Zhang, Peng Wang, Ru Peng, Rui Men, Ruize Gao, Runji Lin, Shijie Wang, Shuai Bai, Sinan Tan, Tianhang Zhu, Tianhao Li, Tianyu Liu, Wenbin Ge, Xiaodong Deng, Xiaohuan Zhou, Xingzhang Ren, Xinyu Zhang, Xipin Wei, Xuancheng Ren, Yang Fan, Yang Yao, Yichang Zhang, Yu Wan, Yunfei Chu, Yuqiong Liu, Zeyu Cui, Zhenru Zhang, and Zhihao Fan. 2024a. Qwen2 technical report. arXiv preprint arXiv:2407.10671.

Kai-Chou Yang. 2024. Kyara.

Rui Yang, Ruomeng Ding, Yong Lin, Huan Zhang, and Tong Zhang. 2024b. Regularizing hidden states enables learning generalizable reward model for llms. arXiv preprint arXiv:2406.10216.

Huimu Yu, Xing Wu, Weidong Yin, Debing Zhang, and Songlin Hu. 2024. Codepmp: Scalable preference model pretraining for large language model reasoning. Preprint, arXiv:2410.02229.

Li Yucheng. 2023. 3,000 chinese zhihu q&a preference dataset. https://huggingface.co/datasets/liyucheng/zhihu_rlhf_3k.

yuelin bai. 2023. Coig-cqia: Quality is all you need for chinese instruction fine-tuning. https://github.com/paralym/COIG-CQIA.

Michael JQ Zhang, Zhilin Wang, Jena D. Hwang, Yi Dong, Olivier Delalleau, Yejin Choi, Eunsol Choi, Xiang Ren, and Valentina Pyatkin. 2024a. Diverging preferences: When do annotators disagree and do models know? Preprint, arXiv:2410.14632.

Xiaotian Zhang, Chunyang Li, Yi Zong, Zhengyu Ying, Liang He, and Xipeng Qiu. 2024b. Evaluating the performance of large language models on gaokao benchmark. Preprint, arXiv:2305.12474.

Lianmin Zheng, Wei-Lin Chiang, Ying Sheng, Siyuan Zhuang, Zhanghao Wu, Yonghao Zhuang, Zi Lin, Zhuohan Li, Dacheng Li, Eric. P Xing, Hao Zhang, Joseph E. Gonzalez, and Ion Stoica. 2023. Judging llm-as-a-judge with mt-bench and chatbot arena. Preprint, arXiv:2306.05685.

Enyu Zhou, Guodong Zheng, Binghai Wang, Zhiheng Xi, Shihan Dou, Rong Bao, Wei Shen, Limao Xiong, Jessica Fan, Yurong Mou, Rui Zheng, Tao Gui, Qi Zhang, and Xuanjing Huang. 2024. Rmb: Comprehensively benchmarking reward models in llm alignment. Preprint, arXiv:2410.09893.

Banghua Zhu, Evan Frick, Tianhao Wu, Hanlin Zhu, and Jiantao Jiao. 2023. Starling-7b: Improving llm helpfulness & harmlessness with rlaif.

## 附录 A 提示类别（Prompt Category）

我们的指令数据集采用双源收集策略构建。主要来源为从生产环境收集的真实人类查询，确保了真实性与实际相关性；辅以经 GPT 增强的开源数据，并经过严格的人工把关以维持质量标准。为确保全面的覆盖与多样性，我们开发了系统化的分类体系来指导数据收集过程。该分类体系帮助我们从多个维度对指令进行归类，包括任务类型（如理解、知识型、创作、推理与数学）、复杂度层级与应用场景。每条收集到的提示都依据该体系被仔细审核与归类，使我们能够在不同类型的指令之间保持均衡分布。CheemsBench 的提示类别体系见图 8 与图 9，CheemsPreference 的提示类别体系见图 10。

> **图 8（原文图像见 PDF）**：开源提示的类别体系。这些提示选自多个数据集，并经人工整合进该统一框架。
>
> **图 9（原文图像见 PDF）**：人类指令的类别体系。由于完整体系过于复杂，仅展示前两层分类。
>
> **图 10（原文图像见 PDF）**：中文偏好数据集中提示的类别体系。由于完整体系过于复杂，仅绘制前两层分类。

## 附录 B 标注提示（Annotation Prompts）

在本工作中，我们利用 GPT-4o 构建偏好数据集。我们采用图 11 所示的结构化评判提示来评估回答质量，强调对不同模型输出进行客观、无偏的比较。每条提示根据其类别被分配特定的评判标准。这些标准确保评测在不同语境下的一致性与全面性。图 13 以中文详细给出了这些标准，涵盖语言与逻辑层面，同时考虑了指令的安全性与复杂性。⁷

⁷ 评判提示模板与标准的英文版本分别见图 12 与图 14。

> **图 11（原文图像见 PDF）**：基于详细评判标准、确保客观比较的 AI 标注模板。（该模板正文为中文，文本提取时乱码「？」；其英文译文见图 12。）
>
> **图 12（原文图像见 PDF）**：译成英文的 AI 标注模板。
>
> **图 13（原文图像见 PDF）**：中文版 AI 标注提示与相应评判标准。（正文为中文，文本提取时乱码「？」；英文译文见图 14。）
>
> **图 14（原文图像见 PDF）**：译成英文的 AI 标注提示与相应评判标准。

## 附录 C 冲突消解（Conflict Resolving）

本节介绍一种旨在解决人工评估中潜在标注冲突的算法。如算法 1 所示，冲突消解算法基于"冲突的回答具有可比质量"这一理解，系统性地将相互冲突的回答整合为更大的节点。该算法首先构建一个以单个回答为节点的图，依据回答之间的偏好关系建立有向边。为处理指示标注冲突的环，该算法采用深度优先搜索（DFS）迭代地检测这些环并将其合并为超节点（super-node）。这一合并过程有助于刻画所涉回答在质量上的相似性。在最后一步，应用拓扑排序算法得到回答的偏序。我们在表 5 中汇报了 Open Prompt 与 Human Instruction 子集上人工标注与 GPT 标注的冲突率。冲突率通过比较原始标注结果与经算法处理后的回答排序之间的一致性来确定。我们发现，总体上 GPT 比人类标注者更不一致。此外，Human Instruction 子集的冲突率高于 Open Prompt 子集，表明该子集中的提示对偏好标注而言可能更具挑战性。

**算法 1：冲突消解算法（Conflict Resolving Algorithm）**（伪代码保持原文）

```
Input: responses, annotations
Output: responseRanks

1:  G ← InitializeGraph()                            ▷ Build Graph G
2:  for each annotation_i in annotations do
3:      (chosen_response, reject_response) ← annotation_i
4:      r1 ← ComputeIdentifier(chosen_response)
5:      r2 ← ComputeIdentifier(reject_response)
6:      if r1 not in G then
7:          AddNode(r1, G)
8:      end if
9:      if r2 not in G then
10:         AddNode(r2, G)
11:     end if
12:     if IsEqual(annotation_i) then               ▷ In case chosen and reject is annotated as equal quality
13:         AddEdge(r1, r2, G)
14:         AddEdge(r2, r1, G)
15:     else
16:         AddEdge(r1, r2, G)
17:     end if
18: end for

19: M ← InitializeMapping()                          ▷ Record mapping between merged node and origin nodes
20: repeat                                           ▷ Detect and Merge Cycles
21:     conflict_ids ← DetectCycles(G)               ▷ Cycles can be detected with Depth-first Search
22:     AddNode(rm, G)
23:     if len(conflict_ids) > 0 then
24:         rm ← CreateRecordIdentifier(conflict_ids, M)
25:         for r_i in conflict_ids do
26:             for e in FindEdgesEndswith(r_i, G) do
27:                 DeleteEdge(e)
28:                 AddEdge(e[0], rm)
29:             end for
30:             for e in FindEdgesStartswith(r_i, G) do
31:                 DeleteEdge(e)
32:                 AddEdge(rm, e[-1])
33:             end for
34:             DeleteNode(r_i)
35:         end for
36:     end if
37: until len(conflict_ids) == 0

38: Initialize an empty list
39: while G is non-empty do                          ▷ Topological Sort
40:     R ← SelectNodesWithoutInEdges(G)
41:     AddRanksWithMapping(responseRanks, M, R)
42:     DeleteNodesEdges(G, R)
43: end while
44: Return responseRanks
```

**表 5**：人工标注与 GPT-4o 标注的冲突率。

| 数据集（子集与标注来源） | 冲突率 |
|---|---|
| Open Prompt Human | 0.1999 |
| Human Instruction Human | 0.2161 |
| Open Prompt GPT | 0.2593 |
| Human Instruction GPT | 0.3170 |

## 附录 D 人工标注（Human Annotation）

我们雇用了一个由 29 名专业标注者组成的团队，他们均持有学士学位，按标准工作时间工作（每天 8 小时的有效标注时间）。平均而言，一名标注者每天完成约 40 次三元比较，并可自由使用任何必要的工具与资源进行事实核查与验证。

### D.1 标注流程

我们的提示分配系统按提示类别划分任务，并根据标注者的领域专长与历史表现将其分发给相应标注者。

为确保数据质量，我们实施了全面的多阶段校验流程；该流程在偏好数据集生产中经过六个多月的实践检验与改进，之后才应用于 CheemsBench 的标注过程。

具体而言，每条提示首先经过双盲标注，两位独立标注者需达到 90% 的一致率。出现分歧时，标注者会进行对齐讨论，依据既定的标注指南而非个人判断达成共识。当重大分歧无法解决时，相关案例会被提交给数据交付团队、数据运营团队，最后交由算法开发者进行进一步的审查与指导。

在质量保证方面，我们采用级联式单盲审查系统。首先，数据交付团队核验 30% 的已标注数据，随后移交数据运营团队进行另一轮独立的 30% 核验。最终结果由研究团队验证。为确保单盲设定下的审查质量，我们开发了动态校验机制：通过团队间的协同对齐持续建立真值样本，并定期将其嵌入审查任务之中。

我们的多阶段流程提供了很强的问责性：每个阶段的工作都会被后续阶段审查，已获批准的标注也可能在后期审查中被驳回，这促使标注者进行彻底的独立评估而非简单附和。出于现实约束，我们采用单盲方式：虽然我们的质量控制审查者更有经验、资质更高，但其人数相比普通标注者较少，因此需要采用这一方法来最大化质量检查的覆盖面。

### D.2 标注指南

我们的标注指南建立在表 6 所示的三个核心维度之上。我们要求标注者在进行偏好标注的同时，依据表 7 的标准为每个回答打分。对于得分相同的回答，我们要求标注者进行分桶式的成对比较以进一步排序。在比较过程中，标注者被指示：若回答 A 优于 B 则记 `g`（good），若 B 优于 A 则记 `b`（bad），若两个回答被视为同等好则记 `s`（same）。该比较基于整体用户偏好，不设详细的评分标准。完成所有比较后，标注者需整合其成对判断，建立完整的排序（例如 A>C>B=D>E）。随后，标注者将这一最终排序与其初始打分进行交叉验证，以确保一致性并解决任何潜在矛盾。

除通用指南之外，我们还针对不同类型的提示制定并迭代完善了具体的评估标准。这些针对特定提示的指南对上述标准进行了细化，根据任务要求平衡不同的评估指标，并为标注者提供详细示例以供参考。此外，我们建立了处理特殊情形（如乱码文本、逻辑不一致的回答与错误信息）的具体规程。另外，标注者还需高亮并指明回答中的具体问题片段，以便在偏好标注之外精确定位问题。

**表 6**：标注指南中的详细评测维度及其定义。

| 维度 | 定义 |
|---|---|
| 无害性（Harmlessness） | 生成内容必须避免对个人、设备、财产、环境或重要机构造成任何潜在伤害。具体而言：<br>· 避免一切形式的歧视（种族、性别、宗教、国籍、性取向、年龄、社会经济地位）<br>· 遵循社会主义核心价值观与社会公德<br>· 排除色情与暴力内容<br>· 保护隐私与知识产权<br>· 避免推广有害的现实建议或非法活动<br>· 尊重所有群体，避免带有偏见的语言<br>· 排除辱骂、威胁或攻击性语言 |
| 真实性（Truthfulness） | 生成内容必须包含准确的信息，避免误导用户。具体而言：<br>· 避免提供虚假信息，尤其是在涉及重要决策或敏感话题时<br>· 排除误导性或未经证实的信息<br>· 尽可能提供来源或证据以增强可信度<br>· 确保专业或技术信息的准确性<br>· 在摘要任务中保持对输入信息的忠实 |
| 帮助性（Helpfulness） | 生成内容应遵循用户要求并提供有效帮助。具体而言：<br>· 使用清晰、易懂的语言和结构<br>· 准确回答问题，即使问题表述不佳<br>· 对不清晰的指令寻求澄清<br>· 避免过多或冗余的信息<br>· 仅在任务隐含要求时做出适当的上下文假设 |

**表 7**：回答质量评估的评分标准与详细描述。

| 质量等级 | 分数 | 类别 | 详细描述 |
|---|---|---|---|
| 差（Poor） | 0 | 严重错误（Severe Errors） | 回答存在严重错误，无实际价值。示例：有害内容、完全无视指令、文本崩坏、语言错误（非中文）、内容严重缺失（截断）、空白或报错信息。 |
| | 1 | 极低质量（Extremely Low Quality） | 回答在全部 3H 维度上表现极差，格式、信息与文本存在重大或大量错误；无法满足用户需求，整体印象极差，基本不可用。 |
| 中等（Average） | 2 | 低于平均（Below Average） | 回答在 3H 维度上存在不足，有明显但非致命的问题；整体印象不佳，大部分内容不可用，小部分经调整后可能可用。 |
| | 3 | 中等（Moderate） | 回答在 3H 维度上表现一般，基本满足用户需求；存在影响有限的轻微错误；印象尚可、平庸，部分可采用但需要用户调整。 |
| 优秀（Excellent） | 4 | 良好（Good） | 回答在 3H 维度上表现良好，满足用户需求且无硬性错误；整体印象良好，瑕疵极少或没有（但无亮点）；大部分可直接使用，小部分需微调。 |
| | 5 | 杰出（Outstanding） | 回答在全部 3H 维度上表现卓越，整体印象出色，有出彩点或亮点；完美满足用户需求，高度契合场景，可完全不做修改地采用。 |

### D.3 标注偏差

我们从回答长度与位置两个角度探究了人类与 GPT 标注者的偏好，如图 15 所示。可以观察到，GPT-4o 通常更偏好被放在后面的回答，而人类标注者对位置没有表现出显著偏好。此外，当回答长度差异适中时，人类与 GPT 标注者都倾向于偏好较长的回答；然而当长度差异过大时，人类倾向于偏好较短的回答。总体而言，标注者的特定偏好并不十分明显。

> **图 15（原文图像见 PDF）**：人类标注者与 GPT 标注者偏差的比较。对于子图 (a) 与 (c)，横轴表示回答 A 与回答 B 的长度差，纵轴表示回答 A 被选为更优的比例。

## 附录 E 基准结果（Benchmark Results）

本节展示 CheemsBench 上的完整结果。表 8 报告了判别式 RM 与作为 RM 的生成式模型的性能。所评测的判别式 RM 包括：Skywork 系列（Liu et al., 2024a）、Llama-3.1-Nemotron-70B-Reward（Wang et al., 2024c）、Llama-3-OffsetBias-RM-8B（Park et al., 2024）、RM-Mistral-7B（Xiong et al., 2024）、URM 系列（Lou et al., 2024）、ArmoRM-Llama3-8B-v0.1（Wang et al., 2024a）、GRM 系列（Yang et al., 2024b）、QRM 系列（Dorka, 2024）、FsfairX-LLaMA3-RM-v0.1（Dong et al., 2023）、RM-Gemma-2/7B（Dong et al., 2023）、InternLM 系列（Cai et al., 2024）、BTRM-Qwen2-7b-0613。所评测的作为 RM 的生成式模型包括：Skywork-Critic 系列（Liu et al., 2024a）、CompassJudger 系列（Cao et al., 2024）、Qwen2.5 系列（Team, 2024）、Llama3.1 系列（Grattafiori et al., 2024）、Llama-3-OffsetBias-8B（Park et al., 2024）。对于 GPT-4、GPT-3.5-turbo 与 Doubao-pro 等商业模型，我们使用其官方 API 进行评测。表 3 报告了不同数据集的表现。所评测的数据集包括：HH-RLHF-cn、Huozi（Huozi-Team, 2024）、Kyara（Yang, 2024）、Zhihu、ChatbotArena（Zheng et al., 2023）、HH-RLHF（Ganguli et al., 2022）、MathPreference、Nectar（Zhu et al., 2023）、PKU-SafeRLHF（Ji et al., 2024）、Skywork（Liu et al., 2024a）、MathStackExchange（Lambert et al., 2023）、UltraFeedback（Cui et al., 2023）、HelpSteer2（Wang et al., 2024d）。

**表 8**：判别式与生成式 RM 在 CheemsBench 上的表现。Overall 指标是 Open Prompt 与 Human Instruction 子集上准确率（Acc.）与完全匹配率（Exact.）的平均值。

| 模型名称 | RewardBench | Open Prompt 准确率 | Open Prompt 完全匹配率 | Human Instruction 准确率 | Human Instruction 完全匹配率 | Overall |
|---|---|---|---|---|---|---|
| **开源奖励模型** | | | | | | |
| Skywork-Reward-Gemma-2-27B | 0.938 | 0.754 | 0.329 | 0.748 | 0.311 | 0.535 |
| Skywork-Reward-Gemma-2-27B-v0.2 | 0.943 | 0.751 | 0.321 | 0.735 | 0.294 | 0.525 |
| Llama-3.1-Nemotron-70B-Reward-HF | 0.941 | 0.750 | 0.317 | 0.722 | 0.271 | 0.515 |
| Llama-3-OffsetBias-RM-8B | 0.894 | 0.734 | 0.310 | 0.689 | 0.239 | 0.493 |
| RM-Mistral-7B | 0.804 | 0.721 | 0.285 | 0.700 | 0.259 | 0.491 |
| URM-LLaMa-3-8B | 0.899 | 0.727 | 0.310 | 0.688 | 0.230 | 0.489 |
| ArmoRM-Llama3-8B-v0.1 | 0.904 | 0.715 | 0.308 | 0.677 | 0.246 | 0.487 |
| Skywork-Reward-Llama-3.1-8B-v0.2 | 0.931 | 0.721 | 0.283 | 0.701 | 0.237 | 0.486 |
| URM-LLaMa-3.1-8B | 0.929 | 0.722 | 0.292 | 0.696 | 0.230 | 0.485 |
| GRM-Llama3-8B-rewardmodel-ft | 0.915 | 0.728 | 0.281 | 0.688 | 0.229 | 0.482 |
| QRM-Llama3.1-8B | 0.931 | 0.722 | 0.275 | 0.690 | 0.233 | 0.480 |
| Skywork-Reward-Llama-3.1-8B | 0.931 | 0.721 | 0.273 | 0.667 | 0.224 | 0.479 |
| FsfairX-LLaMA3-RM-v0.1 | 0.844 | 0.710 | 0.286 | 0.667 | 0.224 | 0.472 |
| RM-Gemma-7B | 0.695 | 0.700 | 0.273 | 0.678 | 0.235 | 0.471 |
| internlm2-20b-reward | 0.902 | 0.714 | 0.260 | 0.652 | 0.200 | 0.457 |
| internlm2-7b-reward | 0.876 | 0.712 | 0.262 | 0.644 | 0.187 | 0.451 |
| BTRM-Qwen2-7b-0613 | 0.832 | 0.708 | 0.259 | 0.647 | 0.186 | 0.450 |
| RM-Gemma-2B | 0.654 | 0.662 | 0.222 | 0.633 | 0.205 | 0.431 |
| internlm2-1-8b-reward | 0.822 | 0.642 | 0.182 | 0.619 | 0.163 | 0.402 |
| GRM-llama3-8B-distill | 0.862 | 0.531 | 0.123 | 0.548 | 0.127 | 0.332 |
| GRM-Gemma-2B-rewardmodel-ft | 0.845 | 0.509 | 0.111 | 0.470 | 0.106 | 0.299 |
| Gemma-2B-rewardmodel-ft | 0.805 | 0.494 | 0.106 | 0.473 | 0.111 | 0.296 |
| GRM-gemma2-2B-rewardmodel-ft | 0.884 | 0.471 | 0.093 | 0.480 | 0.110 | 0.288 |
| **作为奖励模型的生成式模型** | | | | | | |
| Skywork-Critic-Llama-3.1-70B | 0.933 | 0.755 | 0.320 | 0.731 | 0.258 | 0.516 |
| CompassJudger-1-14B-Instruct | 0.841 | 0.745 | 0.327 | 0.692 | 0.239 | 0.501 |
| CompassJudger-1-32B-Instruct | 0.852 | 0.742 | 0.322 | 0.685 | 0.231 | 0.495 |
| Qwen2.5-72B-Instruct | - | 0.734 | 0.306 | 0.678 | 0.229 | 0.487 |
| Skywork-Critic-Llama-3.1-8B | 0.890 | 0.726 | 0.288 | 0.696 | 0.229 | 0.485 |
| GPT-4o | 0.846 | 0.727 | 0.300 | 0.667 | 0.203 | 0.457 |
| Doubao-pro-128k | - | 0.720 | 0.280 | 0.662 | 0.164 | 0.456 |
| Qwen2.5-7B-Instruct | - | 0.713 | 0.262 | 0.637 | 0.163 | 0.444 |
| Llama-3-OffsetBias-8B | 0.840 | 0.690 | 0.243 | 0.658 | 0.180 | 0.443 |
| Llama-3.1-70B-Instruct | 0.840 | 0.685 | 0.244 | 0.610 | 0.153 | 0.423 |
| CompassJudger-1-1.5B-Instruct | 0.734 | 0.660 | 0.210 | 0.594 | 0.132 | 0.399 |
| Llama-3.1-8B-Instruct | 0.657 | 0.630 | 0.158 | 0.583 | 0.116 | 0.372 |
| GPT3.5-turbo | 0.653 | 0.616 | 0.143 | 0.572 | 0.113 | 0.361 |

## 附录 F 超参数设置（Hyperparameter Settings）

我们在表 9 中给出实验所用的关键超参数。除在 CheemsPreference 的 Human 子集上训练 RM 时使用 2 个 epoch（因其结果最佳）外，所有实验均保持一致设置。我们报告的是单次运行的实验结果。

**表 9**：超参数设置。

| 超参数 | 取值 |
|---|---|
| 最大序列长度（Max Sequence Length） | 2048 |
| 正则化系数（Regularization Coefficient） | 0.1 |
| 梯度累积步数（Gradient Accumulation Steps） | 4 |
| 微批次大小（Micro Batch Size） | 2 |
| 全局批次大小（Global Batch Size） | 256 |
| 训练轮数（Epochs） | 2 |
| 预热比例（Warmup Ratio） | 0.1 |
| 学习率调度器（Learning Rate Scheduler） | Cosine |
| 学习率（Learning Rate） | 5e-6 |

## 附录 G AI 助手的使用（Use of AI Assistants）

我们使用 AI 辅助进行语法检查、语句润色与编程。
