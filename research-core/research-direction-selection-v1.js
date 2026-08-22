import { sha256 } from "./event-engine-v1.js";

export const RESEARCH_DIRECTION_SELECTION_SCHEMA_VERSION =
  "research-direction-selection/v1";

export class ResearchDirectionSelectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ResearchDirectionSelectionError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ResearchDirectionSelectionError(code, message, details);
}

function hasText(value, minimum = 1) {
  return typeof value === "string" && Array.from(value.trim()).length >= minimum;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maximum = 2_000) {
  return String(value ?? "").normalize("NFKC").trim().slice(0, maximum);
}

function directionCandidates(preview) {
  return asArray(
    preview?.reviewLandscape?.synthesis?.directionReport?.directions,
  );
}

const DIRECTION_FOCUS_QUERIES = Object.freeze({
  early_detection_screening: '("Early Detection of Cancer"[Mesh] OR screening[Title/Abstract] OR "early detection"[Title/Abstract] OR radiomics[Title/Abstract])',
  biomarkers_molecular: '("Biomarkers"[Mesh] OR biomarker*[Title/Abstract] OR molecular[Title/Abstract] OR genomic*[Title/Abstract] OR mutation*[Title/Abstract])',
  targeted_therapy: '("Molecular Targeted Therapy"[Mesh] OR "targeted therapy"[Title/Abstract] OR "tyrosine kinase inhibitor"[Title/Abstract] OR TKI[Title/Abstract])',
  immunotherapy: '("Immunotherapy"[Mesh] OR immunotherap*[Title/Abstract] OR "immune checkpoint"[Title/Abstract] OR PD-1[Title/Abstract] OR PD-L1[Title/Abstract])',
  perioperative_treatment: '("Perioperative Care"[Mesh] OR perioperative[Title/Abstract] OR neoadjuvant[Title/Abstract] OR adjuvant[Title/Abstract])',
  local_treatment: '("Radiotherapy"[Mesh] OR "Surgical Procedures, Operative"[Mesh] OR surgery[Title/Abstract] OR radiotherap*[Title/Abstract] OR ablation[Title/Abstract])',
  advanced_metastatic: '("Neoplasm Metastasis"[Mesh] OR advanced[Title/Abstract] OR metastatic[Title/Abstract] OR metastasis[Title/Abstract])',
  resistance_microenvironment: '("Drug Resistance, Neoplasm"[Mesh] OR resistance[Title/Abstract] OR resistant[Title/Abstract] OR "tumor microenvironment"[Title/Abstract] OR "tumour microenvironment"[Title/Abstract])',
  toxicity_supportive: '("Treatment Outcome"[Mesh] OR toxicity[Title/Abstract] OR safety[Title/Abstract] OR "supportive care"[Title/Abstract] OR "adverse event"[Title/Abstract])',
  survivorship_quality_of_life: '("Quality of Life"[Mesh] OR survivorship[Title/Abstract] OR "quality of life"[Title/Abstract] OR "patient-reported"[Title/Abstract])',
  ai_digital: '("Artificial Intelligence"[Mesh] OR "artificial intelligence"[Title/Abstract] OR "machine learning"[Title/Abstract] OR "deep learning"[Title/Abstract])',
  prevention_epidemiology: '("Epidemiology"[Subheading] OR prevention[Title/Abstract] OR epidemiolog*[Title/Abstract] OR "risk factor"[Title/Abstract])',
});

const DIRECTION_FOCUS_MAPPINGS = Object.freeze({
  early_detection_screening: { meshTerms: ["Early Detection of Cancer"], mappedTerms: ["screening", "early detection", "radiomics"] },
  biomarkers_molecular: { meshTerms: ["Biomarkers"], mappedTerms: ["biomarker", "molecular", "genomic", "mutation"] },
  targeted_therapy: { meshTerms: ["Molecular Targeted Therapy"], mappedTerms: ["targeted therapy", "tyrosine kinase inhibitor", "TKI"] },
  immunotherapy: { meshTerms: ["Immunotherapy"], mappedTerms: ["immunotherapy", "immune checkpoint", "PD-1", "PD-L1"] },
  perioperative_treatment: { meshTerms: ["Perioperative Care"], mappedTerms: ["perioperative", "neoadjuvant", "adjuvant"] },
  local_treatment: { meshTerms: ["Radiotherapy", "Surgical Procedures, Operative"], mappedTerms: ["surgery", "radiotherapy", "ablation"] },
  advanced_metastatic: { meshTerms: ["Neoplasm Metastasis"], mappedTerms: ["advanced", "metastatic", "metastasis"] },
  resistance_microenvironment: { meshTerms: ["Drug Resistance, Neoplasm"], mappedTerms: ["resistance", "resistant", "tumor microenvironment", "tumour microenvironment"] },
  toxicity_supportive: { meshTerms: ["Treatment Outcome"], mappedTerms: ["toxicity", "safety", "supportive care", "adverse event"] },
  survivorship_quality_of_life: { meshTerms: ["Quality of Life"], mappedTerms: ["survivorship", "quality of life", "patient-reported"] },
  ai_digital: { meshTerms: ["Artificial Intelligence"], mappedTerms: ["artificial intelligence", "machine learning", "deep learning"] },
  prevention_epidemiology: { meshTerms: [], mappedTerms: ["prevention", "epidemiology", "risk factor"] },
});

function sourceCandidateFor(preview) {
  const selectedId = preview?.reviewLandscape?.selectedCandidateId;
  return asArray(preview?.candidates).find((candidate) => candidate.id === selectedId)
    ?? asArray(preview?.candidates).find((candidate) => candidate.status === "ready")
    ?? null;
}

function broadResearchSubjectFor(sourceQuestion) {
  const question = cleanText(sourceQuestion, 900)
    .replace(/[.。!！?？]+$/u, "")
    .trim();
  const match = question.match(
    /^(?<subject>[^,，;；:：?？.!！。\n]{1,80}?)(?:(?:的)?研究)?(?:现状|进展|概况|趋势)(?:如何|怎样|是什么)?$/u,
  );
  const subject = cleanText(match?.groups?.subject, 900);
  return subject || null;
}

function narrowedQuestionFor({ selectedDirection, sourceQuestion }) {
  const source = cleanText(sourceQuestion, 1_200);
  const recommended = cleanText(selectedDirection?.recommendedQuestion, 1_200);
  const broadSubject = broadResearchSubjectFor(source);
  if (broadSubject && hasText(recommended, 4)) {
    return `${broadSubject}：${recommended}`.slice(0, 1_200);
  }
  // Outside the narrow, explicit orientation-title grammar above, the source
  // question is researcher-authored authority and must not be diluted by a
  // generic evidence-derived direction template.
  if (hasText(source, 1) && !broadSubject) return source;
  const direction = cleanText(selectedDirection?.direction, 240);
  if (hasText(source, 1)) return `${source}；第二轮聚焦：${direction}`.slice(0, 1_200);
  if (hasText(recommended, 4)) return recommended;
  return direction;
}

export function buildResearchDirectionSelection({
  preview,
  selectedDirectionId,
  selectionReason,
  deferredReason,
  actor,
  selectedAt = new Date().toISOString(),
} = {}) {
  if (!preview || typeof preview !== "object") {
    fail("DIRECTION_PREVIEW_REQUIRED", "方向选择必须绑定当前综述扫描结果。");
  }
  if (!/^[a-f0-9]{64}$/i.test(preview.planHash ?? "")) {
    fail("INVALID_DIRECTION_PREVIEW", "综述扫描缺少可验证的计划指纹。");
  }
  const candidates = directionCandidates(preview);
  const selectedDirection = candidates.find(
    (candidate) => candidate.id === selectedDirectionId,
  );
  if (!selectedDirection) {
    fail("UNKNOWN_RESEARCH_DIRECTION", "请选择当前报告中实际存在的研究方向。");
  }
  const normalizedSelectionReason = cleanText(selectionReason);
  const normalizedDeferredReason = cleanText(deferredReason);
  if (!hasText(normalizedSelectionReason, 4)) {
    fail("DIRECTION_SELECTION_REASON_REQUIRED", "请用至少 4 个字说明采用这个方向的理由。");
  }
  if (candidates.length > 1 && !hasText(normalizedDeferredReason, 4)) {
    fail("DIRECTION_DEFERRED_REASON_REQUIRED", "请说明其余方向本轮暂缓的理由。");
  }
  if (!actor?.id || actor?.kind !== "human") {
    fail("HUMAN_DIRECTION_OWNER_REQUIRED", "研究方向必须由真实研究者选择。");
  }
  if (!hasText(selectedAt) || Number.isNaN(Date.parse(selectedAt))) {
    fail("INVALID_DIRECTION_SELECTION_TIME", "方向选择时间无效。");
  }

  const sourceQuestion = cleanText(preview.question, 1_200);
  const sourceCandidate = sourceCandidateFor(preview);
  const sourceQuery = cleanText(sourceCandidate?.query, 2_000);
  const focusQuery = DIRECTION_FOCUS_QUERIES[selectedDirection.themeId] ?? null;
  const focusTerms = DIRECTION_FOCUS_MAPPINGS[selectedDirection.themeId] ?? null;
  const suggestedQuery = focusQuery && sourceQuery
    ? `(${sourceQuery}) AND ${focusQuery}`.slice(0, 4_000)
    : sourceQuery;
  const narrowedQuestion = narrowedQuestionFor({ selectedDirection, sourceQuestion });
  const deferredDirections = candidates
    .filter((candidate) => candidate.id !== selectedDirection.id)
    .map((candidate) => ({
      id: candidate.id,
      direction: cleanText(candidate.direction, 240),
      reason: normalizedDeferredReason,
      disposition: "deferred",
    }));
  const body = {
    schemaVersion: RESEARCH_DIRECTION_SELECTION_SCHEMA_VERSION,
    sourceRound: 1,
    sourcePreviewPlanHash: preview.planHash,
    sourceQuestion,
    sourceQuery,
    selectedDirection: {
      id: selectedDirection.id,
      themeId: selectedDirection.themeId ?? null,
      gapId: selectedDirection.gapId ?? null,
      direction: cleanText(selectedDirection.direction, 240),
      recommendedQuestion: cleanText(selectedDirection.recommendedQuestion, 1_200),
      whySuitable: cleanText(selectedDirection.whySuitable, 2_000),
      sourceIds: asArray(selectedDirection.sourceIds).map(String),
      studyPlan: selectedDirection.studyPlan && typeof selectedDirection.studyPlan === "object"
        ? structuredClone(selectedDirection.studyPlan)
        : null,
    },
    selectionReason: normalizedSelectionReason,
    deferredDirections,
    selectedBy: {
      id: String(actor.id),
      role: String(actor.role ?? "human_researcher"),
      kind: "human",
    },
    selectedAt: new Date(selectedAt).toISOString(),
    narrowedBrief: {
      schemaVersion: "research-narrowed-question-brief/v1",
      question: narrowedQuestion,
      suggestedQuery,
      focusMapping: focusTerms
        ? {
            conceptId: selectedDirection.themeId,
            sourceTerm: cleanText(selectedDirection.direction, 240),
            role: "selected_direction",
            meshTerms: [...focusTerms.meshTerms],
            mappedTerms: [...focusTerms.mappedTerms],
            wildcardTerms: [],
            proximityTerms: [],
          }
        : null,
      queryRationale: focusQuery
        ? "继承首轮已确认的研究对象词群，并只追加被选方向的 MeSH/题名摘要词；正式执行前仍需研究者核对。"
        : "当前方向没有可靠的预设英文词群；暂时继承首轮检索式，等待研究者在第二轮人工补词。",
      populationAndComparison: cleanText(
        selectedDirection.studyPlan?.populationAndComparison,
        1_500,
      ) || "当前摘要未形成足够具体的人群与比较边界，第二轮检索后由研究者确认。",
      studyDesign: cleanText(selectedDirection.studyPlan?.studyDesign, 1_000)
        || "研究设计待第二轮检索校准后确认。",
      coreOutcomes: asArray(selectedDirection.studyPlan?.coreOutcomes)
        .map((item) => cleanText(item, 240))
        .filter(Boolean),
      evidenceBoundary:
        "该问题由当前 PubMed 综述题名与可用摘要生成，是第二轮检索假设，不是研究空白定论、因果结论或临床建议。",
      nextDecision:
        "围绕收窄后的问题重新生成检索式，完成前 100 篇反馈校准与近五年综述扫描，再决定是否建立正式项目。",
    },
  };
  return { ...body, decisionHash: sha256(body) };
}

export function validateResearchDirectionSelection(value) {
  const issues = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["direction selection must be an object"];
  }
  if (value.schemaVersion !== RESEARCH_DIRECTION_SELECTION_SCHEMA_VERSION) {
    issues.push("unsupported direction selection schemaVersion");
  }
  if (!/^[a-f0-9]{64}$/i.test(value.sourcePreviewPlanHash ?? "")) {
    issues.push("sourcePreviewPlanHash must be SHA-256");
  }
  if (!/^[a-f0-9]{64}$/i.test(value.decisionHash ?? "")) {
    issues.push("decisionHash must be SHA-256");
  }
  if (!hasText(value.sourceQuestion, 4)) issues.push("sourceQuestion is required");
  if (!hasText(value.sourceQuery, 3)) issues.push("sourceQuery is required");
  if (!hasText(value.selectionReason, 4)) issues.push("selectionReason is required");
  if (!hasText(value.selectedDirection?.id)) issues.push("selectedDirection.id is required");
  if (!hasText(value.selectedDirection?.direction)) issues.push("selectedDirection.direction is required");
  if (!hasText(value.narrowedBrief?.question, 4)) issues.push("narrowedBrief.question is required");
  if (value.selectedBy?.kind !== "human" || !hasText(value.selectedBy?.id)) {
    issues.push("selectedBy must identify a human actor");
  }
  if (!hasText(value.selectedAt) || Number.isNaN(Date.parse(value.selectedAt))) {
    issues.push("selectedAt must be a valid ISO date");
  }
  if (!Array.isArray(value.deferredDirections)) {
    issues.push("deferredDirections must be an array");
  } else if (value.deferredDirections.some((item) => (
    !hasText(item?.id) || !hasText(item?.direction) || !hasText(item?.reason, 4)
  ))) {
    issues.push("every deferred direction requires id, direction, and reason");
  }
  if (/^[a-f0-9]{64}$/i.test(value.decisionHash ?? "")) {
    const { decisionHash: _decisionHash, ...body } = value;
    if (sha256(body) !== value.decisionHash.toLowerCase()) {
      issues.push("decisionHash does not match direction selection content");
    }
  }
  return issues;
}

export function assertValidResearchDirectionSelection(value) {
  const issues = validateResearchDirectionSelection(value);
  if (issues.length) {
    fail("INVALID_RESEARCH_DIRECTION_SELECTION", issues.join("; "), { issues });
  }
  return value;
}
