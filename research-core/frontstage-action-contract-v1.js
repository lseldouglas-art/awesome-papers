export const FRONTSTAGE_ACTION_SCHEMA_VERSION = "research-frontstage-action/v1";

export const FRONTSTAGE_ACTION_IDS = Object.freeze({
  GATE_OPEN: "gate.open",
  GATE_APPROVE: "gate.approve",
  GATE_AMEND: "gate.amend",
  REVIEW_OPEN: "review.open",
  REVIEW_ACCEPT: "review.accept",
  REVIEW_REVISE: "review.revise",
  PREFLIGHT_OPEN: "retrieval.preflight.open",
  PREFLIGHT_RETRY: "retrieval.preflight.retry",
  PROTOCOL_OPEN: "retrieval.protocol.open",
  PROTOCOL_REVISE: "retrieval.protocol.revise",
  RECOVERY_OPEN: "recovery.open",
  RECOVERY_RETRY: "recovery.retry_same_protocol",
  RECOVERY_REVISE: "recovery.revise_protocol",
  PROJECT_RESUME: "project.resume",
  PROJECT_PAUSE: "project.pause",
  PROJECT_CANCEL: "project.cancel",
  PROJECT_RUN: "project.run",
  PROJECT_RESTART: "project.restart",
  BRIEF_VIEW: "brief.view",
  BLOCKER_OPEN: "blocker.open",
});

const PUBLIC_TECHNICAL_LANGUAGE = /Agent|状态机|哈希|\bhash\b|fingerprint|安全保存点|内部执行|运行时|阻塞器|blocker/i;

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

function publicLabel(value, fallback) {
  const candidate = firstText(value);
  return candidate && !PUBLIC_TECHNICAL_LANGUAGE.test(candidate) ? candidate : fallback;
}

function projectRevisionFor({ input, root, project }) {
  const candidates = [
    input.projectRevision,
    root.authoritativeProjectStatus?.projectRevision,
    root.state?.revision,
    project.version,
    project.revision,
  ];
  return candidates.find((value) => Number.isInteger(value) && value >= 0) ?? null;
}

function statusFor({ input, root, project, boundary }) {
  const explicit = firstText(
    input.status,
    root.authoritativeProjectStatus?.status,
    root.projectStatus,
    project.status,
    root.status,
  );
  if (explicit) return explicit.toLowerCase();
  if (boundary?.type === "complete") return "completed";
  if (boundary?.type === "human_gate") return "awaiting_gate";
  if (boundary?.type === "human_review") return "awaiting_review";
  if (boundary?.type === "cancelled") return "cancelled";
  if (boundary?.type === "blocked") {
    return boundary.blockers?.some((blocker) => String(blocker?.id ?? "").startsWith("pause:"))
      ? "paused"
      : "blocked";
  }
  return "idle";
}

function contextFor(input = {}) {
  const root = input.result ?? input;
  const project = input.project ?? root.project ?? root;
  const projection = input.projection ?? root.projection ?? project.projection ?? {};
  const boundary = input.boundary ?? projection.boundary ?? project.boundary ?? null;
  const pendingGate = input.pendingGate ?? root.pendingGate ?? project.pendingGate ??
    (boundary?.type === "human_gate"
      ? {
          gateId: boundary.gateId,
          nodeId: boundary.nodeId,
          fingerprint: boundary.fingerprint,
        }
      : null);
  const pendingReview = input.pendingReview ?? root.pendingReview ?? project.pendingReview ??
    (boundary?.type === "human_review"
      ? { nodeId: boundary.nodeId, reviewerRole: boundary.reviewerRole }
      : null);
  const currentBlocker = input.currentBlocker ?? root.currentBlocker ?? project.blocker ??
    (Array.isArray(boundary?.blockers) ? boundary.blockers[0] : null);
  const projectRevision = projectRevisionFor({ input, root, project });
  return {
    project,
    boundary,
    pendingGate,
    pendingReview,
    currentBlocker,
    projectRevision,
    status: statusFor({ input, root, project, boundary }),
  };
}

function makeAction({
  id,
  label,
  interaction,
  target,
  command = null,
  decision = null,
  tone = "secondary",
  enabled = true,
  binding,
  requirements = {},
}) {
  return {
    id,
    label,
    interaction,
    target,
    command,
    decision,
    tone,
    enabled,
    binding,
    requirements,
  };
}

function isPreflightPause({ project, status, currentBlocker }) {
  if (project?.researchMode !== "live_pubmed" || !["paused", "blocked"].includes(status)) {
    return false;
  }
  const nodeId = firstText(currentBlocker?.nodeId, currentBlocker?.stage);
  const reason = firstText(currentBlocker?.reason, currentBlocker?.message) ?? "";
  const code = firstText(currentBlocker?.code) ?? "";
  return (
    nodeId === "clarify_question" ||
    String(currentBlocker?.id ?? "").startsWith("pause:clarify_question")
  ) && (/PubMed.*(?:预检|检索未完成|未返回|零结果)/i.test(reason) || code.startsWith("PUBMED_"));
}

function withContract({ projectRevision, attention, nextDecision, primaryActionId, actions }) {
  return {
    frontstageAction: {
      schemaVersion: FRONTSTAGE_ACTION_SCHEMA_VERSION,
      binding: { projectRevision },
      attention,
      nextDecision,
      primaryActionId,
    },
    availableActions: actions,
  };
}

/**
 * Derive the researcher-facing decision and allowed actions from persisted project truth.
 * The function is pure: it does not inspect process-local activity or mutate its input.
 */
export function buildFrontstageActionContract(input = {}) {
  const context = contextFor(input);
  const { project, pendingGate, pendingReview, currentBlocker, projectRevision, status } = context;
  const mutable = Number.isInteger(projectRevision);
  const baseBinding = { projectRevision };

  if (pendingGate) {
    const gateId = firstText(pendingGate.gateId, pendingGate.id);
    const decisionVersion = firstText(
      pendingGate.decisionVersion,
      pendingGate.gateFingerprint,
      pendingGate.fingerprint,
    );
    const binding = { ...baseBinding, gateId, decisionVersion };
    const canDecide = mutable && Boolean(gateId && decisionVersion);
    const subject = publicLabel(pendingGate.userLabel, "当前研究范围");
    return withContract({
      projectRevision,
      attention: "required",
      nextDecision: `请核对「${subject}」，并决定批准当前范围或要求修订。`,
      primaryActionId: FRONTSTAGE_ACTION_IDS.GATE_OPEN,
      actions: [
        makeAction({ id: FRONTSTAGE_ACTION_IDS.GATE_OPEN, label: "核对并作出研究决定", interaction: "navigate", target: "gate", tone: "primary", binding: baseBinding }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.GATE_APPROVE, label: "批准当前范围", interaction: "submit", target: "gate", command: "gate_decide", decision: "approved", tone: "primary", enabled: canDecide, binding, requirements: { reasonMinLength: 8 } }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.GATE_AMEND, label: "要求修订", interaction: "submit", target: "gate", command: "gate_decide", decision: "amendment_requested", enabled: canDecide, binding, requirements: { reasonMinLength: 8 } }),
      ],
    });
  }

  if (pendingReview) {
    const nodeId = firstText(pendingReview.nodeId, pendingReview.id);
    const materialVersion = firstText(
      pendingReview.materialVersion,
      pendingReview.materialFingerprint,
      pendingReview.fingerprint,
    );
    const artifactIds = Array.isArray(pendingReview.artifacts)
      ? pendingReview.artifacts
          .map((artifact) => firstText(artifact?.artifactId, artifact?.id))
          .filter(Boolean)
          .sort()
      : [];
    const binding = { ...baseBinding, nodeId, materialVersion, artifactIds };
    const canDecide = mutable && Boolean(nodeId && materialVersion);
    const subject = publicLabel(pendingReview.userLabel, "当前研究材料");
    return withContract({
      projectRevision,
      attention: "required",
      nextDecision: `请复核「${subject}」，并决定接受当前材料或要求修订。`,
      primaryActionId: FRONTSTAGE_ACTION_IDS.REVIEW_OPEN,
      actions: [
        makeAction({ id: FRONTSTAGE_ACTION_IDS.REVIEW_OPEN, label: "查看并完成人工复核", interaction: "navigate", target: "review", tone: "primary", binding: baseBinding }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.REVIEW_ACCEPT, label: "接受当前材料", interaction: "submit", target: "review", command: "review_decide", decision: "accepted", tone: "primary", enabled: canDecide, binding, requirements: { reasonMinLength: 8 } }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.REVIEW_REVISE, label: "退回修订", interaction: "submit", target: "review", command: "review_decide", decision: "revision_requested", enabled: canDecide, binding, requirements: { reasonMinLength: 8 } }),
      ],
    });
  }

  if (isPreflightPause(context)) {
    const binding = { ...baseBinding, blockerId: firstText(currentBlocker?.id) };
    return withContract({
      projectRevision,
      attention: "required",
      nextDecision: "建项前检索尚未取得可检查样本；请修改检索式并重新试检，已有材料保持不变。",
      primaryActionId: FRONTSTAGE_ACTION_IDS.PREFLIGHT_OPEN,
      actions: [
        makeAction({ id: FRONTSTAGE_ACTION_IDS.PREFLIGHT_OPEN, label: "修改检索式并重新试检", interaction: "open_form", target: "retrieval_preflight", tone: "primary", binding: baseBinding }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.PREFLIGHT_RETRY, label: "提交新版检索式", interaction: "submit", target: "retrieval_preflight", command: "retry_search", tone: "primary", enabled: mutable, binding, requirements: { queryMinLength: 3 } }),
      ],
    });
  }

  const retryClass = firstText(currentBlocker?.retryClass);
  const blockerBinding = { ...baseBinding, blockerId: firstText(currentBlocker?.id) };
  if (status === "blocked" && retryClass === "protocol_revision_required") {
    return withContract({
      projectRevision,
      attention: "required",
      nextDecision: "当前检索式未获得可分析结果；请修订检索范围或词项，并说明改变研究方法的理由。",
      primaryActionId: FRONTSTAGE_ACTION_IDS.PROTOCOL_OPEN,
      actions: [
        makeAction({ id: FRONTSTAGE_ACTION_IDS.PROTOCOL_OPEN, label: "修订正式检索方案", interaction: "open_form", target: "retrieval_protocol", tone: "primary", binding: baseBinding }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.PROTOCOL_REVISE, label: "保存新版方案并继续", interaction: "submit", target: "retrieval_protocol", command: "revise_protocol", tone: "primary", enabled: mutable && Boolean(blockerBinding.blockerId), binding: blockerBinding, requirements: { queryMinLength: 3, reasonMinLength: 8, revisedQueryMustDiffer: true } }),
      ],
    });
  }

  if (status === "blocked" && retryClass === "same_protocol_retry") {
    return withContract({
      projectRevision,
      attention: "required",
      nextDecision: "当前检索方案可以保留；请核对数据库服务后按原检索式重试。",
      primaryActionId: FRONTSTAGE_ACTION_IDS.RECOVERY_OPEN,
      actions: [
        makeAction({ id: FRONTSTAGE_ACTION_IDS.RECOVERY_OPEN, label: "查看原因与恢复方式", interaction: "navigate", target: "recovery", tone: "primary", binding: baseBinding }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.RECOVERY_RETRY, label: "按原检索式重试", interaction: "submit", target: "recovery", command: "resume", tone: "primary", enabled: mutable && Boolean(blockerBinding.blockerId), binding: blockerBinding, requirements: { reasonMinLength: 8 } }),
      ],
    });
  }

  if (status === "blocked" && retryClass === "human_review_required") {
    return withContract({
      projectRevision,
      attention: "required",
      nextDecision: "现有信息不足以判断是否需要改变检索方法；请核对原因后选择原式重试或修订方案。",
      primaryActionId: FRONTSTAGE_ACTION_IDS.RECOVERY_OPEN,
      actions: [
        makeAction({ id: FRONTSTAGE_ACTION_IDS.RECOVERY_OPEN, label: "判断检索恢复方式", interaction: "navigate", target: "recovery", tone: "primary", binding: baseBinding }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.RECOVERY_RETRY, label: "保留原式重试", interaction: "submit", target: "recovery", command: "resume", enabled: mutable && Boolean(blockerBinding.blockerId), binding: blockerBinding, requirements: { reasonMinLength: 8 } }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.RECOVERY_REVISE, label: "建立新版检索方案", interaction: "open_form", target: "retrieval_protocol", command: "revise_protocol", enabled: mutable && Boolean(blockerBinding.blockerId), binding: blockerBinding, requirements: { queryMinLength: 3, reasonMinLength: 8, explicitRevision: true } }),
      ],
    });
  }

  if (status === "paused") {
    return withContract({
      projectRevision,
      attention: "optional",
      nextDecision: "本轮研究已暂停；请核对当前问题与已有材料，再决定继续或结束。",
      primaryActionId: FRONTSTAGE_ACTION_IDS.PROJECT_RESUME,
      actions: [
        makeAction({ id: FRONTSTAGE_ACTION_IDS.PROJECT_RESUME, label: "继续本轮研究", interaction: "submit", target: "project", command: "resume", tone: "primary", enabled: mutable, binding: blockerBinding, requirements: { reasonMinLength: 8 } }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.PROJECT_CANCEL, label: "结束本轮研究", interaction: "submit", target: "project", command: "cancel", tone: "danger", enabled: mutable, binding: baseBinding, requirements: { reasonMinLength: 8 } }),
      ],
    });
  }

  if (status === "blocked" || status === "failed") {
    return withContract({
      projectRevision,
      attention: "required",
      nextDecision: "当前步骤的处置条件尚未明确；请先查看原因，再由研究者决定下一步。",
      primaryActionId: FRONTSTAGE_ACTION_IDS.BLOCKER_OPEN,
      actions: [makeAction({ id: FRONTSTAGE_ACTION_IDS.BLOCKER_OPEN, label: "查看原因并决定下一步", interaction: "navigate", target: "recovery", tone: "primary", binding: baseBinding })],
    });
  }

  if (["running", "starting", "queued"].includes(status)) {
    return withContract({
      projectRevision,
      attention: "in_progress",
      nextDecision: "研究材料正在更新；可等待新依据形成，或暂停、结束本轮。",
      primaryActionId: null,
      actions: [
        makeAction({ id: FRONTSTAGE_ACTION_IDS.PROJECT_PAUSE, label: "暂停研究", interaction: "submit", target: "project", command: "pause", enabled: mutable, binding: baseBinding, requirements: { reasonMinLength: 8 } }),
        makeAction({ id: FRONTSTAGE_ACTION_IDS.PROJECT_CANCEL, label: "结束本轮研究", interaction: "submit", target: "project", command: "cancel", tone: "danger", enabled: mutable, binding: baseBinding, requirements: { reasonMinLength: 8 } }),
      ],
    });
  }

  if (status === "completed") {
    return withContract({
      projectRevision,
      attention: "none",
      nextDecision: "本轮研究已经完成；请查看科研简报，并按其中的证据边界解释和使用结论。",
      primaryActionId: FRONTSTAGE_ACTION_IDS.BRIEF_VIEW,
      actions: [makeAction({ id: FRONTSTAGE_ACTION_IDS.BRIEF_VIEW, label: "查看科研简报", interaction: "navigate", target: "brief", tone: "primary", binding: baseBinding })],
    });
  }

  if (status === "cancelled") {
    return withContract({
      projectRevision,
      attention: "optional",
      nextDecision: "本轮已经结束；如需继续，请保留原问题并建立新一轮文献调研。",
      primaryActionId: FRONTSTAGE_ACTION_IDS.PROJECT_RESTART,
      actions: [makeAction({ id: FRONTSTAGE_ACTION_IDS.PROJECT_RESTART, label: "基于原问题新建研究", interaction: "open_create", target: "new_project", tone: "primary", binding: baseBinding })],
    });
  }

  return withContract({
    projectRevision,
    attention: "optional",
    nextDecision: "请根据当前研究问题继续获取可核查材料。",
    primaryActionId: FRONTSTAGE_ACTION_IDS.PROJECT_RUN,
    actions: [makeAction({ id: FRONTSTAGE_ACTION_IDS.PROJECT_RUN, label: "继续下一项研究", interaction: "submit", target: "project", command: "run", tone: "primary", enabled: mutable, binding: baseBinding })],
  });
}

export function frontstageContractHasPublicTechnicalLanguage(contract) {
  const visibleText = [
    contract?.frontstageAction?.nextDecision,
    ...(contract?.availableActions ?? []).map((action) => action?.label),
  ].filter(Boolean).join("\n");
  return PUBLIC_TECHNICAL_LANGUAGE.test(visibleText);
}
