# LitBench：面向创意写作可靠评测的基准与数据集

> **中文译名**：LitBench：面向创意写作可靠评测的基准与数据集
> **英文原题**：LitBench: A Benchmark and Dataset for Reliable Evaluation of Creative Writing
> **作者**：Daniel Fein、Sebastian Russo、Violet Xiang、Kabir Jolly、Rafael Rafailov、Nick Haber（Stanford University，斯坦福大学）
> **发表信息**：arXiv:2507.00769v1 [cs.CL]，2025 年 7 月 1 日；预印本，审稿中（Preprint. Under review）
> **arXiv 链接**：https://arxiv.org/abs/2507.00769
>
> 本文件为 AI 辅助全文翻译，术语以首次出现时"中文（English）"标注。文中「？」表示该处源文本存在提取噪声或拼写存疑（如符号缺失、断行粘连、疑似笔误），已按学术常识合理处理，存疑。

---

## 摘要

评测大语言模型（large language model, LLM）生成的创意写作仍然充满挑战，因为开放式叙事缺乏真值（ground truth）。在缺乏高性能自动化评测方法的情况下，人们常将现成（off-the-shelf, OTS）语言模型用作零样本评判器（zero-shot judge），但它们在此情境下的可靠性尚不明确。为追求对创意写作的稳健评测，我们提出 LitBench——首个用于创意写作验证的标准化基准与成对数据集，包含一个由来自 Reddit 的 2,480 条去偏、人工标注的故事对比构成的留出测试集，以及一个含 43,827 对人类偏好标签的训练语料库。借助 LitBench，我们（i）对零样本 LLM 评判器进行基准测试，（ii）训练 Bradley-Terry 奖励模型与生成式奖励模型，并（iii）开展在线人类研究，以在新生成的 LLM 故事上验证奖励模型的排序。我们的基准测试认定 Claude-3.7-Sonnet 是最强的现成评判器，与人类偏好的一致率达 73%；在训练得到的奖励模型中，Bradley-Terry 与生成式奖励模型均达到 78% 的准确率，优于所有现成评判器。一项在线人类研究进一步证实，我们训练的奖励模型在全新的 LLM 生成故事上与人类偏好持续一致。我们在此发布 LitBench 及奖励模型，为创意写作系统的可靠自动化评测与优化提供一个经过审校的资源。

## 1 引言

借助预言机（oracle）或学习型验证器（learned verifier）的自动化验证，推动了数学与代码生成的快速进展 [Hendrycks et al., 2021, Gao et al., 2024, Jimenez et al., 2023, Pan et al., 2024]。相比之下，创意写作天然具有发散性：面对同一提示，作者可能写出不同却同样成立的故事。真值标签的缺失阻碍了验证，进而阻碍了创意写作生成的进步。由人类专家依据结构化评分量规（rubric）进行的评测固然可靠，但收集此类判断的成本高昂，尤其是在 AI 生成文本的规模之下 [Chakrabarty et al., 2024]。在真值通常从人类评分者处收集的领域，LLM 评判器（LLM judge）常被采用（[Badshah and Sajjad, 2024]；[Son et al., 2024]）。在对话、有用性与摘要任务等情境中，LLM 判断与人类偏好之间的一致性已被发现是合理的 [Zheng et al., 2023]。但它们也表现出种种偏差，例如偏好更长的文本 [Wang et al., 2023]，以及缺乏内部一致性 [Wei et al., 2025]。Feuer et al. [2025] 发现在这些任务中，文体选择比实质内容更经常地左右语言模型的判断。这就对评判器在创意写作情境中的可靠性提出了疑问——在创意写作中，形式与内容都至关重要。

\*同等贡献。通讯作者：drfein@stanford.edu。

预印本。审稿中。

我们提出 LitBench，这是首个高质量成对创意写作样本的标准化基准，数据源自 Reddit 的 r/WritingPrompts 版块。LitBench 既用于评测现有的零样本评判器，也用于开发更契合人类偏好的学习型验证器。随后，为研究 LLM 评判器与训练所得奖励模型之间的差距，我们从 r/WritingPrompts 另行整理了 43k 个成对样本的数据集。LitBench 评测显示，小型开源 LLM 评判器无法准确评测创意写作，但一些领先的专有模型可与训练所得的验证器相抗衡。我们对多种奖励模型的研究表明，生成式奖励模型（generative reward model, GenRM）在该领域与 Bradley-Terry 奖励模型不相上下。虽然 [Mahan et al., 2024] 发现在 RewardBench 等基于偏好的基准上，用思维链（chain-of-thought, CoT）训练 GenRM 可带来相当甚至更优的表现，但我们发现在创意写作验证中这会损害性能，即便 CoT 是从一个强得多的开箱即用验证器模型蒸馏而来。针对 LLM 生成故事的额外人工评测验证了：在我们基准上表现良好的奖励模型确实能够评判创意质量。

我们的贡献如下：

- 一个由 2.5k 个成对人类撰写故事对比构成的基准，连同由 43k 个成对样本组成、经过过滤和标注的验证器训练数据集，以及所生成的理由（rationale）。
- 对当前创意写作验证方法的基准测试，结果表明最好的零样本 LLM 评判器（Claude-Sonnet-3.7）不及在我们训练集上训练的小型奖励模型（1B-7B），说明我们可以以更低成本获得更高质量的奖励模型。
- 对 GenRM 的研究表明，蒸馏得到的思维链会降低创意写作验证的性能。
- 人工评测验证了在 LitBench 上表现良好的验证器可用于选取更高质量的创意写作。

## 2 相关工作

### 2.1 验证（Verification）

近年来，带有真值标签的数学与编程基准促进了这些领域的进展 [Gao et al., 2024, Jimenez et al., 2023]。Cobbe et al. [2021] 率先使用推理时验证（inference-time verification），通过对生成器产出的候选解进行排序，提升了语言模型在 GSM8K 上的性能。更近期，Costello et al. [2025] 与 Zelikman et al. [2024] 表明，对生成结果做真值剪枝（pruning）再重训练，可以提升正确求解数学问题的潜在能力。

在缺乏真值标签时，验证十分困难。基于人类反馈的强化学习（reinforcement learning from human feedback, RLHF）已成为将模型语言与行为同人类品味对齐、并引导模型遵循指令的主流范式 [Ouyang et al., 2022, Stiennon et al., 2020]。Bai et al. [2022] 提出了一种成本更低的人类偏好对齐方法：在反馈过程中以语言模型替代人类。已有研究发现 LLM 评判器在某些情境下与人类偏好一致（Zheng et al. [2023]、Liu et al. [2023]），但它们在创意写作或其他艺术表达形式评测上与人类的一致性尚未得到系统性评估。

在另一种避免昂贵人类偏好的尝试中，[Ethayarajh et al., 2022a] 发布了 Stanford Human Preferences（SHP）数据集，利用 Reddit 的帖子与评论标注来提炼关于"有用性"的人类偏好。在创意写作这一文体上，Chung et al. [2025] 指出，"由于评测的主观性，为创意写作构建一个稳健的奖励模型十分困难"。现有的自动故事评测工作往往依赖参考文本，或使用语言模型，或使用 BLEU、ROGUE 之类的指标 [Li et al., 2025, Netisopakul and Taoto, 2023]。然而，Fan et al. [2018a] 指出，"在我们的开放式生成设定中，这些方法并无用处"。开放式设定下的评测也有若干努力，例如利用结构线索检测叙事不连贯，但故事连贯性本身无法涵盖本工作所关注的创意特质 [Alihosseini et al., 2019, Li et al., 2020]。

### 2.2 写作中的创造性（Creativity in Writing）

"创造性"一词的日常用法缺乏精确性，涵盖多重含义。该词暗示诸要素的和谐交融；常意味着发现或惊奇；而悖论的是，它既能形容技艺精湛，也能形容技艺笨拙——那种新鲜、不受束缚、违抗常规的东西 [Barzun, 1960]。为收窄范围，我们采用 Rhodes 的创造力框架：创造力的四个 P，即 (1) 人（people）、(2) 过程（process）、(3) 环境（press）、(4) 产品（products）[Rhodes, 1961]。本文关注的是创意产品，即短篇小说形式。在为创意产品提出的诸多属性中，跨学科理论提炼出两条根本标准：新颖性（novelty）与价值（value）[Callan and Foster, 2023]。我们的工作部分受到这样一个观察的启发：人类对创意产品存在趋同的偏好。这些偏好可以在我们的文化机构中公开展示。例如，MFA（创意写作硕士）项目课程大纲中必读书目的选择显示出极大的跨机构一致性 [Manery, 2016]。这一点延伸到许多创意领域——那里普遍存在"经典作品"（canon）的概念。心理学研究同样显示了趋同的创意偏好：让专家作家为诗歌与散文排序时，他们能达到很高的一致性 [Amabile, 1982]。对书面语言的判断植根于人类情感（例如觉得某物有趣），并进而植根于共通的人类经验。这些能力是语言模型不具备的。但语言模型可以获得的，是人类对创意产品的聚合偏好。下文我们呈现一个聚合的创意产品集合，希望它能推进面向创作过程的计算方法。换言之，让模型与人类创造力对齐，或许就相当于精心策划一份出色的阅读清单。

## 3 LitBench

LitBench 是一个面向能够评判创意写作质量的奖励模型（reward model）的基准，并附带一个可据以改进的训练集。由于在使用基于偏好的奖励模型提升模型能力时，奖励黑客（reward hacking）是常见问题，我们谨慎地构建评测集与训练集以确保质量。我们将详细描述该流程，并证明我们的筛选流程确有帮助。

图 1（原文图像见 PDF）：数据集构建的预处理方法。

### 3.1 数据收集

我们从拥有 1890 万订阅者的 r/WritingPrompts 版块收集写作样本。用户响应写作提示撰写故事，并通过点赞（upvote）或评论与已发布的故事自由互动。r/WritingPrompts 总计积累了超过一百万篇故事。如此庞大的语料使得高度选择性的数据过滤成为可能，留下的数据让我们能够有把握地假定其中存在人类偏好信号。为构建基准数据，我们通过 praw 库使用 Reddit API。具体而言，我们使用搜索功能，为 [Fan et al., 2018b] 收集的每个帖子采集前 100 条搜索结果，共得到 5,000 余个 post-id（该版块框架中的独立提示）。在构建测试集时，我们过滤掉 2023 年以前的故事，因为这些数据可能与我们的训练集重叠，也更可能已被纳入本文所研究模型的预训练数据。为收集训练数据集，我们从 Hugging Face 上采用 MIT 许可证的 euclaise/WritingPrompts_preferences 数据集中整理样例，该数据集包含 2023 年以前的故事帖子。

\*https://huggingface.co/datasets/euclaise/WritingPrompts_preferences

### 3.2 质量控制

我们先对故事逐篇独立过滤，开始构建数据集。首先，为降低小点赞数带来的噪声影响，我们过滤掉点赞数少于 10 的故事，确保每个故事都有合理的互动量。其次，与 [Chung et al., 2025] 一致，我们过滤掉超过 2048 token 的故事，以剔除过长的故事。最后，我们删除少于 50 词的条目，因为我们在定性上发现这些故事不足以体现创意小说的文体。在配对时，我们执行两个步骤以确保捕捉到真实偏好，再执行一个步骤处理长度偏差。首先，我们排除点赞差异微弱的配对，过滤掉点赞差小于 25% 的对。其次，遵循 [Ethayarajh et al., 2022b] 的方法，我们只构造"点赞数更高者同时也发布得更晚"的配对，以缓解不同曝光时长带来的时间偏差。最后，我们发现所得数据集存在长度偏差：65.25% 的 chosen 响应比 rejected 响应更长。为在保留长度多样性的同时解决这一问题，我们构建长度差异直方图（100 个桶）并修剪配对，直至达到对称——即 chosen 故事更短与更长的比例均衡。该步骤见图 2。数据准备流程总结于图 1。整个流程对我们的基准集与训练集分别独立执行。

图 2（原文图像见 PDF）：长度偏差缓解。

### 3.3 最终数据集描述

LitBench 由 2,480 个成对对比组成，共包含 3,543 篇故事。这些故事平均长度为 550 词，故事长度分布右偏，带有较长故事的尾部。数据完全取自 2023 年 1 月 2 日之后。这保证了数据与我们的训练集无重叠，也使得一些训练截止时间更早的现有语言模型能够接受真正的零样本评测。我们发现，许多 rejected 故事的点赞数接近我们规定的 10 的下限，另有高赞故事构成的长尾。chosen 故事的最低点赞数为 14，这是因为我们决定修剪点赞差低于 chosen 响应 25% 的成对样例。这些分布见图 3。训练集由 50,309 篇唯一故事组成，用于构成 43,827 个成对样例。其分布在故事长度与点赞分布上与测试集相似，但训练集中的故事严格早于 2023 年。绝大多数故事发布于 2014 至 2022 年间。我们通过在第 5 节比较分别在其上训练的奖励模型，证实了标注训练集的质量确实高于原始集合。

图 3（原文图像见 PDF）：LitBench 测试集与训练集的字数、日期和点赞分布。

### 3.4 "chosen" 样本的定性分析

"获胜"的写作样本有何特征？为对此作定性判断，我们阅读并标注了 LitBench 的 50 个成对写作样本。我们的观察如下。故事为何获胜？受偏好的故事常含有出人意料的反转或令人惊奇的幽默；我们读到许多巧妙的笑点与文字游戏。例如，我们读到一位暴君女王不靠武力、而以荒诞的礼貌赢得反对派的故事，颠覆了读者的预期。另一篇讲述了一个女人与她那位名叫 "Decimator" 的强大俘获者的故事。该故事玩转黑暗主题，其幽默在出格与粗俗之间游走，逗乐了我们（也逗乐了 Reddit 用户！）故事为何落败？虽然有些故事难以分出高下，但许多故事显得干瘪、缺乏情感特质。我们发现一些故事因叙事混乱或用词怪异而令人难以读毕。一篇角色过多的科幻故事令我们困惑：有一个带着"芯片"的"era-model"士兵、一位名叫 "Gabby" 的女子、一只变形怪物等等——对短篇而言角色太多；更不必说读者还要面对急速切换的叙事视角。值得注意的是，语法错误与叙事不连贯虽偶见于落败样本，但通常并非其共性特征。

## 4 训练与评测协议

我们评测多种验证方法，包括零样本 Bradley-Terry 判别式奖励模型，以及带与不带思维链生成的生成式奖励模型 [Wei et al., 2022]。

**Bradley-Terry 判别式奖励模型** 我们使用 Bradley-Terry（BT）公式 [Bradley and Terry, 1952] 训练判别式奖励模型：对成对中的每个写作样本独立打分，并训练模型为受偏好的样本赋予更高奖励。给定奖励分数 r_chosen 与 r_rejected，损失定义为：

L_BT = − log σ「？」(r_chosen − r_rejected)

以促使更好与更差的样本之间拉开差距。我们在基模型的最后隐状态之后附加一个线性层，然后微调整个组合回归模型的全部权重。准确率按 r_chosen > r_rejected 的情形所占的百分比计算。

**生成式奖励模型** 生成式奖励模型已被证明在数学与代码领域表现良好，尤其是对分布外数据（[Mahan et al., 2024]；[Zhang et al., 2024]）。生成式验证器将分类视为自回归生成：在指令微调模型之上，对其预测进行带交叉熵损失的监督微调。思维链（CoT）也可纳入该过程，即对位于预测之前、描述随后预测的思维链进行微调。此处我们训练两个版本的生成式奖励模型（GenRM）：(1) GenRM——预测 "A" 与 "B" 之间哪个单一 token 将被选中；(2) GenRM-CoT——先推理再选择受偏好的故事，推理系用 GPT-4.1 生成的理由蒸馏而来。测试时，我们随机交换 chosen 与 rejected 故事在选项 A 与 B 之间的位置以避免位置偏差，GenRM 的判定在 temperature=0 下以单次采样收集。

**零样本 LLM 评判器** 现成 LLM 评判器被给予未标注的故事 A 与 B，并被要求就成对样本给出表示其偏好的判定（例如 "A" 或 "B"）。特别地，我们指示评判器在生成判定之前先形成解释。为应对 LLM 评判器已知的位置偏差 [Ye et al., 2024]，我们取两组位置排列成对的平均表现。我们通过在从训练集采样的验证集上进行选择，确定了 LLM-as-judge 模板提示——其中指定了评测标准与输出格式——即在五个手工构造的提示中选出精确度最高者。我们选择不使用自动提示优化工具（如 TextGrad [Yuksekgonul et al., 2025]），因为我们观察到这些方法得到的提示性能更差。关于提示优化、提示模板与响应结构的进一步讨论，参见 7）。我们将该评判器方法应用于一组最先进的专有与开源 LLM，其结果作为基线展示于图 6 与图 4。

## 5 结果与分析

本工作的动机源于这样一个前提：创意、开放式领域中的验证可以通过学习型奖励模型来实现。基于该动机我们提供 LitBench，并通过以下方式论证其效用：

- 通过对训练所得的奖励模型进行基准测试来验证数据集的构建，并通过在线研究证明奖励模型的普适性。
- 刻画用于验证人类写作的基于 LLM 的方法，比较跨模型的表现并分析其推理文本。

**BT 与生成式奖励模型优于零样本 LLM** 图 4 给出了奖励模型的对比表现。在 LitBench 训练集上微调的最佳 Bradley-Terry 奖励模型（Llama-8B）达到 78% 的与人类一致率，略超最佳的生成式验证器（GenRM-Qwen）。GenRM 与 BT 奖励模型均显著优于最强的零样本评判器（Claude-3.7-Sonnet，73%）。有趣的是，为 GenRM 加入思维链推理会使准确率降至 72%，这说明显式的顺序推理虽然在数学与代码任务中有益，在评判叙事质量时却会引入文本噪声。零样本表现随骨干模型规模的变化难以预测：SoTA 的 OpenAI、Anthropic 与 Deepseek 模型处于 70% 档，而较小的开源模型徘徊在略高于随机的水平（56–60%）。这些结果强调：就创意写作评测而言，针对性的偏好微调比参数量更具决定性，且判别式目标仍是该领域最可靠的选择。

图 4（原文图像见 PDF）：在 LitBench 上，训练所得验证器优于零样本 LLM 评判器。Claude-3.7-Sonnet 是最强的零样本模型。BT 验证器与 GenRM 相当，但带 CoT 的 GenRM 表现更差。Qwen、Llama 与 Gemma 骨干模型的规模分别为 7B、8B 与 12B。

**推理会降低判定准确率** 尽管 CoT 式的性能提升总体上很成功（如 2.1 节所述），此处 CoT 实际上损害了奖励模型的性能。为考察这一点，我们对评判模型生成的解释文本计算统计量，并将这些特征与判定准确率做相关分析。受创意写作教学法的启发 [Sellers, 2021]，我们在图 5 中呈现对判定准确率最具预测力的特征。在所有模型中，对情节的讨论最能预测正确性（尤其在 Anthropic 模型中），与所有模型中 +14.8% 的更高正确率相关。然而，解释文本的大多数特征与随后的判定准确率关系甚微。

图 5（原文图像见 PDF）：影响判定准确率的解释文本特质。

**性能随奖励模型类型差异化扩展** 图 6 显示，随着模型规模增大，各类奖励模型的性能提升幅度各不相同。GemRM-CoT「？」在 Llama 与 Qwen 骨干的小模型规模上起点较低，但稳步提升至 74%。而无 CoT 的 GenRM 在各模型规模上均无显著提升，表明可以使用小得多的模型（1B 或 1.5B）获得相近的性能。Bradley-Terry 模型的性能因骨干不同而存在明显差异，尤其是在较小的模型（1B/1.5B 与 3B）上。对零样本评判器，我们观察到类似效应：性能随规模增大而有实质提升。

图 6（原文图像见 PDF）：不同类型奖励模型（RM）的与人类一致率随模型规模的提升不一致。

**验证数据过滤方法** 我们进一步验证筛选流程：在不同过滤策略产出的数据集上训练消融 BT 奖励模型，并在去偏的 LitBench 测试集上评测。我们构造了原始训练集的轻过滤版本，仅移除包含点赞数少于 10 的故事的配对，以及基于点赞差的配对，得到 395k 对。我们还构造了按时间戳与点赞差配对的未过滤版本，得到 1.03M 对。我们在这些数据集上训练以 Llama-3.2-1B 为骨干的 BT 奖励模型。尽管样例数量显著更多，我们发现：不按时间戳配对时，在 LitBench 上的性能在低得多的水平（65%）即告饱和。去掉我们的长度过滤后，我们发现性能在 70% 饱和，但同时也发现该奖励模型存在长度偏差，在多数情况下强烈偏好两篇故事中较长的那篇。该实验结果见图 7。

图 7（原文图像见 PDF）：朴素点赞配对、朴素时间戳加点赞配对在比 LitBench 训练集更低的准确率上饱和。仅用朴素时间戳与点赞配对会产生长度有偏的验证器。所有模型均为在 Llama-1B 骨干上微调的 BT 奖励模型。

**人类实验** 我们使用 GPT-4.1 与 GPT-4o 从 40 个 LitBench 提示各生成 64 篇故事，然后用我们基于 Llama-8B 的 Bradley-Terry 奖励模型对其进行排序。在一项有 46 名美/英众包工作者（每对 10–13 名标注者）参与的在线人类研究中，我们评测了人类与奖励模型就每个提示所选最佳与最差故事的一致性。图 8 表明，标注者在 57% 的情况下选择了奖励模型偏好的故事，而选择被拒故事的比例为 41%，超过了表现处于随机水平的最佳 LLM 评判器（Claude-3.7-Sonnet）。这些结果证实，基于 Reddit 标签的偏好微调能够泛化到全新的创意写作提示，但 40% 的分歧率也表明仍有巨大提升空间——更丰富的监督信号（如基于评分量规的反馈或理由蒸馏）有望使自动奖励进一步对齐人类的文学品味。

图 8（原文图像见 PDF）：人类偏好与奖励模型在生成写作配对上的一致性。

## 6 讨论

本工作表明，最强的现成 LLM 评判器在创意写作评测上已开始接近微调的领域专用模型的性能。因此，在缺乏昂贵人类偏好数据的情况下，专有 LLM 评判器似乎是训练验证器的可行替代。当训练数据可用时，GenRM 在不同基模型与规模上最为稳定准确。我们的结果也令人对使用思维链训练 GenRM 的做法产生疑问。最后，我们的人工评测表明，在 LitBench 上的性能可泛化到对新生成 LLM 故事的评测，这提示未来工作或许可以利用强验证器来提升潜在的创意写作生成能力。

## 7 局限性

本工作的一个关键局限源自承自 [Ethayarajh et al., 2023] 的假设：Reddit 上的点赞包含关于人类偏好的信息。虽然我们通过人工评测对数据集做了实验性验证，但点赞信息中可能还编码了哪些其他潜在因素仍不清楚。例如，[Kassaeyan, 2016] 报告称，在社交网络上给帖子点赞的决策至少部分由个人与社会机制驱动，包括个性化（individuation）、感知行为控制（perceived behavioral control）与利他主义。

我们将人类偏好延伸为写作质量判断的做法，还因写作评测中的主观性问题而更加复杂。已有研究表明，写作的可测特征如何在总体上与人类评分相关 [Zedelius et al., 2019, McNamara et al., 2010]。此外，关于课堂情境下公平写作评价的著作为写作的客观性确立了先例 [Weigle, 2002]。

Elam [2023] 认为人工生成的写作通过呈现历史上并不真实发生的现实与语境而"使意义变得无意义"（"renders meaning senseless"）。类似地，我们的验证器也受限于其与真实个体人类经验的疏离——而正是这些经验为一切创意写作奠基。我们承认，任何自动化质量验证器都无法完全捕捉任意文本在真实世界情境中的社会价值，我们对任何与之相反的暗示表示遗憾。我们的数据来自 Reddit，据报道其人口统计特征偏向男性、受过教育且中年的人群 [Duarte, 2025, Agrawal, 2016]。归根结底，我们的基准与配套数据集反映的是这些群体的共识偏好。

## 附录 A

### A.1 LLM-as-judge 原始结果

| 模型 | Acc（Jan23 测试集） | 平均解释长度（Avg. Expl. Len.） |
|---|---|---|
| claude-3-5-haiku | 0.675 | 292.4 |
| claude-3-7-sonnet | 0.731 | 280.2 |
| gpt-4.1 | 0.702 | 202.3 |
| gpt-4.1-mini | 0.630 | 246.7 |
| o4-mini | 0.700 | 131.5 |
| deepseek-v3 | 0.700 | 167.4 |
| deepseek-r1 | 0.710 | 142.8 |
| gemma-3-12b-it | 0.657 | 497.0 |
| llama-3.1-8b | 0.581 | 332.0 |
| qwen-2.5-7b | 0.599 | 174.0 |

表 1：各模型在 LitBench 上的 LLM-as-a-judge 评测结果。

### A.2 LLM-as-judge 提示优化

**动机。** 我们希望让开箱即用的 LLM 评测器在该基准上有尽可能准确的发挥。已有研究表明，基于 LLM 的评判器对提示内容极其敏感 (CITE)。在本实验设定中，提示可以 (a) 引入供评判器推断判定时使用的标准，(b) 指定输出格式以确保结果易于解析。**策略。** 有许多提示优化库可以自动对提示文本"求导"，以提升在给定评测指标上的准确率。然而，在对这些工具进行一些尝试之后，我们选择采用自行设计的方法来优化提示，遵循以下路径。

**目标**：为每个模型家族（如 Llama）选择一个优化后的提示。**优化方法。**

1. 手工构造六个"模板"提示，各自引入供评判器生成判定时使用的不同标准。
2. 统一输出格式：对大型指令微调模型请求 JSON 对象；对较小的模型请求纯文本。
3. 为每个家族使用一个中档模型，用在从训练集抽取的验证集（n = 500）上评估每个提示，以避免偏差。
4. 按家族采纳准确率最高的提示。
5. 依据模型规模与遵循指令的能力，附加标准化的输出格式指令。

### A.3 提示模板

以下提示模板保留英文原文。

#### 1. 作家式标准（Writer-ly Criteria）

```text
You're evaluating creative writing responses A and B.
Compare them based on these dimensions:

- Imagery: vivid descriptions and sensory details
- Tension: dramatic interest and conflict
- Pattern: structural elements and composition
- Energy: engaging style and dynamic writing
- Insight: meaningful ideas and depth

IMPORTANT: Your answer MUST use EXACTLY this format:
Reasoning: [brief comparison]
Preferred: [A or B] (state which one is better)

Example format:
Reasoning: Response B has stronger imagery and tension.
Preferred: B
```

#### 2. 备选标准（Alternative Criteria）

```text
Evaluate creative writing responses A and B. Consider these aspects:

- Originality: unique concepts, unexpected elements
- Imagery: sensory language and descriptions
- Emotional impact: how the writing affects the reader
- Coherence: logical flow and narrative structure
- Technical skill: language use and style

FORMAT REQUIRED:
Reasoning: [your evaluation]
Preferred: [A or B]
```

#### 3. 最简指令（Minimal Instruction）

```text
Compare responses A and B for creative writing quality. MUST follow this format:
Reasoning: [brief analysis]
Preferred: [A or B]
```

#### 4. Reddit 最简版（Reddit-Minimal）

```text
You are evaluating two creative writing responses (A and B) to the same writing prompt.
Your task is to predict which response would receive more upvotes from the Reddit community.
Your verdict MUST follow this exact format:
Reasoning: [explain which response would likely get more Reddit upvotes and why]
Preferred: [A or B] (the one you predict would get more upvotes)
```

#### 5. Reddit 详尽版（Reddit-Verbose）

```text
You are evaluating two creative writing responses (A and B) to the same writing prompt. These responses are similar to those posted on Reddit writing subreddits like r/WritingPrompts.

Your task is to predict which response would receive more upvotes from the Reddit community. Reddit users typically upvote creative writing that is engaging, original, well-written, and emotionally resonant.

When making your prediction, consider what makes content popular on Reddit:
- Originality and uniqueness of ideas
- Engaging narrative style and pacing
- Emotional impact and relatability
- Clever twists or satisfying conclusions
- Technical quality of writing

This is an experiment to test how well language models can predict human preferences in creative writing as expressed through Reddit's voting system.

Your verdict MUST follow this exact format:
Reasoning: [explain which response would likely get more Reddit upvotes and why]
Preferred: [A or B] (the one you predict would get more upvotes)
```

#### 6. Reddit 详尽排列版（Reddit-Verbose Permuted）

```text
You are tasked with evaluating two creative writing responses (A and B) to the same prompt. Your goal is to predict which response would garner more upvotes from the Reddit community, specifically in writing subreddits like r/WritingPrompts.

Consider the following key dimensions for your evaluation:
- Creativity and Originality: How unique are the ideas presented?
- Narrative Engagement: Is the storytelling captivating and immersive?
- Emotional Resonance: Does the piece evoke feelings or relatable experiences?
- Surprise and Satisfaction: Are there clever twists or fulfilling conclusions?
- Writing Quality: Is the grammar, style, and structure polished?

Your output must strictly follow this format:
1. Reasoning: [Explain which response is likely to receive more Reddit upvotes, citing specific strengths and weaknesses.]
2. Preferred: [A or B]

Be concise and clear in your assessment, adhering to the format above.
```

## 附录 B 数据集许可与访问

所有数据均可通过 Hugging Face 上的 SAA-Lab/LitBench 合集公开访问。使用该数据集的代码可在 GitHub 上获取。

我们训练集的内容取自 Hugging Face 上采用 MIT 许可证的 euclaise/WritingPrompts_preferences。在测试集中，我们发布了 3.5k 条来自 r/WritingPrompts 的 Reddit 评论的 id，以及从 Reddit API 重新获取（rehydrate）数据的代码。我们承认 Reddit 用户保留对其个人评论的版权，我们不主张对该内容的所有权，也不对其进行再许可。我们在本次发布之前联系了 Reddit，以澄清其 API 条款下的可接受使用方式。截至提交之时，我们尚未收到回复。

## 附录 C 计算资源使用

所有训练与评测均在我们的内部集群上完成，所用节点配备 128 个 CPU 核心、8 块各含 48GB 显存的 NVIDIA A40 GPU，以及总计 732GB 的系统内存。训练验证器的耗时从 1B 参数模型的 3 小时不等，最长可达 8B 参数模型的一天。包括失败的运行、数据消融以及 LLM-as-judge 的生成在内，总计算量估计为 NVIDIA A40 上的 500 GPU 小时。

## 附录 D 训练超参数

在所有训练运行中，我们使用 128 个样例的有效批大小（effective batch size）、1e-5 的学习率以及 10% 的预热比例（warmup ratio）。我们以 bfloat16 精度训练，并使用 AdamW 作为优化器。

---

## 参考文献（原文）

Abhinav Agrawal. The user demographics of reddit: The official app. https://medium.com/@sm_app_intel/the-user-demographics-of-reddit-the-official-app-7e2e18b1e0e1, December 2016. Accessed: 2025-05-06.

Danial Alihosseini, Ehsan Montahaei, and Mahdieh Soleymani Baghshah. Jointly measuring diversity and quality in text generation models. In Proceedings of the Workshop on Methods for Optimizing and Evaluating Neural Language Generation, pages 90–98, Minneapolis, MN, 2019. Association for Computational Linguistics. doi: 10.18653/v1/W19-2311. URL https://aclanthology.org/W19-2311.

Teresa M. Amabile. Social psychology of creativity: A consensual assessment technique. Journal of Personality and Social Psychology, 43(5):997–1013, 1982. doi: 10.1037/0022-3514.43.5.997.

Sher Badshah and Hassan Sajjad. Reference-guided verdict: Llms-as-judges in automatic evaluation of free-form text, 2024. URL https://arxiv.org/abs/2408.09235.

Yuntao Bai, Saurav Kadavath, Sandipan Kundu, Amanda Askell, Jackson Kernion, Andy Jones, Anna Chen, Anna Goldie, Azalia Mirhoseini, Cameron McKinnon, et al. Constitutional ai: Harmlessness from ai feedback. arXiv preprint arXiv:2212.08073, 2022.

Jacques Barzun. The cults of "research" and "creativity". Harper's Magazine, 221(1325):69–74, 1960. URL https://harpers.org/archive/1960/10/the-cults-of-research-and-creativity/.

Ralph Allan Bradley and Milton E Terry. Rank analysis of incomplete block designs: I. the method of paired comparisons. Biometrika, 39(3/4):324–345, 1952.

Dominic Callan and Jennifer Foster. How interesting and coherent are the stories generated by a large-scale neural language model? comparing human and automatic evaluations of machine-generated text. Expert Systems, 40(6):e13292, 2023. doi: 10.1111/exsy.13292. URL https://doi.org/10.1111/exsy.13292.

Tuhin Chakrabarty, Philippe Laban, Divyansh Agarwal, Smaranda Muresan, and Chien-Sheng Wu. Art or artifice? large language models and the false promise of creativity. In Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems, pages 1–34, 2024.

John Joon Young Chung, Vishakh Padmakumar, Melissa Roemmele, Yuqian Sun, and Max Kreminski. Modifying large language model post-training for diverse creative writing, 2025. URL https://arxiv.org/abs/2503.17126.

Karl Cobbe, Vineet Kosaraju, Mohammad Bavarian, Mark Chen, Heewoo Jun, Lukasz Kaiser, Matthias Plappert, Jerry Tworek, Jacob Hilton, Reiichiro Nakano, Christopher Hesse, and John Schulman. Training verifiers to solve math word problems. arXiv preprint arXiv:2110.14168, 2021.

Caia Costello, Simon Guo, Anna Goldie, and Azalia Mirhoseini. Think, prune, train, improve: Scaling reasoning without scaling models, 2025. URL https://arxiv.org/abs/2504.18116.

Fabio Duarte. Reddit user age, gender, & demographics (2025). https://explodingtopics.com/blog/reddit-users, May 2025. Accessed: 2025-05-06.

Michele Elam. Poetry will not optimize; or, what is literature to ai? American literature, 95(2):281–303, 2023.

Kawin Ethayarajh, Yejin Choi, and Swabha Swayamdipta. Understanding dataset difficulty with V-usable information. arXiv preprint arXiv:2110.08420, 2022a. URL https://arxiv.org/abs/2110.08420.

Kawin Ethayarajh, Yejin Choi, and Swabha Swayamdipta. Understanding dataset difficulty with V-usable information. In Kamalika Chaudhuri, Stefanie Jegelka, Le Song, Csaba Szepesvari, Gang Niu, and Sivan Sabato, editors, Proceedings of the 39th International Conference on Machine Learning, volume 162 of Proceedings of Machine Learning Research, pages 5988–6008. PMLR, 17–23 Jul 2022b.

Kawin Ethayarajh, Heidi Zhang, Yizhong Wang, and Dan Jurafsky. Stanford human preferences dataset, 2023.

Angela Fan, Mike Lewis, and Yann Dauphin. Hierarchical neural story generation. arXiv preprint arXiv:1805.04833, 2018a. URL https://arxiv.org/abs/1805.04833.

Angela Fan, Mike Lewis, and Yann Dauphin. Hierarchical neural story generation, 2018b. URL https://arxiv.org/abs/1805.04833.

Benjamin Feuer, Micah Goldblum, Teresa Datta, Sanjana Nambiar, Raz Besaleli, Samuel Dooley, Max Cembalest, and John P. Dickerson. Style outweighs substance: Failure modes of llm judges in alignment benchmarking, 2025. URL https://arxiv.org/abs/2409.15268.

Bofei Gao, Feifan Song, Zhe Yang, Zefan Cai, Yibo Miao, Qingxiu Dong, Lei Li, Chenghao Ma, Liang Chen, Runxin Xu, et al. Omni-math: A universal olympiad level mathematic benchmark for large language models. arXiv preprint arXiv:2410.07985, 2024.

Dan Hendrycks, Collin Burns, Saurav Kadavath, Akul Arora, Steven Basart, Eric Tang, Dawn Song, and Jacob Steinhardt. Measuring mathematical problem solving with the math dataset. arXiv preprint arXiv:2103.03874, 2021.

Carlos E Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexi Pei, Ofir Press, and Karthik Narasimhan. Swe-bench: Can language models resolve real-world github issues? arXiv preprint arXiv:2310.06770, 2023.

Kasra Kassaeyan. Factors Affecting Upvoting Intention on Social Bookmarking Sites. PhD thesis, Luleå tekniska universitet, 2016.

Jianing Li, Yanyan Lan, Jiafeng Guo, and Xueqi Cheng. On the relation between quality–diversity evaluation and distribution-fitting goal in text generation. In Proceedings of the 37th International Conference on Machine Learning, pages 5927–5937. PMLR, 2020. URL https://proceedings.mlr.press/v119/li20h.html.

Ruizhe Li, Chiwei Zhu, Benfeng Xu, Xiaorui Wang, and Zhendong Mao. Automated creativity evaluation for large language models: A reference-based approach, 2025. URL https://arxiv.org/abs/2504.15784.

Yang Liu, Jonas Schneider, Jonathan Raiman, Ian Tenney, Nitish Gupta, Diya Raghu, Douwe Kiela, and Lazaros Polymenakos. G-eval: Nlg evaluation using gpt-4 with better human alignment. arXiv preprint arXiv:2303.16634, 2023. URL https://arxiv.org/abs/2303.16634.

Dakota Mahan, Duy Van Phung, Rafael Rafailov, Chase Blagden, Nathan Lile, Louis Castricato, Jan-Philipp Fränken, Chelsea Finn, and Alon Albalak. Generative reward models. arXiv preprint arXiv:2410.12832, 2024.

Rebecca Manery. The Education of the Creative Writing Teacher: A Study of Conceptions of Creative Writing Pedagogy in Higher Education. PhD thesis, University of Michigan, 2016. URL https://deepblue.lib.umich.edu/handle/2027.42/133407.

Danielle S McNamara, Scott A Crossley, and Philip M McCarthy. Linguistic features of writing quality. Written communication, 27(1):57–86, 2010.

Ponrudee Netisopakul and Usanisa Taoto. Comparison of evaluation metrics for short story generation. IEEE Access, 11:140253–140269, 2023.

Long Ouyang, Jeff Wu, Xu Jiang, Diogo Almeida, Carroll L. Wainwright, Pamela Mishkin, Chong Zhang, Sandhini Agarwal, Katarina Slama, Alex Ray, John Schulman, Jacob Hilton, Fraser Kelton, Luke Miller, Maddie Simens, Amanda Askell, Peter Welinder, Paul Christiano, Jan Leike, and Ryan Lowe. Training language models to follow instructions with human feedback, 2022. URL https://arxiv.org/abs/2203.02155.

Jiayi Pan, Xingyao Wang, Graham Neubig, Navdeep Jaitly, Heng Ji, Alane Suhr, and Yizhe Zhang. Training software engineering agents and verifiers with swe-gym. arXiv preprint arXiv:2412.21139, 2024.

Mel Rhodes. An analysis of creativity. Phi Delta Kappan, 42(7):305–310, 1961. URL https://www.jstor.org/stable/20342603.

Heather Sellers. The Practice of Creative Writing: A Guide for Students. Bedford/St. Martin's (Macmillan Learning), New York, NY, 4 edition, 2021. ISBN 9781319215958. URL https://store.macmillanlearning.com/us/product/The-Practice-of-Creative-Writing/p/1319215955.

Guijin Son, Hyunwoo Ko, Hoyoung Lee, Yewon Kim, and Seunghyeok Hong. Llm-as-a-judge and reward model: What they can and cannot do, 2024. URL https://arxiv.org/abs/2409.11239.

Nisan Stiennon, Long Ouyang, Jeff Wu, Daniel M. Ziegler, Ryan Lowe, Chelsea Voss, Alec Radford, Dario Amodei, and Paul Christiano. Learning to summarize from human feedback. arXiv preprint arXiv:2009.01325, 2020. URL https://arxiv.org/abs/2009.01325.

Peiyi Wang, Lei Li, Liang Chen, Zefan Cai, Dawei Zhu, Binghuai Lin, Yunbo Cao, Qi Liu, Tianyu Liu, and Zhifang Sui. Large language models are not fair evaluators, 2023. URL https://arxiv.org/abs/2305.17926.

Hui Wei, Shenghua He, Tian Xia, Fei Liu, Andy Wong, Jingyang Lin, and Mei Han. Systematic evaluation of llm-as-a-judge in llm alignment tasks: Explainable metrics and diverse prompt templates, 2025. URL https://arxiv.org/abs/2408.13006.

Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma, Brian Ichter, Fei Xia, Ed H. Chi, Quoc V. Le, and Denny Zhou. Chain-of-thought prompting elicits reasoning in large language models. arXiv preprint arXiv:2201.11903, 2022. URL https://arxiv.org/abs/2201.11903.

Sara Cushing Weigle. Assessing Writing. Cambridge University Press, Cambridge, 2002. doi: 10.1017/CBO9780511732997.

Jiayi Ye, Yanbo Wang, Yue Huang, Dongping Chen, Qihui Zhang, Nuno Moniz, Tian Gao, Werner Geyer, Chao Huang, Pin-Yu Chen, Nitesh V Chawla, and Xiangliang Zhang. Justice or prejudice? quantifying biases in llm-as-a-judge. arXiv preprint arXiv:2410.02736, 2024.

Mert Yuksekgonul et al. Optimizing generative ai by backpropagating language model feedback. Nature, 639:609–616, 2025. URL https://www.nature.com/articles/s41586-025-08661-4.

Claire M Zedelius, Caitlin Mills, and Jonathan W Schooler. Beyond subjective judgments: Predicting evaluations of creative writing from computational linguistic features. Behavior research methods, 51:879–894, 2019.

Eric Zelikman, Yuhuai Wu, Jesse Mu, and Noah D Goodman. Star: Self-taught reasoner bootstrapping reasoning with reasoning. In Proc. the 36th International Conference on Neural Information Processing Systems, volume 1126, 2024.

Lunjun Zhang, Arian Hosseini, Hritik Bansal, Mehran Kazemi, Aviral Kumar, and Rishabh Agarwal. Generative verifiers: Reward modeling as next-token prediction. arXiv preprint arXiv:2408.15240, 2024.

Lianmin Zheng et al. Judging llm-as-a-judge with mt-bench and chatbot arena. arXiv preprint arXiv:2306.05685, 2023. URL https://arxiv.org/abs/2306.05685.
