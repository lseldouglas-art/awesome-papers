import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace } from '../src/workspace.mjs';
import { upgradeProject, exportProgress } from '../src/progress.mjs';
import { registerResearchResult, isLegacyResultIndexEvidence } from '../src/kernel.mjs';
import { startServer } from '../src/server.mjs';
import { createClient } from '../src/client.mjs';

const wire = value => JSON.parse(JSON.stringify(value));
function legacyFixture() {
  const state = { schemaVersion: 2, projects: {}, receipts: {}, events: [], modelCalls: [] };
  for (let index = 0; index < 2; index++) {
    const p = upgradeProject(createWorkspace(state, { example: true }, `legacy-${index}`), false);
    const a = Object.values(p.artifacts)[0], revision = a.revisions[0], original = Object.values(p.evidence)[0];
    const result = { id: `legacy-result-${index}`, artifactId: a.id, kind: 'brief', blocks: structuredClone(revision.blocks),
      citations: [{ blockId: original.target.blockId, accessId: original.accessId, sourceId: original.sourceId, quote: original.quote, relation: 'context' }],
      accessIds: [...revision.sourceAccessIds], provenance: { actor: 'model', fixture: true } };
    p.researchResults[result.id] = result; revision.resultId = result.id; a.draft.resultId = result.id;
    // A matching operation string alone must never hide original user evidence.
    original.operationId = 'index-existing-results';
  }
  return state;
}
async function checkStartupExports(t, state, bytes = JSON.stringify(state, null, 2)) {
  const snapshots = Object.values(state.projects).flatMap(p => Object.values(p.artifacts).flatMap(a => a.revisions.map(r => ({
    projectId: p.id, artifactId: a.id, revisionId: r.id, revision: wire(r), export: wire(exportProgress(p, a.id, r.id)),
  }))));
  const directory = await mkdtemp(join(tmpdir(), 'rw2-legacy-export-'));
  await writeFile(join(directory, 'workspace.json'), bytes, { mode: 0o600 });
  let app;
  try {
    // This exercises migration plus the real startup index and its HTTP export.
    // Neither initializing nor reopening is allowed to call research providers.
    const options = { directory, port: 0, researchOptions: { modelFactory: () => ({ generate: async () => { throw Error('unexpected model call'); } }),
      pubmed: { search: async () => { throw Error('unexpected literature retrieval'); } } } };
    for (let pass = 0; pass < 2; pass++) {
      app = await startServer(options); const api = createClient({ baseUrl: app.url });
      let checked = 0;
      for (const snapshot of snapshots) {
        const actual = await api.exportRevision(snapshot.projectId, snapshot.artifactId, snapshot.revisionId);
        // Only counts are emitted if real local data fails; never dump private text.
        assert.ok(isDeepStrictEqual(actual, snapshot.export), `historical export mismatch on pass ${pass + 1}, revision ${checked + 1} of ${snapshots.length}`);
        assert.ok(isDeepStrictEqual(actual.revision, snapshot.revision), `historical revision changed on pass ${pass + 1}`);
        checked++;
      }
      const indexed = await app.store.read();
      for (const original of Object.values(state.projects)) {
        const current = indexed.projects[original.id];
        if (Object.values(original.researchResults ?? {}).some(result => ['brief', 'answer'].includes(result.kind) && result.blocks?.some(block => block.type !== 'heading' && block.text?.trim()))) {
          assert.ok(Object.keys(current.researchItems).length > 0, 'startup must retain a usable live research graph');
        }
        assert.ok(isDeepStrictEqual(current.accesses, original.accesses), 'access snapshots changed');
        assert.ok(isDeepStrictEqual(current.annotations, original.annotations), 'annotations changed');
        for (const evidence of Object.values(original.evidence)) assert.ok(isDeepStrictEqual(current.evidence[evidence.id], evidence), 'original evidence changed');
      }
      t.diagnostic(`pass ${pass + 1}: ${Object.keys(state.projects).length} projects, ${checked} historical exports exact`);
      await app.close(); app = null;
    }
    assert.equal(await readFile(join(directory, 'workspace.json'), 'utf8'), String(bytes));
  } finally { if (app) await app.close(); }
}

test('legacy JSON exports stay exact after real SQLite startup indexing and restart', async t => {
  await checkStartupExports(t, legacyFixture());
});

test('already persisted first-v0.6 indexes are excluded without deleting graph or original evidence', async t => {
  const original = legacyFixture(), indexed = structuredClone(original);
  for (const p of Object.values(indexed.projects)) {
    for (const result of Object.values(p.researchResults)) registerResearchResult(p, result, 'index-existing-results');
    const derived = Object.values(p.evidence).filter(e => e.derivation?.mode === 'legacy_enrichment');
    assert.ok(derived.length > 0);
    for (const evidence of derived) {
      assert.equal(evidence.actor, 'local_program');
      evidence.actor = 'model';
      delete evidence.derivation; // Isolated fixture models records saved before the explicit marker existed.
      assert.equal(isLegacyResultIndexEvidence(p, evidence), true);
    }
    const prior = original.projects[p.id];
    for (const a of Object.values(prior.artifacts)) for (const r of a.revisions) {
      assert.ok(isDeepStrictEqual(exportProgress(p, a.id, r.id), exportProgress(prior, a.id, r.id)), 'compatibility export changed');
    }
    for (const evidence of Object.values(prior.evidence)) assert.equal(isLegacyResultIndexEvidence(p, evidence), false);
  }
  await checkStartupExports(t, indexed);
});
