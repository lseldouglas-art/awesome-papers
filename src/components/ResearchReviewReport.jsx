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
  { id: "trends", label: "五年趋势", title: "近五年趋势与选题分析" },
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

function decisionGroupSummary(groupId) {
  const summaries = {
    risk_detection: "重点看哪些人需要更早识别、在什么场景使用何种检测，以及风险边界怎样定义。",
    treatment_decision: "重点看治疗适用人群、比较策略、结局标准和真实实施边界。",
    stratification_monitoring: "重点看分层变量、验证层级，以及研究结果能否真正改变决策。",
    unmapped_themes: "这些主题还没有进入既有决策链，需要人工复核后再用于选题。",
  };
  return summaries[groupId] ?? "这些数字只表示当前样本覆盖；正式选题仍需回到具体人群、比较和结局。";
}

function directionOrganization(direction) {
  const items = list(direction?.organization ?? direction?.reviewPlan?.organization ?? direction?.outline).slice(0, 4);
  return items.length ? items.join(" → ") : "先冻结问题边界，再按比较策略、核心结局与验证层级组织文献。";
}

function directionWorkload(direction) {
  return [
    direction?.reviewPlan?.reviewType,
    direction?.workload?.targetCoreLiterature,
    direction?.workload?.timeline,
    direction?.workload?.difficulty ? `难度${direction.workload.difficulty}` : null,
  ].filter(Boolean).join(" · ") || "工作量需在窄检索后确认";
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
          <h3 id="rawb-report-rounds-title">问题如何从领域扫描收窄到聚焦检索</h3>
        </div>
        <p>{comparison.boundary}</p>
      </header>
      <div className="rawb-report-rounds__grid">
        {[comparison.first, comparison.second].map((round, index) => (
          <article key={index === 0 ? "first" : "second"}>
            <span>{index === 0 ? "领域扫描" : "聚焦检索"}</span>
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
        <h2 className="rawb-report-reader-title"><span aria-hidden="true">01</span>这个领域，目前能确定什么？</h2>
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
          <div><h3>当前需要解决的具体问题</h3></div>
          <p>问题来自摘要明确报告的限制；摘要未报告仍保持未知。</p>
        </header>
        <FindingList items={model.majorProblems} empty="当前摘要未形成可稳定聚类的问题信号；不能据此写成领域没有问题。" />
      </section>

      <section className="rawb-report-wide-section">
        <header className="rawb-report-section-heading">
          <div><h3>新入门研究者的关键判断点</h3></div>
          <p>这些是研究方法约束；领域级判断仍需指南、关键全文和高质量综述单独核查。</p>
        </header>
        <FindingList items={model.newcomerGuide} />
      </section>
    </div>
  );
}

function TrendChapter({ model }) {
  const groups = model.decisionStructure.slice(0, 3);
  const maxThemeCount = Math.max(
    1,
    ...groups.flatMap((group) => list(group.items).map((item) => Number(item?.count) || 0)),
  );
  const structuralInsights = [
    ...model.selectionPatterns,
    ...model.metadataPatternInsights,
  ].slice(0, 3);
  const structuralLabels = ["问题层级", "证据标准", "转化门槛"];
  const directInsights = [
    ...model.trendInsights,
    ...model.metadataPatternInsights,
  ].slice(0, 5);
  const finalJudgment = model.selectionPatterns[0]?.conclusion
    ?? "优先选择能够明确人群、比较条件、核心结局和验证门槛的问题，再用同题综述窄检索确认新增价值。";

  return (
    <div className="rawb-report-trend-brief">
      <header className="rawb-report-trend-brief__intro">
        <h2><span aria-hidden="true">02</span>近五年，研究重点如何变化？</h2>
        <p>本章把当前样本中的主题变化翻译成选题判断；数字只说明这批题名与摘要的覆盖，不代表全领域发文量。</p>
        {model.stratifiedAllocation ? (
          <p className="rawb-report-trend-boundary"><strong>阅读边界：</strong>当前样本按连续 12 个月窗口等额选取；年份计数只能说明样本构成，不能证明“领域升温”或“发文增长”。</p>
        ) : null}
      </header>

      <div className="rawb-report-trend-columns">
        <div className="rawb-report-trend-columns__left">
          <section className="rawb-report-trend-section" aria-labelledby="rawb-report-trend-branches-title">
            <header>
              <h3 id="rawb-report-trend-branches-title">一、热点研究分支</h3>
              <p>主题可重叠；覆盖度表示当前样本中的研究密度。</p>
            </header>
            {groups.length ? (
              <ol className="rawb-report-trend-groups">
                {groups.map((group) => (
                  <li key={group.id}>
                    <strong>{group.label}</strong>
                    <div className="rawb-report-trend-groups__bars">
                      {list(group.items).slice(0, 2).map((item, itemIndex) => {
                        const count = Number(item?.count) || 0;
                        const width = Math.max(7, Math.round((count / maxThemeCount) * 100));
                        return (
                          <div key={item.id ?? item.label}>
                            <span>{item.label}</span>
                            <i aria-hidden="true"><i className={itemIndex === 0 ? "is-primary" : "is-secondary"} style={{ width: `${width}%` }} /></i>
                            <b>{count}/{model.analyzedCount}</b>
                          </div>
                        );
                      })}
                    </div>
                    <p>{decisionGroupSummary(group.id)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <DistributionBars items={model.themeDistribution.slice(0, 6)} total={model.analyzedCount} />
            )}
          </section>

          <section className="rawb-report-trend-section is-structure" aria-labelledby="rawb-report-trend-structure-title">
            <header>
              <h3 id="rawb-report-trend-structure-title">二、近五年的结构性演变</h3>
              <p>从描述主题，走向可以比较和验证的研究问题。</p>
            </header>
            <dl>
              {structuralInsights.map((item, index) => (
                <div key={item?.id ?? `${item?.title}-${index}`}>
                  <dt>{structuralLabels[index]}</dt>
                  <dd><strong>{item?.title}</strong><span>{conclusion(item)}</span></dd>
                </div>
              ))}
            </dl>
            <p className="rawb-report-trend-section__takeaway">选题价值不再由技术名词是否新决定，而由它能否减少一个具体科研或临床决定的不确定性决定。</p>
          </section>
        </div>

        <div className="rawb-report-trend-columns__right">
          <section className="rawb-report-trend-section is-conclusions" aria-labelledby="rawb-report-trend-conclusions-title">
            <header>
              <h3 id="rawb-report-trend-conclusions-title">三、从当前样本中直接得到的选题结论</h3>
            </header>
            <FindingList items={directInsights} empty="当前样本还不能形成可复核的选题结论。" />
          </section>

          <section className="rawb-report-trend-section is-final" aria-labelledby="rawb-report-trend-final-title">
            <header><h3 id="rawb-report-trend-final-title">四、最后怎么判断</h3></header>
            <p>{finalJudgment}</p>
            <p className="rawb-report-trend-formula"><strong>选题公式</strong><span>明确人群 × 临床场景 × 比较策略 × 核心结局 × 验证层级</span></p>
          </section>
        </div>
      </div>
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
        <h2 className="rawb-report-reader-title"><span aria-hidden="true">03</span>下一步，哪些研究问题最值得继续验证？</h2>
        <p className="rawb-report-lead">{model.opportunityThesis}</p>
        <p className="rawb-report-method-note"><strong>判断原则：</strong>候选方向只有在近两年同题综述没有用相同人群、比较轴和核心结局充分回答，且原始研究量足以支持预设比较时，才值得正式立题。</p>
      </section>

      <fieldset className="rawb-report-opportunity-list">
        <legend>{onDirectionSelect ? "选择一个方向进入立题方案" : "候选方向比较"}</legend>
        <div className="rawb-report-opportunity-list__header" aria-hidden="true">
          <span>候选题目</span>
          <span>为什么值得写</span>
          <span>文献组织主线</span>
          <span>可行性与工作量</span>
        </div>
        {directions.map((direction, index) => {
          const selected = direction.id === selectedDirectionId;
          const content = (
            <>
              <span className="rawb-report-opportunity-list__rank">{String(index + 1).padStart(2, "0")}</span>
              <span className="rawb-report-opportunity-list__title">
                <strong>{directionTitle(direction)}</strong>
                <small><b>建议顺位</b>{direction.priority}</small>
              </span>
              <span className="rawb-report-opportunity-list__value" data-label="为什么值得写">
                <small>{direction.incrementalValueHypothesis || direction.whyPotentiallyValuable || direction.whyNotFullyReviewed}</small>
              </span>
              <span className="rawb-report-opportunity-list__organization" data-label="文献组织主线">
                <small>{directionOrganization(direction)}</small>
              </span>
              <span className="rawb-report-opportunity-list__workload" data-label="可行性与工作量">
                <small>{directionWorkload(direction)}</small>
                <small>先比较近两年同题综述，再决定是否立题。</small>
              </span>
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
          <div><h3>选题调研优化建议</h3></div>
          <p>按“同题综述比较—问题收窄—文献量估算—新增价值判断”的顺序完成立题。</p>
        </header>
        <ol>
          <li><strong>同题综述比较</strong><span>逐篇比较近两年综述、协议与伞状综述的问题、评价轴和更新日期。</span></li>
          <li><strong>问题收窄</strong><span>固定人群、疾病阶段、比较策略、核心结局与随访时间。</span></li>
          <li><strong>文献量估算</strong><span>报告命中、去重与初筛后的原始研究量；50–100篇只是工作量目标。</span></li>
          <li><strong>新增价值判断</strong><span>说明新综述将改变哪一种比较框架、标准化表格或临床决策。</span></li>
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
        <h2 className="rawb-report-reader-title"><span aria-hidden="true">04</span>选定方向后，怎样把这篇综述做完？</h2>
        <p className="rawb-report-lead">本章把当前方向转化为可执行的综述问题、文献结构和停止条件；标题、文献量与周期需用窄检索结果进一步校准。</p>
      </section>

      <aside className="rawb-report-selected-direction">
        <span>候选综述方向</span>
        <h3>{directionTitle(direction)}</h3>
        <dl>
          <div><dt>建议综述类型</dt><dd>{direction.reviewPlan?.reviewType || "依据窄检索结果选择"}</dd></div>
          <div><dt>核心文献目标</dt><dd>{direction.workload?.targetCoreLiterature ?? "窄检索后估算"}</dd></div>
          <div><dt>预估周期</dt><dd>{direction.workload?.timeline ?? "窄检索后估算"}</dd></div>
          <div><dt>预估难度</dt><dd>{direction.workload?.difficulty ?? "窄检索后估算"}</dd></div>
          <div><dt>首要核查</dt><dd>{direction.externalReviewVerified ? "比较同题综述的评价框架" : "近两年同题综述与协议"}</dd></div>
        </dl>
      </aside>

      <section className="rawb-report-plan-core">
        <article>
          <h3>为什么这个角度可能形成增量</h3>
          <p>{direction.incrementalValueHypothesis || direction.whyPotentiallyValuable || direction.whySuitable}</p>
          <p><strong>当前样本覆盖：</strong>{direction.existingCoverage?.interpretation || "当前样本尚未形成可计算的主题覆盖。"}</p>
          <p><strong>竞争性判断：</strong>{direction.whyNotFullyReviewed || "需逐篇比较同题综述的问题、评价轴与更新日期。"}</p>
          <p className="rawb-report-method-note"><strong>成立条件：</strong>低频本身不能证明空白；只有既有综述没有充分回答同一决策问题，且原始研究可支持预设比较时，候选增量才成立。</p>
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
          <p><strong>继续推进条件：</strong>{direction.verificationGate || "完成窄检索并比较同题综述后再判断。"}</p>
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

function EvidenceDrawer({ model, evidenceRows, chapterLabel, comparison, open, onClose, drawerRef }) {
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
      <details className="rawb-report-technical-audit">
        <summary>技术审计信息</summary>
        <p>以下内容供复现、故障诊断和版本核对使用，不参与前台的领域判断。</p>
        {model.technicalIntegrityBoundary ? <p>{model.technicalIntegrityBoundary}</p> : null}
        <dl className="rawb-report-binding">
          <div><dt>项目标识</dt><dd>{model.binding?.projectId ?? "建项前预检"}</dd></div>
          <div><dt>来源集合指纹</dt><dd>{model.binding?.sourceSetHash ? model.binding.sourceSetHash.slice(0, 12) : "尚未绑定"}</dd></div>
          <div><dt>报告版本</dt><dd>{model.binding?.reportRevision ?? "建项后生成"}</dd></div>
          <div><dt>内容指纹</dt><dd>{model.binding?.reportHash ? model.binding.reportHash.slice(0, 12) : "尚未生成"}</dd></div>
          <div><dt>相关性检查</dt><dd>{model.relevanceGate?.status === "passed" ? "通过" : model.relevanceGate?.status === "blocked" ? "阻断" : "建项前检查"}</dd></div>
        </dl>
        <RoundComparison comparison={comparison} />
      </details>
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
  question = "",
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
  const readerQuestion = String(
    question
    || landscape?.question
    || secondRound?.question
    || firstRound?.question
    || "",
  ).trim();
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
        <div className="rawb-four-chapter-report__identity">
          <span>科研工作台 · 综述选题报告</span>
          <h1 id={`${tabBase}-title`}>{readerQuestion ? `${readerQuestion}：领域图景与综述选题` : "领域图景与综述选题"}</h1>
          <p>{model.periodLabel} · {model.analyzedCount} 篇题名与摘要</p>
          <div className="rawb-report-scope-summary" aria-label="报告用途与证据边界">
            <span>用途：领域扫描与综述选题</span>
            <span>观察对象：近五年综述题名与摘要</span>
            <span>边界：不能单独证明研究空白或临床有效性</span>
          </div>
        </div>
        <div className="rawb-four-chapter-report__tools">
          <div className="rawb-four-chapter-report__utility">
            <button
              type="button"
              className="rawb-report-export"
              disabled={reportBlocked}
              onClick={() => downloadMentorBrief(model, { selectionReason, deferredReason })}
            >导出导师简报</button>
          </div>
        </div>
      </header>

      {relevanceBlocked ? (
        <p className="rawb-report-blocker" role="alert">当前样本与研究问题的相关性不足，不能用于领域判断、选题或导出；请返回检索校准并修订范围。</p>
      ) : null}
      {ledgerBlocked ? <p className="rawb-report-blocker" role="alert">纳入记录数量与报告分析分母不一致：{model.ledgerIntegrity.boundary}</p> : null}
      {staleBinding ? (
        <p className="rawb-report-blocker" role="alert">本报告使用的证据版本已不是当前版本。请返回检索校准并重新生成；旧报告只供追溯，不能导出或用于选题。</p>
      ) : null}

      <div className="rawb-report-navigation">
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
        <button type="button" className="rawb-report-evidence-entry" aria-expanded={evidenceOpen} onClick={evidenceOpen ? closeEvidence : openEvidence}>
          {evidenceOpen ? "收起本节分析依据" : `查看本节分析依据（${chapterEvidenceRows.length}篇）`}
        </button>
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
          <PlanChapter
            model={model}
            selectionReason={selectionReason}
            deferredReason={deferredReason}
            onSelectionReasonChange={onSelectionReasonChange}
            onDeferredReasonChange={onDeferredReasonChange}
            interactionDisabled={reportBlocked}
          />
        ) : null}
      </section>

      <footer className="rawb-report-actions">
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

      <EvidenceDrawer model={model} evidenceRows={chapterEvidenceRows} chapterLabel={activeChapterConfig.label} comparison={comparison} open={evidenceOpen} onClose={closeEvidence} drawerRef={drawerRef} />
      <p className="rawb-four-chapter-report__boundary"><strong>证据与责任边界：</strong>{model.reportBoundary}</p>
    </section>
  );
}
