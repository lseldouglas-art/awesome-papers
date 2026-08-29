import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ResearchScopingSessionStoreV1,
  SCOPING_SESSION_STAGES,
} from "./research-scoping-session-store-v1.js";

test("scoping session persists every method-line revision and recovers after a new store instance", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "research-scoping-session-"));
  const sessionId = "scoping-00000000-0000-4000-8000-000000000001";
  const store = new ResearchScopingSessionStoreV1({
    rootDir,
    idFactory: () => sessionId,
    now: (() => {
      let second = 0;
      return () => new Date(Date.UTC(2026, 7, 29, 0, 0, second++));
    })(),
  });

  let snapshot = await store.createFirstPlan({ planHash: "plan-1", question: "领域现状？" });
  assert.equal(snapshot.stage, SCOPING_SESSION_STAGES.FIRST_PLAN);
  for (const [eventType, payload] of [
    ["FIRST_CALIBRATION_COMPLETED", { calibrationHash: "calibration-1" }],
    ["FIRST_PREVIEW_COMPLETED", { planHash: "preview-1" }],
    ["DIRECTION_SELECTED", { decisionHash: "decision-1" }],
    ["SECOND_PLAN_GENERATED", { planHash: "plan-2" }],
    ["SECOND_CALIBRATION_COMPLETED", { calibrationHash: "calibration-2" }],
    ["SECOND_PREVIEW_COMPLETED", { planHash: "preview-2" }],
  ]) {
    snapshot = await store.append({
      sessionId,
      expectedRevision: snapshot.revision,
      eventType,
      payload,
    });
  }
  assert.equal(snapshot.stage, SCOPING_SESSION_STAGES.COMPLETE);
  assert.equal(snapshot.revision, 7);

  const recovered = await new ResearchScopingSessionStoreV1({ rootDir }).load(sessionId);
  assert.deepEqual(recovered.identity, snapshot.identity);
  assert.equal(recovered.firstRound.plan.planHash, "plan-1");
  assert.equal(recovered.firstRound.preview.planHash, "preview-1");
  assert.equal(recovered.directionSelection.decisionHash, "decision-1");
  assert.equal(recovered.secondRound.preview.planHash, "preview-2");

  const [fileName] = (await readdir(rootDir)).filter((name) => name.endsWith(".ndjson"));
  const lines = (await readFile(join(rootDir, fileName), "utf8")).trimEnd().split("\n");
  assert.equal(lines.length, 7);
  assert.deepEqual(lines.map((line) => JSON.parse(line).revision), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(lines.every((line) => /^[a-f0-9]{64}$/.test(JSON.parse(line).hash)));
});

test("scoping session rejects skipped stages and stale writers without overwriting revisions", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "research-scoping-session-guard-"));
  const sessionId = "scoping-00000000-0000-4000-8000-000000000002";
  const store = new ResearchScopingSessionStoreV1({ rootDir, idFactory: () => sessionId });
  const first = await store.createFirstPlan({ planHash: "plan-1" });

  const [dataFile] = (await readdir(rootDir)).filter((name) => name.endsWith(".ndjson"));
  await writeFile(
    join(rootDir, `${dataFile}.lock`),
    `${JSON.stringify({ pid: 2_147_483_647, acquiredAt: new Date().toISOString() })}\n`,
    "utf8",
  );

  await assert.rejects(
    store.append({
      sessionId,
      expectedRevision: first.revision,
      eventType: "FIRST_PREVIEW_COMPLETED",
      payload: { planHash: "preview-1" },
    }),
    (error) => error.code === "SCOPING_SESSION_STAGE_MISMATCH",
  );
  const calibrated = await store.append({
    sessionId,
    expectedRevision: first.revision,
    eventType: "FIRST_CALIBRATION_COMPLETED",
    payload: { calibrationHash: "calibration-1" },
  });
  await assert.rejects(
    store.append({
      sessionId,
      expectedRevision: first.revision,
      eventType: "FIRST_PREVIEW_COMPLETED",
      payload: { planHash: "stale-preview" },
    }),
    (error) => error.code === "SCOPING_SESSION_REVISION_MISMATCH",
  );
  const recovered = await store.load(sessionId);
  assert.equal(recovered.revision, calibrated.revision);
  assert.equal(recovered.firstRound.preview, null);
});
