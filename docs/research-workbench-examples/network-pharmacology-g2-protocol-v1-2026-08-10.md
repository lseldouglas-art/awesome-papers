# 网络药理学方法质量、验证链与可重复性｜G2 Protocol v1

> 状态：`candidate_ready_for_human_G2_signoff`  
> 研究类型：PubMed 限定的方法学范围综述 + 内嵌分层随机抽样的元研究审计  
> 适用范围：2018-01-01 至正式末次检索日；历史里程碑可定向纳入  
> 继承边界：`PubMed-only methodological orientation`；本方案不是多数据库系统综述，也不支持跨语种穷尽、领域路线占比、临床疗效或全球范式转移的定量结论。

## 1. G2 推荐决定

采用一套**双证据通道**方案。M 通道全量识别方法学、规范、数据库比较与批判性研究；A 通道从 17,528 条 PubMed 母集按时期分层随机抽取应用研究，既保留纯计算和弱验证论文，也保留强闭环论文，用来避免只筛“高证据信号”造成的 spectrum bias。E（药物实体/暴露）、O（疾病情境）、C（结合/占有/功能介导信号）不再是三个互斥文献库，而是 A 通道的非互斥抽取域；它们的定向检索只用于补充稀有强机制案例，永远不进入实践比例的分母。

该方案适合当前用户已经批准的 PubMed-only 范围，可生成透明、可复核的**方法学证据地图**。若目标改为投稿时声称“完整范围综述”，应回到 G1 增加至少一个互补数据库并接受信息专家的 PRESS 审核；JBI 的范围综述方法建议在资源允许时尽可能全面检索，并明确披露任何覆盖限制。[JBI Scoping Review Manual](https://jbi-global.atlassian.net/wiki/spaces/MANUAL/pages/355862497/10.%2BScoping%2Breviews)

## 2. 题目与研究问题

### 中文题目

**从数据库关联到暴露—靶点—表型闭环：2018—2026 年网络药理学方法质量、验证链与可重复性的 PubMed 限定范围综述及元研究审计方案**

### English title

**From database associations to exposure–target–phenotype closure: a protocol for a PubMed-restricted methodological scoping review with a stratified meta-research audit of network pharmacology, 2018–2026**

### 主问题

在 2018 年至末次检索日的 PubMed 文献中，网络药理学方法证据与随机抽样的应用实践如何报告并检验数据来源、数据库和算法选择、可重复性与生物学验证；哪些设计特征能够把数据库关联升级为受药物暴露和疾病情境约束、可被因果实验反驳的机制证据？

### 子问题

1. 数据库覆盖、实体映射、聚合规则、网络算法与参数怎样改变候选靶点和解释？
2. 文献把哪些操作称为“验证”，它们分别只能支持 E0—E5 证据阶梯中的哪一级主张？
3. bottom-up、top-down 与 middle-out 三种分析起点如何被稳定判定；哪些研究只是技术叠加，哪些真正形成药物侧、疾病侧与功能验证的会合？
4. 多组学、单细胞、AI 和 QSP 在增加情境、剂量或时间信息时解决了什么，又留下哪些偏倚、复现和转化缺口？

问题保持中性：`middle-out` 是评价框架与未来设计原则，不预设它已经成为主流或必然优于其他路线。2018—2025 可做 PubMed 限定、抽样误差可见的时期比较；2026 只作为截至末次检索日的不完整年度快照，不与完整年度直接比较。

## 3. 方法学依据与报告标准

- 按 JBI 范围综述方法形成预先方案、PCC、纳排标准、检索、双人筛选、数据 charting、描述性分析和偏离记录。[JBI protocol guidance](https://jbi-global.atlassian.net/wiki/spaces/MANUAL/pages/355862619/10.2%2BDevelopment%2Bof%2Ba%2Bscoping%2Breview%2Bprotocol)
- 最终报告按 PRISMA-ScR 的 20 个必需项和 2 个可选项呈现，检索细节另按 PRISMA-S 的 16 项报告；Protocol 在正式筛选前注册到 OSF 或等价时间戳仓库。[PRISMA-ScR](https://www.prisma-statement.org/scoping) [PRISMA-S](https://www.prisma-statement.org/prisma-search)
- 网络药理学专属报告审计参考《网络药理学评价方法指南 SCM 0061-2021》，但把“报告是否完整”和“机制证据是否强”作为两个独立维度，禁止合并成一个含义不清的总分。
- 本范围综述只做证据特征映射和框架分析，不做疗效 Meta 分析，也不把来源中的结果合成为临床建议。

## 4. PCC 与分析单元

| 元素 | 本方案定义 |
|---|---|
| Population / Problem | PubMed 收录且明确把 network pharmacology / network-based pharmacology 作为实质方法的方法研究与应用研究；规范性文件另作背景层 |
| Concept | 数据谱系、数据库/算法敏感性、报告完整性、可重复性、验证类型、E0—E5 证据组件、bottom-up/top-down/middle-out 会合程度 |
| Context | 全球药物发现、天然产物、民族药和中医药；不限疾病、国家或语言。QSP/网络医学只作清楚标记的相邻背景，不进入网络药理学实践分母 |
| 分析单元 | 以研究家族而非单条 PMID 为主；预印本与期刊版保留 lineage，定量描述只计首选正式版本一次 |

时间边界：2018—2025 是完整年度分析集；2026 只作为截至末次检索日的索引快照；2018 年以前的里程碑只用于引言背景，不进入纳排、流程图或任何分母。

## 5. 纳入与排除标准

### 5.1 纳入

主分析语料须由 PubMed 检得、发表于 2018-01-01 至末次检索日，并进入以下一个证据通道：

1. **M｜方法与规范证据：**方法评价、数据库/算法比较、benchmark、偏倚或同质化分析、复现协议、报告规范、具有明确方法学贡献的平台论文或批判性综述。内部继续区分“具有 ground truth/比较/性能数据的实证方法证据”和“指南、观点、清单等规范性证据”；规范文件不能证明实际采用率。
2. **A｜应用实践审计：**原始研究实质执行网络药理学，用于生成、排序或检验药物—靶点—疾病关系。无论是纯计算、弱验证、负结果、结论过强还是强闭环研究均可纳入；不得按 E/O/C 信号决定 A 通道的纳入。

E（药物实体与暴露信号）、O（疾病组学/单细胞情境）和 C（结合/占有与功能介导）是 A 通道的非互斥抽取组件。E 命中的计算 ADME/PK 预测与实测血液、组织或 PK 证据必须分开编码；C 命中的结合、细胞占有、浓度关系、靶点扰动和救援也必须分组件解释。E/O/C 定向检索可补充罕见强机制案例，但这些补充案例单列为 `case_enrichment`，不能进入应用实践的比例或时期变化分母。

检索不设语言限制；团队可处理中文和英文全文。其他语言全文若无法可靠翻译，保留在未获取/待判定清单并报告原因，不以“无证据”处理。PubMed 之外发现的官方指南或历史里程碑可进入 `contextual_standard` 背景层，但不计入主分析、PRISMA 流程或 PubMed 实践分母。

### 5.2 排除

- 与药物作用或靶点发现无关的社会网络、共现网络、生态网络和网络 Meta 分析。
- 只在背景中提及网络药理学、实际未执行网络药理学任务的记录。
- 纯网络医学、纯 QSP 或纯疗效研究，且没有执行药物—靶点—疾病网络分析的记录。
- 对 M 通道而言，仅复述“网络药理学可解释多成分多靶点”而不提供方法、数据、规范或验证贡献的泛综述；这不影响符合 A 通道定义的纯计算应用被纳入实践审计。
- 未能获得足够元数据来判断研究对象和方法的记录；此类记录进入“未解决”附录，不计作科学排除。
- 重复发表的非首选版本；保留版本关系，不重复计数。
- 已撤稿研究从科学综合中排除，但保留检索流程、撤稿状态和排除原因。

## 6. 检索架构与 G2 可行性校准

### 6.1 状态声明

当前权威输入是 `NP-G1-20260810-v8` 与 `NP-G1-LIB-002`：它们记录用户已批准 PubMed-only 范围、G1 范围内完成且允许进入 G2。较早的 `CAL-003` 和 `network-pharmacology-g1-completion-checkpoint-v1` 仍写着 Scopus/CNKI 阻塞，它们只是用户“忽略这两个”之前的历史快照，不再决定当前 Gate。

G1 已冻结的方法标题检索得到 51 条记录、50 个研究家族；它是方法候选校准库，不是正式综述的完整文献库。以下 G2 检索在 2026-08-10 通过 NCBI E-utilities 实际运行，仅用于 Protocol 可行性校准，状态为 `executed_pilot`，尚未完成去重、筛选或冻结。E/O/C 高度重叠，**计数不得相加**。

| ID | 目的 | 命中 |
|---|---|---:|
| NP-G2-A | 应用审计母集：network pharmacology / network-based pharmacology | 17,528 |
| NP-PM-02 | M 通道宽方法基线 | 183 |
| NP-G2-M2 | 高敏感相邻方法候选（初步题名审计仅 1/15 为明确方法研究） | 15 |
| NP-G2-E | case enrichment：药物实体/暴露信号（含预测性噪声） | 911 |
| NP-G2-O | case enrichment：扩展组学/单细胞情境 + 实验 | 2,329 |
| NP-G2-C | case enrichment：结合/占有/功能介导信号 | 2,455 |
| NP-G2-H | case enrichment：扩展 E 与 C 信号交集 | 108 |

NP-G2-M2 是高敏感补充式，不是 15 条方法证据：题名审计中仅 PMID 41800093 明确属于方法学评价，其余包含应用研究、network meta-analysis 及其他网络语义，均需按同一标准筛选。NP-G2-E 也不是“实测暴露库”：抽查可见计算 ADME/PK 预测，正式抽取必须区分 `predicted` 与 `measured`。NP-G2-C 同样只是高敏感信号式；`rescue` 可指线粒体等表型恢复，观察性研究也可报告 dose-response，均不能仅凭词命中编码为靶点因果。

NP-G2-H 只能用于寻找罕见闭环候选，不能作为应用实践入口：即使扩展因果词后，它仍未召回 PMID 39669203 这类报告了组织暴露和体内外验证、但摘要未使用预设因果词的校准案例；且该研究的暴露与表型跨物种，未核全文前不能认定 exposure–effect 已对齐。这个负召回结果证明应用实践必须来自母集概率抽样，而不能来自高证据信号富集。

### 6.2 A 通道分层随机抽样

1. 正式末次检索后导出 NP-G2-A 的全部 PMID 和元数据，先按 DOI、规范化题名、作者、年份、预印本/期刊版本关系形成研究家族母表。
2. 建立四个互斥时期层：2018—2020、2021—2023、2024—2025、2026 截至检索日。前三层各随机抽取 200 个研究家族；2026 抽取 100 个，仅作不完整年度描述。若某层不足目标量则全纳。
3. 在抽样前冻结每层家族数、完整随机排列、伪随机算法、软件版本和种子。种子由母集 manifest 的 SHA-256 预先派生，不能由研究者反复试到满意样本。
4. 固定样本不因验证强弱、全文可及性或结果方向而替换；未获取、非应用研究和排除理由仍保留。若名义样本全部属于目标应用总体，前三层每层 200 在最保守比例下约有 ±7 个百分点的 95% 抽样误差，2026 的 100 条约为 ±10 个百分点；这只是设计阶段上限。筛除非应用记录、未取得全文或出现其他失访后，最终区间必须按实际纳入的应用家族数、分层权重和有限总体修正重新计算，不得沿用名义精度。
5. A 通道使用分层权重报告比例、绝对时期差和 95% CI；2026 不进入完整年度主比较。E/O/C 补入案例及引用链补入案例从所有加权分母排除。
6. 路线占比默认仍被禁止；只有完成 A 通道全文双人编码、冻结派生规则并获得新的人工决定后，才可报告“PubMed 自我标识应用研究中的加权分布”，且不得外推全球领域占比。

#### A 通道估计量与缺失处理

- 目标量是各完整时期层中，符合 A 纳入定义的 PubMed 自我标识应用研究家族具备预设二元特征的比例。主估计使用分层简单随机不放回设计下的 Hájek 域比例：`p̂ = Σ(wᵢ Eᵢ Rᵢ Yᵢ) / Σ(wᵢ Eᵢ Rᵢ)`，其中 `wᵢ=N_h/n_h`，`Eᵢ` 为应用研究资格，`Rᵢ` 为该结局可判定，`Yᵢ` 为结局，`N_h/n_h` 分别为时期层母集与实际抽样家族数。
- 方差采用 Taylor 线性化并纳入分层及有限总体修正；比例的 95% CI 预设为 design-based logit CI，使用设计自由度的 t 分位数并截于 `[0,1]`。当事件为 0 或全为 1 时改用 survey beta interval；时期绝对差用同一设计对象的 Taylor 线性化 contrast 及 95% t CI。软件、包版本和完整分析代码在抽样冻结时保存。
- 非应用记录保留在流程图但不进入域分母；全文未获取或某结局无法判定者不编码为阴性、也不替换。主分析对该结局使用可判定家族，并同时报告 `Rᵢ=0` 的加权比例；关键结局另给“所有缺失为否/所有缺失为是”的识别界限。任一时期关键结局缺失超过 5% 时，再以预设元数据构建 response-propensity 加权敏感性分析，且不得替代主结果。

### 6.3 完整候选式

#### NP-G2-A｜应用审计母集

```text
("network pharmacology"[Title/Abstract]
OR "network-based pharmacology"[Title/Abstract])
AND ("2018/01/01"[Date - Publication] : "2026/08/10"[Date - Publication])
```

#### NP-PM-02｜M 通道宽方法基线

```text
(("network pharmacology"[Title] OR "network-based pharmacology"[Title])
AND (guideline*[Title/Abstract] OR standardization[Title/Abstract]
OR standardisation[Title/Abstract] OR reproducibility[Title/Abstract]
OR benchmark*[Title/Abstract] OR "database comparison"[Title/Abstract]
OR "methodological evaluation"[Title/Abstract]
OR "critical evaluation"[Title/Abstract]
OR bias[Title/Abstract] OR limitations[Title/Abstract]))
AND ("2018/01/01"[Date - Publication] : "2026/08/10"[Date - Publication])
```

#### NP-G2-M2｜相邻方法表述

```text
(("network analysis"[Title])
AND (ethnopharmacolog*[Title/Abstract] OR "herbal medicine"[Title/Abstract]
OR "traditional medicine"[Title/Abstract])
AND (methodolog*[Title/Abstract] OR bias*[Title/Abstract]
OR homogene*[Title/Abstract] OR reproducib*[Title/Abstract]
OR benchmark*[Title/Abstract] OR validation[Title/Abstract]))
AND ("2018/01/01"[Date - Publication] : "2026/08/10"[Date - Publication])
```

#### NP-G2-E｜药物实体与暴露信号

```text
(("network pharmacology"[Title/Abstract]
OR "network-based pharmacology"[Title/Abstract])
AND (pharmacokinetic*[Title/Abstract]
OR "serum pharmacochemistry"[Title/Abstract]
OR "plasma component*"[Title/Abstract]
OR "blood component*"[Title/Abstract]
OR "tissue distribution"[Title/Abstract]
OR "absorbed component*"[Title/Abstract]
OR "blood-absorbed component*"[Title/Abstract]
OR "blood absorbed component*"[Title/Abstract]
OR "plasma-absorbed component*"[Title/Abstract]
OR "plasma absorbed component*"[Title/Abstract]
OR "serum-derived component*"[Title/Abstract]
OR "serum derived component*"[Title/Abstract]
OR "prototype component*"[Title/Abstract]
OR "prototype constituent*"[Title/Abstract]
OR "in vivo constituent*"[Title/Abstract]
OR Cmax[Title/Abstract] OR "plasma concentration*"[Title/Abstract]
OR "brain penetration"[Title/Abstract] OR "target tissue"[Title/Abstract]))
AND ("2018/01/01"[Date - Publication] : "2026/08/10"[Date - Publication])
```

#### NP-G2-O｜疾病情境与实验

```text
(("network pharmacology"[Title/Abstract]
OR "network-based pharmacology"[Title/Abstract])
AND (transcriptomic*[Title/Abstract] OR proteomic*[Title/Abstract]
OR metabolomic*[Title/Abstract] OR lipidomic*[Title/Abstract]
OR phosphoproteomic*[Title/Abstract] OR multiomic*[Title/Abstract]
OR "multi-omic*"[Title/Abstract] OR "single-cell"[Title/Abstract]
OR "single cell"[Title/Abstract] OR "single-nucleus"[Title/Abstract]
OR "single nucleus"[Title/Abstract] OR "RNA-seq"[Title/Abstract]
OR RNAseq[Title/Abstract] OR "RNA sequencing"[Title/Abstract]
OR scRNA-seq[Title/Abstract] OR scRNAseq[Title/Abstract]
OR "spatial transcriptomic*"[Title/Abstract]
OR "spatial omic*"[Title/Abstract] OR epigenomic*[Title/Abstract]
OR proteogenomic*[Title/Abstract])
AND (experiment*[Title/Abstract] OR validation[Title/Abstract]
OR in vivo[Title/Abstract] OR in vitro[Title/Abstract]))
AND ("2018/01/01"[Date - Publication] : "2026/08/10"[Date - Publication])
```

#### NP-G2-C｜结合、占有与功能介导信号

```text
(("network pharmacology"[Title/Abstract]
OR "network-based pharmacology"[Title/Abstract])
AND ("target engagement"[Title/Abstract]
OR "target occupancy"[Title/Abstract]
OR "surface plasmon resonance"[Title/Abstract]
OR "biolayer interferometry"[Title/Abstract]
OR "bio-layer interferometry"[Title/Abstract]
OR "isothermal titration calorimetry"[Title/Abstract]
OR "microscale thermophoresis"[Title/Abstract]
OR "cellular thermal shift assay"[Title/Abstract]
OR "drug affinity responsive target stability"[Title/Abstract]
OR "thermal proteome profiling"[Title/Abstract]
OR chemoproteomic*[Title/Abstract] OR "pull-down"[Title/Abstract]
OR "pull down"[Title/Abstract] OR CETSA[Title/Abstract] OR DARTS[Title/Abstract]
OR knockdown[Title/Abstract] OR knockout[Title/Abstract] OR "knock out"[Title/Abstract]
OR "gene silencing"[Title/Abstract] OR siRNA[Title/Abstract]
OR shRNA[Title/Abstract] OR RNAi[Title/Abstract] OR CRISPR[Title/Abstract]
OR overexpress*[Title/Abstract] OR "loss-of-function"[Title/Abstract]
OR "gain-of-function"[Title/Abstract] OR "gene ablation"[Title/Abstract]
OR rescue[Title/Abstract]
OR "dose-response"[Title/Abstract] OR "dose response"[Title/Abstract]
OR "concentration-response"[Title/Abstract]
OR "concentration response"[Title/Abstract]
OR "concentration-dependent"[Title/Abstract]
OR "concentration dependent"[Title/Abstract]
OR "dose-dependent"[Title/Abstract] OR "dose dependent"[Title/Abstract]
OR IC50[Title/Abstract] OR EC50[Title/Abstract]
OR "pharmacological blockade"[Title/Abstract]
OR "neutralizing antibody"[Title/Abstract]))
AND ("2018/01/01"[Date - Publication] : "2026/08/10"[Date - Publication])
```

#### NP-G2-H｜高优先级交集，不作唯一入口

```text
(("network pharmacology"[Title/Abstract]
OR "network-based pharmacology"[Title/Abstract])
AND (pharmacokinetic*[Title/Abstract]
OR "serum pharmacochemistry"[Title/Abstract]
OR "plasma component*"[Title/Abstract]
OR "blood component*"[Title/Abstract]
OR "tissue distribution"[Title/Abstract]
OR "absorbed component*"[Title/Abstract]
OR "blood-absorbed component*"[Title/Abstract]
OR "blood absorbed component*"[Title/Abstract]
OR "plasma-absorbed component*"[Title/Abstract]
OR "plasma absorbed component*"[Title/Abstract]
OR "serum-derived component*"[Title/Abstract]
OR "serum derived component*"[Title/Abstract]
OR "prototype component*"[Title/Abstract]
OR "prototype constituent*"[Title/Abstract]
OR "in vivo constituent*"[Title/Abstract]
OR Cmax[Title/Abstract] OR "plasma concentration*"[Title/Abstract]
OR "brain penetration"[Title/Abstract] OR "target tissue"[Title/Abstract])
AND ("target engagement"[Title/Abstract]
OR "target occupancy"[Title/Abstract]
OR "surface plasmon resonance"[Title/Abstract]
OR "biolayer interferometry"[Title/Abstract]
OR "bio-layer interferometry"[Title/Abstract]
OR "isothermal titration calorimetry"[Title/Abstract]
OR "microscale thermophoresis"[Title/Abstract]
OR "cellular thermal shift assay"[Title/Abstract]
OR "drug affinity responsive target stability"[Title/Abstract]
OR "thermal proteome profiling"[Title/Abstract]
OR chemoproteomic*[Title/Abstract] OR "pull-down"[Title/Abstract]
OR "pull down"[Title/Abstract] OR CETSA[Title/Abstract] OR DARTS[Title/Abstract]
OR knockdown[Title/Abstract] OR knockout[Title/Abstract] OR "knock out"[Title/Abstract]
OR "gene silencing"[Title/Abstract] OR siRNA[Title/Abstract]
OR shRNA[Title/Abstract] OR RNAi[Title/Abstract] OR CRISPR[Title/Abstract]
OR overexpress*[Title/Abstract] OR "loss-of-function"[Title/Abstract]
OR "gain-of-function"[Title/Abstract] OR "gene ablation"[Title/Abstract]
OR rescue[Title/Abstract]
OR "dose-response"[Title/Abstract] OR "dose response"[Title/Abstract]
OR "concentration-response"[Title/Abstract]
OR "concentration response"[Title/Abstract]
OR "concentration-dependent"[Title/Abstract]
OR "concentration dependent"[Title/Abstract]
OR "dose-dependent"[Title/Abstract] OR "dose dependent"[Title/Abstract]
OR IC50[Title/Abstract] OR EC50[Title/Abstract]
OR "pharmacological blockade"[Title/Abstract]
OR "neutralizing antibody"[Title/Abstract]))
AND ("2018/01/01"[Date - Publication] : "2026/08/10"[Date - Publication])
```

正式执行前须完成四项冻结：信息专家 PRESS 审核；逐项哨兵召回；NCBI query translation 检查；把日期上限改为实际末次检索日。随后按 PRISMA-S 保存数据库入口、完整式、时间、计数、排序、导出字段、原始响应与哈希。第三步检查所有纳入全文的参考文献，以及 PubMed 可追踪的被引/相似文献；新增记录必须标明发现路径。只有 PubMed 已索引记录能进入 M/A 主分析；非 PubMed 的官方标准只进入背景层。

## 7. 筛选与一致性

1. 按 PMID、DOI、规范化题名、作者和版本关系去重，保留研究家族；勘误、更新、预印本和期刊版保留报告级 lineage。
2. 两名人类研究者先独立筛选至少 50 条题名/摘要和 20 篇全文，样本须覆盖 M/A、纯计算、弱验证、强验证和边界案例。报告原始一致率、Gwet's AC1 和 Cohen's κ；关键规则原始一致率目标为 ≥80%，AC1/κ 任一明显低于 0.60 时继续修订手册并重新校准。
3. 题名/摘要和全文两个阶段都由两人独立决定；分歧先共识，仍不一致时由第三人裁决。
4. AI 可做字段预填、排序、重复提示和理由一致性检查，但不得独立作最终排除决定。
5. 全文排除必须使用预先定义的单一主理由；纳入、排除、未获取和待判定分别导出。`not_reported` 不得被编码为 `not_performed`。
6. 若纳排标准改变，先记录 Protocol deviation、理由和影响，再重放受影响记录，不能静默覆盖。

## 8. 路线判定与反捷径规则

三条路线是本综述的派生分析框架，不是领域公认的互斥标准。抽取时先分别记录研究起点、药物侧组件、疾病侧组件、会合点和因果检验，再由冻结规则派生路线；不得让筛选者直接凭印象三选一。

| 路线 | 判定起点 | 最低判定规则 |
|---|---|---|
| bottom-up | 从药物、方剂、成分或数据库预测出发 | 药物侧候选先于疾病侧实测模块；允许后续实验，但记录是否有真实暴露 |
| top-down | 从患者/模型表型或疾病组学出发 | 疾病模块由情境数据先定义，再匹配药物或成分 |
| bidirectional | 药物侧与疾病侧都被分析，但至少一侧仍主要来自预测 | 分列两侧证据，不因“双向”一词自动升级为 middle-out |
| middle-out（严格） | 药物侧与疾病侧独立获得实证锚点后会合 | 体外主张须有明确实测药物实体；体内主张须有相应物种、剂量、时间及血液/靶组织可达暴露；同时还须有具体疾病模块，且 E3b 功能介导为 `reported_yes` |
| partial middle-out | 只满足上述三项中的两项 | 必须写明缺失的是暴露、疾病情境还是因果检验，不得简称完整闭环 |
| mixed / unclear | 顺序或证据不足以稳定归类 | 保留不确定，不强行三分 |

E3b 的最低合格实验是：对预设会合靶点进行靶点特异遗传扰动，或具有充分选择性与对照的药理阻断，并显示它改变“药物对相关表型的效应”；救援、反向扰动或基因型—药物交互可加强判定。仅表达变化、一般通路抑制、无选择性的抑制剂或表型共同变化不合格。

特别规则：制剂成分鉴定不等于体内暴露；跨物种或不匹配剂量的暴露与表型不能自动对齐；表达量变化不等于靶点参与；hub、富集、docking 和 MD 不等于 target engagement；一个通路蛋白随表型共同改变也不等于该靶点介导疗效。`strict middle-out` 只描述两侧实证锚定并在会合点完成 E3b 功能检验的研究路线，不自动等于完整靶点因果闭环。若主张“化合物 X 经靶点 Y 导致表型 Z”，还必须同时具备：（结合或细胞内靶点占有）+（Y 的靶向扰动改变 X 的表型效应，最好有救援或效应修饰）+（浓度或体内暴露相容）；任一单项都不能独立证明整条因果链。

## 9. 数据 charting 字典

可执行字段定义见 `network-pharmacology-g2-charting-schema-v1-2026-08-10.yaml`。抽取表必须把以下字段分列，禁止把“用了什么工具”写成一个自由文本大格：

| 域 | 必填字段 |
|---|---|
| 来源与 lineage | record_id、family_id、发现通道、PMID、DOI、版本/勘误/撤稿、年份、国家、语言、来源类型、全文状态、筛选者、抽取者、全文 locator |
| 研究对象 | 研究设计、药物/方剂/成分、疾病/模型、样本量、剂量、给药途径、时间、对照、资助、利益冲突 |
| 药物侧 | 成分来源、是否实测、检测方法、血/组织暴露、PK 参数、暴露与实验浓度是否对齐 |
| 疾病侧 | 疾病数据来源、队列/模型、组学层、细胞类型、模块定义、批次/混杂处理 |
| 数据谱系 | 每个数据库名称、版本、访问日期、实体 ID、证据类型、筛选阈值、合并规则 |
| 网络与算法 | 节点/边定义、背景网络、算法、参数、随机种子、训练/测试划分、数据泄漏、比较基线、多重检验、敏感性分析 |
| docking / MD | 结构来源、位点依据、box、软件/版本、参数、阳性对照、重对接、MD 条件；与实验结合证据分列 |
| 验证 | validation_type、模型、盲法/随机化、样本量依据、重复数、阴阳性/零结果、浓度—反应、结合/占有、扰动、救援、独立重复、体内表型、人体证据 |
| 复现 | 数据、代码、环境、协议、永久标识、可访问性、作者是否提供足够细节重建分析 |
| 结论边界 | 作者原话及 locator、综述允许结论、E0—E5 组件、正/负/零结果、反证、缺失环节、循环验证、过度外推类型 |

缺失值统一使用 `reported_yes / reported_no / not_reported / unclear / not_applicable`，其中 `not_reported` 不能解释为没有实施。当前 YAML 是 `PilotChartingSchema v1`：批准 G2 只冻结它作为试填基线，而非宣称最终抽取表已定稿。两名研究者须用至少 10 篇最大差异样本试填，覆盖方法评价、规范文件、平台、纯计算、弱验证、暴露研究、组学研究、扰动/救援、动物和人体研究；若无需修改，记录同一哈希的晋升确认；若需修改，必须生成 v2 与 Protocol amendment，不得覆盖 v1。正式抽取在试填后版本获批前保持 `execution_blocked`。

## 10. 三轴评价框架

### 10.1 报告完整性轴

按“已报告 / 未报告 / 不适用 / 无法判断”记录：数据来源与版本、访问日期、实体标准化、筛选阈值、网络定义、算法参数、软件版本、docking/MD 细节、实验设计、数据/代码/协议可用性。结果以域级比例或项目矩阵呈现，不生成会掩盖关键缺陷的总分。

### 10.2 机制证据轴

| 等级 | 允许的最高措辞 |
|---|---|
| E0 | 数据库/文献存在关联 |
| E1 | 计算候选或机制假设 |
| E2 | 在特定疾病样本、组织或组学中获得情境化支持 |
| E3a | 在特定体系获得直接结合或细胞内靶点占有；只支持物理相互作用/占有，不自动支持表型介导 |
| E3b | 靶点特异扰动改变药物效应，并以救援或效应修饰加强；只支持功能介导，不自动证明直接结合 |
| E4 | 在相应物种、剂量、时间和靶部位存在可达暴露，且与体内表型及 E3a/E3b 组件相容；跨物种证据须分列，未核对齐不得升级 |
| E5 | 适当设计的人体研究才允许讨论临床疗效或安全性 |

E0—E5 是本项目的**证据组件框架**，不是已经过测量学验证的质量量表，也不保证所有组件单调递增。每篇研究只记录各链条环节的证据，不用一个“最高等级”遮盖短板。例如存在血液/组织暴露并不自动满足 E4 对齐；具体靶点若只有 docking，靶点证据仍为 E1。

### 10.3 研究可信度轴

不设总分或“高/低质量”切点，逐域给出 `low_concern / some_concern / high_concern / unclear / not_applicable` 及全文 locator：

1. 数据或 reference standard 是否适合当前预测任务；
2. 是否存在循环验证、训练—测试污染、未来信息泄漏或把数据库输入再当独立验证；
3. 数据库/算法比较是否使用相同任务、实体集、ground truth、调参预算和评价指标；
4. 阈值、多重检验、模型不确定性与敏感性分析是否处理；
5. 实验是否正交、独立，是否有适当对照、随机化/盲法、重复与样本量依据；
6. 给药剂量、实验浓度、体内暴露、模型和疾病情境是否匹配；
7. 作者结论是否超过直接证据，是否把未报告写成已满足，是否忽略反证或零结果。

报告完整性、证据组件与可信度三轴必须分别展示；任何一轴都不能替代另外两轴。

### 10.4 关键校准证据的适用边界

- 数据库/算法比较研究（NP-G1-FT-002，PMID 39730024）只覆盖 42 种草药、36 个成分，并以单一 HERB 库中的已知 target/effect 为参考；阳性稀疏，unknown 中可能含未标注阳性。因此它支持“在该任务中数据库和算法选择会改变结果”，不支持数据库的普遍优劣排序。
- 同质化审计（NP-G1-FT-003，PMID 41800093）限于 Web of Science Core、开放获取、天然产物研究及 2023-10-01—2024-06-30 的窗口；代谢物、靶点、通路的实际分析分母分别为 465、880、917，并排除了报告超过 30 项的论文。它支持“该限定语料存在显著同质化”，不能证明全领域、2018—2026 趋势或单一数据库造成全部偏差。
- blind docking 研究（NP-G1-FT-004，PMID 40196361）的误用样本仅为 2024 年 *Frontiers in Pharmacology* 的 35 篇论文；CASF-2016 的 285 个复合物 benchmark 只界定 blind docking 的性能边界。两者都不能生成“多数领域论文误用”的总体比例。

## 11. 分析计划

1. 用 PRISMA-ScR 流程图分别报告 M 通道全量方法检索、A 通道母集/抽样/筛选和 case enrichment 补入；三者不得混用分母。
2. M 通道采用结构化内容分析和 claim—counterclaim 映射，区分实证方法证据、规范性建议和平台自述；指南出现不等于已被普遍采用。
3. A 通道预设三个主要结果：最低计算复现要素是否齐全；是否形成药物侧—疾病侧的情境化会合；会合后是否同时具备结合/细胞占有、靶点特异功能介导以及与浓度或体内暴露相容的表型证据。各组件也单独报告，禁止把其中任一项写成完整靶点因果。
4. 对 A 通道使用分层抽样权重，按 2018—2020、2021—2023、2024—2025 报告比例、绝对时期差和 95% CI；2026 截至检索日单独描述。任何时期差都只表示 PubMed 自我标识文献特征的变化，不能解释为因果或全球范式转移。
5. 构建“研究起点 × E/O/C 组件 × E0—E5 × 可信度域 × 缺失环节”的 UpSet 图或热图；`partial middle-out` 与完整 middle-out 分开。路线加权分布只有在全文双人编码和新增人工批准后才可报告。
6. 做敏感性分析：研究家族/报告两种计数；排除仅摘要来源；严格/宽松 middle-out 规则；把 `not_reported` 与 `reported_no` 分开；剔除只有 docking/MD 的“验证”后重算验证标签分布；比较有/无全文记录的元数据。
7. case enrichment 只用于展示罕见强闭环、负校准和反例，不进入 A 通道的比例、时期差或趋势图。
8. 不进行疗效 Meta 分析、网络 Meta 分析、临床推荐，亦不把 E0—E5 当作已验证的证据确定性工具。

## 12. 证据驱动论文大纲

正式章节映射见 `network-pharmacology-g2-evidence-outline-v1-2026-08-10.yaml`。当前冻结大纲为：

1. 工具链成熟为何不等于机制成熟；
2. 数据库、实体映射与网络算法怎样制造不稳定；
3. 可重复计算的最低报告要求；
4. 从 docking/MD 到 binding、target engagement 与功能介导：验证概念的分层；
5. 从单侧预测到暴露—疾病模块—因果检验的闭环；
6. 多组学、单细胞、AI 与 QSP 的真实增量和边界；
7. 面向下一代网络药理学的最小可辩护设计。

每一节都必须保留：支撑来源数、反证/限制、允许措辞、禁止外推和待补证据。证据不足的章节只能合并、补检或降级，不能由语言生成补齐。

## 13. 风险、替代方案与停止规则

| 风险 | 等级 | 控制 |
|---|---|---|
| 仅 PubMed 导致数据库和语言覆盖偏倚 | 高 | 标题、摘要、方法、讨论和结论持续标注 PubMed-restricted；若投稿要求完整范围综述，重开 G1 增库 |
| 只覆盖自我标识为 network pharmacology 的研究 | 高 | 结论限定为该术语下的 PubMed 文献，不外推未使用该标签的网络药物研究 |
| 高证据信号富集造成 spectrum bias | 高 | A 通道只从母集按冻结随机方案抽样；E/O/C 补入从所有实践分母排除 |
| 分层样本只能识别较大时期差异 | 中 | 报告权重、绝对差与 95% CI；不把无显著差异解释为没有变化 |
| “validation”语义污染 | 高 | 以具体实验动作编码，不采信作者标签；docking/MD 单列 |
| middle-out 分类主观 | 中 | 先抽取组件再派生路线；50 条题摘、20 篇全文校准；双人判断；报告 bidirectional/mixed/unclear |
| 数据库版本和参数不报告 | 高 | 记为报告缺口，不推测或补写；必要时联系作者 |
| 新近 2026 文献持续索引 | 中 | 正式写作前更新检索并保存差异；旧快照不覆盖 |
| 引用追踪偏向高被引研究 | 中 | 引用链仅作为补充发现路径，所有补入仍使用同一纳排规则 |
| 全文、语言和发表偏倚 | 中 | 记录未获取率、语言与负/零结果；比较有无全文记录的元数据；不替换固定随机样本 |
| AI 自动抽取产生错配 | 高 | 关键字段与每条主张由人回到全文 locator 核验；生成与核查角色分离 |

停止规则：当 Protocol 已注册、检索式经 PRESS/哨兵检验冻结、双人筛选者完成校准且所有必填字段可在试填样本中稳定获得，才允许进入正式执行。若缺少第二名筛选者或信息专家审核，状态为 `execution_blocked`，不得以 Agent 单独运行替代。

## 14. 可行性与角色

核心工作量不是把 E/O/C 的命中数相加，而是：M 通道约 183 条宽方法候选及 M2 的 15 条高噪声相邻候选，A 通道 700 个分层随机研究家族，以及 H 高优先级候选和少量预先说明的反例。建议团队为：1 名 PI、2 名独立筛选/编码者、1 名裁决方法学人员、1 名信息专家。预计 12—16 周：1—2 周检索/抽样冻结，2—3 周筛选，5—7 周全文与 charting，1—2 周一致性核查，2 周证据地图和写作。若资源只能支持 8—10 周，应先把 A 通道缩为可行性审计并扩大置信区间，不能静默降低双人核查。

## 15. G2 一致性检查

- 题目、主问题、PCC、纳排标准、检索通道、抽取字段和分析输出一致。
- G1 的 51 条记录/50 个家族只作校准与方法候选输入，未冒充全量研究库。
- M 方法证据与 A 应用概率样本分开；E/O/C 是组件和 case enrichment，不是互斥通道或实践分母。
- 报告完整性、机制证据组件和研究可信度分开；来源、版本、参数和 validation_type 分开。
- 所有实践比例、路线派生和时间分层都限定在 A 抽样分母内，不外推为全球领域占比；2026 单列。
- docking/MD 没有被升级为 target engagement；动物和细胞证据没有被升级为临床有效。
- 单数据库偏倚、第二筛选者、PRESS 和注册均保留为显式前置条件。

## 16. 唯一待决策项

**是否批准本 Protocol 作为 G2 v1，并在当前 PubMed-only 边界下进入 G3 签署与执行准备？**

- `批准 G2`：冻结本版题目、PCC、M/A 双通道、分层随机抽样、E/O/C 组件与补充规则、路线规则、三轴评价、分析计划及 `PilotChartingSchema v1` 基线；试填后的字段变化必须升版并形成 amendment。G3 只做版本审计、试填晋升、注册/签署准备，不静默改变科学范围。
- `修改 G2：……`：生成 v2 和差异，不覆盖 v1。
- 若目标变为投稿级完整范围综述：回复 `升级多数据库`，系统重开 G1，而不是在 G2 中悄悄扩大范围。

默认状态为**不自动批准**。
