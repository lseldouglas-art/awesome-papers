import { createHash } from 'node:crypto';
import { validatePaperBatchOutput, recoverPaperBatch } from './workflows.mjs';

// Reuse the existing batch/coverage contract. Only incomplete work is split;
// transport/auth/rate-limit errors are never silently resent.
export function learnedPaperCallSize(requested, records = []) {
  const failedSizes = records.filter(r => r.errorCode === 'model_incomplete_response')
    .map(r => r.segments?.length ?? 0).filter(n => n > 1);
  return Math.min(requested, ...failedSizes.map(n => Math.max(1, Math.floor(n / 2))));
}

export async function extractPaperBatch({ batch, invoke, retain, signal, maxCallMaterials = batch.materials.length,
  onLimit = async () => {} }) {
  const papers = [], queue = [];
  let syntaxSplits = 0;
  const subset = (unit, indices, repair = false) => {
    const materials = indices.map(i => unit.materials[i]), segments = indices.map(i => unit.segments[i]);
    const fingerprint = createHash('sha256').update(JSON.stringify({ parent: batch.fingerprint, segments })).digest('hex');
    return { ...batch, id: `part_${fingerprint.slice(0, 20)}`, fingerprint, materials, segments, repair };
  };
  const enqueue = (unit, limit, repair = false) => {
    const parts = [];
    for (let i = 0; i < unit.materials.length; i += limit)
      parts.push(subset(unit, unit.materials.slice(i, i + limit).map((_, j) => i + j), repair));
    queue.unshift(...parts);
  };
  enqueue(batch, maxCallMaterials);
  while (queue.length) {
    signal?.throwIfAborted();
    const unit = queue.shift();
    if (unit.materials.length > maxCallMaterials) { enqueue(unit, maxCallMaterials, unit.repair); continue; }
    let output, error, result;
    try {
      output = await invoke(unit);
      signal?.throwIfAborted();
      result = validatePaperBatchOutput(output.text, unit);
    } catch (caught) {
      signal?.throwIfAborted(); error = caught;
      if (!['model_structure', 'incomplete_paper_coverage', 'invalid_citation', 'model_incomplete_response'].includes(error.code)) throw error;
      const text = output?.text ?? error.responseSnapshot?.text;
      result = text ? recoverPaperBatch(text, unit) : { papers: [] };
    }
    if (result.papers.length) {
      const sourceCallId = output?.provenance?.requestId ?? error?.callId ?? null;
      const recovery = { sourceCallId, operation: error ? 'independent_paper_validation' : 'validated_paper_unit',
        contentRewritten: false, errorCode: error?.code ?? null };
      // Every successful unit survives a later failure, even within one UI batch.
      await retain({ batchId: `${unit.id}:${sourceCallId ?? 'local'}`, fingerprint: unit.fingerprint, status: 'completed',
        segments: result.papers.map(p => p.segment), attempts: [], toolRuns: [], result: { ...result, provenance: output?.provenance ?? null }, recovery });
      papers.push(...result.papers);
    }
    if (!error) continue;
    const remaining = unit.materials.map((m, i) => result.papers.some(p => p.accessId === m.accessId) ? -1 : i).filter(i => i >= 0);
    if (!remaining.length) continue;
    const pending = subset(unit, remaining);
    if (error.code === 'model_incomplete_response' && error.responseSnapshot?.finishReason !== 'length') throw error;
    if (error.code === 'model_incomplete_response' || (error.code === 'model_structure' && !unit.repair && syntaxSplits++ === 0)) {
      if (unit.materials.length <= 1) throw error;
      maxCallMaterials = Math.max(1, Math.min(maxCallMaterials, Math.floor(unit.materials.length / 2)));
      await onLimit(maxCallMaterials, error.code);
      enqueue(pending, maxCallMaterials);
    } else {
      if (unit.repair) throw error;
      enqueue(pending, maxCallMaterials, true);
    }
  }
  return { batchId: batch.id, fingerprint: batch.fingerprint, framework: 'domain-landscape-v1', papers,
    usage: null, cost: { status: 'unknown', amount: null }, maxCallMaterials };
}
