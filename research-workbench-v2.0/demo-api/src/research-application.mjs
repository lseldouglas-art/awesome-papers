import {compositionInput,executeComposition} from './figure-workspace.mjs';
import {researchInstruction,RESEARCH_LANGUAGE_VERSION} from '../../shared/research-language.mjs';
import {manuscriptInput,executeManuscript} from './manuscript-writing.mjs';
import {templateInput,executeTemplateTask} from './research-templates.mjs';
import {templateModes} from '../../shared/research-templates.mjs';
import {writingInput, executeWriting, recoverWritingOutputs} from './topic-writing.mjs';
import { topicTaskModes, topicPlanningFeedback } from '../../shared/topic-library-workflow.mjs';
import { validateTopicOptions, executeTopicWorkflow } from './topic-library-workflow.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ResearchService, validateResearchOutput } from './research.mjs';
import { DomainError, requireThat } from './errors.mjs';
import { executeCommand, getProject } from './domain.mjs';
import { artifactOf, capture, checkDraft, checkpoint } from './progress.mjs';
import { MODEL_OUTPUT_PARSER_VERSION, normalizeOuterJsonFence, parseModelJsonObject, extractLeadingJsonObject } from './model-output.mjs';
import { ensureKernel, researchState, createQuestionComparison, composeResearchBrief, registerResearchResult, saveBranchInvestigation, saveTopicReview, applyTopicScreeningPolicy } from './kernel.mjs';
import { materialPacket } from '../../shared/material-scope.mjs';
import { searchesForArtifact, topicSearchMethod } from '../../shared/topic-search.mjs';
import { LANDSCAPE_FRAMEWORK, materialCoverage } from '../../shared/domain-landscape.mjs';
import { workflowRegistry, buildResearchContext, comparisonInstructions, scientificComparabilityInstructions, validateComparisonOutput, materialContextLimits,
  planMaterialBatches, assertMaterialContextFits, perPaperBatchInstructions, validatePaperBatchOutput, combinePaperCoverage,
  landscapeAggregationInstructions, completeLandscapeAggregation, runMaterialBatches, isTerminalRun, createTaskAttempt,
  createToolRun, transitionRun } from './workflows.mjs';

import { topicReviewInstructions, validateTopicReview, deepArgumentInstructions, topicAggregationInstructions, completeTopicAggregation } from './topic-review.mjs';

const uid = prefix => `${prefix}_${randomUUID()}`;
const now = () => new Date().toISOString();
const clone = value => structuredClone(value);
const nonempty = value => typeof value === 'string' && value.trim();
const fingerprint = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const modes = new Set([...Object.keys(workflowRegistry), ...topicTaskModes, ...templateModes, 'figure-compose', 'connection']);
export const RESEARCH_PROMPT_VERSION = 'research-workbench-v0.14-topic-decisions-v2';
const promptVersionFor = mode => mode==='figure-compose'?'research-workbench-figure-compose-v1': ['topic-writing','manuscript-writing'].includes(mode) ? 'research-workbench-v0.22.1-academic-manuscript-v2' : mode==='topic-outline' ? 'research-workbench-v0.18-argument-outline-v2' : ['topic-screen','topic-preview'].includes(mode) ? 'research-workbench-v0.19-relevance-recovery-v2' : mode==='topic-review' ? 'research-workbench-v0.16-topic-abcd-v1' : mode === 'topic-plan' ? 'research-workbench-v0.15-search-repair-digest-v1' : RESEARCH_PROMPT_VERSION;
const landscapeSelfCheck = `输出前逐项检查最终 JSON（检查包括每一节的每个 items 元素，以及七个维度各自的 comparison）：每个 status=reported 或 inference 的陈述必须至少有一个实际支持本陈述的 citations:{ref,passage}，且 R/P 编号确实存在于本次给定材料中。不能因 comparison 是解释文字就省略其依据，也不能借用不相关片段来通过结构检查。
找不到相关依据时，把该项的 status 改为 unknown，并把正文改为具体的待了解内容或“本次材料未覆盖／摘要未报告”；不要保留肯定结论再贴 unknown 标签。建议性的下一步用 suggestion。coverage=insufficient 的维度，其 items 和 comparison 都只能使用 unknown 或 suggestion；有局部依据的维度仍需展示具体支持片段与缺失边界。
材料数量、年份范围、访问层级等来源统计由程序和界面展示，不要在 overview 中重复这些统计，也不要把来源范围说明标成 reported 的科研发现。确需解释材料边界时，用 unknown 说明本次不能回答什么。
hotspots 中“对用户可能有价值”“值得关注的方向”属于 suggestion；仅说明当前材料未报告长期随访、尚不能判断成熟度等本次知识边界时，用 unknown。若论文明确报告了某项研究局限，可以用 reported，但同样必须给出对应的真实 R/P 引用。只有基于研究结果作出的实际综合推断才用 inference，并给出支持它的真实 R/P 引用。
${scientificComparabilityInstructions}
headline 和 text 必须具有相同的证据边界，标题不得将“摘要未报告”压缩成“缺乏/缺位/尚无/均缺”。没有全文或专门检索核查时，标题应写“本次摘要未报告外部验证”，不能写“外部验证缺失”。不以科学价值高、证据链完整、已趋标准化、已成熟等无判据形容词替代具体研究发现。采用规范中文术语，避免不必要的中英文夹杂。
现实条件或可行性没有被用户明确说明时保持未知，不推定已经拥有数据、样本、设备或招募能力。只返回约定的 JSON，不额外返回自查报告；所有内容仍是待用户理解与取舍的 AI 整理。`;
const event = (p, task, type, detail = {}) => p.researchEvents.push({ id: uid('event'), projectId: p.id, type, actor: 'local_program',
  operationId: task.requestId ?? task.id, target: { taskId: task.id, artifactId: task.artifactId }, detail: clone(detail), at: now() });
const safeError = error => error instanceof DomainError || error.name === 'ModelAdapterError' ? error.message : '本步处理失败，已有材料与记录保留；可以手动继续。';

/** Application service around the existing retrieval/landscape vertical slice.
 * Model generation never performs a research adoption decision. */
export class ResearchApplication extends ResearchService {
  applyScreeningPolicy(p,a,operationId) { return applyTopicScreeningPolicy(p,a,operationId); }
  constructor(...args) {
    super(...args);
    this.taskContext = new AsyncLocalStorage();
    const pubmed = this.pubmed;
    this.pubmed = Object.create(pubmed);
    for (const method of ['search', 'metadata', 'queryPage', 'planCollection']) if (typeof pubmed[method] === 'function') this.pubmed[method] = (...input) => {
      const scope = this.taskContext.getStore();
      if (!scope) return pubmed[method](...input);
      return this.recordRetrieval(scope.task, scope.signal, method, input, () => pubmed[method](...input));
    };
  }

  async initialize() {
    await super.initialize();
    await this.store.update(s => {
      recoverWritingOutputs(s);
      for (const p of Object.values(s.projects)) {
        ensureKernel(p);
        for (const task of Object.values(p.researchTasks ?? {})) {
          for (const field of ['attempts', 'toolRuns']) for (const record of task[field] ?? []) if (!isTerminalRun(record.status)) Object.assign(record, transitionRun(record, 'interrupted', { errorCode: 'service_interrupted' }));
          for (const record of task.paperBatchRecords ?? []) if (!isTerminalRun(record.status)) {
            record.status = 'interrupted';
            for (const field of ['attempts', 'toolRuns']) for (const attempt of record[field] ?? []) if (!isTerminalRun(attempt.status)) Object.assign(attempt, transitionRun(attempt, 'interrupted', { errorCode: 'service_interrupted' }));
          }
        }
      }
    });
    return this;
  }

  async capabilities() {
    return { ...await super.capabilities(), storage: this.store.filename?.endsWith('.sqlite') ? 'sqlite' : 'local_file',
      workflows: Object.values(workflowRegistry), contextLimits: materialContextLimits(this.settings.config) };
  }

  isResearchInputStale(project, task) {
    return project.researchKernel?.version !== task.input.baseStateVersion;
  }

  registerResearchOutput(project, result, task) {
    result.adoptionContext = clone(task.input.adoptionContext);
    registerResearchResult(project, result, task.requestId ?? task.id);
  }

  async start(projectId, body, requestId) {
    requireThat(!this.closing, 'service_closing', '服务正在关闭，请稍后继续。', 503);
    requireThat(body && modes.has(body.mode), 'invalid_mode', '不支持这一研究动作。');
    const config = clone(this.settings.config);
    const accepted = await this.store.transact(requestId, { operation: 'start-research', projectId, body }, s => {
      const p = ensureKernel(getProject(s, projectId)), a = artifactOf(p, body.artifactId); checkDraft(a, body.baseVersion);
      requireThat(['retrieve', 'brief', 'topic-preview', 'topic-collect'].includes(body.mode) || (this.settings.public().configured && config.enabled), 'model_not_configured', '请先配置并启用本机模型服务。', 503);
      requireThat(!Object.values(p.researchTasks).some(t => !isTerminalRun(t.status)), 'task_running', '本课题已有一步正在进行，可等待或停止后继续。', 409);
      requireThat(body.text === undefined || nonempty(body.text), 'invalid_input', '请填写本次问题。');
      requireThat(body.baseStateVersion === undefined || body.baseStateVersion === p.researchKernel.version, 'research_state_conflict', '研究选择已有变化，请重新查看后继续。', 409);
      if (['retrieve', 'landscape'].includes(body.mode)) requireThat(nonempty(body.query) && body.query.length <= 2000, 'invalid_query', '先填写或生成本次检索式。');
      let reuseSearch = null;
      if (body.reuseSearchId !== undefined) {
        reuseSearch = p.searches[body.reuseSearchId];
        requireThat(body.mode === 'landscape' && reuseSearch?.query === body.query && reuseSearch.accessIds.length > 0, 'invalid_search', '请选择本课题原检索范围中的已存材料。');
        requireThat(reuseSearch.accessIds.every(id => a.draft.sourceAccessIds.includes(id)), 'invalid_scope', '这次检索的材料已不在当前成果中，请明确选择材料后继续。');
      }
      const selectedIds = body.accessIds ?? reuseSearch?.accessIds ?? [];
      requireThat(Array.isArray(selectedIds) && new Set(selectedIds).size === selectedIds.length
        && selectedIds.every(id => a.draft.sourceAccessIds.includes(id) && p.accesses[id]), 'invalid_scope', '请选择当前成果实际保存的材料。');
      const materials = materialPacket(p, selectedIds);
      requireThat(materials.every(m => p.sources[m.sourceId]?.origin !== 'synthetic_fixture'), 'fixture_scope', '虚构交互示例不能作为真实研究资料。');
      if (['ask', 'revise', 'compare', 'deepen', 'topic-review', 'topic-screen', 'topic-outline'].includes(body.mode) || reuseSearch) requireThat(materials.length > 0, 'materials_required', '请先选择本次使用的实际材料。');
      if(body.mode==='topic-outline') requireThat(materials.every(m=>p.researchResults[a.draft.resultId]?.library?.entries?.some(e=>e.accessId===m.accessId&&e.decision==='included')),'invalid_scope','请先纳入认可的材料，再选择用于大纲的范围。');
      if (body.mode === 'topic-review') requireThat(a.kind === 'topic_library', 'invalid_scope', '请先打开当前选题的专题文献库。');
      const revision = capture(p, a, requestId, 'task_input');
      let target = null;
      if (body.blockId) {
        const block = revision.blocks.find(b => b.id === body.blockId); requireThat(block, 'invalid_target', '选中位置已有变化，请重新选择。');
        target = { artifactId: a.id, revisionId: revision.id, blockId: block.id, text: block.text };
      }
      let itemTarget = null;
      const topicTarget = a.kind === 'topic_library' ? a.branchQuestion : null;
      if (topicTarget) requireThat((!body.itemId || body.itemId === topicTarget.itemId) && (!body.itemRevisionId || body.itemRevisionId === topicTarget.revisionId), 'invalid_target', '请围绕本专题保存的问题版本继续研究；其他选题请从对应专题进入。');
      requireThat(body.searchScopeMode === undefined || ['focused', 'expanded'].includes(body.searchScopeMode), 'invalid_scope', '检索范围需要是本专题或明确扩展。');
      if (body.itemId || topicTarget) {
        const targetId = body.itemId ?? a.branchQuestion.itemId, targetRevision = body.itemRevisionId ?? a.branchQuestion?.revisionId;
        const item = p.researchItems[targetId], itemRevision = item?.revisions.find(r => r.id === (targetRevision ?? item.headRevisionId));
        requireThat(item && itemRevision, 'invalid_target', '要深入的方向或问题不存在于当前课题。');
        itemTarget = { itemId: item.id, revisionId: itemRevision.id, kind: item.kind, text: itemRevision.text, scope: itemRevision.scope };
      }
      const state = researchState(p);
      const input = { notes: clone(a.draft.notes), name: p.name, originalGoal: p.originalGoal, goal: p.goal, conditions: p.conditions, metadataVersion: p.metadataVersion,
        baseVersion: a.draft.version, baseStateVersion: state.version, revisionId: revision.id, resultId: a.draft.resultId,
        target, itemTarget, query: body.query ?? '', text: body.text ?? '', materials, reuseSearchId: reuseSearch?.id ?? null,
        currentBrief: a.draft.resultId ? clone(p.researchResults[a.draft.resultId]?.blocks ?? []) : [], recentExchanges: [],
        searchScope: Object.values(p.searches).filter(search => search.accessIds.some(id => selectedIds.includes(id))).map(({ query, searchedAt, coverage, searches, missingIds, warnings }) => ({ query, searchedAt, coverage, searches, missingIds, warnings })),
        adoptionContext: { version: state.version, currentQuestion: state.currentQuestion, exploration: state.exploration,
          decisionIds: [...new Set([...Object.values(p.researchKernel.choices), state.currentQuestion?.decisionId, state.exploration?.decisionId,
            ...(!state.currentQuestion && p.researchKernel.undecidedDecisionId ? [p.researchKernel.undecidedDecisionId] : [])].filter(Boolean))], undecided: !state.currentQuestion } };
      if(body.mode==='figure-compose') input.figure=compositionInput(p,a,body);
      if(templateModes.includes(body.mode)) input.template=templateInput(p,a,body);
      if(body.mode==='topic-writing') input.writing=writingInput(p,a,body);
      if(body.mode==='manuscript-writing') input.manuscript=manuscriptInput(p,a,body);
      if (topicTaskModes.includes(body.mode)) input.topicOptions = validateTopicOptions(p,a,body);
      if (['topic-screen','topic-preview','topic-outline'].includes(body.mode)) input.relevanceConceptGroups = clone((a.topicWorkspace?.plans??[]).filter(plan=>plan.query===input.query).at(-1)?.groups?.filter(group=>group.core)??[]);
      if (body.mode === 'topic-plan') input.searchFeedback = clone(topicPlanningFeedback(p,a,input.query,input.topicOptions));
      input.context = buildResearchContext(p, a, { ...input, replyToTaskId: body.replyToTaskId, relatedTaskIds: body.relatedTaskIds });
      if (itemTarget) input.context.selectedResearchItem = clone(itemTarget);
      if (topicTarget) {
        input.searchScopeMode = body.searchScopeMode ?? 'focused';
        input.context.primaryResearchObject = clone(itemTarget);
        input.context.researchFocusRule = '本专题的问题及版本优先；原课题与其他选题只提供背景，不替代当前对象。';
        if (['clarify', 'retrieve'].includes(body.mode)) {
          requireThat(body.query === undefined || (typeof body.query === 'string' && body.query.length <= 2000), 'invalid_query', '检索式超过当前支持的长度。');
          input.context.searchScopeMode = input.searchScopeMode;
          input.context.searchMethod = topicSearchMethod;
          input.context.searchFeedback = searchesForArtifact(p, a).map(({ id, query, searchedAt, searches, accessIds, missingIds, warnings }) => ({ id, query, searchedAt, searches, retrievedCount: accessIds.length, missingIds, warnings }));
        }
      }
      if (body.mode === 'topic-review') {
        input.context.selectedArtifact.blocks = []; input.context.parentArtifact = null; input.context.relatedHistory = [];
        input.context.reviewPurpose = '基于本次实际材料重新检验当前选题，不把历史AI结论当依据';
      }
      let previous = null;
      if (body.retryTaskId) {
        previous = p.researchTasks[body.retryTaskId];
        requireThat(previous && ['failed', 'cancelled', 'interrupted'].includes(previous.status) && previous.mode === body.mode && previous.artifactId === a.id,
          'invalid_retry', '请选择本课题未完成的同一研究任务进行手动重试。', 409);
        const previousIds = [...new Set([...(previous.input.materials ?? []).map(m => m.accessId), ...(previous.searchId ? p.searches[previous.searchId]?.accessIds ?? [] : [])])].sort();
        requireThat(previous.input.query === input.query && previous.input.text === input.text
          && (previous.input.searchScopeMode ?? 'focused') === (input.searchScopeMode ?? 'focused')
          && JSON.stringify(previousIds) === JSON.stringify(materials.map(m => m.accessId).sort()),
        'invalid_retry', '本次问题或所选材料已经变化，请作为新任务运行。', 409);
        const researchFocus = context => [context?.currentQuestion?.itemId ?? null, context?.currentQuestion?.revisionId ?? null,
          context?.exploration?.itemId ?? null, context?.exploration?.revisionId ?? null];
        requireThat(previous.input.goal === input.goal && previous.input.conditions === input.conditions
          && JSON.stringify(previous.input.notes) === JSON.stringify(input.notes)
          && JSON.stringify(previous.input.itemTarget ?? null) === JSON.stringify(input.itemTarget)
          && JSON.stringify(researchFocus(previous.input.context)) === JSON.stringify(researchFocus(input.context)),
        'invalid_retry', '课题意图、认识或采用的问题已有变化，请按当前上下文创建新任务。', 409);
        // Retrieval adds materials to the draft without rewriting the original
        // input revision. Keep that exact context on an explicitly requested
        // retry, otherwise a new capture ID would invalidate valid checkpoints.
        input.context = clone(previous.modelContext ?? previous.input.context ?? input.context);
        input.revisionId = previous.input.revisionId;
        input.adoptionContext = clone(previous.input.adoptionContext ?? input.adoptionContext);
        input.baseStateVersion = previous.input.baseStateVersion ?? input.baseStateVersion;
        if (!input.reuseSearchId && previous.searchId && body.mode === 'landscape') input.reuseSearchId = previous.searchId;
      }
      const provider = body.mode === 'brief' ? 'local_program' : (['retrieve','topic-collect'].includes(body.mode)||body.mode==='topic-preview'&&!this.settings.public().configured) ? 'PubMed' : new URL(config.baseUrl).hostname;
      const task = { id: uid('task'), requestId, projectId, artifactId: a.id, mode: body.mode, status: 'queued', createdAt: now(), progress: '准备本步工作',
        input, inputFingerprint: fingerprint(input), promptVersion: `${promptVersionFor(body.mode)}:${body.mode}`, provider, model: ['retrieve', 'brief', 'topic-collect'].includes(body.mode) ? null : config.model,
        calls: [], attempts: [], toolRuns: [], paperBatchRecords: clone(previous?.paperBatchRecords ?? []), retryOfTaskId: previous?.id ?? null, cost: { status: 'unknown', amount: null } };
      task.attempts.push(createTaskAttempt(task.id, { previousAttemptId: previous?.attempts?.at(-1)?.id ?? null, inputFingerprint: task.inputFingerprint, provider, model: task.model }));
      p.researchTasks[task.id] = task;
      if (body.text) task.messageId = executeCommand(s, projectId, 'append-message', { conversationId: Object.keys(p.conversations)[0], text: body.text,
        ...(target ? { target: { artifactId: a.id, revisionId: revision.id, blockId: target.blockId } } : {}) }, requestId).id;
      event(p, task, 'research_task_queued', { mode: task.mode, inputRevisionId: revision.id, inputFingerprint: task.inputFingerprint, retryOfTaskId: task.retryOfTaskId });
      p.updatedAt = now(); return { taskId: task.id };
    });
    const task = await this.store.read(s => s.projects[projectId].researchTasks[accepted.taskId]);
    if (!isTerminalRun(task.status) && !this.running.has(task.id)) {
      const controller = new AbortController(), running = { controller, promise: null }; this.running.set(task.id, running);
      running.promise = this.run(task, config, controller.signal).finally(() => this.running.delete(task.id));
    }
    return accepted;
  }

  async updateTask(task, values) {
    return this.store.update(s => {
      const p = ensureKernel(s.projects[task.projectId]), t = p.researchTasks[task.id];
      if (isTerminalRun(t.status)) return;
      if (values.status && values.status !== t.status) {
        const next = transitionRun(t, values.status, values); Object.assign(t, next);
        event(p, t, `research_task_${t.status}`, { inputFingerprint: t.inputFingerprint, errorCode: values.errorCode ?? null });
      } else Object.assign(t, values);
    });
  }

  async revalidateSavedOutput(projectId, failedTaskId, requestId, { sourceCallId, extractLeadingJson = false } = {}) {
    requireThat(!this.closing, 'service_closing', '服务正在关闭，请稍后继续。', 503);
    requireThat(typeof extractLeadingJson === 'boolean', 'invalid_input', '提取尾注前 JSON 的选项必须明确为 true 或 false。');
    const accepted = await this.store.transact(requestId, { operation: 'revalidate-saved-output', projectId, failedTaskId, sourceCallId: sourceCallId ?? null, extractLeadingJson }, s => {
      const p = ensureKernel(getProject(s, projectId)), previous = p.researchTasks[failedTaskId];
      requireThat(previous?.status === 'failed' && ['landscape', 'revise', 'ask', 'deepen', 'compare', 'clarify', 'topic-review'].includes(previous.mode), 'invalid_revalidation', '请选择一项已有原始模型响应的失败研究任务。', 409);
      requireThat(!Object.values(p.researchTasks).some(task => !isTerminalRun(task.status)), 'task_running', '本课题仍有任务正在运行，请结束后进行本地重新校验。', 409);
      const calls = s.modelCalls.filter(call => call.projectId === projectId && call.taskId === previous.id && previous.calls.includes(call.id)
        && call.status === 'completed' && !call.discardedAfterCancellation && typeof call.outputText === 'string' && ['model.generate', 'model.landscape-synthesis', 'model.topic-synthesis'].includes(call.purpose));
      const call = sourceCallId ? calls.find(call => call.id === sourceCallId) : calls.at(-1);
      requireThat(call, 'saved_output_unavailable', '没有可明确定位的完整模型响应；本地校验不会自动调用模型。', 409);
      const refs = ['model.landscape-synthesis', 'model.topic-synthesis'].includes(call.purpose) ? call.inputRefs : call.materialRefs;
      requireThat(Array.isArray(refs), 'invalid_scope', '旧调用缺少明确的实际材料范围，不能猜测恢复。', 409);
      const manifest = previous.materialManifest ?? previous.modelContext?.selectedMaterialRefs ?? previous.input.materials;
      const materials = refs.map(ref => {
        const access = p.accesses[ref.accessId], metadata = manifest.find(m => m.accessId === ref.accessId);
        requireThat(access && access.sourceId === ref.sourceId && metadata?.sourceId === access.sourceId && typeof metadata.ref === 'string', 'invalid_scope', '旧响应的材料身份或实际访问快照不完整，未创建恢复成果。', 409);
        const { text: ignored, ...savedMetadata } = metadata;
        return { ...clone(savedMetadata), text: access.text };
      });
      requireThat(new Set(materials.map(m => m.accessId)).size === materials.length, 'invalid_scope', '旧响应包含重复材料身份，请查看原始任务。', 409);
      const a = artifactOf(p, previous.artifactId);
      requireThat(a.revisions.some(revision => revision.id === previous.input.revisionId), 'invalid_scope', '原任务输入版本已不存在，未创建恢复成果。', 409);
      const task = { id: uid('task'), requestId, projectId, artifactId: previous.artifactId, mode: previous.mode, executionMode: 'local_revalidation',
        status: 'queued', createdAt: now(), progress: '准备在本机重新校验已保存响应，不调用模型',
        input: { ...clone(previous.input), materials }, inputFingerprint: previous.inputFingerprint ?? fingerprint(previous.input), promptVersion: null,
        provider: 'local_program', model: null, calls: [], attempts: [], toolRuns: [], cost: { status: 'not_applicable', amount: 0 },
        retryOfTaskId: previous.id, sourceCallId: call.id, sourceOutputFingerprint: fingerprint(call.outputText), parserVersion: MODEL_OUTPUT_PARSER_VERSION,
        extractLeadingJson, paperBatchRecords: clone(previous.paperBatchRecords ?? []), materialManifest: materials.map(({ text, ...metadata }) => metadata),
        searchId: previous.searchId ?? null, revalidation: { sourceTaskId: previous.id, sourceCallId: call.id, status: 'queued', modelCalled: false } };
      task.attempts.push(createTaskAttempt(task.id, { previousAttemptId: previous.attempts?.at(-1)?.id ?? null, inputFingerprint: task.inputFingerprint, provider: 'local_program' }));
      p.researchTasks[task.id] = task;
      event(p, task, 'saved_output_revalidation_queued', { sourceTaskId: previous.id, sourceCallId: call.id, parserVersion: MODEL_OUTPUT_PARSER_VERSION, extractLeadingJson, modelCalled: false });
      return { taskId: task.id };
    });
    const task = await this.store.read(s => s.projects[projectId].researchTasks[accepted.taskId]);
    if (!isTerminalRun(task.status) && !this.running.has(task.id)) {
      const controller = new AbortController(), running = { controller, promise: null }; this.running.set(task.id, running);
      running.promise = this.executeRevalidation(task, controller.signal).finally(() => this.running.delete(task.id));
    }
    return accepted;
  }

  async executeRevalidation(task, signal) {
    try {
      await this.store.update(s => {
        const p = s.projects[task.projectId], t = p.researchTasks[task.id];
        requireThat(!isTerminalRun(t.status), 'cancelled', '本地校验已停止。', 409);
        Object.assign(t, transitionRun(t, 'running', { progress: '正在读取原响应并检查结构、完整覆盖和原文定位' }));
        Object.assign(t.attempts[0], transitionRun(t.attempts[0], 'running'));
        t.toolRuns.push(transitionRun(createToolRun(t.attempts[0], { name: 'local.validate-saved-model-output', inputRefs: [{ sourceCallId: t.sourceCallId }] }), 'running'));
        event(p, t, 'saved_output_revalidation_started', { sourceCallId: t.sourceCallId, modelCalled: false });
      });
      const call = await this.store.read(s => s.modelCalls.find(call => call.id === task.sourceCallId && call.projectId === task.projectId && call.taskId === task.retryOfTaskId));
      requireThat(call && fingerprint(call.outputText) === task.sourceOutputFingerprint, 'saved_output_changed', '已保存模型响应发生变化，未采用这次本地校验。', 409);
      let text, excludedOutput = null, excludedPrefix = null;
      if (task.extractLeadingJson) {
        const extracted = extractLeadingJsonObject(call.outputText); text = extracted.jsonText; excludedOutput = extracted.excludedOutput; excludedPrefix = extracted.excludedPrefix;
      } else { parseModelJsonObject(call.outputText); text = normalizeOuterJsonFence(call.outputText); }
      const provenance = { actor: 'local_program', operation: 'local_revalidation', modelCalled: false, parserVersion: MODEL_OUTPUT_PARSER_VERSION,
        sourceTaskId: task.retryOfTaskId, sourceCallId: call.id, sourceModelProvenance: clone(call.provenance ?? null), sourceOutputFingerprint: task.sourceOutputFingerprint,
        normalization: task.extractLeadingJson ? 'explicit_leading_object_extraction' : 'outer_markdown_fence_only', contentRewritten: false,
        excludedOutput, excludedPrefix, excludedOutputIncludedInArtifact: false };
      await this.updateTask(task, { revalidation: { ...provenance, status: 'parsed_unvalidated' } });
      if (['model.landscape-synthesis','model.topic-synthesis'].includes(call.purpose)) {
        const completed = task.paperBatchRecords.filter(record => record.status === 'completed' && record.result);
        const candidates = [...completed.filter(record => record.recovery).reverse().map(record => [record]), completed];
        let combined;
        for (const records of candidates.filter(records => records.length)) {
          try { combined = combinePaperCoverage(records.map(record => record.result), task.input.materials); break; }
          catch (error) { if (!(error instanceof DomainError)) throw error; }
        }
        requireThat(combined, 'incomplete_paper_coverage', '原综合响应所依赖的逐篇记录尚未完整验证，不能跳过它们创建成果。', 409);
        text = call.purpose === 'model.topic-synthesis' ? completeTopicAggregation(text, combined) : completeLandscapeAggregation(text, combined);
        provenance.extractionSourceCallIds = [...new Set(task.paperBatchRecords.map(record => record.recovery?.sourceCallId ?? record.result?.provenance?.requestId).filter(Boolean))];
      }
      const parsed = task.mode === 'topic-review' ? validateTopicReview(text, task.input.materials, {criteriaVersion:/v0\.16-topic-abcd/.test(call.promptVersion??'')?'topic-abcd-v1':null}) : task.mode === 'compare' ? validateComparisonOutput(text, task.input.materials, {requireAssessment: /v0\.(12-decision-estimates|13-topic-library|14-topic-decisions)/.test(call.promptVersion ?? ''), requireDifficulty: /v0\.14-topic-decisions/.test(call.promptVersion ?? '')})
        : validateResearchOutput(text, task.mode === 'deepen' ? 'ask' : task.mode, task.input.materials,
          { requirePaperNotes: ['landscape', 'revise', 'topic-review'].includes(task.mode), requireDimensions: ['landscape', 'revise', 'topic-review'].includes(task.mode) });
      signal.throwIfAborted();
      await this.store.update(s => {
        const p = ensureKernel(s.projects[task.projectId]), t = p.researchTasks[task.id], a = artifactOf(p, task.artifactId);
        requireThat(!isTerminalRun(t.status) && !signal.aborted, 'cancelled', '本地校验已停止。', 409);
        t.staleInput = a.draft.version !== task.input.baseVersion || p.metadataVersion !== task.input.metadataVersion || this.isResearchInputStale(p, task);
        if (task.mode === 'clarify') {
          t.proposal = parsed; p.researchProposal = { ...parsed, taskId: t.id, inputVersion: task.input.baseVersion };
        } else if (task.mode === 'compare') {
          const result = createQuestionComparison(p, parsed, { operationId: task.requestId, taskId: task.id, inputArtifactId: a.id,
            inputRevisionId: task.input.revisionId, accessIds: task.input.materials.map(m => m.accessId), provenance, adoptionContext: task.input.adoptionContext,
            projectContext: { name: task.input.name ?? p.name, goal: task.input.goal, originalGoal: task.input.originalGoal, conditions: task.input.conditions, metadataVersion: task.input.metadataVersion } });
          t.outputArtifactId = result.artifactId; t.resultId = result.resultId;
        } else if (task.mode === 'topic-review') {
          Object.assign(t, saveTopicReview(p, t, parsed, provenance));
        } else if (task.mode === 'deepen' && a.kind === 'research_branch') {
          Object.assign(t, saveBranchInvestigation(p, t, parsed, provenance));
        } else {
          const result = { id: uid('result'), taskId: t.id, artifactId: a.id, kind: ['ask', 'deepen'].includes(task.mode) ? 'answer' : 'brief', ...parsed,
            createdAt: now(), materialCoverage: materialCoverage(task.input.materials), materialManifest: clone(t.materialManifest),
            searchScope: clone(task.input.searchScope ?? []), accessIds: task.input.materials.map(m => m.accessId), searchId: task.searchId,
            provenance, inputRevisionId: task.input.revisionId, adoptionContext: clone(task.input.adoptionContext ?? null) };
          p.researchResults[result.id] = result; t.resultId = result.id;
          if (result.kind === 'brief' && !a.draft.resultId && !t.staleInput) {
            a.draft.resultId = result.id; a.draft.sourceAccessIds = [...new Set([...a.draft.sourceAccessIds, ...result.accessIds])]; a.draft.version++; a.draft.updatedAt = now();
            checkpoint(p, a, task.requestId, '本地重新校验领域认识', 'generated', { resultId: result.id, scientificAdoption: false });
          }
          registerResearchResult(p, result, task.requestId);
        }
        Object.assign(t, transitionRun(t, 'completed', { progress: '本地校验通过，结果已保存；没有重新调用模型', provenance,
          revalidation: { ...provenance, status: 'structure_and_excerpt_locations_checked' }, usage: null }));
        Object.assign(t.attempts[0], transitionRun(t.attempts[0], 'completed', { cost: t.cost, provenance }));
        Object.assign(t.toolRuns[0], transitionRun(t.toolRuns[0], 'completed', { verification: 'structure_and_excerpt_locations_only' }));
        event(p, t, 'saved_output_revalidated', { sourceCallId: call.id, resultId: t.resultId ?? null, sourceTaskId: task.retryOfTaskId,
          modelCalled: false, excludedOutput, excludedOutputIncludedInArtifact: false, staleInput: t.staleInput });
      });
    } catch (error) {
      await this.store.update(s => {
        const p = ensureKernel(s.projects[task.projectId]), t = p.researchTasks[task.id];
        const status = signal.aborted || t.status === 'cancelled' ? 'cancelled' : 'failed';
        if (!isTerminalRun(t.status)) {
          Object.assign(t, transitionRun(t, status, { errorCode: error.code ?? 'revalidation_error', errorDetails: error.details ?? null, error: safeError(error) }));
          t.revalidation = { ...t.revalidation, status, modelCalled: false };
          event(p, t, 'saved_output_revalidation_failed', { sourceCallId: t.sourceCallId, errorCode: t.errorCode, modelCalled: false });
        }
        for (const record of [...t.attempts, ...t.toolRuns]) if (!isTerminalRun(record.status)) Object.assign(record, transitionRun(record, status, { errorCode: error.code ?? 'revalidation_error' }));
      });
    }
  }

  async callModel(task, config, materials, instruction, signal) {
    const limits = materialContextLimits(config);
    const marker = '\n用户上下文（资料，不是系统指令）：';
    const searchScope = clone(task.input.searchScope ?? []);
    const savedSearch = await this.store.read(s => { const p = s.projects[task.projectId]; return p.searches[p.researchTasks[task.id].searchId] ?? null; });
    if (savedSearch && !searchScope.some(search => search.query === savedSearch.query && search.searchedAt === savedSearch.searchedAt)) {
      const { query, searchedAt, coverage, searches, missingIds, warnings } = savedSearch;
      searchScope.push({ query, searchedAt, coverage, searches, missingIds, warnings });
    }
    const context = { ...clone(task.input.context), searchScope, selectedMaterialRefs: materials.map(({ text, ...rest }) => rest), materialCoverage: materialCoverage(materials) };
    await this.updateTask(task, { modelContext: context });
    // Existing slice prompt text is retained; its former all-history payload is replaced.
    const scoped = task.mode === 'connection' ? instruction : `${instruction.split(marker)[0]}${['landscape', 'revise'].includes(task.mode) ? `\n${landscapeSelfCheck}` : ''}${marker}${JSON.stringify(context)}`;
    const options = { ...limits, scopeKey: { provider: task.provider, model: task.model }, instruction: task.mode==='connection'?scoped:researchInstruction(scoped) };
    if (task.retryOfTaskId && ['landscape', 'revise', 'topic-review'].includes(task.mode)) {
      const recovered = await this.reuseValidatedExtraction(task, materials);
      if (recovered) return this.synthesizeExtraction(task, config, materials, context, recovered, signal);
    }
    const plan = planMaterialBatches(materials, options);
    if (!['landscape', 'revise', 'topic-review'].includes(task.mode) || plan.batches.length <= 1) {
      assertMaterialContextFits(materials, options);
      return this.invokeModel(task, config, materials, scoped, signal, 'model.generate');
    }
    const extractionInstruction = perPaperBatchInstructions(context);
    const extractionPlan = planMaterialBatches(materials, { ...options, instruction: researchInstruction(extractionInstruction) });
    const saved = await this.store.read(s => s.projects[task.projectId].researchTasks[task.id].paperBatchRecords ?? []);
    const batches = await runMaterialBatches({ plan: extractionPlan, taskId: task.id, provider: task.provider, model: task.model, previous: saved,
      manualRetry: Boolean(task.retryOfTaskId), signal,
      checkpoint: record => this.store.update(s => {
        const p = s.projects[task.projectId], t = p.researchTasks[task.id];
        t.paperBatchRecords ??= [];
        const index = t.paperBatchRecords.findIndex(r => r.batchId === record.batchId);
        if (index < 0) t.paperBatchRecords.push(record); else t.paperBatchRecords[index] = record;
        if (!isTerminalRun(t.status)) t.progress = `正在完整整理材料：已完成 ${t.paperBatchRecords.filter(r => r.status === 'completed').length} / ${extractionPlan.batches.length} 批`;
        event(p, t, 'material_batch_checkpoint', { batchId: record.batchId, status: record.status, segments: record.segments });
      }),
      run: async ({ batch }) => {
        const output = await this.invokeModel(task, config, batch.materials, extractionInstruction, signal, 'model.paper-extraction', batch.segments);
        return { ...validatePaperBatchOutput(output.text, batch), usage: output.usage, cost: output.cost, provenance: output.provenance };
      } });
    const combined = combinePaperCoverage(batches.results, materials);
    return this.synthesizeExtraction(task, config, materials, context, { ...batches, combined }, signal);
  }

  /** A user's retry may reuse complete extraction inside a rejected synthesis.
   * Only structure, full access coverage and exact excerpts are rechecked here;
   * rejected scientific statements are neither changed nor silently accepted. */
  async reuseValidatedExtraction(task, materials) {
    const saved = await this.store.read(s => {
      const p = s.projects[task.projectId], current = p.researchTasks[task.id], previous = p.researchTasks[task.retryOfTaskId];
      return { records: current.paperBatchRecords ?? [], previous, calls: s.modelCalls.filter(call => call.projectId === task.projectId && call.taskId === previous?.id) };
    });
    if (!saved.previous || saved.previous.mode !== task.mode || saved.previous.artifactId !== task.artifactId) return null;
    const completed = saved.records.filter(record => record.status === 'completed' && record.result);
    // A recovered complete record can coexist with earlier partial batches.
    // Prefer that exact complete record so partial history is neither deleted
    // nor accidentally counted as a second copy of the same source coverage.
    const candidates = [...completed.filter(record => record.recovery).reverse().map(record => [record]), completed];
    for (const records of candidates.filter(records => records.length)) {
      try {
        const combined = combinePaperCoverage(records.map(record => record.result), materials);
        return { combined, records, reusedBatchIds: records.map(record => record.batchId),
          recoveredCallIds: [...new Set(records.map(record => record.recovery?.sourceCallId).filter(Boolean))] };
      } catch (error) { if (!(error instanceof DomainError)) throw error; }
    }
    if (saved.previous.status !== 'failed') return null;
    const refs = values => Array.isArray(values) ? values.map(({ sourceId, accessId }) => `${sourceId}\0${accessId}`).sort() : [];
    const selectedRefs = JSON.stringify(refs(materials));
    for (const call of [...saved.calls].reverse()) {
      if (call.status !== 'completed' || call.discardedAfterCancellation || call.purpose !== 'model.generate' || typeof call.outputText !== 'string'
        || JSON.stringify(refs(call.materialRefs)) !== selectedRefs) continue;
      // This is a validation plan for already-sent complete input, not a new
      // model request; configured request bounds must not split that history.
      const batch = planMaterialBatches(materials, { instruction: `Recover extraction from saved call ${call.id}`,
        scopeKey: { sourcePromptFingerprint: call.promptFingerprint ?? null, sourceTaskId: saved.previous.id } }).batches[0];
      let validated, combined;
      try {
        let extractionText = call.outputText;
        if (task.mode === 'topic-review') {
          const data = extractLeadingJsonObject(extractionText).value;
          requireThat(data.framework === 'topic-evidence-v1', 'model_structure', '旧响应不是专题逐篇记录。');
          extractionText = JSON.stringify({ framework: LANDSCAPE_FRAMEWORK, papers: data.papers });
        }
        validated = validatePaperBatchOutput(extractionText, batch);
        combined = combinePaperCoverage([validated], materials);
      } catch (error) { if (error instanceof DomainError) continue; throw error; }
      const recovery = { sourceCallId: call.id, sourceTaskId: saved.previous.id, sourcePromptVersion: call.promptVersion ?? null,
        sourcePromptFingerprint: call.promptFingerprint ?? null, provenance: clone(call.provenance ?? null),
        checkedAt: now(), verification: 'complete_paper_coverage_and_excerpt_positions_only', newModelCall: false };
      const record = { batchId: batch.id, fingerprint: batch.fingerprint, status: 'completed', segments: clone(batch.segments), attempts: [], toolRuns: [],
        result: { ...validated, provenance: clone(call.provenance ?? null), sourceCallId: call.id }, recovery };
      await this.store.update(s => {
        const p = s.projects[task.projectId], t = p.researchTasks[task.id]; requireThat(!isTerminalRun(t.status), 'cancelled', '本步已停止。', 409);
        t.paperBatchRecords ??= [];
        if (!t.paperBatchRecords.some(prior => prior.batchId === record.batchId)) t.paperBatchRecords.push(record);
        event(p, t, 'paper_extraction_recovered', { sourceCallId: call.id, sourceTaskId: saved.previous.id, recoveredBatchId: record.batchId,
          materialCount: materials.length, coverage: combined.coverage, newModelCall: false });
      });
      return { combined, records: [record], reusedBatchIds: [record.batchId], recoveredCallIds: [call.id] };
    }
    return null;
  }

  async synthesizeExtraction(task, config, materials, context, batches, signal) {
    const { combined } = batches, topical = task.mode === 'topic-review', synthesis = topical ? topicAggregationInstructions(combined,context) : `${landscapeAggregationInstructions(combined, context)}\n${landscapeSelfCheck}`;
    await this.updateTask(task, { materialBatchCoverage: combined.coverage, reusedBatchIds: batches.reusedBatchIds,
      recoveredExtractionCallIds: batches.recoveredCallIds ?? [], progress: topical ? '全部材料已逐篇整理，正在论证证据、缺口与设计' : batches.reusedBatchIds.length ? '已复用完整逐篇记录，只重新整理七个领域维度' : '全部材料已逐篇整理，正在综合七个领域维度' });
    assertMaterialContextFits([], { ...materialContextLimits(config), instruction: researchInstruction(synthesis) });
    const output = await this.invokeModel(task, config, [], synthesis, signal, topical ? 'model.topic-synthesis' : 'model.landscape-synthesis', materials.map(({ accessId, sourceId }) => ({ accessId, sourceId })));
    return { ...output, text: topical ? completeTopicAggregation(output.text,combined) : completeLandscapeAggregation(output.text, combined), provenance: { ...output.provenance, processing: 'complete_extraction_then_synthesis',
      materialRefs: materials.map(({ accessId, sourceId }) => ({ accessId, sourceId })), batchIds: batches.records.map(r => r.batchId), reusedBatchIds: batches.reusedBatchIds,
      recoveredExtractionCallIds: batches.recoveredCallIds ?? [], coverage: combined.coverage } };
  }

  async invokeModel(task, config, materials, instruction, signal, name, inputRefs = materials.map(({ accessId, sourceId }) => ({ accessId, sourceId }))) {
    signal.throwIfAborted();
    if(task.mode!=='connection')instruction=researchInstruction(instruction);
    let tool;
    const callId = uid('call'), promptVersion = `${promptVersionFor(task.mode)}:${task.mode}:${name}${task.mode==='connection'?'':`:${RESEARCH_LANGUAGE_VERSION}`}`;
    const promptFingerprint = fingerprint({ instruction, materials });
    await this.store.update(s => {
      const p = ensureKernel(s.projects[task.projectId]), t = p.researchTasks[task.id]; requireThat(!isTerminalRun(t.status), 'cancelled', '本步已停止。', 409);
      tool = transitionRun(createToolRun(t.attempts.at(-1), { name, inputRefs }), 'running', { promptVersion, promptFingerprint, callId }); t.toolRuns.push(tool);
      s.modelCalls.push({ id: callId, taskId: task.id, projectId: task.projectId, provider: task.provider, model: task.model, purpose: name,
        promptVersion, promptFingerprint, languageStandard:task.mode==='connection'?null:RESEARCH_LANGUAGE_VERSION, inputRefs: clone(inputRefs), materialRefs: materials.map(({ sourceId, accessId }) => ({ sourceId, accessId })),
        ...(name==='model.topic-screen'?{screeningInput:{instruction,materials:clone(materials)}}:{}),
        inputCharacters: instruction.length + JSON.stringify(materials).length, status: 'running', startedAt: now(), usage: null, cost: { status: 'unknown', amount: null } });
      t.calls.push(callId);
      event(p, t, 'model_call_started', { callId, toolRunId: tool.id, purpose: name, promptVersion, promptFingerprint });
    });
    try {
      const generated = await this.modelFactory(config, { fetchImpl: this.fetchImpl }).generate({ requestId: callId, instruction, materials, signal });
      let normalized = null;
      if (task.mode !== 'connection') { try { parseModelJsonObject(generated.text); } catch { try { normalized = extractLeadingJsonObject(generated.text); } catch { /* Validation below reports malformed or ambiguous output. */ } } }
      const output = { ...generated, ...(normalized ? { text: normalized.jsonText } : {}), provenance: { ...generated.provenance, requestId: callId, promptVersion, promptFingerprint, purpose: name, ...(normalized ? { formatNormalization: { operation: 'leading_complete_object', excludedOutput: normalized.excludedOutput, excludedPrefix: normalized.excludedPrefix, contentRewritten: false, sourceCallId: callId } } : {}) } };
      await this.store.update(s => {
        const p = s.projects[task.projectId], t = p.researchTasks[task.id], saved = t.toolRuns.find(r => r.id === tool.id);
        const discardedAfterCancellation = signal.aborted || t.status === 'cancelled';
        Object.assign(s.modelCalls.find(c => c.id === callId), { status: 'completed', finishedAt: now(), usage: output.usage, cost: output.cost,
          provenance: output.provenance, discardedAfterCancellation, outputText: generated.text, ...(normalized ? { formatNormalization: output.provenance.formatNormalization } : {}), outputStatus: 'unvalidated_model_output' });
        if (!isTerminalRun(saved.status)) Object.assign(saved, transitionRun(saved, discardedAfterCancellation ? 'cancelled' : 'completed',
          { usage: output.usage, cost: output.cost, provenance: output.provenance }));
        event(p, t, 'model_call_completed', { callId, toolRunId: tool.id, discardedAfterCancellation });
      });
      signal.throwIfAborted();
      return output;
    } catch (error) {
      await this.store.update(s => {
        const p = s.projects[task.projectId], t = p.researchTasks[task.id], saved = t.toolRuns.find(r => r.id === tool.id), call = s.modelCalls.find(c => c.id === callId);
        const status = signal.aborted ? 'cancelled' : 'failed', errorCode = error.code ?? 'model_error';
        // A returned-but-discarded late response still has real usage. Keep that
        // physical call record completed while the task/tool remain cancelled.
        if (call.status === 'running') {
          Object.assign(call, { status, finishedAt: now(), errorCode });
          event(p, t, `model_call_${status}`, { callId, toolRunId: tool.id, errorCode });
        }
        if (!isTerminalRun(saved.status)) Object.assign(saved, transitionRun(saved, status, { errorCode }));
      });
      throw error;
    }
  }

  async run(task, config, signal) {
    return this.taskContext.run({ task, signal }, () => this.executeRun(task, config, signal));
  }

  async recordRetrieval(task, signal, method, input, operation) {
    let tool;
    await this.store.update(s => {
      const t = s.projects[task.projectId].researchTasks[task.id]; requireThat(!isTerminalRun(t.status), 'cancelled', '本步已停止。', 409);
      tool = transitionRun(createToolRun(t.attempts.at(-1), { name: `PubMed.${method}`, inputRefs: method !== 'metadata' ? [{ query: input[0], options: Object.fromEntries(Object.entries(input[1]??{}).filter(([key,value])=>!['signal','onProgress','state'].includes(key)&&typeof value!=='function')) }] : input[0].map(pmid => ({ pmid })) }), 'running');
      t.toolRuns.push(tool);
    });
    try {
      const result = await operation(); signal.throwIfAborted();
      await this.store.update(s => {
        const saved = s.projects[task.projectId].researchTasks[task.id].toolRuns.find(r => r.id === tool.id);
        Object.assign(saved, transitionRun(saved, 'completed', { provider: 'PubMed', retrievedCount: method === 'metadata' ? result.length : result.records?.length ?? result.ids?.length ?? null,
          ...(method === 'search' ? { missingIds: result.missingIds ?? [], warnings: result.warnings ?? [] } : {}) }));
      });
      return result;
    } catch (error) {
      await this.store.update(s => {
        const saved = s.projects[task.projectId].researchTasks[task.id].toolRuns.find(r => r.id === tool.id);
        if (!isTerminalRun(saved.status)) Object.assign(saved, transitionRun(saved, signal.aborted ? 'cancelled' : 'failed', { errorCode: error.code ?? 'retrieval_failed' }));
      });
      throw error;
    }
  }

  async executeRun(task, config, signal) {
    try {
      await this.store.update(s => {
        const t = s.projects[task.projectId].researchTasks[task.id], attempt = t.attempts.at(-1);
        if (!isTerminalRun(t.status)) Object.assign(attempt, transitionRun(attempt, 'running'));
      });
      signal.throwIfAborted();
      if(task.mode==='figure-compose') await executeComposition(this,task,config,signal);
      else if(templateModes.includes(task.mode)) await executeTemplateTask(this,task,config,signal);
      else if(task.mode==='topic-writing') await executeWriting(this,task,config,signal);
      else if(task.mode==='manuscript-writing') await executeManuscript(this,task,config,signal);
      else if (topicTaskModes.includes(task.mode)) await executeTopicWorkflow(this,task,config,signal);
      else if (!['compare', 'deepen', 'brief', 'topic-review'].includes(task.mode)) await super.run(task, config, signal);
      else {
        await this.updateTask(task, { status: 'running', progress: task.mode === 'brief' ? '正在整理实际问题、依据与取舍' : task.mode === 'compare' ? '正在比较问题、依据与未知' : '正在深入所选方向与依据' });
        let output = null, parsed = null;
        if (task.mode !== 'brief') {
          const instruction = task.mode === 'topic-review' ? topicReviewInstructions() : task.mode === 'compare' ? comparisonInstructions()
            : `返回 JSON {items:[{headline,text,status,citations:[{ref,passage}]}]}。${deepArgumentInstructions} reported/inference 必须有本次实际 R/P 引用，unknown/suggestion 区分未知与拟议设计。每段标题给具体判断，正文解释证据与对设计的影响。只返回完整JSON，不追加尾注。`;
          output = await this.callModel(task, config, task.input.materials, instruction, signal); signal.throwIfAborted();
          parsed = task.mode === 'topic-review' ? validateTopicReview(output.text,task.input.materials) : task.mode === 'compare' ? validateComparisonOutput(output.text, task.input.materials, {requireAssessment:true,requireDifficulty:true})
            : validateResearchOutput(output.text, 'ask', task.input.materials);
        }
        await this.store.update(s => {
          const p = ensureKernel(s.projects[task.projectId]), t = p.researchTasks[task.id], a = p.artifacts[task.artifactId];
          if (isTerminalRun(t.status) || signal.aborted) return;
          t.staleInput = a.draft.version !== task.input.baseVersion || p.metadataVersion !== task.input.metadataVersion || p.researchKernel.version !== task.input.baseStateVersion;
          if (task.mode === 'compare') {
            const result = createQuestionComparison(p, parsed, { operationId: task.requestId, taskId: task.id, inputArtifactId: a.id,
              inputRevisionId: task.input.revisionId, accessIds: task.input.materials.map(m => m.accessId), provenance: output.provenance, adoptionContext: task.input.adoptionContext,
              projectContext: { name: task.input.name, goal: task.input.goal, originalGoal: task.input.originalGoal, conditions: task.input.conditions, metadataVersion: task.input.metadataVersion } });
            t.outputArtifactId = result.artifactId; t.resultId = result.resultId;
          } else if (task.mode === 'brief') {
            requireThat(!t.staleInput, 'research_state_conflict', '研究内容刚刚发生变化，请重新整理简报。', 409);
            const result = composeResearchBrief(p, { baseStateVersion: task.input.baseStateVersion, inputArtifactId: a.id, inputRevisionId: task.input.revisionId, next: task.input.text || undefined }, task.requestId);
            t.outputArtifactId = result.artifactId; t.resultId = result.resultId;
          } else if (task.mode === 'topic-review') {
            Object.assign(t, saveTopicReview(p, t, parsed, output.provenance));
          } else if (a.kind === 'research_branch') {
            Object.assign(t, saveBranchInvestigation(p, t, parsed, output.provenance));
          } else {
            const result = { id: uid('result'), taskId: t.id, artifactId: a.id, kind: 'answer', ...parsed, createdAt: now(),
              accessIds: task.input.materials.map(m => m.accessId), materialManifest: task.input.materials.map(({ text, ...m }) => m),
              materialCoverage: materialCoverage(task.input.materials), provenance: output.provenance, inputRevisionId: task.input.revisionId,
              adoptionContext: task.input.adoptionContext, explorationTarget: task.input.itemTarget ?? task.input.target };
            p.researchResults[result.id] = result; registerResearchResult(p, result, task.requestId); t.resultId = result.id;
          }
          Object.assign(t, transitionRun(t, 'completed', { progress: '本步结果已保存，可以查看、追问或继续表达取舍。', usage: output?.usage ?? null,
            cost: output?.cost ?? { status: 'not_applicable', amount: 0 }, provenance: output?.provenance ?? { actor: 'local_program', modelCalled: false } }));
          event(p, t, 'research_task_completed', { resultId: t.resultId, outputArtifactId: t.outputArtifactId ?? null, staleInput: t.staleInput });
        });
      }
    } catch (error) {
      await this.updateTask(task, { status: signal.aborted ? 'cancelled' : 'failed', errorCode: error.code ?? 'run_error', errorDetails: error.details ?? null,
        error: signal.aborted ? '本步已停止，已有内容保留。' : safeError(error) });
    } finally {
      await this.store.update(s => {
        const p = ensureKernel(s.projects[task.projectId]), t = p.researchTasks[task.id];
        if (t.resultId && p.researchResults[t.resultId]) registerResearchResult(p, p.researchResults[t.resultId], task.requestId);
        const attempt = t.attempts?.at(-1);
        if (attempt && !isTerminalRun(attempt.status) && isTerminalRun(t.status)) Object.assign(attempt, transitionRun(attempt, t.status, { usage: t.usage ?? null, cost: t.cost, errorCode: t.errorCode ?? null }));
        if (!['compare', 'deepen', 'brief', 'topic-review'].includes(t.mode) && t.status === 'completed') event(p, t, 'research_task_completed', { resultId: t.resultId ?? null, outcome: t.outcome ?? null });
      });
    }
  }

  async stop(projectId, taskId, requestId) {
    const cancel = s => {
      const p = ensureKernel(getProject(s, projectId)), t = p.researchTasks[taskId];
      requireThat(t, 'not_found', '没有这个任务。', 404);
      if (!isTerminalRun(t.status)) {
        Object.assign(t, transitionRun(t, 'cancelled', { progress: '已停止，已有内容保留' }));
        const attempt = t.attempts?.at(-1);
        if (attempt && !isTerminalRun(attempt.status)) Object.assign(attempt, transitionRun(attempt, 'cancelled', { requestedBy: 'local_user' }));
        event(p, { ...t, requestId: requestId ?? t.requestId }, 'research_task_cancelled', { requestedBy: 'local_user' });
      }
      return { stopped: t.status === 'cancelled', status: t.status };
    };
    const result = requestId ? await this.store.transact(requestId, { operation: 'stop-research', projectId, taskId }, cancel) : await this.store.update(cancel);
    if (result.stopped) this.running.get(taskId)?.controller.abort();
    return result;
  }
}
