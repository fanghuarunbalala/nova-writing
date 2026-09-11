# StoryAlign：面向故事生成的奖励模型评估与训练

> - **中文译名**：StoryAlign：面向故事生成的奖励模型评估与训练
> - **英文原题**：STORYALIGN: EVALUATING AND TRAINING REWARD MODELS FOR STORY GENERATION
> - **作者**：Haotian Xia, Hao Peng, Yunjia Qi, Xiaozhi Wang, Bin Xu, Lei Hou, Juanzi Li（清华大学计算机科学与技术系）
> - **发表信息**：ICLR 2026 会议论文（Published as a conference paper at ICLR 2026）；arXiv:2605.04831v1 [cs.CL]，2026 年 5 月 6 日
> - **arXiv 链接**：https://arxiv.org/abs/2605.04831
> - 本文件为 AI 辅助全文翻译，术语以首次出现时"中文（English）"标注。源文本由 pdftotext 提取，存在断行、符号缺失等噪声，已按上下文修复；存疑之处以「？」标注。

> 作者注（原文脚注）：同等贡献；通讯作者。

## 摘要

故事生成旨在自动产出连贯、有结构且引人入胜的叙事。尽管大语言模型（large language models, LLM）已显著推动了文本生成的发展，但 LLM 生成的故事在复杂叙事结构与人类对齐的偏好方面，仍与人类撰写的作品存在差距。一个关键原因在于缺乏对人类故事偏好的有效建模——这类偏好本质上高度主观且尚未被充分研究。在本工作中，我们系统地评估了对人类故事偏好的建模情况，并提出 STORYRMB，这是首个用于评估奖励模型（reward model）在故事偏好上表现的基准（benchmark）。STORYRMB 包含 1,133 条高质量、经人工核验的实例，每条实例由一个提示（prompt）、一个优选（chosen）故事和三个被拒（rejected）故事组成。我们发现，现有奖励模型难以可靠地选出符合人类偏好的故事，表现最好的模型准确率也仅为 66.3%。为弥补这一不足，我们跨多个领域构建了约 100,000 对高质量的故事偏好对（preference pairs），并在此基础上训练出面向故事偏好的先进奖励模型 STORYREWARD。STORYREWARD 在 STORYRMB 上取得了最先进（state-of-the-art, SoTA）的性能，超越了规模大得多的模型。我们还将 STORYREWARD 用于下游测试时扩展（test-time scaling）应用中的 best-of-n（BoN）故事选择，发现它总体上能选出与人类偏好更契合的故事。我们将发布数据集、模型与代码，以便于后续研究。相关代码与数据可于 https://github.com/THU-KEG/StoryAlign 获取。

## 1 引言

故事生成任务旨在从给定前提（premise）出发，自动生成连贯、有结构且引人入胜的叙事（Wang et al., 2023）。随着大语言模型（LLM）的兴起及其强大的文本生成能力，许多研究利用 LLM 并设计工作流来生成流畅的故事（Alhussain & Azmi, 2021; Wang et al., 2024b; Lee et al., 2025; Xia et al., 2025; Huot et al., 2025）。然而，LLM 生成的故事常被认为缺乏复杂的叙事结构与创造性（Chakrabarty et al., 2024; Tian et al., 2024; Wang & Kreminski, 2025）。例如，Chakrabarty et al. (2024) 报告称，与专业作者撰写的故事相比，LLM 生成的故事通过专家评估的概率要低三到十倍。这一差距表明，尽管已取得显著进展，LLM 生成的叙事距离人类水准与人类偏好仍然很远。其主要原因在于，当前 LLM 在训练过程中缺乏对人类故事偏好的有效建模。LLM 通常依赖基于人类反馈的强化学习（reinforcement learning from human feedback, RLHF；Ouyang et al., 2022），该方法首先训练一个奖励模型（reward model, RM）以捕捉人类偏好，然后基于这些奖励来优化 LLM。然而，现有奖励模型主要面向通用领域（Zhong et al., 2025），可能忽视故事特有的偏好；同时它们还存在各种偏差，例如冗长偏差（verbosity bias）（Saito et al.; Peng et al., 2025），即偏好更长而非更高质量的回答。因此，以这类奖励信号训练的模型可能天然难以生成符合人类偏好的故事。此外，建模故事偏好本身极具挑战性，因为它具有主观性，并横跨创造性、相关性等多个维度。因此，对 LLM 生成故事的自动化评估至今仍是一个开放问题（Yang & Jin, 2024）。有鉴于此，有效地评估并改进奖励模型的故事偏好建模十分必要。

为弥补这一差距，我们系统地评估了人类故事偏好的建模，并开发了一个面向故事生成的先进奖励模型。具体而言，我们提出 STORYRMB，这是首个评估故事偏好奖励模型的基准。受先前工作（Yang & Jin, 2024）启发，我们为 STORYRMB 定义了 5 项评估标准，包括一致性（coherence）、创造性（creativity）、人物塑造（characterization）、流畅性（fluency）与相关性（relevance）。STORYRMB 的构建包含两个部分：(1) 候选故事生成，即从 4 个先进 LLM（包括 Gemini 2.5 Pro（Comanici, 2025）、Grok 3（xAI, 2025）、GPT-4o（OpenAI, 2024）、Qwen-Long（Wan et al., 2025a））收集同一前提下的多样故事；为确保覆盖真实场景，我们还为约 250 个前提加入了人类撰写的故事作为候选。(2) 偏好判定，我们设计了两阶段的半自动化标注流程：先由四个先进 LLM——包括 GLM-4.5（Team et al., 2025）、Qwen2.5-Max（Yang et al., 2025）、Claude-3.5-Sonnet（Claude, 2024）与 DeepSeek-R1（DeepSeek-AI et al., 2025）——通过多数投票（majority voting）选出优选故事，随后进行人工核验（human verification）；对于分歧严重的情形，则直接由人类进行偏好标注。最终，STORYRMB 共包含 1,133 条高质量、经人工核验的实例，每条实例含一个前提、一个优选故事与三个被拒故事。我们随后在 STORYRMB 上评估了若干先进的奖励模型，发现现有奖励模型难以可靠地选出符合人类偏好的故事，最高准确率仅为 66.3%。我们还发现，现有奖励模型往往偏爱 LLM 生成的故事而非人类撰写的故事，这使得它们难以引导模型迈向人类水准的故事生成（Tian et al., 2024）。

因此，我们提出 STORYREWARD——一个在大规模、高质量故事偏好对数据集上训练的先进故事偏好奖励模型。为确保覆盖真实世界并准确捕捉人类偏好，我们收集了大量人类撰写的故事及相应的人类偏好信号。具体而言，我们从中文与英文网络文学平台收集故事及其元数据（如类别、点赞数等），并用三种方法构建偏好对：(1) 前提反向生成（premise back-generation）。我们从同一类别中随机采样带点赞信息的故事对，并用 LLM 反向翻译出对应的前提（Qi et al., 2024）。点赞更多的故事记为优选，另一篇记为被拒，由此得到约 6,000 对偏好对。(2) 提示引导重写（prompt-guided rewriting）。我们随机选择一个前提及其对应的人类撰写故事作为优选，再让 LLM 重写该故事作为被拒。我们通过提示约束重写的修改范围（例如仅修改结尾或标题），以避免优选与被拒之间出现平凡差异。该方法假设人类撰写的故事总体上更受偏好，我们也在 20 个样本上验证了这一点。由此得到约 30,000 对偏好对。(3) 人类引导续写（human-guided continuation）。我们采样人类撰写的故事，以其前半部分作为续写的前提。我们用原始的人类续写来引导 LLM 的输出，将其视为优选，而 LLM 直接从该前提出发生成的续写则视为被拒。由于人类续写的质量显著高于 LLM 的续写，我们没有直接把人类续写当作优选，以避免平凡差异。由此得到约 10,000 对偏好对。此外，我们还采用了一种广泛使用的偏好对构建方法（Cui et al., 2024）：为给定前提采样两个故事，并用 LLM 选出最佳者作为优选。最终，我们共获得 100,000 对高质量偏好对，涵盖多样的真实人类偏好，并用于训练 STORYREWARD。STORYREWARD 在 STORYRMB 上取得了最先进的性能，甚至超过了规模大得多的模型。我们进一步将 STORYREWARD 应用于测试时扩展，开展由奖励模型挑选更优故事的 Best-of-N（BoN）实验。实验结果表明，STORYREWARD 选出的故事显著优于其他奖励模型选出的故事，进一步验证了其在真实应用中的有效性。总而言之，我们的贡献主要有三方面：(1) 我们提出 STORYRMB，这是首个评估奖励模型建模故事偏好能力的基准；大量实验表明，现有奖励模型难以捕捉人类故事偏好。(2) 我们提出一种自动化的故事偏好对收集方法，并构建了覆盖多样真实人类偏好的大规模、高质量训练数据集。(3) 我们提出 STORYREWARD，一个面向故事偏好的先进奖励模型，在 STORYRMB 上取得 SoTA 性能；我们进一步验证了其在真实应用中的有效性。

## 2 STORYRMB：一个面向故事偏好的基准

如图 1 所示，本节介绍构建 STORYRMB 的方法，包括候选故事生成（§2.1）与两阶段偏好判定流程（§2.2）。

**图 1（原文图像见 PDF）** 基准构建框架总览。该流程包括：(1) 收集由 LLM 与人类生成的候选故事；(2) 为故事打分并按各维度划分。这两个阶段得到一个用于评估故事奖励模型的多样数据集。

### 2.1 候选故事构建

**提示收集** 为生成多样且高质量的故事，我们首先受 Ma et al. (2024) 模块化合成方法的启发，设计了一个多阶段的前提¹构建框架。我们的方法首先建立一套取材于文学与电影的主题框架，涵盖存在主义、伦理困境等类别；随后以"冲突或反转"结构（Fan et al., 2019; Barber & Kudenko, 2008）撰写信息密集的种子前提；再为种子补充人物与场景设定，通过基于 LLM 的改写实现风格多样化，并经人工过滤以保证逻辑与文化上的合理性。该流程产出 624 个高质量前提。更多细节见附录 A。除 LLM 生成的前提外，我们还加入了带人类撰写故事的前提以增强多样性：从 WritingPrompts 数据集（Fan et al., 2018）中随机采样并筛选出 600 个高质量前提，每个前提都配有一篇由人类作者撰写的故事。

> ¹ 前提（premise）即故事提示词（story prompt），是故事生成文献中广泛使用的术语。

**候选生成** 构建前提池后，我们使用多个 LLM 将每个前提扩展为 4 个候选故事。为确保多样性，我们选择了四个代表性模型：GPT-4o（OpenAI, 2024）、Gemini 2.5 Pro（Comanici, 2025）、Grok 4（xAI, 2025）与 Qwen-Long（Wan et al., 2025a）。每个前提在统一的提示模板下提供给全部四个模型，从而为每个前提得到四篇候选故事。这些故事覆盖广泛的主题、语言与叙事风格，为后续偏好标注奠定了坚实基础。构建细节见附录 B。

### 2.2 偏好判定

收集到每个前提的四篇候选故事后，我们按质量对其排序，即进行偏好标注。我们首先使用若干 LLM 对每篇 LLM 生成的故事打分，并据此对候选排序；随后采用人工核验。为进一步识别哪些偏好维度最为关键（例如，故事 A 之所以比故事 B 更受偏好，是否因其一致性更佳），我们进行维度归类。

**偏好排序** 我们采用 LLM 对每篇 LLM 生成的故事打分，并据此对候选排序，然后对偏好排序进行人工核验。遵循先前工作（Yang & Jin, 2024），我们定义五个评分维度：创造性、一致性、流畅性、人物塑造与相关性。我们采用四个 LLM——GLM-4.5（Team et al., 2025）、Qwen2.5-Max（Yang et al., 2025）、Claude-3.5（Claude, 2024）与 DeepSeek-R1（DeepSeek-AI et al., 2025）——为每个维度及总体各打一个分数。基于总体分数，每个 LLM 会针对每个前提给出候选故事的排序。随后我们计算四个 LLM 排序之间的一致性。具体而言，给定 $m$ 篇候选故事 $\{c_1, c_2, \ldots, c_m\}$ 与 $n$ 个 LLM 给出的排序，我们使用 Kendall's Tau 相关系数（Kendall, 1938）度量排序间的相似度。对任意两个模型 A 与 B，其排序结果分别记为 $\mathcal{A}$ 与 $\mathcal{B}$，Kendall's Tau 定义为：

$$\tau(\mathcal{A}, \mathcal{B}) = \frac{N_c - N_d}{\binom{m}{2}}, \qquad \tau \in [-1, 1] \qquad (1)$$

其中 $N_c$ 表示一致对（concordant pairs）的数目，$N_d$ 表示不一致对（discordant pairs）的数目，$\binom{m}{2}$ 为可能的故事对总数。为评估 $n$ 个 LLM 之间的总体一致性，我们对每一对模型计算 Kendall's Tau 并取平均：

$$\tau_{\mathrm{avg}} = \frac{2}{n(n-1)} \sum_{i<j} \tau(i, j) \qquad (2)$$

若 $\tau_{\mathrm{avg}} < 0.6$，我们认为存在严重分歧，需人类标注者进行偏好排序标注；否则采用多数投票得到最终排序，再由人工核验。更多标注细节见附录 C。

**维度归类** 经过上述步骤，我们已得到基于总体分数的偏好排序。由于评估涉及五个维度，我们进一步进行维度归类（dimensional categorization），以识别哪些偏好维度最具决定性。例如，故事 A 之所以比故事 B 更受偏好，是否由于其一致性更佳。遵循先前工作（Yang & Jin, 2024）的方法，我们设计了一个四阶段方法，通过判定哪个维度最能区分优选故事与被拒候选，对每个提示进行归类。完整流程见附录 F。最终数据集包含 1,133 条偏好实例。按主要区分维度，数据集被划分为五组：创造性（292）、一致性（265）、流畅性（225）、人物塑造（215）与相关性（136）。该方法流程如下：

**阶段 1：平均差距分析。** 对每个维度 $d \in \{1, 2, \ldots, 5\}$，我们计算平均差距：

$$\mathrm{mean\_gap}_d = \mathrm{score}_{\mathrm{chosen},d} - \frac{1}{|R|} \sum_{r \in R} \mathrm{score}_{r,d} \qquad (3)$$

其中 $R$ 表示被拒故事的集合。若某一维度的平均差距显著大于其他维度（超过预设的平局容差 $\varepsilon = 0.5$「？」），我们就将该提示组归入该维度。

**阶段 2：对次优者的领先幅度。** 当多个维度展现出接近的平均差距时，我们考察竞争性领先幅度：

$$\mathrm{margin}_d = \mathrm{score}_{\mathrm{chosen},d} - \max_{r \in R} \mathrm{score}_{r,d} \qquad (4)$$

这可以识别出优选故事与最佳被拒替代之间差距最清晰的维度。我们选择领先幅度最大的维度。

**阶段 3：被拒分数方差。** 若领先幅度仍持平，我们考虑被拒分数的方差：

$$\mathrm{variance}_d = \mathrm{Var}(\{\mathrm{score}_{r,d} : r \in R\}) \qquad (5)$$

我们选择方差最小的维度，表明被拒故事在该维度上一致地表现不佳。

**阶段 4：序数兜底。** 若所有阶段后仍存在平局，我们采用确定性的序数排序（$d_1 \succeq d_2 \succeq \ldots \succeq d_5$「？」）以保证类别归属的唯一性。

## 3 STORYREWARD：一个面向故事偏好的奖励模型

本节介绍 STORYREWARD 的研发，包括大规模高质量故事偏好对的构建（§3.1）与 STORYREWARD 的训练（§3.2）。

### 3.1 收集偏好对

为确保所收集偏好对的真实世界覆盖并降低人工标注成本，我们设计了一个自动化数据收集框架，用于收集人类撰写的故事与多种人类偏好。具体而言，我们首先从流行的中文（豆瓣²）与英文（WritingPrompts³）网络文学平台爬取大量人类撰写的故事，以及类别、点赞数等关联元数据。随后我们设计了三种自动收集偏好对的方法。

> ² https://www.douban.com
> ³ https://huggingface.co/datasets/euclaise/writingprompts

**前提反向生成** 我们从豆瓣网站收集了大量故事。为收集成对数据，我们首先基于相似度对故事聚类：同一簇内的故事要么共享平台定义的类型标签，要么来自同一作者的专栏。这样的簇通常在主题、文风与题材上具有相似性。在每个簇内，我们采样两篇不同的故事构成故事对，并将其输入 GPT-4o（OpenAI, 2024），由其基于两篇故事的共性生成一个前提。偏好判定则利用用户互动统计：具体而言，读者数更高的故事被视为"优选"。为确保可靠性，我们过滤掉互动量极低的故事对，最终得到约 6,000 对完全源自真实人类撰写故事的偏好对。更多细节见附录 E.2。

**提示引导重写** 我们选择一篇人类撰写的故事及其对应前提作为"优选"样本，然后通过提示 LLM 重写原故事来生成"被拒"样本。关键在于，这一重写过程并非任意进行：我们采用一组精心设计的提示模板，系统地控制修改内容并指向叙事质量的特定方面。这些提示会约束 LLM 的改动，例如通过指示其仅改动故事结尾来破坏情节一致性。更多细节见附录 E.3。这种受约束的方式避免了优选与被拒故事之间的平凡差异，而是生成仍可读但在文风、语调或逻辑上被刻意注入缺陷的被拒样本。该方法基于"人类撰写的故事总体质量更高"这一假设，我们也在 20 个样本上验证了该假设。

**人类引导续写** 在初步实验中，我们观察到，在奖励模型训练中直接将人类撰写故事与 LLM 生成故事相对比，往往导致快速收敛与欠佳的性能。这主要源于人类撰写故事与 LLM 生成故事之间显著的质量差距与表层差异。为缓解该问题，我们向两个 LLM 提供相同的前提与提示，但只有一个 LLM 可以访问故事的真实人类续写。在两种设定下生成故事后，我们基于如下假设构建偏好对：受人类作者续写引导的模型更可能产出更优的叙事。为验证该假设，我们随机抽取 20 对偏好对，确认受人类续写引导的模型表现更好。更多生成细节与提示见附录 E.4。

除从人类撰写故事构建故事偏好对外，我们还采用了一种广泛使用的方法（Cui et al., 2024）：由 LLM 为同一前提生成两个故事，再由另一个 LLM 自动将一篇标注为优选、另一篇标注为被拒。更多生成设定与提示见附录 E.1。最终，我们共获得约 100,000 对高质量偏好对，覆盖多样的真实人类偏好，可直接用于奖励模型训练。

### 3.2 训练 STORYREWARD

我们使用 Llama-3.1-8B-Instruct 与 Qwen3-8B 作为训练的基座模型。我们将所收集偏好对中每条实例的前提作为输入、故事作为偏好对，训练 STORYREWARD-LLAMA 与 STORYREWARD-QWEN。我们将 batch size 设为 1，STORYREWARD-LLAMA 的学习率为 $9 \times 10^{-6}$、STORYREWARD-QWEN 为 $2 \times 10^{-5}$，训练 1 个 epoch。

## 4 实验

### 4.1 主实验

**实验设定** 形式化地，给定四篇候选故事 $\{s_1, s_2, s_3, s_4\}$，奖励模型为每个候选打分 $f(s_i)$。若 $\arg\max_i f(s_i) = s$（其中 $s$ 表示被预测的优选故事），则视为预测正确。我们以正确预测的比例作为主要评估指标。我们将基线分为两大类。(1) 奖励模型，即显式为奖励建模而训练的模型，通常形式化为回归模型——为每个回答打分并选择分数最高者。该类中我们纳入若干先进且有代表性的模型，如 InternLM2-Reward（Cai et al., 2024）、Skywork-Reward（Liu et al., 2024）、ArmoRM（Wang et al., 2024a）、QRM（Dorka, 2024）、GRM（Yang et al., 2024）与 WQRM（Chakrabarty et al., 2025）。(2) 基于 LLM 的生成式奖励模型，即利用大语言模型直接为回答打分或进行两两比较以选出受偏好的回答（Lambert et al., 2024）。该组中我们评估若干专有系统，包括 GPT-4o（OpenAI, 2024）、Gemini-2.5 Pro（Comanici, 2025）、Grok（xAI, 2025），以及我们的基座模型 Llama-3.1-8B Instruct（Meta, 2024b）与 Qwen3-8B（Yang et al., 2025）。

**实验结果** 全部实验结果见表 1。我们得到以下观察：(1) 现有奖励模型与 LLM-as-judge（LLM 作为评判器）表现不佳。最好的模型 GPT-4o 也仅取得 66.3% 的准确率，远不足以用于下游应用。这表明当前奖励模型忽视了故事偏好的建模，也进一步说明故事偏好的复杂性——它需要专门的数据与建模，而非依赖通用领域偏好的泛化。(2) 总体而言，奖励模型在流畅性维度上表现更好，倾向于偏爱更流畅的故事。这很直观，因为奖励模型与 LLM-as-judge 天然对表层流畅性敏感（Tian et al., 2024）。相比之下，在需要更深叙事理解的复杂维度（如创造性与人物塑造）上，分数普遍更低。这凸显了现有奖励模型无法捕捉故事特有的偏好，也说明了专门面向故事的奖励模型的必要性。(3) 我们训练的模型（STORYREWARD-QWEN 与 STORYREWARD-LLAMA）在 STORYRMB 上取得最佳结果，显著超越基座模型（Llama3.1 与 Qwen3），尤其在创造性与人物塑造等故事特有指标上。这证明了我们训练数据的有效性。由于我们的数据构建方法可扩展，我们也鼓励社区收集更多高质量语料，以开发更先进的奖励模型。

**表 1：被考察模型与 STORYREWARD 在 STORYRMB 上的准确率（%）。Average（平均）表示五个维度得分的平均值。加粗：最佳结果；下划线：次佳结果。**

| 模型 | 一致性 | 创造性 | 人物塑造 | 流畅性 | 相关性 | 平均 |
|---|---|---|---|---|---|---|
| InternLM2-20B-Reward | 17.0 | 25.1 | 21.9 | 17.3 | 41.2 | 21.3 |
| InternLM2-7B-Reward | 18.5 | 18.9 | 18.1 | 15.6 | 25.0 | 18.7 |
| Skywork-Reward-Gemma-2-27B-v0.2 | 36.6 | 29.8 | 22.8 | 40.0 | 34.6 | 32.7 |
| Skywork-Reward-Llama-3.1-8B-v0.2 | 29.4 | 32.3 | 26.5 | 36.0 | 30.9 | 31.0 |
| QRM-Llama3.1-8B-v2 | 15.1 | 17.9 | 9.3 | 13.3 | 19.9 | 14.9 |
| ArmoRM-Llama3-8B-v0.1 | 52.4 | 48.8 | 44.2 | 56.4 | 43.4 | 49.7 |
| GRM-Llama3.1-8B-rewardmodel-ft | 35.1 | 28.1 | 23.7 | 35.1 | 35.3 | 31.1 |
| WQRM | 16.6 | 27.1 | 24.2 | 31.1 | 19.9 | 24.0 |
| Llama3.1-8B-Instruct | 22.3 | 30.5 | 25.1 | 16.9 | 24.9 | 24.3 |
| Qwen3-8B | 55.8 | 53.1 | 47.0 | 60.4 | 48.5 | 53.5 |
| GPT-4o | 63.4 | <u>63.7</u> | <u>66.0</u> | <u>73.3</u> | 67.6 | <u>66.3</u> |
| Gemini-2.5-Pro | 57.7 | 51.7 | 57.2 | 64.4 | 52.2 | 56.8 |
| Grok-3 | 62.6 | 57.5 | 62.8 | 69.8 | 60.3 | 62.4 |
| STORYREWARD-LLAMA | <u>64.5</u> | 60.8 | 62.3 | 53.8 | <u>67.7</u> | 61.4 |
| STORYREWARD-QWEN | **77.5** | **78.8** | **71.6** | **74.2** | **69.1** | **75.0** |

### 4.2 偏好分析：人类故事 vs. LLM 故事

先前研究表明，LLM 生成的故事与人类撰写的差异很大（Tian et al., 2024），远未达到人类水准。我们认为一个关键原因是：现有奖励模型往往偏爱 LLM 生成的故事。为探究这一点，我们分析了当前的奖励模型。如 §2 所述，STORYRMB 包含两个子集：LLM–LLM 对（优选与被拒故事均由 LLM 生成）与 Human–LLM 对（优选故事由人类撰写、被拒故事由 LLM 生成）。我们在这两个子集上评估奖励模型，结果见图 2。我们发现，现有模型在 Human–LLM 对上的表现明显更差，表明它们倾向于偏好 LLM 生成的故事。一个可能的原因是 LLM 偏爱 LLM 生成的内容（Liu et al., 2023）。因此，这类奖励模型往往无法引导模型生成类人的故事。相比之下，STORYREWARD 在 Human–LLM 对上表现更好，显示出与人类偏好更强的对齐。这一优势源于我们对人类撰写偏好对的有效收集。因此，我们呼吁社区在训练与偏好建模中利用更多人类撰写的数据，向真正人类水准的故事生成迈进。

**图 2（原文图像见 PDF）** 在 LLM–LLM 对与 Human–LLM 对上的准确率（%）。LLM–LLM 表示所有故事均由 LLM 生成；Human–LLM 表示优选故事为人类撰写、被拒故事为 LLM 生成。

## 5 基于 Best-of-N 采样的测试时扩展

奖励模型的一个重要应用是测试时扩展：让模型生成多个回答，并用奖励模型选出最佳者，即 Best-of-N（BoN）采样（Brown et al., 2024; Peng et al., 2025）。本节将奖励模型应用于测试时扩展场景，以评估 STORYREWARD 的有效性。具体而言，我们使用常用的故事前提数据集——MoPS 数据集（Ma et al., 2024），其中包含约 100 个前提。对每个前提，我们用 Llama-3.1-70B-Instruct（Meta, 2024a）以采样温度 1 生成 16 篇故事。人类标注者随后按偏好对这 16 篇故事排序：两名标注者独立排序，不一致之处由另一名资深标注者裁定。然后我们采用不同的奖励模型从 16 篇故事中选出最佳者。我们进行头对头（head-to-head）评估：在人类偏好排序中位次更高的故事即为获胜故事。

头对头结果见图 3。我们观察到，STORYREWARD 显著优于其他奖励模型，其选出较差故事的情形不足 30%。这表明我们的模型在测试时扩展中更能识别更好的故事。值得注意的是，我们的模型仅为 8B 规模，部署与推理成本低廉，凸显了其在真实测试时扩展中的实用性。我们也鼓励社区将我们的奖励模型用于更细粒度的搜索，例如蒙特卡洛树搜索（Monte Carlo Tree Search, MCTS）（Xie et al., 2024），使模型能够选出更好的故事。

**图 3（原文图像见 PDF）** 在 MoPS 测试集上 BoN 的头对头比较结果。STORYREWARD-QWEN 与 STORYREWARD-LLAMA 均展现出压倒性的胜率。"Tie"（平局）表示两个模型选择了同一故事。

## 6 相关工作

### 6.1 故事生成

在 LLM 的推动下，故事生成已取得显著进展，促使越来越多研究致力于提升叙事质量。Huot et al. (2025) 提出 Agents' Room，一个受叙事理论启发的生成框架，将叙事写作分解为由专门化智能体完成的子任务。Wang et al. (2024b) 提出具有记忆增强的动态分层大纲长篇故事生成方法 DOME（Dynamic Hierarchical Outlining with Memory-Enhancement），以生成内容与情节连贯的长篇故事。Wang & Kreminski (2024) 提出使用更高层、更抽象的高层故事结构符号规范，并通过答案集编程（answer set programming）实现，以引导并多样化基于 LLM 的故事生成。Lee et al. (2025) 提出 WritingPath，一个使用显式大纲引导 LLM 生成目标明确、高质量文本的框架，其灵感来自结构化的写作规划与推理路径，强调在整个写作过程中反映用户意图。Wan et al. (2025b) 提出 CogWriter，将 LLM 受约束的长篇文本生成转化为系统化的认知写作范式；CogWriter 由执行分层规划以分解任务的规划智能体（Planning Agent）与并行执行这些计划的多个生成智能体（Generation Agent）组成。然而，也有研究认为 LLM 生成的故事仍远低于人类水准（Chakrabarty et al., 2024; Tian et al., 2024; Wang & Kreminski, 2025），我们将其部分归因于训练期间缺乏有效奖励模型的引导。

### 6.2 故事生成中的奖励建模

LLM 在数学、编程等具有客观可验证解的任务上已取得卓越突破。这些进展在很大程度上得益于可验证奖励的强化学习（Reinforcement Learning with Verifiable Rewards, RLVR），它利用由基于规则的验证器导出的参考信号提供二元反馈（对或错）。当任务存在明确的标准答案时，这一范式非常有效。相比之下，写作任务缺乏标准化答案且本质上主观，因而更具挑战性。LLM 生成的文本常常冗长，其质量难以验证。为应对该挑战，Jia et al. (2025) 提出了一种面向创意写作等不可验证任务的新训练范式：不依赖固定的人类撰写数据集，而是采用双智能体框架——写作智能体生成故事，审阅智能体提供详细且富有建设性的反馈。这种反馈充当丰富且可扩展的奖励信号，使模型无需大量人工监督即可迭代自我改进。尽管并非专门针对故事生成，该框架朝向构建能捕捉开放式创作任务细微差别的奖励模型迈出了重要一步。与之并行，Fein et al. (2025) 已成为创意写作偏好建模的首个标准化基准与配对数据集。通过整理从 Reddit 收集的数据，Fein et al. (2025) 提供了 43,827 对人类标注的偏好对，为训练与评估奖励模型奠定了基础。

## 7 结论

本文对面向故事生成的奖励模型进行了系统评估与训练。具体而言，我们提出 STORYRMB，这是首个评估故事偏好奖励模型的基准，并评估了若干代表性奖励模型与 LLM-as-judge。我们发现当前奖励模型难以很好地捕捉人类故事偏好，且往往偏爱 LLM 生成的故事而非人类撰写的故事。为弥补这一差距，我们提出 STORYREWARD——一个面向故事偏好的先进奖励模型，它在我们自动化流水线收集的大规模、高质量数据集上训练而成；该流水线汇聚人类撰写故事与真实人类偏好信号，并运用重写等技术实现多样覆盖。STORYREWARD 在 STORYRMB 上取得了最先进的性能。我们还将奖励模型用于测试时扩展应用（以之进行 BoN 搜索），发现 STORYREWARD 总体能选出更好的故事。我们建议研究社区开发更强的故事奖励模型，以实现真正人类水准的故事生成。

## 致谢

本工作受国家自然科学基金（No. 52539001）与北京市自然科学基金（L243006）资助，并得到网络学习智能技术与应用国家工程实验室的部分支持。

## 伦理考量

(1) 知识产权。在本研究中，我们使用了来自豆瓣网站与 WritingPrompts 的故事。对于前者，我们严格遵守其版权协议；后者是开源的，我们完全遵守了其许可条款。我们相信所有数据集均已妥善脱敏，不包含标注者或原作者的任何个人信息。我们还采用 GPT-4o 检查所有人类撰写的故事，以标记暴力或露骨内容等潜在敏感内容。实际上，我们没有发现任何被标记为敏感的故事。我们还随机抽取并检查了 10 篇人类撰写的故事，未发现敏感内容。对于本研究中考察的大语言模型（LLM），我们通过其付费 API 查询 LLM（如 GPT-4o、Gemini 2.5 Pro 等）。(2) 预期用途。本文研究奖励模型在故事生成情境下的表现，并提供了一个高质量基准与一个奖励模型。通过所呈现的深入分析，我们希望为学术界提供关于 LLM 与故事生成任务的有意义洞见。(3) 滥用风险。本文提出的奖励模型与基准旨在改进故事生成。任何人都不应使用我们的故事生成方法创作非法故事、传播非法内容或用于商业牟利。(4) AI 辅助。我们在论文中使用 LLM 生成数据，这一点已在第 2 节和第 3 节中说明。我们还使用 ChatGPT 润色了部分语句。(5) 标注者待遇在附录 C.2 中讨论。

## 参考文献（原文）

Arwa I Alhussain and Aqil M Azmi. Automatic story generation: A survey of approaches. ACM Computing Surveys (CSUR), 54(5):1-38, 2021.

Jinze Bai, Shuai Bai, Yunfei Chu, Zeyu Cui, Kai Dang, Xiaodong Deng, Yang Fan, Wenbin Ge, Yu Han, Fei Huang, Binyuan Hui, Luo Ji, Mei Li, Junyang Lin, Runji Lin, Dayiheng Liu, Gao Liu, Chengqiang Lu, Keming Lu, Jianxin Ma, Rui Men, Xingzhang Ren, Xuancheng Ren, Chuanqi Tan, Sinan Tan, Jianhong Tu, Peng Wang, Shijie Wang, Wei Wang, Shengguang Wu, Benfeng Xu, Jin Xu, An Yang, Hao Yang, Jian Yang, Shusheng Yang, Yang Yao, Bowen Yu, Hongyi Yuan, Zheng Yuan, Jianwei Zhang, Xingxuan Zhang, Yichang Zhang, Zhenru Zhang, Chang Zhou, Jingren Zhou, Xiaohuan Zhou, and Tianhang Zhu. Qwen technical report, 2023. URL https://arxiv.org/abs/2309.16609.

Heather Barber and Daniel Kudenko. Generation of dilemma-based narratives: Method and turing test evaluation. In Ulrike Spierling and Nicolas Szilas (eds.), Interactive Storytelling, pp. 214-217, Berlin, Heidelberg, 2008. Springer Berlin Heidelberg. ISBN 978-3-540-89454-4.

Bradley Brown, Jordan Juravsky, Ryan Ehrlich, Ronald Clark, Quoc V Le, Christopher Ré, and Azalia Mirhoseini. Large language monkeys: Scaling inference compute with repeated sampling. arXiv preprint arXiv:2407.21787, 2024.

Zheng Cai, Maosong Cao, Haojiong Chen, Kai Chen, Keyu Chen, Xin Chen, Xun Chen, Zehui Chen, Zhi Chen, Pei Chu, Xiaoyi Dong, Haodong Duan, Qi Fan, Zhaoye Fei, Yang Gao, Jiaye Ge, Chenya Gu, Yuzhe Gu, Tao Gui, Aijia Guo, Qipeng Guo, Conghui He, Yingfan Hu, Ting Huang, Tao Jiang, Penglong Jiao, Zhenjiang Jin, Zhikai Lei, Jiaxing Li, Jingwen Li, Linyang Li, Shuaibin Li, Wei Li, Yining Li, Hongwei Liu, Jiangning Liu, Jiawei Hong, Kaiwen Liu, Kuikun Liu, Xiaoran Liu, Chengqi Lv, Haijun Lv, Kai Lv, Li Ma, Runyuan Ma, Zerun Ma, Wenchang Ning, Linke Ouyang, Jiantao Qiu, Yuan Qu, Fukai Shang, Yunfan Shao, Demin Song, Zifan Song, Zhihao Sui, Peng Sun, Yu Sun, Huanze Tang, Bin Wang, Guoteng Wang, Jiaqi Wang, Jiayu Wang, Rui Wang, Yudong Wang, Ziyi Wang, Xingjian Wei, Qizhen Weng, Fan Wu, Yingtong Xiong, Chao Xu, Ruiliang Xu, Hang Yan, Yirong Yan, Xiaogui Yang, Haochen Ye, Huaiyuan Ying, Jia Yu, Jing Yu, Yuhang Zang, Chuyu Zhang, Li Zhang, Pan Zhang, Peng Zhang, Ruijie Zhang, Shuo Zhang, Songyang Zhang, Wenjian Zhang, Wenwei Zhang, Xingcheng Zhang, Xinyue Zhang, Hui Zhao, Qian Zhao, Xiaomeng Zhao, Fengzhe Zhou, Zaida Zhou, Jingming Zhuo, Yicheng Zou, Xipeng Qiu, Yu Qiao, and Dahua Lin. Internlm2 technical report, 2024. URL https://arxiv.org/abs/2403.17297.

Tuhin Chakrabarty, Philippe Laban, Divyansh Agarwal, Smaranda Muresan, and Chien-Sheng Wu. Art or artifice? large language models and the false promise of creativity, 2024. URL https://arxiv.org/abs/2309.14556.

Tuhin Chakrabarty, Philippe Laban, and Chien-Sheng Wu. Ai-slop to ai-polish? aligning language models through edit-based writing rewards and test-time computation. arXiv preprint arXiv:2504.07532, 2025.

Cyril Chhun, Fabian M Suchanek, and Chloé Clavel. Do language models enjoy their own stories? prompting large language models for automatic story evaluation. Transactions of the Association for Computational Linguistics, 12:1122-1142, 2024.

Kenneth W Church and William A Gale. Poisson mixtures. Natural Language Engineering, 1(2):163-190, 1995.

Claude. The claude 3 model family: Opus, sonnet, haiku, 2024. URL https://api. semanticscholar.org/CorpusID:268232499.

Gheorghe Comanici. Gemini 2.5: Pushing the frontier with advanced reasoning, multimodality, long context, and next generation agentic capabilities, 2025. URL https://arxiv.org/abs/2507.06261.

Ganqu Cui, Lifan Yuan, Ning Ding, Guanming Yao, Bingxiang He, Wei Zhu, Yuan Ni, Guotong Xie, Ruobing Xie, Yankai Lin, et al. Ultrafeedback: Boosting language models with scaled ai feedback. In Forty-first International Conference on Machine Learning, 2024.

DeepSeek-AI, Daya Guo, Dejian Yang, Haowei Zhang, Junxiao Song, Ruoyu Zhang, Runxin Xu, Qihao Zhu, Shirong Ma, Peiyi Wang, Xiao Bi, Xiaokang Zhang, Xingkai Yu, Yu Wu, Z. F. Wu, Zhibin Gou, Zhihong Shao, Zhuoshu Li, Ziyi Gao, Aixin Liu, Bing Xue, Bingxuan Wang, Bochao Wu, Bei Feng, Chengda Lu, Chenggang Zhao, Chengqi Deng, Chenyu Zhang, Chong Ruan, Damai Dai, Deli Chen, Dongjie Ji, Erhang Li, Fangyun Lin, Fucong Dai, Fuli Luo, Guangbo Hao, Guanting Chen, Guowei Li, H. Zhang, Han Bao, Hanwei Xu, Haocheng Wang, Honghui Ding, Huajian Xin, Huazuo Gao, Hui Qu, Hui Li, Jianzhong Guo, Jiashi Li, Jiawei Wang, Jingchang Chen, Jingyang Yuan, Junjie Qiu, Junlong Li, J. L. Cai, Jiaqi Ni, Jian Liang, Jin Chen, Kai Dong, Kai Hu, Kaige Gao, Kang Guan, Kexin Huang, Kuai Yu, Lean Wang, Lecong Zhang, Liang Zhao, Litong Wang, Liyue Zhang, Lei Xu, Leyi Xia, Mingchuan Zhang, Minghua Zhang, Minghui Tang, Meng Li, Miaojun Wang, Mingming Li, Ning Tian, Panpan Huang, Peng Zhang, Qiancheng Wang, Qinyu Chen, Qiushi Du, Ruiqi Ge, Ruisong Zhang, Ruizhe Pan, Runji Wang, R. J. Chen, R. L. Jin, Ruyi Chen, Shanghao Lu, Shangyan Zhou, Shanhuang Chen, Shengfeng Ye, Shiyu Wang, Shuiping Yu, Shunfeng Zhou, Shuting Pan, S. S. Li, Shuang Zhou, Shaoqing Wu, Shengfeng Ye, Tao Yun, Tian Pei, Tianyu Sun, T. Wang, Wangding Zeng, Wanjia Zhao, Wen Liu, Wenfeng Liang, Wenjun Gao, Wenqin Yu, Wentao Zhang, W. L. Xiao, Wei An, Xiaodong Liu, Xiaohan Wang, Xiaokang Chen, Xiaotao Nie, Xin Cheng, Xin Liu, Xin Xie, Xingchao Liu, Xinyu Yang, Xinyuan Li, Xuecheng Su, Xuheng Lin, X. Q. Li, Xiangyue Jin, Xiaojin Shen, Xiaosha Chen, Xiaowen Sun, Xiaoxiang Wang, Xinnan Song, Xinyi Zhou, Xianzu Wang, Xinxia Shan, Y. K. Li, Y. Q. Wang, Y. X. Wei, Yang Zhang, Yanhong Xu, Yao Li, Yao Zhao, Yaofeng Sun, Yaohui Wang, Yi Yu, Yichao Zhang, Yifan Shi, Yiliang Xiong, Ying He, Yishi Piao, Yisong Wang, Yixuan Tan, Yiyang Ma, Yiyuan Liu, Yongqiang Guo, Yuan Ou, Yuduan Wang, Yue Gong, Yuheng Zou, Yujia He, Yunfan Xiong, Yuxiang Luo, Yuxiang You, Yuxuan Liu, Yuyang Zhou, Y. X. Zhu, Yanhong Xu, Yanping Huang, Yaohui Li, Yi Zheng, Yuchen Zhu, Yunxian Ma, Ying Tang, Yukun Zha, Yuting Yan, Z. Z. Ren, Zehui Ren, Zhangli Sha, Zhe Fu, Zhean Xu, Zhenda Xie, Zhengyan Zhang, Zhewen Hao, Zhicheng Ma, Zhigang Yan, Zhiyu Wu, Zihui Gu, Zijia Zhu, Zijun Liu, Zilin Li, Ziwei Xie, Ziyang Song, Zizheng Pan, Zhen Huang, Zhipeng Xu, Zhongyu Zhang, and Zhen Zhang. Deepseek-r1: Incentivizing reasoning capability in llms via reinforcement learning, 2025. URL https://arxiv.org/abs/2501.12948.

Nicolai Dorka. Quantile regression for distributional reward models in rlhf, 2024. URL https://arxiv.org/abs/2409.10164.

Angela Fan, Mike Lewis, and Yann Dauphin. Hierarchical neural story generation. In Iryna Gurevych and Yusuke Miyao (eds.), Proceedings of the 56th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pp. 889-898, Melbourne, Australia, July 2018. Association for Computational Linguistics. doi: 10.18653/v1/P18-1082. URL https://aclanthology.org/P18-1082/.

Angela Fan, Mike Lewis, and Yann Dauphin. Strategies for structuring story generation. In Anna Korhonen, David Traum, and Lluís Màrquez (eds.), Proceedings of the 57th Annual Meeting of the Association for Computational Linguistics, pp. 2650-2660, Florence, Italy, July 2019. Association for Computational Linguistics. doi: 10.18653/v1/P19-1254. URL https://aclanthology.org/P19-1254/.

Daniel Fein, Sebastian Russo, Violet Xiang, Kabir Jolly, Rafael Rafailov, and Nick Haber. Litbench: A benchmark and dataset for reliable evaluation of creative writing, 2025. URL https://arxiv.org/abs/2507.00769.

Jack Grieve. Quantitative authorship attribution: An evaluation of techniques. Literary and linguistic computing, 22(3):251-270, 2007.

Fantine Huot, Reinald Kim Amplayo, Jennimaria Palomaki, Alice Shoshana Jakobovits, Elizabeth Clark, and Mirella Lapata. Agents' room: Narrative generation through multi-step collaboration, 2025. URL https://arxiv.org/abs/2410.02603.

Ruipeng Jia, Yunyi Yang, Yongbo Gai, Kai Luo, Shihao Huang, Jianhe Lin, Xiaoxi Jiang, and Guanjun Jiang. Writing-zero: Bridge the gap between non-verifiable tasks and verifiable rewards, 2025. URL https://arxiv.org/abs/2506.00103.

Slava M Katz. Distribution of content words and phrases in text and language modelling. Natural language engineering, 2(1):15-59, 1996.

M. G. Kendall. A new measure of rank correlation. Biometrika, 30(1/2):81-93, 1938. ISSN 00063444. URL http://www.jstor.org/stable/2332226.

Nathan Lambert, Valentina Pyatkin, Jacob Morrison, LJ Miranda, Bill Yuchen Lin, Khyathi Chandu, Nouha Dziri, Sachin Kumar, Tom Zick, Yejin Choi, Noah A. Smith, and Hannaneh Hajishirzi. Rewardbench: Evaluating reward models for language modeling, 2024. URL https://arxiv.org/abs/2403. 13787.

Yukyung Lee, Soonwon Ka, Bokyung Son, Pilsung Kang, and Jaewook Kang. Navigating the path of writing: Outline-guided text generation with large language models, 2025. URL https://arxiv.org/abs/ 2404.13919.

Chris Yuhao Liu, Liang Zeng, Jiacai Liu, Rui Yan, Jujie He, Chaojie Wang, Shuicheng Yan, Yang Liu, and Yahui Zhou. Skywork-reward: Bag of tricks for reward modeling in llms, 2024. URL https: //arxiv.org/abs/2410.18451.

Yang Liu, Dan Iter, Yichong Xu, Shuohang Wang, Ruochen Xu, and Chenguang Zhu. G-eval: Nlg evaluation using gpt-4 with better human alignment. In Proceedings of EMNLP, pp. 2511-2522, 2023.

Yan Ma, Yu Qiao, and Pengfei Liu. Mops: Modular story premise synthesis for open-ended automatic story generation, 2024. URL https://arxiv.org/abs/2406.05690.

Meta. Llama-3.1-70b-instruct. https://huggingface.co/meta-llama/Llama-3.1-70B-Instruct, 2024a. Accessed: 2025-09-20.

Meta. Llama-3.1-8b-instruct. https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct, 2024b. Released: July 23, 2024; Accessed: 2025-09-20.

OpenAI. Hello gpt-4o, 2024. URL https://openai.com/index/hello-gpt-4o/. Accessed: 2025-02-04.

Long Ouyang, Jeffrey Wu, Xu Jiang, Diogo Almeida, Carroll Wainwright, Pamela Mishkin, Chong Zhang, Sandhini Agarwal, Katarina Slama, Alex Ray, et al. Training language models to follow instructions with human feedback. Advances in neural information processing systems, 35:27730-27744, 2022.

Samuel J Paech. Eq-bench: An emotional intelligence benchmark for large language models. arXiv preprint arXiv:2312.06281, 2023.

Hao Peng, Yunjia Qi, Xiaozhi Wang, Zijun Yao, Bin Xu, Lei Hou, and Juanzi Li. Agentic reward modeling: Integrating human preferences with verifiable correctness signals for reliable reward systems. arXiv preprint arXiv:2502.19328, 2025.

Yunjia Qi, Hao Peng, Xiaozhi Wang, Bin Xu, Lei Hou, and Juanzi Li. Constraint back-translation improves complex instruction following of large language models. arXiv preprint arXiv:2410.24175, 2024.

Qwen, :, An Yang, Baosong Yang, Beichen Zhang, Binyuan Hui, Bo Zheng, Bowen Yu, Chengyuan Li, Dayiheng Liu, Fei Huang, Haoran Wei, Huan Lin, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Yang, Jiaxi Yang, Jingren Zhou, Junyang Lin, Kai Dang, Keming Lu, Keqin Bao, Kexin Yang, Le Yu, Mei Li, Mingfeng Xue, Pei Zhang, Qin Zhu, Rui Men, Runji Lin, Tianhao Li, Tianyi Tang, Tingyu Xia, Xingzhang Ren, Xuancheng Ren, Yang Fan, Yang Su, Yichang Zhang, Yu Wan, Yuqiong Liu, Zeyu Cui, Zhenru Zhang, and Zihan Qiu. Qwen2.5 technical report, 2025. URL https://arxiv.org/abs/2412.15115.

Alan Roberts. Rhythm in prose and the serial correlation of sentence lengths: A joyce cary case study. Literary and linguistic computing, 11(1):33-39, 1996.

Keita Saito, Akifumi Wachi, Koki Wataoka, and Youhei Akimoto. Verbosity bias in preference labeling by large language models. In NeurIPS 2023 Workshop on Instruction Tuning and Instruction Following.

Team, Aohan Zeng, Xin Lv, Qinkai Zheng, Zhenyu Hou, Bin Chen, Chengxing Xie, Cunxiang Wang, Da Yin, Hao Zeng, Jiajie Zhang, Kedong Wang, Lucen Zhong, Mingdao Liu, Rui Lu, Shulin Cao, Xiaohan Zhang, Xuancheng Huang, Yao Wei, Yean Cheng, Yifan An, Yilin Niu, Yuanhao Wen, Yushi Bai, Zhengxiao Du, Zihan Wang, Zilin Zhu, Bohan Zhang, Bosi Wen, Bowen Wu, Bowen Xu, Can Huang, Casey Zhao, Changpeng Cai, Chao Yu, Chen Li, Chendi Ge, Chenghua Huang, Chenhui Zhang, Chenxi Xu, Chenzheng Zhu, Chuang Li, Congfeng Yin, Daoyan Lin, Dayong Yang, Dazhi Jiang, Ding Ai, Erle Zhu, Fei Wang, Gengzheng Pan, Guo Wang, Hailong Sun, Haitao Li, Haiyang Li, Haiyi Hu, Hanyu Zhang, Hao Peng, Hao Tai, Haoke Zhang, Haoran Wang, Haoyu Yang, He Liu, He Zhao, Hongwei Liu, Hongxi Yan, Huan Liu, Huilong Chen, Ji Li, Jiajing Zhao, Jiamin Ren, Jian Jiao, Jiani Zhao, Jianyang Yan, Jiaqi Wang, Jiayi Gui, Jiayue Zhao, Jie Liu, Jijie Li, Jing Li, Jing Lu, Jingsen Wang, Jingwei Yuan, Jingxuan Li, Jingzhao Du, Jinhua Du, Jinxin Liu, Junkai Zhi, Junli Gao, Ke Wang, Lekang Yang, Liang Xu, Lin Fan, Lindong Wu, Lintao Ding, Lu Wang, Man Zhang, Minghao Li, Minghuan Xu, Mingming Zhao, Mingshu Zhai, Pengfan Du, Qian Dong, Shangde Lei, Shangqing Tu, Shangtong Yang, Shaoyou Lu, Shijie Li, Shuang Li, Shuang-Li, Shuxun Yang, Sibo Yi, Tianshu Yu, Wei Tian, Weihan Wang, Wenbo Yu, Weng Lam Tam, Wenjie Liang, Wentao Liu, Xiao Wang, Xiaohan Jia, Xiaotao Gu, Xiaoying Ling, Xin Wang, Xing Fan, Xingru Pan, Xinyuan Zhang, Xinze Zhang, Xiuqing Fu, Xunkai Zhang, Yabo Xu, Yandong Wu, Yida Lu, Yidong Wang, Yilin Zhou, Yiming Pan, Ying Zhang, Yingli Wang, Yingru Li, Yinpei Su, Yipeng Geng, Yitong Zhu, Yongkun Yang, Yuhang Li, Yuhao Wu, Yujiang Li, Yunan Liu, Yunqing Wang, Yuntao Li, Yuxuan Zhang, Zezhen Liu, Zhen Yang, Zhengda Zhou, Zhongpei Qiao, Zhuoer Feng, Zhuorui Liu, Zichen Zhang, Zihan Wang, Zijun Yao, Zikang Wang, Ziqiang Liu, Ziwei Chai, Zixuan Li, Zuodong Zhao, Wenguang Chen, Jidong Zhai, Bin Xu, Minlie Huang, Hongning Wang, Juanzi Li, Yuxiao Dong, and Jie Tang. Glm-4.5: Agentic, reasoning, and coding (arc) foundation models, 2025. URL https://arxiv.org/abs/2508.06471.

Yufei Tian, Tenghao Huang, Miri Liu, Derek Jiang, Alexander Spangher, Muhao Chen, Jonathan May, and Nanyun Peng. Are large language models capable of generating human-level narratives? In Proceedings of EMNLP, pp. 17659-17681, 2024.

Fanqi Wan, Weizhou Shen, Shengyi Liao, Yingcheng Shi, Chenliang Li, Ziyi Yang, Ji Zhang, Fei Huang, Jingren Zhou, and Ming Yan. Qwenlong-l1: Towards long-context large reasoning models with reinforcement learning, 2025a. URL https://arxiv.org/abs/2505.17667.

Kaiyang Wan, Honglin Mu, Rui Hao, Haoran Luo, Tianle Gu, and Xiuying Chen. A cognitive writing perspective for constrained long-form text generation, 2025b. URL https://arxiv.org/abs/ 2502.12568.

Haoxiang Wang, Wei Xiong, Tengyang Xie, Han Zhao, and Tong Zhang. Interpretable preferences via multi-objective reward modeling and mixture-of-experts, 2024a. URL https://arxiv.org/abs/ 2406.12845.

Phoebe J. Wang and Max Kreminski. Guiding and diversifying llm-based story generation via answer set programming, 2024. URL https://arxiv.org/abs/2406.00554.

Qianyue Wang, Jinwu Hu, Zhengping Li, Yufeng Wang, daiyuan li, Yu Hu, and Mingkui Tan. Generating long-form story using dynamic hierarchical outlining with memory-enhancement, 2024b. URL https: //arxiv.org/abs/2412.13575.

Yi Wang and Max Kreminski. Can llms generate good stories? insights and challenges from a narrative planning perspective. arXiv preprint arXiv:2506.10161, 2025.

Yuxin Wang, Jieru Lin, Zhiwei Yu, Wei Hu, and Börje F Karlsson. Open-world story generation with structured knowledge enhancement: A comprehensive survey. Neurocomputing, pp. 126792, 2023.

xAI. Grok (version 2025-09-14), 2025. URL https://grok.x.ai. Large language model.

Haotian Xia, Hao Peng, Yunjia Qi, Xiaozhi Wang, Bin Xu, Lei Hou, and Juanzi Li. Storywriter: A multi-agent framework for long story generation. arXiv preprint arXiv:2506.16445, 2025.

Yuxi Xie, Anirudh Goyal, Wenyue Zheng, Min-Yen Kan, Timothy P Lillicrap, Kenji Kawaguchi, and Michael Shieh. Monte carlo tree search boosts reasoning via iterative preference learning. arXiv preprint arXiv:2405.00451, 2024.

An Yang, Anfeng Li, Baosong Yang, Beichen Zhang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Gao, Chengen Huang, Chenxu Lv, Chujie Zheng, Dayiheng Liu, Fan Zhou, Fei Huang, Feng Hu, Hao Ge, Haoran Wei, Huan Lin, Jialong Tang, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Yang, Jiaxi Yang, Jing Zhou, Jingren Zhou, Junyang Lin, Kai Dang, Keqin Bao, Kexin Yang, Le Yu, Lianghao Deng, Mei Li, Mingfeng Xue, Mingze Li, Pei Zhang, Peng Wang, Qin Zhu, Rui Men, Ruize Gao, Shixuan Liu, Shuang Luo, Tianhao Li, Tianyi Tang, Wenbiao Yin, Xingzhang Ren, Xinyu Wang, Xinyu Zhang, Xuancheng Ren, Yang Fan, Yang Su, Yichang Zhang, Yinger Zhang, Yu Wan, Yuqiong Liu, Zekun Wang, Zeyu Cui, Zhenru Zhang, Zhipeng Zhou, and Zihan Qiu. Qwen3 technical report, 2025. URL https://arxiv.org/abs/2505.09388.

Dingyi Yang and Qin Jin. What makes a good story and how can we measure it? a comprehensive survey of story evaluation. arXiv preprint arXiv:2408.14622, 2024.

Rui Yang, Ruomeng Ding, Yong Lin, Huan Zhang, and Tong Zhang. Regularizing hidden states enables learning generalizable reward model for llms. In Advances in Neural Information Processing Systems, 2024.

Jialun Zhong, Wei Shen, Yanzeng Li, Songyang Gao, Hua Lu, Yicheng Chen, Yang Zhang, Wei Zhou, Jinjie Gu, and Lei Zou. A comprehensive survey of reward models: Taxonomy, applications, challenges, and future. arXiv preprint arXiv:2504.12328, 2025.

## 附录

### 附录 A 前提生成细节

我们整理了一组横跨多个主题领域的多样种子前提。为避免冗余并保持结构连贯，我们引入了一套借鉴文学、哲学与电影母题的主题分类框架。该框架将前提划分为以下类别：存在主义/哲学：关注自我、存在、意义与认知等根本问题。社会政治议题：聚焦权力、真相、道德与社会结构等主题。心理/意识取向叙事：探索记忆、梦境、身份与感知。伦理困境：呈现涉及艰难权衡、具有道德挑战性的场景。时间与存在：涉及时空性、命运、历史与不朽等形而上学设定。每条种子前提基于两条核心原则设计：(1) 冲突或反转。每个前提都以一个关键冲突或认知反转为核心，例如"一位哲学家发现自己的毕生工作建立在伪造的证据之上"或"一位历史学家发现历史遭到系统性操纵"。这类构造促使 LLM 探索多样、高风险的叙事轨迹。(2) 简洁的叙事结构。前提遵循"主体 + 行动/变化 + 发现/困境"的紧凑模式。示例包括"一位心理治疗师亲身体验患者的创伤"或"一位医生发现一种需要牺牲一人才能救活多人的疗法"。这种结构在保持信息密集的同时提供了强有力的叙事钩子。

为避免种子前提过于抽象或程式化，我们为其扩充了额外的叙事要素（如人物、场景、时代背景）。例如，"一位哲学家发现自己的毕生工作建立在伪造的前提之上"被扩充为"在 19 世纪的一座欧洲大学城，一位哲学家意识到其终身研究的基础建立在被篡改的历史记录之上"。该策略在保持主题内核的同时提升了叙事具体性。

我们进一步利用 LLM 进行轻量改写，用结构化提示生成风格多样的变体；后处理则剔除冗余或过于直译的输出，以确保多样性与深度。通过该流程，我们构建了包含 1,856 个候选前提的初始池，示例条目包括"一位科学家提出证明自由意志是幻觉的定理并遭到多方反对"和"一位心理治疗师在一次医疗事故后开始将患者的创伤当作自己的记忆来体验"。随后我们进行人工过滤，剔除语义空洞、逻辑不一致、主题冗余或文化敏感的前提。最终集合由 1,000 个高质量前提组成，每个前提以一至两个句子表达，语义互异且足够丰富，可支撑故事生成任务。

### 附录 B 故事生成细节

如表 3 所示，我们使用 LLM 生成故事，作为构建基准的候选故事。对 533 个 LLM 生成的前提，我们采用四个 LLM 为每个前提生成四篇候选故事。对从 WritingPrompts 测试集中采样的 600 个前提，我们用三个不同的 LLM 生成三篇候选故事，并纳入原始的人类撰写故事，同样总共得到四个候选。

### 附录 C 人工评分细节

对包含一篇人类撰写故事与三篇 LLM 生成故事的 600 条实例，我们仅对 LLM 生成的故事应用 §2.2 的偏好排序流程进行排序。对人类撰写的故事，我们过滤掉极短的故事（即少于 100 词）。鉴于 WritingPrompts 的严格质量控制加上我们的额外过滤，我们将人类撰写故事视为四个候选中质量最高者。我们进行了进一步核验：请标注者只需核验该人类撰写故事是否确实最佳，无需判断其他故事的排序。若标注者无法确定，则将该实例标记为"unsure"。最终，91 条实例被标为"unsure"并被剔除，得到 509 条实例，每条包含一篇人类撰写故事与三篇 LLM 生成故事。对 230 条 $\tau_{\mathrm{avg}} < 0.6$ 的实例，我们进行完整的人工标注，详见 C.1 节。对 394 条 $\tau_{\mathrm{avg}} \geq 0.6$ 的实例，我们进行人工核验：首先进行多数投票，即对四个 LLM 的总体分数取平均，为每个候选故事生成一个最终分数；平均后的最终分数产生最终排序。然后，我们向标注者提供前提与排序后的故事，请其确认排序较高的故事是否确实更好；若标注者无法判断，我们保留原排序。这一人工核验流程相比完整人工标注节省了约 30% 的标注时间。$\tau_{\mathrm{avg}}$ 的 0.6 阈值基于经验性启发式：$\tau_{\mathrm{avg}} = 0.6$ 意味着约 80% 的一致对与 20% 的不一致对，我们认为这已代表足够高的排序一致性。

#### C.1 标注指南

我们搭建了本地标注平台以收集人类对故事质量的判断。我们招募并指导标注者评估同一前提下生成的候选故事。要求标注者在打分前读完给定前提的所有候选续写，并确保其评分能清晰反映故事质量的差异。为保持标注可靠性，我们进行了周期性质量检查：每标注 50 组后，随机抽样复查以核验一致性与正确性。

#### C.2 标注协调

我们招募了英语专业的学生担任本项目的标注者。标注者的人口统计分布为 58% 女性、42% 男性。所有参与标注的人员均拥有学士学位。所有人员均按商定的薪酬与工作量获得公平报酬。我们与所有标注者签署了正式合同，所有用工实践均遵守当地劳动法规。标注者的隐私受到严格保护，任何个人信息均未被用于任何目的。标注过程的总成本（包括故事标注以及标注平台的开发与维护）约为 10,000 美元。

### 附录 D Human–LLM 基准细节

表 7 展示了我们如何用 LLM 生成故事以与人类故事比较。

**表 7：使用 WritingPrompt 前提生成故事的示例提示。**

| 提示类型 | 示例（原文提示，保留英文） |
|---|---|
| 我们如何基于两个故事生成前提 | Write a continuous, immersive literary fiction story of at least {length} words. The story should unfold in a natural, human-like way--flowing as if written by a thoughtful novelist, not an AI. Premise: {prompt} The story should: Use natural pacing: weave moments of quiet reflection with vivid external events, instead of nonstop introspection. Balance internal monologue with dialogue and interaction, so the protagonist feels alive and connected to others. Maintain a consistent atmospheric tone with sensory detail (sounds, smells, textures) that feel authentic rather than overly ornamental. Prioritize human readability: avoid mechanical repetition, vary sentence lengths, and use subtle rhythm to make the prose engaging. Escalate tension gradually, but allow for moments of relief, small human connections, or fragile beauty. Important: Write as if you are crafting a novel that would be highly rated by human readers. The prose should feel alive, compassionate, and deeply human, not robotic or overly stylized. |

### 附录 E 训练对生成细节

#### E.1 LLM 故事对生成细节

表 3 展示了我们用于生成故事对的提示，模型组合为 Llama3.1-8B-Instruct（Meta, 2024b）对比 Llama3.1-70B-Instruct（Meta, 2024a）、DeepSeek-R1-Distill-Llama-8B（DeepSeek-AI et al., 2025）对比 DeepSeek-R1-Distill-Llama-70B（DeepSeek-AI et al., 2025），以及 Qwen2.5-14B（Bai et al., 2023）对比 QwQ-32B（Qwen et al., 2025）。一方面，我们让较大的 LLM 评估两个较小 LLM 生成的故事；另一方面，我们比较较大 LLM 与较小 LLM 各自生成的一篇故事。

**表 3：通过对比小规模与大规模 LLM 生成的故事来构建偏好对的示例提示。**

| 提示类型 | 示例（原文提示，保留英文） |
|---|---|
| 我们如何基于两个故事生成前提 | Write a continuous, uninterrupted, highly detailed literary fiction story of at least {length} words, with no chapters, no scene breaks, and no meta commentary. Maintain a consistent atmospheric tone, vivid sensory descriptions, and deep psychological introspection. Premise:{prompt} The story should: - Flow continuously without numbered sections or chapter titles - Use rich imagery and internal monologue to convey the protagonist's unraveling thoughts - Gradually escalate tension without giving definitive answers to the mystery - End with an ambiguous but emotionally powerful conclusion |

#### E.2 前提反向生成细节

除故事重写与无引导生成外，我们还设计了提示（如表 4 所示），从既有文本中引出前提。具体而言，我们提供两篇文章的标题与摘要作为输入，要求模型识别它们的共同要素（如主题、场景、人物或情节发展），并将其凝练为单一前提。该前提被要求足够通用又逻辑自洽，使两篇文章均可由其派生。该流程使我们能够在保持生成故事间叙事连贯的同时，系统性地以多样且语义扎实的前提扩充前提池。

**表 4：基于两篇人类故事生成前提的示例提示。**

| 提示类型 | 示例（原文提示，保留英文） |
|---|---|
| 我们如何基于两个故事生成前提 | Below are two articles. Based on their commonalities in theme, background, characters, or plot, please derive a single premise that can logically give rise to both stories. Article A:{title_a} {abstract_a} Article B:{title_b} {abstract_b} Please output a premise that can directly lead to the content of both articles. |

#### E.3 以重写生成被拒故事的细节

如表 6 所示，为构建可靠的偏好对，我们将人类撰写的故事视为正例，并通过受控的 LLM 重写生成低质量的负例。具体而言，我们通过改变人物动机、修改关键情节点、破坏因果连贯或简化语言来刻意降低文本质量，从而产出与原始事件大体一致但叙事或文风质量较弱的版本。然后将这些负例与人类正例配对，构成用于训练奖励模型的数据对。为确保负例的质量确实低于人类版本，我们对生成输出进行了随机人工抽查。

**表 6：通过重写人类故事生成被拒故事的示例提示（含续表）。**

| 提示类型 | 示例（原文提示，保留英文） |
|---|---|
| 有人类引导的故事 | The following is an excerpt from a novel. Please rewrite the beginning so that it matches the ending in style and ensures consistent character motivations. Title: {title} Abstract: {abstract} Content: {content} Rewrite the beginning: |
| 无人类引导的故事 | The following is a novel. Please rewrite the beginning so that it aligns with the emotional tone of the ending. Title: {title} Abstract: {abstract} Content: {content} Rewrite the beginning: |
| 有人类引导的故事 | The following is an excerpt from a novel. Please rewrite the middle section so that it matches the ending in style and ensures consistent character motivations. Title: {title} Abstract: {abstract} Content: {content} Rewrite the middle section: |
| 无人类引导的故事 | The following is a novel. Please rewrite the middle section so that it aligns with the emotional tone of both the beginning and the ending. Title: {title} Abstract: {abstract} Content: {content} Rewrite the middle section: |
| 有人类引导的故事 | The following is an excerpt from a novel. Please rewrite the ending so that it matches the preceding style and maintains consistent character motivations. Title: {title} Abstract: {abstract} Content: {content} Rewrite the ending: |
| 无人类引导的故事 | The following is the beginning and middle part of a novel. Please rewrite the ending so that it aligns with the emotional tone of the middle part. Title: {title} Abstract: {abstract} Content: {content} Rewrite the ending: |
| 有人类引导的故事 | The following is a passage. Please rewrite it to alter the emotional tone, while keeping the events themselves unchanged. Title: {title} Abstract: {abstract} Content: {content} Rewrite the passage with a new emotional tone: |
| 无人类引导的故事 | The following is an excerpt from a novel. Please keep the events and plot largely unchanged, but modify only the final scene and outcome. Title: {title} Abstract: {abstract} Content: {content} Modify the final scene and outcome: |
| 有人类引导的故事 | Please rewrite the following straightforward narration into a literary expression that is more evocative, poetic, and rhythmical. Title: {title} Abstract: {abstract} Content: {content} Rewrite in a literary style: |
| 无人类引导的故事 | Please enhance the following passage by adding the characters' psychological activities and inner conflicts, making the fragment more vivid and multidimensional. Title: {title} Abstract: {abstract} Content: {content} Add inner thoughts and conflicts: |

#### E.4 人类引导续写细节

事实上，我们最初的方法是将人类撰写的故事原文直接作为优选回答。但训练出的奖励模型表现不佳，在 StoryRMB 上的平均准确率低于 30%。这可能是因为人类与 LLM 生成故事之间的分布差距很大（Tian et al., 2024），奖励模型容易利用表层语言捷径而非关注故事质量。因此，我们最终采用人类引导续写的方法，让 LLM 从人类提供的上下文继续写作。我们在表 5 中给出两个代表性的提示模板：(1) 人类引导生成，模型在保留核心要素的前提下重写并扩展给定的故事开头；(2) 无引导生成，模型仅依据标题创作原创故事。

**表 5：在有/无人类引导下构建故事对的示例提示。**

| 提示类型 | 示例（原文提示，保留英文） |
|---|---|
| 有人类引导的故事 | You are a talented fiction writer. Below is a story title and an original story beginning. Your task is to rewrite and extend the story in your own words. Preserve the original plot, characters, tone, and worldbuilding. You can improve the wording, expand on details, and make the story more vivid, but do not change the core storyline or intent. Title: {title} Original Beginning: {beginning} Rewrite the story: |
| 无人类引导的故事 | You are a talented fiction writer. Below is a story title. Based on this title alone, write a complete and engaging short story. Be imaginative and creative. You can invent characters, settings, and plot freely, as long as it fits the spirit of the title. Title: title Write the story: |

### 附录 F 维度选择算法

算法 1 旨在将候选故事集归入某个特定的偏好维度。它采用层次化流程来判定哪个维度最能凸显优选故事。首先，在阶段 1 中，我们计算优选故事的分数与所有被拒故事平均分之间的差距（$\mathrm{mean\_gap}_d$），选择差距最大的维度作为偏好维度。在阶段 2 中，若多个维度的差距落在预设容差 $\varepsilon$ 内（表明持平），我们计算优选故事分数与被拒故事最高分之间的领先幅度（$\mathrm{margin}_d$），选择领先幅度最大的维度来确定偏好维度。在阶段 3 中，若平局仍然存在，我们计算被拒故事分数的方差（$\mathrm{variance}_d$）以评估其表现的一致性，选择方差最小的维度作为偏好维度。最后，若前三个阶段的分析仍导致平局，算法调用序数兜底（阶段 4），应用预先定义的排序来选择最终的偏好维度。

**算法 1：四阶段维度选择。该算法介绍我们如何判定故事属于哪个偏好维度。**

```text
Function CategorizeDimension(M, ε, priority):
    // 阶段 1：最高平均差距
    best ← score[chosen_story];
    ANS ← {dim | max(best[dim] - M.mean[dim]) < ε};      「？」
    if ANS then
        return ANS
    end
    // 阶段 2：在阶段 1 候选中取最高领先幅度
    second = M.max;
    ANS ← {dim | max(best[dim] - second[dim]) < ε};      「？」
    if ANS then
        return ANS
    end
    // 阶段 3：在阶段 2 候选中取最低被拒方差
    ANS ← {dim | |M.rej_vars[dim]| < ε};                 「？」
    if ANS then
        return ANS
    end
    // 阶段 4：用预定义优先级打破平局
    foreach dim in priority do
        if dim.max == M.max then
            return dim
        end
    end
```

> 注：算法伪代码在 PDF 文本提取时存在符号缺失，以上按上下文尽量还原；条件式中可能缺失的比较项以「？」标注。

### 附录 G 数据统计

STORYRMB 与训练数据集的数据统计见表 9。

**表 9：训练数据与 STORYRMB 的数据统计。**

| 数据集 | 实例数 | 来源 | 平均长度（词） | 中位长度（词） |
|---|---|---|---|---|
| 训练数据 | 93,729 | Douban, WritingPrompts, LLMs | 2,802 | 1,858 |
| STORYRMB | 1,133 | WritingPrompts, LLMs | 3,011 | 2,401 |

### 附录 H 补充实验

#### H.1 消融研究

消融实验结果见表 2。我们分析了从训练数据集构建方法中移除关键成分的影响。（-前提反向生成）：我们用两个不同规模的模型从同一提示生成两篇故事，其中较大模型生成的故事被视为优选故事。这些故事被视为补充训练数据。然后我们移除由"前提反向生成"生成的训练数据，并加入等量的补充数据，随后以 Qwen3-8B 为基座模型进行训练，并在 STORYRMB 上评估结果。（-人类引导续写）：类似地，我们移除由"人类引导续写"生成的训练数据，替换为等量的补充训练数据，同样以 Qwen3-8B 为基座模型进行训练并在 STORYRMB 上评估。（-提示引导重写）：与前面的方法相同，我们移除由"提示引导重写"生成的训练数据，替换为等量的补充训练数据，以 Qwen3-8B 为基座模型进行训练并在 STORYRMB 上评估。

**表 2："（-）Premise Back-generation"移除由"前提反向生成"构建的训练数据；"（-）Prompt-Guided Rewriting"移除由"提示引导重写"构建的训练数据；"（-）Human-Guided Continuation"移除由"人类引导续写"构建的训练数据。加粗表示最佳结果。**

| 模型 | 一致性 | 创造性 | 人物塑造 | 流畅性 | 相关性 | 平均 |
|---|---|---|---|---|---|---|
| STORYREWARD-QWEN | 77.5 | **78.8** | 71.6 | **74.2** | 69.1 | **75.0** |
| (-) Premise Back-Generation | **82.3** | 70.4 | **78.6** | 68.9 | **75.0** | 73.9 |
| (-) Human-Guided Continuation | 81.5 | 70.4 | 76.2 | 67.1 | 72.8 | 72.8 |
| (-) Prompt-Guided Rewriting | 73.4 | 68.1 | 71.3 | 65.2 | 68.7 | 69.9 |

#### H.2 STORYRMB 上的头对头排序结果

我们进一步在 STORYRMB 上采用 §5 的头对头排序评估方法进行评估。在该设定中，我们比较两个奖励模型所选故事的排序，在原始偏好排序中位次更高者即为获胜故事。结果见图 4。可以观察到，我们的模型优于基线，这与图 3 的发现一致。关于图 2 中（我们的模型）在 LLM–LLM 对上的落后，一个可能的原因是：尽管我们的模型擅长一般性偏好，但在高质量且相似的 LLM 生成结果中区分出绝对最佳的候选仍具挑战性。

**图 4（原文图像见 PDF）** 在 STORYRMB 上 BoN 的头对头比较结果。"Tie"（平局）表示两个模型选择了同一故事。

#### H.3 在另一个写作基准上的表现

我们在另一个写作基准上评估了我们的模型。具体而言，我们使用 EQ-Bench（Paech, 2023）的 Creative Writing v3 评估集，并采用一种广泛使用的故事评估方法（Chhun et al., 2024）。我们首先在 STORYRMB 上对该评估方法进行元评估（meta-evaluation），即用该方法为每篇故事打分并选出最佳者。我们发现它在 LLM–LLM 对上达到 94% 的准确率，在 Human–LLM 对上为 54%。因此，我们认为该评估方法可有效评估 LLM 生成的故事。

评估流程如下。首先，我们以 Llama3.1-8B-Instruct 为策略模型，为每个提示生成 16 篇候选故事；然后，用不同的奖励模型从 16 篇中选出最佳故事；最后，用上述评估方法评估这些被选出的故事。结果报告于表 10。可以发现，StoryReward-Qwen 与 StoryReward-Llama 选出的故事均获得更高分数，证明了我们训练的奖励模型的有效性。

**表 10：采用一种广泛使用的故事生成评估方法（Chhun et al., 2024）在 EQ-Bench（Paech, 2023）Creative Writing v3 测试集上的结果。**

| 模型 | 平均分 |
|---|---|
| STORYREWARD-QWEN | 2.72 |
| STORYREWARD-LLAMA | 2.51 |
| GRM-Llama3.1-8B-rewardmodel-ft | 2.24 |
| Skywork-Reward-Llama-3.1-8B-v0.2 | 2.24 |
| QRM-Llama3.1-8B-v2 | 2.31 |
| Skywork-Reward-Gemma-2-27B-v0.2 | 2.28 |
| ArmoRM-Llama3-8B-v0.1 | 2.36 |

#### H.4 语言学分析

我们对不同奖励模型所选出的故事进行了语言学分析。具体而言，我们采用计量语言学中的语言突发性（linguistic burstiness）概念来评估类人写作。已知人类语言在信息内容与结构上呈现非均匀性（Church & Gale, 1995; Katz, 1996）。遵循先前研究（Roberts, 1996; Grieve, 2007），我们以句子长度分布作为该现象的代理指标。具体而言，我们通过句子长度的峰度（kurtosis）来量化故事突发性，其计算公式为：

$$\mathrm{Kurtosis} = \frac{E[(X - \mu)^4]}{\sigma^4} - 3 \qquad (6)$$

其中 $\mu$ 表示平均句长，$\sigma$ 表示句长的标准差。高峰度表明极短或极长句子频繁出现，这捕捉了人类写作典型的结构复杂性与动态方差。结果见表 8。我们观察到，STORYREWARD-QWEN 选出的故事相比真实参考（ground truth）表现出更高的峰度。这提示了一种潜在偏差：由于训练数据包含人类撰写的故事，STORYREWARD-QWEN 可能把语言突发性（即高峰度）当作质量的代理。虽然这为模型行为提供了统计学解释，但系统而深入的分析（如机制可解释性）需要大量实验，超出本文范围。我们将其留作未来工作。

**表 8：被考察模型、STORYREWARD 与 STORYRMB 所选故事的峰度。STORYREWARD-QWEN（on wrong predictions，错误预测）表示与 STORYRMB 所选不同的那些故事；STORYREWARD-QWEN（on correct predictions，正确预测）表示与 STORYRMB 所选相同的那些故事。"Difference"（差异）表示其他模型所选故事与 STORYRMB 所选故事之间的峰度相对差异。**

| 模型 | 峰度 | 差异（%） |
|---|---|---|
| STORYREWARD-QWEN（错误预测） | 1.0149 | +12.8 |
| STORYREWARD-QWEN（全部） | 1.0064 | +11.8 |
| STORYREWARD-QWEN（正确预测） | 0.9958 | +10.7 |
| GRM-Llama3.1-8B-rewardmodel-ft | 0.9573 | +6.4 |
| Skywork-Reward-Llama-3.1-8B-v0.2 | 0.9220 | +2.4 |
| QRM-Llama3.1-8B-v2 | 0.9056 | +0.6 |
| STORYRMB（ground truth 优选故事） | 0.8999 | 0.0 |
| Skywork-Reward-Gemma-2-27B-v0.2 | 0.7598 | -15.6 |
| ArmoRM-Llama3-8B-v0.1 | 0.6876 | -23.6 |
