import { projectRuntimeProvenanceAllowsFormal } from "./agent-run-log-v1.js";
import { resolveSignedExportAuthority } from "./export-authority-v1.js";
import { validateResearchArtifactContent } from "./artifact-contracts-v1.js";
import { validateRetrievalRun } from "./research-live-retrieval-v1.js";
import { sha256 } from "./event-engine-v1.js";

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function currentArtifacts(artifacts) {
  return (Array.isArray(artifacts) ? artifacts : []).filter(
    (artifact) =>
      artifact?.freshness !== "stale" &&
      !["rejected", "superseded"].includes(artifact?.status),
  );
}

function latestArtifact(artifacts, type) {
  return currentArtifacts(artifacts)
    .filter((artifact) => artifact?.type === type)
    .sort((left, right) => (right?.version ?? 0) - (left?.version ?? 0))[0] ?? null;
}

function sourceId(record) {
  return record?.sourceId ?? record?.id ?? null;
}

function sameOrderedValues(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function retrievalAuthorityForProject(project) {
  const runs = project?.retrievalRuns ?? {};
  const formalRuns = [
    runs.pilot,
    runs.orientationCorpus,
    ...(Array.isArray(runs.focusedCalibration) ? runs.focusedCalibration : []),
    runs.finalLibrary,
  ].filter(Boolean);
  const legacy = runs.legacyBootstrap ?? null;
  const preview = runs.previewSelection ?? null;
  return {
    stage: runs.finalLibrary
      ? "final_library"
      : formalRuns.length > 0
        ? "formal_retrieval_in_progress"
        : preview
          ? "preview_only"
          : legacy
            ? "legacy_single_receipt"
            : "not_started",
    finalLibraryReady: Boolean(runs.finalLibrary),
    formalRunCount: formalRuns.length,
    formalRuns,
    finalLibrary: runs.finalLibrary ?? null,
    previewSelection: preview,
    legacyBootstrap: legacy,
  };
}

export function validateFinalLibraryAuthority({ project, artifacts } = {}) {
  const issues = [];
  if (project?.researchMode !== "live_pubmed") {
    issues.push("project researchMode must equal live_pubmed");
  }
  const finalRun = project?.retrievalRuns?.finalLibrary ?? null;
  if (!finalRun) {
    issues.push("finalLibrary retrieval run is required");
    return issues;
  }
  issues.push(
    ...validateRetrievalRun(finalRun, { purpose: "finalLibrary" }).map(
      (issue) => `finalLibrary: ${issue}`,
    ),
  );

  const manifest = latestArtifact(artifacts, "LibraryManifest");
  if (!manifest?.content) {
    issues.push("a current LibraryManifest is required");
    return issues;
  }
  const content = manifest.content;
  issues.push(
    ...validateResearchArtifactContent("LibraryManifest", content).map(
      (issue) => `LibraryManifest: ${issue}`,
    ),
  );
  if (manifest.contentHash !== sha256(content)) {
    issues.push("LibraryManifest contentHash does not match content");
  }
  const receipt = finalRun.receipt ?? {};
  const expectedSourceIds = Array.isArray(receipt.records)
    ? receipt.records.map(sourceId)
    : [];
  const bindings = [
    ["retrievalMode", content.retrievalMode, "live_pubmed"],
    ["provider", content.provider, "pubmed"],
    ["retrievalRunPurpose", content.retrievalRunPurpose, "finalLibrary"],
    ["protocolArtifactId", content.protocolArtifactId, finalRun.protocolArtifactId],
    ["protocolContentHash", content.protocolContentHash, finalRun.protocolContentHash],
    ["queryId", content.queryId, finalRun.queryId],
    ["query", content.query, finalRun.query],
    ["queryHash", content.queryHash, finalRun.queryHash],
    ["retrievalReceiptHash", content.retrievalReceiptHash, receipt.receiptHash],
    ["executedAt", content.executedAt, receipt.executedAt],
    ["sourceCount", content.sourceCount, expectedSourceIds.length],
  ];
  for (const [field, actual, expected] of bindings) {
    if (actual !== expected) {
      issues.push(`LibraryManifest.${field} does not bind finalLibrary`);
    }
  }
  if (!sameOrderedValues(content.sourceIds, expectedSourceIds)) {
    issues.push("LibraryManifest.sourceIds do not equal finalLibrary records in order");
  }
  if (!hasText(manifest.contentHash)) issues.push("LibraryManifest contentHash is required");
  return issues;
}

export function evaluateResearchFormalAuthority({
  project,
  artifacts = [],
  runtimeProvenance = null,
  workflowComplete = false,
} = {}) {
  const retrievalAuthority = retrievalAuthorityForProject(project);
  const issues = [];
  if (!workflowComplete) issues.push("workflow is not complete");
  issues.push(...validateFinalLibraryAuthority({ project, artifacts }));
  if (
    !projectRuntimeProvenanceAllowsFormal(runtimeProvenance, {
      projectId: project?.id ?? null,
    })
  ) {
    issues.push("project runtime provenance is not formal-eligible");
  }

  let signedExportAuthority = null;
  try {
    signedExportAuthority = resolveSignedExportAuthority(currentArtifacts(artifacts));
  } catch (error) {
    issues.push(`signed export authority is unavailable: ${error?.code ?? "unknown"}`);
  }
  if (
    signedExportAuthority &&
    (signedExportAuthority.authorityClass !== "authoritative" ||
      signedExportAuthority.restrictedOnly === true)
  ) {
    issues.push("signed export authority is non-authoritative");
  }

  const formalResearchComplete = issues.length === 0;
  return {
    formalResearchComplete,
    code: formalResearchComplete
      ? "live_pubmed_audited_signed"
      : workflowComplete
        ? "workflow_complete_restricted"
        : retrievalAuthority.stage,
    retrievalAuthority,
    signedAuthorityClass: signedExportAuthority?.authorityClass ?? null,
    issues,
    boundary: formalResearchComplete
      ? "最终文献库、逐项目实时模型回执、审计与作者签署的唯一导出字节已全部绑定。"
      : retrievalAuthority.finalLibraryReady
        ? "最终文献库已保存，但正式资格仍需同时通过逐项目实时模型回执、科研审计和作者签署校验。"
        : retrievalAuthority.stage === "formal_retrieval_in_progress"
          ? "当前只有试检、领域宽检索或聚焦校准运行；尚未形成最终冻结文献库。"
          : retrievalAuthority.stage === "preview_only"
            ? "建项前预检只用于确认问题和检索表达，不进入正式文献库。"
            : retrievalAuthority.stage === "legacy_single_receipt"
              ? "历史单次检索只供追溯，不能证明分阶段真实检索。"
              : "尚未形成最终冻结文献库。",
  };
}
