import { sha256 } from "./event-engine-v1.js";

export class CitationVerificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CitationVerificationError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CitationVerificationError(code, message, details);
}

function sourceInputs(workOrder) {
  const snapshots = (workOrder.inputArtifacts ?? [])
    .filter((artifact) =>
      ["SourceSnapshot", "OrientationSourceSnapshot"].includes(artifact.type),
    )
    .map((artifact) => ({
      id: artifact.id,
      sourceId: artifact.content?.sourceId ?? artifact.id,
      title: artifact.content?.title ?? "",
      abstract: artifact.content?.abstract ?? artifact.content?.text ?? "",
      text: artifact.content?.text ?? artifact.content?.abstract ?? "",
      accessLevel: artifact.content?.accessLevel ?? "unknown",
      sourceSnapshotHash:
        artifact.content?.sourceSnapshotHash ?? artifact.contentHash ?? null,
      locator: artifact.content?.locator ?? null,
    }));
  if (snapshots.length > 0) return snapshots;
  return (workOrder.project?.sourceMaterials ?? []).map((source) => ({
    ...structuredClone(source),
    sourceId: source.sourceId ?? source.id,
    abstract: source.abstract ?? source.text ?? "",
  }));
}

function receiptForResult(receipt) {
  return {
    toolId: "citation_verify",
    receiptHash: receipt.receiptHash,
    claimHash: receipt.claimHash,
    method: receipt.method,
    checkedAt: receipt.checkedAt,
    coverage: receipt.coverage,
    sourceRefs: receipt.sourceRefs,
    matchedSourceRefs: receipt.matchedSourceRefs,
    expectedSourceRefs: receipt.expectedSourceRefs,
    unmatchedExpectedSourceRefs: receipt.unmatchedExpectedSourceRefs,
    sourceBindingSatisfied: receipt.sourceBindingSatisfied,
  };
}

function rationale(receipt) {
  if (receipt.verdict === "direct_support") {
    return "核查工具确认该事实句是当前可见来源文本中的精确摘录；这不自动证明因果或外推有效性。";
  }
  if (receipt.verdict === "partial_support") {
    return "来源与该句存在词项重合，但核查工具不能确认整句获得直接支持。";
  }
  return "当前可见来源不足以支持该事实句。";
}

function requiredRevision(receipt) {
  if (receipt.sourceBindingSatisfied === false) {
    return "当前句子只在其他来源中命中；请改正 citation intent 指向的 EvidenceRecord，或提供该 EvidenceRecord 对应来源中的可定位支持文本。";
  }
  if (receipt.verdict === "direct_support") return null;
  if (receipt.verdict === "partial_support") {
    return "改为来源中的可定位原句，或把无法直接支持的部分明确标为作者解释。";
  }
  return "删除该事实句，或补充可定位且能够直接支持它的来源后重新核查。";
}

function evidenceInputs(workOrder) {
  return new Map(
    (workOrder.inputArtifacts ?? [])
      .filter((artifact) => artifact.type === "EvidenceRecord")
      .map((artifact) => [artifact.id, artifact]),
  );
}

function sourceKey(sourceId, sourceSnapshotHash) {
  return `${String(sourceId ?? "")}\u0000${String(sourceSnapshotHash ?? "").toLowerCase()}`;
}

function evidenceSourceRefsForSentence(sentence, evidenceById, sources) {
  const sourceByKey = new Map(
    sources.map((source) => [
      sourceKey(source.sourceId ?? source.id, source.sourceSnapshotHash),
      source,
    ]),
  );
  return (sentence.citationIntents ?? []).map((intent) => {
    const evidence = evidenceById.get(intent.evidenceId);
    if (!evidence) {
      return {
        evidenceId: intent.evidenceId,
        citationIntentId: intent.id,
        sourceId: null,
        sourceSnapshotHash: null,
        unresolvedReason: "EvidenceRecord is not included in this work order.",
      };
    }
    const sourceId = evidence.content?.sourceId;
    const sourceSnapshotHash = evidence.content?.sourceSnapshotHash;
    const source = sourceByKey.get(sourceKey(sourceId, sourceSnapshotHash));
    if (!source) {
      return {
        evidenceId: intent.evidenceId,
        citationIntentId: intent.id,
        sourceId,
        sourceSnapshotHash,
        unresolvedReason: "EvidenceRecord does not match an available source snapshot.",
      };
    }
    return {
      evidenceId: intent.evidenceId,
      citationIntentId: intent.id,
      sourceId: source.sourceId ?? source.id,
      sourceSnapshotHash: source.sourceSnapshotHash,
    };
  });
}

/**
 * Replaces every model-authored verification verdict with a tool-derived one.
 * The model may propose a result, but it cannot self-assert direct support.
 */
export async function enforceCitationVerification({
  workOrder,
  candidates,
  gateway,
  onReceipt = null,
} = {}) {
  const verificationOutputs = (workOrder?.requiredOutputs ?? []).filter(
    (output) => output.type === "ClaimVerificationResult",
  );
  if (verificationOutputs.length === 0) return structuredClone(candidates ?? []);
  if (typeof gateway?.verifyCitation !== "function") {
    fail(
      "CITATION_VERIFIER_UNAVAILABLE",
      "逐句引用核查节点必须配置 citation_verify 工具。",
    );
  }

  const sources = sourceInputs(workOrder);
  if (sources.length === 0) {
    fail("CITATION_SOURCES_MISSING", "逐句引用核查没有可定位的来源快照。");
  }
  const drafts = (workOrder.inputArtifacts ?? []).filter(
    (artifact) => artifact.type === "ClaimUnitDraft",
  );
  const evidenceById = evidenceInputs(workOrder);
  const candidateById = new Map(
    (candidates ?? []).map((candidate) => [candidate.artifactId, candidate]),
  );

  for (const output of verificationOutputs) {
    const draft = drafts[output.slot - 1] ?? drafts[0];
    if (!draft) {
      fail("CLAIM_DRAFT_MISSING", `${output.artifactId} 没有对应的主张草稿。`);
    }
    // Sentence labels are descriptive metadata, never an authority boundary.
    // Verify every sentence so a factual claim cannot bypass citation checks by
    // being relabelled as a transition.
    const verifiableSentences = draft.content?.sentences ?? [];
    if (verifiableSentences.length === 0) {
      fail(
        "VERIFIABLE_SENTENCE_MISSING",
        `${draft.id} 没有可核查句子。`,
      );
    }
    const base = candidateById.get(output.artifactId);
    if (!base) {
      fail("VERIFICATION_CANDIDATE_MISSING", `Agent 未提交 ${output.artifactId}。`);
    }

    const sentenceResults = [];
    for (const sentence of verifiableSentences) {
      const expectedEvidenceRefs = evidenceSourceRefsForSentence(
        sentence,
        evidenceById,
        sources,
      );
      const unresolvedEvidenceRefs = expectedEvidenceRefs.filter(
        (reference) => reference.unresolvedReason,
      );
      if (unresolvedEvidenceRefs.length > 0) {
        fail(
          "CITATION_EVIDENCE_BINDING_UNRESOLVED",
          "Citation intent 指向的 EvidenceRecord 没有随工作单提供或无法绑定来源快照。",
          { sentenceId: sentence.id, unresolvedEvidenceRefs },
        );
      }
      const receipt = await gateway.verifyCitation({
        claim: sentence.text,
        sources,
        expectedSourceRefs: expectedEvidenceRefs.map(({ sourceId, sourceSnapshotHash }) => ({
          sourceId,
          sourceSnapshotHash,
        })),
      });
      if (!/^[a-f0-9]{64}$/i.test(receipt?.receiptHash ?? "")) {
        fail("INVALID_CITATION_RECEIPT", "citation_verify 未返回可校验的核查回执。", {
          sentenceId: sentence.id,
        });
      }
      const toolCallId = `${workOrder.id}:citation:${sha256(sentence.id).slice(0, 12)}`;
      await onReceipt?.({
        type: "tool_result",
        toolCallId,
        toolName: "citation_verify",
        details: {
          ...receipt,
          sentenceId: sentence.id,
          workOrderId: workOrder.id,
        },
      });
      sentenceResults.push({
        sentenceId: sentence.id,
        verdict: receipt.verdict,
        citationIntentIds: (sentence.citationIntents ?? []).map((intent) => intent.id),
        verifiedEvidenceIds:
          receipt.verdict === "unsupported" || receipt.sourceBindingSatisfied !== true
            ? []
            : expectedEvidenceRefs.map((reference) => reference.evidenceId),
        rationale: rationale(receipt),
        requiredRevision: requiredRevision(receipt),
        verificationReceipt: receiptForResult(receipt),
      });
    }

    candidateById.set(output.artifactId, {
      ...base,
      content: {
        schemaVersion: "1.0.0",
        id: output.artifactId,
        version: output.version,
        claimUnitDraftId: draft.id,
        draftProducerId: draft.content?.producerId ?? "agent:claim_unit_writer",
        verifierId: `agent:${workOrder.role}`,
        status: "verified",
        limitations: [
          "每个事实句的判定均来自 citation_verify 回执，不接受 Agent 自报通过。",
          "直接支持仅指当前可见文本中的精确摘录；因果、方法学质量与外推仍需独立审查。",
        ],
        sentenceResults,
      },
    });
  }

  return (candidates ?? []).map(
    (candidate) => candidateById.get(candidate.artifactId) ?? structuredClone(candidate),
  );
}

export function hasUnacceptedFactualSentences(artifacts = []) {
  return artifacts
    .filter((artifact) => artifact.type === "ClaimVerificationResult")
    .some((artifact) =>
      (artifact.content?.sentenceResults ?? []).some(
        (result) => result.verdict !== "direct_support",
      ),
    );
}
