import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  buildMentorBrief,
  buildResearchReviewReportModel,
  buildScopingRoundComparison,
  reportChapterIdForKey,
  researchReportChapterEvidenceRows,
  researchReportBindingStatus,
} from "./research-review-report-model.js";
import "./research-review-report.css";

const CHAPTERS = Object.freeze([
  { id: "landscape", label: "领域图景", title: "领域图景" },
  { id: "trends", label: "趋势与选题", title: "近五年趋势与选题分析" },
  { id: "opportunities", label: "研究机会", title: "一句话总结与研究机会" },
  { id: "plan", label: "综述方向", title: "综述方向：如何把题目真正做完" },
]);

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function conclusion(item) {
  return item?.conclusion ?? item?.value ?? item?.advice ?? "当前样本没有返回可安全表达的结论。";
}

function joinChineseSentences(items) {
  const sentences = list(items)
    .map((item) => String(item).trim().replace(/[。；;]+$/g, ""))
    .filter(Boolean);
  return sentences.length ? `${sentences.join("；")}。` : "";
}

function directionTitle(direction) {
  return direction?.displayTitle ?? direction?.direction ?? direction?.recommendedQuestion ?? "候选方向";
}

function accessLabel(value) {
  if (["abstract_only", "title_abstract"].includes(value)) return "题名与摘要";
  if (value === "title_only") return "仅题名";
  if (["full_text", "full_text_and_supplement"].includes(value)) return "已访问全文";
  return "访问层级未知";
}

function screeningDispositionLabel(row) {
  if (row?.includedInDerivedAnalysis === true) return "进入当前分析";
  if (row?.relevance?.status === "not_relevant") return "研究对象相关性未通过";
  return "未进入当前分析";
}

function chapterIndex(id) {
  const index = CHAPTERS.findIndex((chapter) => chapter.id === id);
  return index < 0 ? 0 : index;
}

function ClaimLabel({ children, tone = "sample" }) {
  return <span className={`rawb-report-claim-label is-${tone}`}>{children}</span>;
}

function FindingList({ items, empty = "当前分层样本没有返回可安全表达的判断。" }) {
  if (!list(items).length) return <p className="rawb-report-empty">{empty}</p>;
  return (
    <ol className="rawb-report-findings">
      {list(items).map((item, index) => (
        <li key={item?.id ?? `${item?.title}-${index}`}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div>
            <strong>{item?.title ?? "当前判断"}</strong>
            <p>{conclusion(item)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function DistributionBars({ items, total, empty = "当前数据不足以形成分布。" }) {
  const rows = list(items).filter((item) => Number(item?.count) > 0);
  const max = Math.max(1, ...rows.map((item) => Number(item.count)));
  if (!rows.length) return <p className="rawb-report-empty">{empty}</p>;
  return (
    <ol className="rawb-report-bars">
      {rows.map((item) => {
        const count = Number(item.count);
        const width = Math.max(5, Math.round((count / max) * 100));
        return (
          <li key={item.id ?? item.label}>
            <span>{item.label}</span>
            <span className="rawb-report-bars__track" aria-hidden="true">
              <span style={{ width: `${width}%` }} />
            </span>
            <strong>{count}{total ? `/${total}` : ""}</strong>
          </li>
        );
      })}
    </ol>
  );
}

function DecisionStructure({ groups, total }) {
  if (!list(groups).length) return null;
  return (
    <ol className="rawb-report-decision-structure">
      {groups.map((group) => (
        <li key={group.id}>
          <strong>{group.label}</strong>
          <ul>
            {list(group.items).map((item) => (
              <li key={item.id}><span>{item.label}</span><b>{item.count}/{total}</b></li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function RoundComparison({ comparison }) {
  if (!comparison) return null;
  return (
    <section className="rawb-report-rounds" aria-labelledby="rawb-report-rounds-title">
      <header>
        <div>
          <ClaimLabel tone="inference">两轮检索结构比较</ClaimLabel>
          <h3 id="rawb-report-rounds-title">问题如何从领域扫描收窄到聚焦检索</h3>
        </div>
        <p>{comparison.boundary}</p>
      </header>
      <div className="rawb-report-rounds__grid">
        {[comparison.first, comparison.second].map((round, index) => (
          <article key={index === 0 ? "first" : "second"}>
            <span>{index === 0 ? "首轮 · 领域扫描" : "第二轮 · 聚焦检索（未验证）"}</span>
            <strong>{round.question || "研究问题未返回"}</strong>
            <dl>
              <div><dt>分层样本</dt><dd>{round.sampledCount} 篇</dd></div>
              <div><dt>摘要可用</dt><dd>{round.abstractCount} 篇</dd></div>
              <div><dt>主题结构</dt><dd>{round.themeCount} 类</dd></div>
              <div><dt>首要信号</dt><dd>{round.topTheme}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function FieldLandscapeChapter({ model }) {
  const leadingThemes = model.themeDistribution.slice(0, 6);
  return (
    <div className="rawb-report-chapter-layout is-landscape">
      <section className="rawb-report-narrative">
        <ClaimLabel>{model.claimLabels.sampleObservation}</ClaimLabel>
        <h2>从第一性原理看领域现状</h2>
        <p className="rawb-report-lead">领域综述的最小有效单元不是一个宽泛主题，而是一项可检验的决策：针对哪类人群、在何种疾病阶段、比较何种策略、以哪个时间点的患者重要结局判断获益。当前样本的作用，是定位这些决策链上已经被覆盖与仍需核查的环节。</p>
        <p className="rawb-report-sample-synthesis"><strong>当前样本判断：</strong>{model.executiveSummary || "当前样本尚不足以形成稳定的领域判断。"}</p>
        <FindingList items={model.developmentStatus} />
      </section>

      <aside className="rawb-report-signal-panel" aria-label="临床决策链上的主题结构">
        <header><h3>临床决策链上的主题结构</h3><span>主题可重叠</span></header>
        {model.decisionStructure.length
          ? <DecisionStructure groups={model.decisionStructure} total={model.analyzedCount} />
          : <DistributionBars items={leadingThemes} total={model.analyzedCount} />}
        <p>{model.decisionStructureComplete
          ? "当前可见主题均已显式放回风险识别、治疗决策与分层验证链条；数字只表示当前样本覆盖。"
          : `仍有 ${model.unmappedThemes.length} 个主题未进入预设决策链，已单列提示；完成分类校正前不能声称链条完整。`}</p>
      </aside>

      <section className="rawb-report-wide-section">
        <header className="rawb-report-section-heading">
          <div><ClaimLabel>{model.claimLabels.sampleObservation}</ClaimLabel><h3>当前需要解决的具体问题</h3></div>
          <p>问题来自摘要明确报告的限制；摘要未报告仍保持未知。</p>
        </header>
        <FindingList items={model.majorProblems} empty="当前摘要未形成可稳定聚类的问题信号；不能据此写成领域没有问题。" />
      </section>

      <section className="rawb-report-wide-section">
        <header className="rawb-report-section-heading">
          <div><ClaimLabel>方法边界</ClaimLabel><h3>新入门研究者的关键判断点</h3></div>
          <p>这些是研究方法约束；领域级判断仍需指南、关键全文和高质量综述单独核查。</p>
        </header>
        <FindingList items={model.newcomerGuide} />
      </section>
    </div>
  );
}

function TrendChapter({ model }) {
  const journalRows = model.journalDistribution.slice(0, 6);
  const titleRows = model.titlePatternDistribution.slice(0, 6);
  return (
    <div className="rawb-report-chapter-layout is-trends">
      <section className="rawb-report-narrative">
        <ClaimLabel>{model.claimLabels.sampleObservation}</ClaimLabel>
        <h2>热点分支、结构性演变与选题规律</h2>
        <p className="rawb-report-lead">本章只分析当前分层样本中的主题、题名与期刊模式；不把固定抽样配额解释为全领域发文增减。</p>
        {model.stratifiedAllocation ? (
          <p className="rawb-report-method-note"><strong>抽样设计判断：</strong>当前账本按连续 12 个月窗口等额选取综述；日历年份计数会受窗口边界影响，只能说明样本构成，不能支持“领域升温”或“发文增长”。</p>
        ) : null}
        <FindingList items={model.trendInsights} empty="当前样本没有形成足以报告的时间变化信号。" />
      </section>

      <section className="rawb-report-analysis-grid" aria-label="当前样本分布分析">
        <article>
          <header><h3>年度样本结构</h3><span>非全量发文计量</span></header>
          <DistributionBars items={model.yearDistribution} />
        </article>
        <article>
          <header><h3>热点研究分支</h3><span>当前样本覆盖度</span></header>
          <DistributionBars items={model.themeDistribution.slice(0, 6)} total={model.analyzedCount} />
        </article>
        <article>
          <header><h3>期刊分布</h3><span>仅说明样本来源</span></header>
          <DistributionBars items={journalRows} />
        </article>
        <article>
          <header><h3>题名结构</h3><span>选题表达模式</span></header>
          <DistributionBars items={titleRows} />
        </article>
      </section>

      <section className="rawb-report-wide-section">
        <header className="rawb-report-section-heading">
          <div><ClaimLabel tone="inference">{model.claimLabels.researchOpportunityInference}</ClaimLabel><h3>基于样本结构形成的选题策略推断</h3></div>
          <p>这些是把样本结构转化为选题策略的方法学推断，不是逐篇文献直接证明的价值或新意；必须经同题综述窄检索验证。</p>
        </header>
        <FindingList items={model.selectionPatterns} />
      </section>

      <section className="rawb-report-wide-section">
        <header className="rawb-report-section-heading">
          <div><ClaimLabel>{model.claimLabels.sampleObservation}</ClaimLabel><h3>期刊与题名模式的直接判断</h3></div>
          <p>只报告当前数据真正支持的模式，并明确自动编码的解释边界。</p>
        </header>
        <FindingList items={model.metadataPatternInsights} />
      </section>
    </div>
  );
}

function OpportunityChapter({ model, selectedDirectionId, onDirectionSelect, interactionDisabled = false }) {
  const directions = model.directions;
  if (!directions.length) {
    return <p className="rawb-report-empty">当前样本还不足以生成可追溯的候选方向；应先修订检索或补充样本。</p>;
  }
  return (
    <div className="rawb-report-chapter-layout is-opportunities">
      <section className="rawb-report-narrative is-wide">
        <ClaimLabel tone="inference">{model.claimLabels.researchOpportunityInference}</ClaimLabel>
        <h2>低频不构成空白；可验证的增量必须改变决策框架</h2>
        <p className="rawb-report-lead">{model.opportunityThesis}</p>
        <p className="rawb-report-method-note">以下方案均是待窄检索证伪的结构化候选，不是已证实空白；竞争综述、真实文献量与可比性必须在立题前冻结。</p>
      </section>

      <fieldset className="rawb-report-opportunity-list">
        <legend>{onDirectionSelect ? "选择一个方向进入立题方案" : "候选方向比较"}</legend>
        {directions.map((direction, index) => {
          const selected = direction.id === selectedDirectionId;
          const content = (
            <>
              <span className="rawb-report-opportunity-list__rank">{String(index + 1).padStart(2, "0")}</span>
              <span className="rawb-report-opportunity-list__title">
                <strong>{directionTitle(direction)}</strong>
                <small><b>核查优先级</b>{direction.priority}</small>
                <small>{direction.workload?.timeline ? `${direction.workload.timeline} · ` : ""}{direction.workload?.difficulty ? `难度 ${direction.workload.difficulty}` : "难度待窄检索评估"}</small>
              </span>
              <span className="rawb-report-opportunity-list__competition">
                <b>{direction.externalReviewVerified ? `同题综述：已核查 · 竞争风险${direction.competitionRisk || "待判"}` : "同题综述：待核查"}</b>
                <small>样本内覆盖信号{direction.coverageSignal || "未知"}：{direction.existingCoverage?.interpretation}</small>
                <small>{direction.whyNotFullyReviewed}</small>
              </span>
              <span className="rawb-report-opportunity-list__increment"><b>可验证增量</b><small>{direction.incrementalValueHypothesis}</small></span>
              <span className="rawb-report-opportunity-list__discard"><b>放弃或降级条件</b><small>{joinChineseSentences(list(direction.discardConditions).slice(0, 1))}</small></span>
            </>
          );
          return onDirectionSelect ? (
            <label key={direction.id} className={selected ? "is-selected" : ""}>
              <input
                type="radio"
                name="review-opportunity"
                value={direction.id}
                data-direction-id={direction.id}
                checked={selected}
                disabled={interactionDisabled}
                onChange={() => onDirectionSelect(direction.id)}
              />
              {content}
            </label>
          ) : (
            <article key={direction.id} className={selected ? "is-selected" : ""}>{content}</article>
          );
        })}
      </fieldset>

      <section className="rawb-report-wide-section rawb-report-research-gates">
        <header className="rawb-report-section-heading">
          <div><ClaimLabel tone="external">{model.claimLabels.externalReviewCheck}</ClaimLabel><h3>选题调研优化建议</h3></div>
          <p>{model.externalReviewVerificationCount > 0 ? `已有 ${model.externalReviewVerificationCount}/${model.directions.length} 个方向绑定合规核查回执；未绑定方向仍保持待核查。` : "尚无按方向绑定的合规外部综述核查回执；先核查竞争综述、问题边界与真实文献量，再决定综述类型。"}</p>
        </header>
        <ol>
          <li><strong>竞争综述核查</strong><span>检索近两年同题综述、协议与伞状综述，明确重叠问题。</span></li>
          <li><strong>问题收窄</strong><span>固定人群、疾病阶段、比较策略、核心结局与随访时间。</span></li>
          <li><strong>文献量预检</strong><span>50–100篇只能作为检索前目标；必须报告命中、去重与初筛后的估计量。</span></li>
          <li><strong>立题门槛</strong><span>新增价值应来自可比较框架、标准化表格或临床决策路径。</span></li>
        </ol>
      </section>
    </div>
  );
}

function PlanChapter({
  model,
  selectionReason,
  deferredReason,
  onSelectionReasonChange,
  onDeferredReasonChange,
  interactionDisabled = false,
}) {
  const direction = model.selectedDirection;
  if (!direction) return <p className="rawb-report-empty">请先在“研究机会”中选择一个候选方向。</p>;
  const plan = list(direction?.workload?.plan);
  const abandonConditions = list(direction?.discardConditions).length
    ? list(direction.discardConditions)
    : list(direction?.abandonConditions).length
      ? list(direction.abandonConditions)
    : [
        "近两年已有同范围高质量综述，且当前方案不能提出新的评价框架或决策用途。",
        "窄检索后可用原始研究不足以支持预设比较，或研究对象与结局无法稳定定义。",
        "关键异质性只能由全文方法解决，但当前时间与获取条件无法完成可靠核查。",
      ];
  return (
    <div className="rawb-report-chapter-layout is-plan">
      <section className="rawb-report-narrative is-wide">
        <ClaimLabel tone="inference">{model.claimLabels.researchOpportunityInference}</ClaimLabel>
        <h2>立题边界与执行方案</h2>
        <p className="rawb-report-lead">本章只展开当前选中的一个方向；标题、文献量与工作周期都是立题候选，需经第二轮窄检索和竞争综述核查后冻结。</p>
      </section>

      <aside className="rawb-report-selected-direction">
        <span>探索性立题 · 未验证</span>
        <h3>{directionTitle(direction)}</h3>
        <dl>
          <div><dt>综述类型</dt><dd>{direction.reviewPlan?.reviewType || "待窄检索确认"}</dd></div>
          <div><dt>范围状态</dt><dd>待窄检索确认</dd></div>
          <div><dt>工作量估计</dt><dd>{direction.workload?.targetCoreLiterature ?? "待计算"}</dd></div>
          <div><dt>周期估计</dt><dd>{direction.workload?.timeline ?? "待评估"}</dd></div>
          <div><dt>难度估计</dt><dd>{direction.workload?.difficulty ?? "待评估"}</dd></div>
          <div><dt>同题综述核查</dt><dd>{direction.externalReviewVerified ? "已绑定方向级回执" : "未完成"}</dd></div>
          <div><dt>原始研究量预检</dt><dd>未完成；50–100篇仅为候选发现目标</dd></div>
        </dl>
      </aside>

      <section className="rawb-report-plan-core">
        <article>
          <h3>为什么这个角度可能形成增量</h3>
          <p>{direction.incrementalValueHypothesis || direction.whyPotentiallyValuable || direction.whySuitable}</p>
          <p><strong>同题综述状态：</strong>{direction.externalReviewVerified ? `已核查；竞争风险${direction.competitionRisk || "待判"}` : "待绑定可定位的方向级核查回执"}</p>
          <p><strong>样本内覆盖信号：</strong>{direction.coverageSignal || "未知"}。{direction.existingCoverage?.interpretation || "当前样本尚未形成可计算的主题覆盖。"}</p>
          <p><strong>为何尚不能判定已被充分综述：</strong>{direction.whyNotFullyReviewed || "当前尚未完成同题综述逐篇比较。"}</p>
          <p className="rawb-report-method-note"><strong>不能提前承诺：</strong>低频不等于空白，已有综述也不等于问题已解决。正式立题必须完成竞争综述与原始研究量核查。</p>
        </article>
        <article>
          <h3>范围定义与 PICO / PCC</h3>
          <p>{direction.reviewPlan?.populationAndComparison || direction.scopeDefinition || direction.recommendedQuestion || "第二轮需冻结对象/人群、核心概念或干预、比较条件、结局与研究场景。"}</p>
          {list(direction.coreOutcomes).length ? (
            <p><strong>核心结局：</strong>{direction.coreOutcomes.join("、")}</p>
          ) : null}
        </article>
        <article>
          <h3>文献组织思路</h3>
          <ol>{list(direction.organization).length
            ? list(direction.organization).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
            : list(direction.outline).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol>
        </article>
        <article>
          <h3>工作量、执行与降级条件</h3>
          <p><strong>文献量目标：</strong>{direction.workload?.targetCoreLiterature || "下一轮窄检索后估算"}；<strong>周期：</strong>{direction.workload?.timeline || "待评估"}；<strong>难度：</strong>{direction.workload?.difficulty || "待评估"}</p>
          <ol>{(plan.length ? plan : [
            "第1–2周：完成竞争综述检索、问题冻结与协议草案。",
            "第3–6周：筛选、去重、范围收窄并预估核心文献量。",
            "第7–9周：提取证据、质量评价并形成比较框架。",
            "第10–12周：综合、写作、导师核查与版本冻结。",
          ]).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol>
          <p><strong>立题门槛：</strong>{direction.verificationGate || "完成第二轮窄检索后再判断。"}</p>
          <p><strong>放弃或降级条件：</strong>{joinChineseSentences(abandonConditions)}</p>
        </article>
      </section>

      {onSelectionReasonChange ? (
        <section className="rawb-report-decision-form" aria-labelledby="rawb-report-decision-form-title">
          <h3 id="rawb-report-decision-form-title">记录研究者决定</h3>
          <label>
            <span>为什么本轮采用这个方向</span>
            <textarea
              value={selectionReason}
              disabled={interactionDisabled}
              onChange={(event) => onSelectionReasonChange(event.target.value)}
              placeholder="写明科研价值、可行性、团队条件或当前最值得消除的不确定性。"
              rows={3}
              maxLength={2000}
            />
          </label>
          <label>
            <span>其余方向为什么暂缓</span>
            <textarea
              value={deferredReason}
              disabled={interactionDisabled}
              onChange={(event) => onDeferredReasonChange?.(event.target.value)}
              placeholder="写明暂缓依据；保留为下一轮备选，不把未采用误写为没有价值。"
              rows={2}
              maxLength={2000}
            />
          </label>
        </section>
      ) : null}
    </div>
  );
}

function EvidenceRowsTable({ rows, caption }) {
  return (
    <div className="rawb-report-evidence__table-wrap">
      <table>
        <caption>{caption}</caption>
        <thead><tr><th>PMID</th><th>题名</th><th>年份</th><th>期刊</th><th>访问层级</th></tr></thead>
        <tbody>
          {rows.map((row, index) => {
            const href = row?.locator?.url ?? (row?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(row.pmid)}/` : null);
            return (
              <tr key={row.sourceId ?? row.pmid ?? index}>
                <td>{href ? <a href={href} target="_blank" rel="noreferrer">{row.pmid || "查看来源"}</a> : row.pmid || "未返回"}</td>
                <td>{row.title}</td><td>{row.year}</td><td>{row.journal}</td><td>{accessLabel(row.accessLevel)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceDrawer({ model, evidenceRows, chapterLabel, open, onClose, drawerRef }) {
  return (
    <section
      className="rawb-report-evidence"
      hidden={!open}
      ref={drawerRef}
      tabIndex={-1}
      aria-labelledby="rawb-report-evidence-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <header>
        <div><h2 id="rawb-report-evidence-title">{chapterLabel} · 本节分析依据</h2><p>先显示本章直接引用的代表性记录；完整纳入账本仍可展开核验。</p></div>
        <button type="button" onClick={onClose}>关闭依据</button>
      </header>
      <dl className="rawb-report-binding">
        <div><dt>项目</dt><dd>{model.binding?.projectId ?? "建项前预检"}</dd></div>
        <div><dt>来源集合</dt><dd>{model.binding?.sourceSetHash ? model.binding.sourceSetHash.slice(0, 12) : "预检指纹待绑定"}</dd></div>
        <div><dt>报告版本</dt><dd>{model.binding?.reportRevision ?? "建项后生成"}</dd></div>
        <div><dt>内容指纹</dt><dd>{model.binding?.reportHash ? model.binding.reportHash.slice(0, 12) : "报告内容指纹缺失"}</dd></div>
        <div><dt>相关性门禁</dt><dd>{model.relevanceGate?.status === "passed" ? "已通过" : model.relevanceGate?.status === "blocked" ? "已阻断" : "建项前待核"}</dd></div>
      </dl>
      {evidenceRows.length ? (
        <EvidenceRowsTable rows={evidenceRows} caption={`本章直接引用的 ${evidenceRows.length} 篇代表性记录`} />
      ) : <p className="rawb-report-empty">本章结论尚未映射到可定位的代表性记录；在补齐映射前只能作为方法提示。</p>}
      {model.rows.length > evidenceRows.length ? (
        <details className="rawb-report-screening-ledger">
          <summary>查看完整纳入账本（{model.rows.length} 篇）</summary>
          <EvidenceRowsTable rows={model.rows} caption={`纳入当前分析的 ${model.rows.length} 篇样本`} />
        </details>
      ) : null}
      {!model.rows.length ? <p className="rawb-report-empty">逐条账本尚未返回，因此本报告不能作为正式可审计结果。</p> : null}
      {model.excludedRows.length ? (
        <details className="rawb-report-screening-ledger">
          <summary>查看筛选处置账本（{model.excludedRows.length} 条未进入当前分析）</summary>
          <p>这里单列检索记录的处置，不把排除项计入“{model.claimLabels.sampleObservation}”或章节统计。</p>
          <div className="rawb-report-evidence__table-wrap">
            <table>
              <caption>未进入当前分析的检索记录</caption>
              <thead><tr><th>PMID</th><th>题名</th><th>处置</th><th>可复核理由</th></tr></thead>
              <tbody>
                {model.excludedRows.map((row, index) => (
                  <tr key={row.sourceId ?? row.pmid ?? index}>
                    <td>{row.pmid || "未返回"}</td>
                    <td>{row.title}</td>
                    <td>{screeningDispositionLabel(row)}</td>
                    <td>{row.exclusionReason || "当前账本未返回具体理由。"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      <p className="rawb-report-evidence__boundary"><strong>结论边界：</strong>{model.reportBoundary}</p>
    </section>
  );
}

function downloadMentorBrief(model, options = {}) {
  if (!globalThis.document || !globalThis.Blob || !globalThis.URL?.createObjectURL) return;
  const blob = new Blob([buildMentorBrief(model, options)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "综述选题导师简报.md";
  link.click();
  URL.revokeObjectURL(url);
}

export function ResearchReviewReport({
  landscape,
  researchReport = null,
  firstRound = null,
  secondRound = null,
  selectedDirectionId = "",
  lockedDirection = null,
  selectionReason = "",
  deferredReason = "",
  onDirectionSelect = null,
  onSelectionReasonChange = null,
  onDeferredReasonChange = null,
  onPrimaryAction = null,
  primaryActionLabel = "确认方向并开始第二轮窄检索",
  busy = false,
  storageKey = "research-review-report",
  currentBinding = null,
}) {
  const tabBase = useId();
  const drawerRef = useRef(null);
  const evidenceButtonRef = useRef(null);
  const lockedReviewDirection = useMemo(() => {
    if (!lockedDirection?.id) return null;
    if (!firstRound || !lockedDirection?.reportBinding) return null;
    const firstRoundModel = buildResearchReviewReportModel({
      landscape: firstRound?.reviewLandscape ?? firstRound,
      selectedDirectionId: lockedDirection.id,
    });
    const canRebind = Boolean(
      lockedDirection?.reportBinding
      && !researchReportBindingStatus(firstRoundModel.binding, lockedDirection.reportBinding).stale,
    );
    if (!canRebind) return null;
    const resolved = firstRoundModel.selectedDirection;
    return resolved?.id === lockedDirection.id
      ? { ...resolved, reportBinding: lockedDirection.reportBinding, bindingVerified: true }
      : null;
  }, [firstRound, lockedDirection]);
  const model = useMemo(() => buildResearchReviewReportModel({
    landscape,
    researchReport,
    selectedDirectionId,
    lockedDirection: lockedReviewDirection,
  }), [landscape, lockedReviewDirection, researchReport, selectedDirectionId]);
  const comparison = useMemo(
    () => buildScopingRoundComparison(firstRound, secondRound),
    [firstRound, secondRound],
  );
  const [activeChapter, setActiveChapter] = useState(() => {
    try {
      const saved = globalThis.localStorage?.getItem(`${storageKey}:chapter`);
      return CHAPTERS.some((chapter) => chapter.id === saved) ? saved : "landscape";
    } catch {
      return "landscape";
    }
  });
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const activeIndex = chapterIndex(activeChapter);
  const activeChapterConfig = CHAPTERS[activeIndex];
  const chapterEvidenceRows = researchReportChapterEvidenceRows(
    model,
    activeChapter,
    selectedDirectionId || model.selectedDirection?.id || "",
  );
  const bindingStatus = researchReportBindingStatus(model.binding, currentBinding);
  const lockedSelectionStale = Boolean(lockedDirection?.id && !lockedReviewDirection);
  const staleBinding = Boolean(
    model.contract?.stale === true
    || model.binding?.status === "stale"
    || model.lockedSelectionStale
    || lockedSelectionStale
    || bindingStatus.stale,
  );
  const relevanceBlocked = Boolean(
    model.relevanceGate?.status === "blocked"
    || (model.contract && model.relevanceGate?.status !== "passed"),
  );
  const ledgerBlocked = model.ledgerIntegrity?.status !== "passed";
  const reportBlocked = staleBinding || relevanceBlocked || ledgerBlocked;
  const selectionIdentified = Boolean(
    lockedReviewDirection?.id
    || model.directions.some((direction) => direction.id === selectedDirectionId),
  );
  const decisionReady = selectionIdentified
    && Array.from(selectionReason.trim()).length >= 4
    && (model.directions.length < 2 || Array.from(deferredReason.trim()).length >= 4);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(`${storageKey}:chapter`, activeChapter);
    } catch {
      // Report navigation remains usable when storage is unavailable.
    }
  }, [activeChapter, storageKey]);

  function selectChapter(id, { focus = false } = {}) {
    setActiveChapter(id);
    if (focus) {
      globalThis.requestAnimationFrame?.(() => {
        globalThis.document?.getElementById(`${tabBase}-${id}-tab`)?.focus();
      });
    }
  }

  function handleTabKeyDown(event) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const id = reportChapterIdForKey(activeChapter, event.key);
    if (id) selectChapter(id, { focus: true });
  }

  function openEvidence() {
    evidenceButtonRef.current = globalThis.document?.activeElement ?? null;
    setEvidenceOpen(true);
    globalThis.requestAnimationFrame?.(() => drawerRef.current?.focus({ preventScroll: false }));
  }

  function closeEvidence() {
    setEvidenceOpen(false);
    globalThis.requestAnimationFrame?.(() => evidenceButtonRef.current?.focus({ preventScroll: true }));
  }

  function handlePrimary() {
    if (activeIndex < CHAPTERS.length - 1) {
      selectChapter(CHAPTERS[activeIndex + 1].id, { focus: true });
      return;
    }
    onPrimaryAction?.();
  }

  const nextLabel = activeIndex < CHAPTERS.length - 1
    ? `继续到${CHAPTERS[activeIndex + 1].label}`
    : primaryActionLabel;

  return (
    <section className="rawb-four-chapter-report" aria-labelledby={`${tabBase}-title`}>
      <header className="rawb-four-chapter-report__header">
        <div>
          <span>科研工作台 · 综述选题报告</span>
          <h1 id={`${tabBase}-title`}>{String(activeIndex + 1).padStart(2, "0")} {activeChapterConfig.title}</h1>
          <p>{model.periodLabel} · {model.claimLabels.sampleObservation} · 题名与摘要级</p>
          <div className="rawb-report-claim-legend" aria-label="报告结论层级">
            <ClaimLabel>{model.claimLabels.sampleObservation}</ClaimLabel>
            <ClaimLabel tone="external">{model.claimLabels.externalReviewCheck}</ClaimLabel>
            <ClaimLabel tone="inference">{model.claimLabels.researchOpportunityInference}</ClaimLabel>
          </div>
        </div>
        <button
          type="button"
          className="rawb-report-export"
          disabled={reportBlocked}
          onClick={() => downloadMentorBrief(model, { selectionReason, deferredReason })}
        >导出导师简报</button>
      </header>

      {relevanceBlocked ? (
        <p className="rawb-report-blocker" role="alert">研究对象相关性门禁未通过或缺失：当前样本不能进入正式报告、选题决定或导出。</p>
      ) : null}
      {ledgerBlocked ? <p className="rawb-report-blocker" role="alert">账本完整性门禁未通过：{model.ledgerIntegrity.boundary}</p> : null}
      {staleBinding ? (
        <p className="rawb-report-blocker" role="alert">报告或方向绑定已经过期：{bindingStatus.mismatches.length ? `${bindingStatus.mismatches.join("、")} 与当前项目不一致或缺失。` : "当前报告、首轮方向或内容绑定无法重新核验。"}请返回检索校准并重新扫描；旧报告保留为只读记录，不能导出或用于选题。</p>
      ) : null}

      <div className="rawb-report-tabs" role="tablist" aria-label="综述选题报告章节" onKeyDown={handleTabKeyDown}>
        {CHAPTERS.map((chapter) => (
          <button
            key={chapter.id}
            id={`${tabBase}-${chapter.id}-tab`}
            type="button"
            role="tab"
            aria-selected={activeChapter === chapter.id}
            aria-controls={`${tabBase}-${chapter.id}-panel`}
            tabIndex={activeChapter === chapter.id ? 0 : -1}
            className={activeChapter === chapter.id ? "is-active" : ""}
            onClick={() => selectChapter(chapter.id)}
          >
            {chapter.label}
          </button>
        ))}
      </div>

      <section
        id={`${tabBase}-${activeChapter}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabBase}-${activeChapter}-tab`}
        tabIndex={0}
        className="rawb-report-panel"
      >
        {activeChapter === "landscape" ? <FieldLandscapeChapter model={model} /> : null}
        {activeChapter === "trends" ? <TrendChapter model={model} /> : null}
        {activeChapter === "opportunities" ? (
          <OpportunityChapter model={model} selectedDirectionId={selectedDirectionId} onDirectionSelect={onDirectionSelect} interactionDisabled={reportBlocked} />
        ) : null}
        {activeChapter === "plan" ? (
          <>
            <RoundComparison comparison={comparison} />
            <PlanChapter
              model={model}
              selectionReason={selectionReason}
              deferredReason={deferredReason}
              onSelectionReasonChange={onSelectionReasonChange}
              onDeferredReasonChange={onDeferredReasonChange}
              interactionDisabled={reportBlocked}
            />
          </>
        ) : null}
      </section>

      <footer className="rawb-report-actions">
        <button type="button" className="rawb-report-evidence-entry" aria-expanded={evidenceOpen} onClick={evidenceOpen ? closeEvidence : openEvidence}>
          {evidenceOpen ? "收起本节分析依据" : `查看本节分析依据（${chapterEvidenceRows.length}篇代表性记录）`}
        </button>
        {(activeIndex < CHAPTERS.length - 1 || onPrimaryAction) ? (
          <button
            type="button"
            className="rawb-report-primary"
            onClick={handlePrimary}
            disabled={busy || reportBlocked || (activeIndex === CHAPTERS.length - 1 && onPrimaryAction && !decisionReady)}
          >
            {busy && activeIndex === CHAPTERS.length - 1 ? "正在进入第二轮…" : nextLabel}
          </button>
        ) : null}
      </footer>

      <EvidenceDrawer model={model} evidenceRows={chapterEvidenceRows} chapterLabel={activeChapterConfig.label} open={evidenceOpen} onClose={closeEvidence} drawerRef={drawerRef} />
      <p className="rawb-four-chapter-report__boundary"><strong>证据与责任边界：</strong>{model.reportBoundary}</p>
    </section>
  );
}
