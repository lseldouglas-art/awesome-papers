# Pi Research Workbench · 证据综述模式

一个可安装到 [Pi](https://github.com/earendil-works/pi) 的本地证据综述 Agent 包：用固定状态机约束真实检索、证据核查与综述写作，用 Agent 处理开放任务，把人工审批留给研究者本人。

当前 V1 的准确定位是“可审计的 PubMed 证据综述工作台”。它帮助研究者把问题变成可追溯的文献判断和受限稿件，但不冒充已经完成湿实验、生物信息学分析、临床研究或任何真实世界验证。

## 安装与首次运行

要求 Node.js 22.19+ 和 Pi 0.84.1+。

```bash
pi install /absolute/path/to/research-core -l
pi
```

然后运行：

```text
/research-new
```

不写入 Pi 设置的临时试用：

```bash
pi -e /absolute/path/to/research-core
```

包内 CLI 可以初始化项目配置、检查运行模式和执行 headless 研究：

```bash
research-pi init
research-pi doctor
research-pi doctor --live-check
research-pi run --title "术后睡眠与恢复" \
  --question "术后睡眠与恢复有何关联？" \
  --query "postoperative sleep AND recovery"
```

Headless 模式遇到人工门禁只返回 `awaiting_user_decision`，绝不会代替用户批准。回到 Pi TUI 运行 `/research-decide` 后，再运行 `/research-continue`。

## Pi 能力

Agent 可调用的八个受控工具：

- `research_query_preview`：从中文问题提出至少两个透明候选，并真实试检 PubMed，预演本身不建项；
- `research_project_create`：建立真实 PubMed 研究并停在首个人工决定点；
- `research_project_list`：列出当前目录下的研究；
- `research_project_read`：读取科研人员关心的来源、产物、边界和决定；
- `research_literature_landscape`：查看重叠文献组、未分类材料、已登记争议与尚未验证的候选方向；
- `research_run_current_step`：按状态机推进到下一个安全边界；冻结协议中的检索式不能在推进时静默覆盖；
- `research_resume_current_step`：研究者确认网络或工具故障已处理后，从同一冻结协议恢复；已落盘的成功检索不重复；
- 正式检索零结果时，只有研究者可用 `/research-revise-protocol` 建立带理由的新协议版本；Agent 不能自行改变研究方法；
- `research_export`：作者签署唯一 ExportManifest 后，导出该清单绑定的 JSON 研究包、Markdown 或 BibTeX；未签署字节一律拒绝导出。

只有用户主动输入的命令才能形成 Gate 决定：

- `/research-new [研究问题]`
- `/research-status [project-id]`
- `/research-continue [project-id]`
- `/research-resume [project-id]`
- `/research-revise-protocol [project-id]`
- `/research-decide [project-id]`
- `/research-export [project-id] [json|markdown|bibtex]`

包同时提供 `scientific-research` Skill 和四个模板：`/research-question`、`/research-pubmed`、`/research-audit`、`/research-brief`。

## 数据、网络与模型

默认数据目录是当前可信项目的 `.pi/research-workbench-data`。这里保存项目级追加事件链、不可变内容寻址产物、Agent 生命周期记录和导出文件。可用 `PI_RESEARCH_DATA_DIR` 显式改到别处。项目选择和检索回执也通过 Pi `appendEntry` 写入会话，用于重启和分支恢复；科研状态仍以外部追加事件链为权威。

网络只读访问 NCBI E-utilities。建议按 NCBI 要求配置 `NCBI_EMAIL` 和 `NCBI_TOOL`；更高频率访问可配置 `NCBI_API_KEY`。扩展不会上传本地目录或手稿到 PubMed。

在 Pi 扩展内，包会继承当前会话选择的模型与 `modelRegistry` 认证（包括 `openai-codex` 的 ChatGPT OAuth、模型级请求头和自定义 provider），并在每次请求时重新解析短期凭据；密钥和请求头不会写入项目、运行回执或日志。独立 Web/CLI 仍可通过 `.env.example` 中的 `RESEARCH_AGENT_PROVIDER`、`RESEARCH_AGENT_MODEL` 和对应 API key 配置 OpenAI/Anthropic 实时运行。没有可用实时模型时进入 guided 模式：真实状态机、真实持久化和真实 PubMed 仍可运行，但内容一律标记为受限，不能称为正式研究结论。

## V1 定位与科研边界

V1 面向题名/摘要级的 PubMed 证据综述，可交付经过核查的研究判断、证据驱动大纲或经审计综述稿。它不声称已经覆盖多数据库去重、付费全文获取、临床试验执行、实验室 SOP、伦理审批、正式统计分析、多人权限服务或合格电子签名。

大范围筛选默认以题名和摘要为主；全文不是候选发现或摘要级筛选完成的前提。每条来源必须保留真实访问层级，摘要没有报告的信息保持“未知”。涉及精确数值、强因果、安全性和临床决策的主张应升级到有针对性的全文核查。

中途追溯直接在工作台或 `/research-status` 查看；下载文件只在作者确认唯一 ExportManifest 后开放。确认后的 JSON、BibTeX 与 Markdown 均由清单保存的 exact bytes 提供，不能在下载时临时重算。guided 项目得到的是 `simulation_signed` 受限确认，只能下载带受限标识的演练成果；它不代表科学审计通过，也不能继承到正式稿。只有项目自己的不可变实时模型运行证明、完整审计、流程完成和作者正式签署同时满足时才标记正式；guided 项目即使服务器后来切换到 live 配置也不会升格。

## 诊断与验证

```bash
npm test
npm run test:core
npm run pack:check
npm run test:install
```

The repository includes `.github/workflows/pi-research-workbench-ci.yml`, which runs package checks on Node 22.19 and 24 across Linux, macOS and Windows, plus the full deterministic core suite on Linux.

`research-pi doctor` 默认不联网，并诚实显示 guided/live 模式。`research-pi doctor --live-check` 才会访问 PubMed 做一条探测。

“凭据已配置”不等于实时模型已经成功。正式资格还要求项目事件链里每次 Agent 运行都保存成功停止原因和非零 token usage；供应商 401/403、零 token、旧日志缺回执或任何 guided/faux 运行都会失败关闭。

详细威胁边界见 [SECURITY.md](./SECURITY.md)，贡献不变量见 [CONTRIBUTING.md](./CONTRIBUTING.md)，版本记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 内核设计说明

这里保存的是与网站、Skill、App 和插件都无关的科研流程定义核心。任何产品形态只能调用或投影它，不能在界面里另造一套科研事实。

当前科研 Harness 的正式构想与调用口令见 [`research-harness-canonical-index.md`](../docs/research-harness-canonical-index.md)。

## 当前范围

`review-research-machine-v1.js` 面向证据驱动的文献综述研究。它继承训练营材料中“方向—检索—证据—大纲—分段写作—核查—交付”的递进关系，同时增加真实检索、检索校准、文献库冻结、反证、独立核查、版本保留和人工责任等科研门禁。

用户默认只看到五个时期：

1. 问题成形；
2. 文献调研；
3. 论证结构；
4. 写作与核查；
5. 定稿交付。

内部共有 26 个节点。文献调研明确分成“宽检索建立领域视野—人工选择综述切口—围绕切口精准重检索”三段。每个节点都声明目的、输入、产物、验收条件、人工权限和证据不足时的处理方式。

节点执行、执行者认领、科研产物和人工决定使用四套不同状态；“内容已经生成”不会被误写成“研究者已经批准”。

## 已能运行的内核

`event-engine-v1.js` 与 `event-store-v1.js` 已把流程定义变成首个本地可运行版本：

- 所有改变只追加记录，旧版本和旧决定不会被覆盖；
- 每份科研产物同时保存内容校验、版本、来源和上游关系；
- 人工决定绑定指定研究者、允许角色、确切产物版本和决定理由；
- 上游变化会沿产物关系和流程依赖通知下游重新核查；
- “质量是否通过”和“是否仍适用于当前问题”分开记录；
- AI 执行需要领取有期限的工作，过期后自动阻塞并等待恢复确认；
- 程序中断在一项决定写到一半时，会先补齐原决定，再允许新的操作；
- 本地事件文件关闭后可以重新加载，并从头恢复同一研究状态。

`fixtures/network-pharmacology-replay-v1.js` 用本次网络药理学调研的真实来源、文件校验和用户纠偏记录做黄金回放。13篇候选已经完成摘要级筛选、证据提炼和独立核查；研究者随后明确批准了这份受限证据边界，并把本轮目标扩展为论文论证结构。研究者已退回第一版概念性大纲，要求改为可直接逐段写作的论文计划；旧版及其复核保留为被替代的审计历史。当前恢复结果仍是“论证结构：确认论文论证路线”：43段新版大纲及其独立复核已完成，只有绑定新版确切文件版本的第二次大纲 Gate 正在等待研究者决定。系统没有代替用户批准，也没有生成论文正文、`OutlineDecision` 或 `FrozenWritingPlan`。

这仍是本地单机内核，不是成熟多人服务。正式调用应通过 `dispatchTrustedCommand` 注入经过认证的用户身份和可信服务器时间，并把审计头校验值保存在独立可信位置；直接使用 `dispatchCommand` 只适合已经可信的内部适配器、迁移和测试。跨机器事务、远程权限服务和正式电子签名不在当前版本内。

## 统一科研方法包

`method-pack-interface-v1.js` 定义所有方法能力共用的科研接口。它要求每个方法包明确问题适用性、证据产出、禁止外推、前置条件、执行与停止规则、质量控制、不确定性、来源与版本、资源和人工责任。

当前三个示例用于检查这套接口是否真的跨方法成立：

1. 陌生领域调研；
2. 靶点介导机制实验设计；
3. 生物信息学差异表达分析。

它们是架构级模板，不替代实验室 SOP、伦理审查、统计咨询或学科专家判断。

## Evidence brief 首个产品纵切

`artifact-contracts-v1.js` 开始把状态机中的类型名落实为内容级科研对象契约，当前覆盖 `EvidenceExcerpt`、`ResearchConclusionCard`、`EvidenceVerificationReport`、`DecisionReceipt` 和 `EvidenceBriefBundle`。它强制保存访问层级、真实来源定位、未知项、独立核查和精确决定指纹，并在结论引用不存在或关系不相容的证据时拒绝通过。

`user-brief-renderer-v1.js` 从通过校验的同一事实包确定性生成用户简报。输出直接包含当前研究时期、本轮新结论、主要依据与边界、下一步或待确认决定；相同输入逐字相同，不临场补写时间或结论。

`event-engine-v1.js` 的 `PRODUCE_ARTIFACT` 已接入上述结构化内容校验。结论卡必须绑定当前执行者和已经接受的证据输入；独立核查报告必须绑定真实结论生产者、真实核查者及精确结论卡输入。已知结构化产物不能只提交一个不透明哈希来绕过内容校验。

本纵切的范围与验收标准见 [`research-workbench-evidence-brief-vertical-slice-v1-2026-08-11.md`](../docs/research-workbench-evidence-brief-vertical-slice-v1-2026-08-11.md)。可运行说明见 [`research-workbench-runnable-core-slice-v1-2026-08-11.md`](../docs/research-workbench-runnable-core-slice-v1-2026-08-11.md)。

## 产品边界

状态机允许三种合法完成点：得到一份经过核查的研究判断、得到有证据支撑的论文结构、得到经过全文审计的综述稿。因此后续产品可以只解决一个小痛点，不必把整条科研生产线全部做进首版。

大范围文献筛选默认以题名和摘要为主，全文不是筛选完成的前提；系统必须标明访问层级，并把摘要未报告的内容保留为未知。每次科研任务的最终回复必须直接在聊天正文给出可独立阅读的用户简报，文件和链接只能作为可选追溯材料。

## 验证

```bash
node --test research-core/*.test.mjs research-core/fixtures/*.test.mjs
```

直接观察网络药理学纵切：

```bash
node scripts/run-research-evidence-brief-demo.mjs
```

## 独立产品入口

状态机不是产品界面本身，而是保证科研步骤顺序、角色分离、版本失效和人工权限的后台治理层。当前证据决定界面只是 `approve_evidence_boundary` 人工门禁的自然语言投影；用户不需要学习26个内部节点。

启动独立科研工作台：

```bash
npm run dev:research
```

访问 `http://127.0.0.1:5177/research-workbench`。接受或要求修改会通过独立本地接口调用正式事件引擎；前端不能直接制造已批准状态。开源架构、当前限制和发布前决定见 [`research-workbench-open-source-architecture-v1-2026-08-12.md`](../docs/research-workbench-open-source-architecture-v1-2026-08-12.md)。
