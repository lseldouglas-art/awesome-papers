import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ContentAddressedArtifactStore,
  ContentAddressedArtifactStoreError,
  canonicalizeJsonContent,
  contentAddressForJson,
} from "./content-addressed-artifact-store-v1.js";

function tempRoot() {
  return join(tmpdir(), `research-artifacts-${process.pid}-${randomUUID()}`);
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function rmdirIfPresent(directoryPath) {
  try {
    await rmdir(directoryPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function cleanupSingleArtifact(rootDir, filePath) {
  await unlinkIfPresent(filePath);
  await rmdirIfPresent(dirname(filePath));
  await rmdirIfPresent(join(rootDir, "sha256"));
  await rmdirIfPresent(rootDir);
}

test("normalizes JSON before addressing and idempotently reuses existing content", async () => {
  const rootDir = tempRoot();
  const store = new ContentAddressedArtifactStore({ rootDir });
  let filePath;
  try {
    const first = await store.put({ z: 3, nested: { b: true, a: [2, 1] }, a: -0 });
    filePath = first.filePath;
    const second = await store.put({ a: 0, nested: { a: [2, 1], b: true }, z: 3 });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.address, second.address);
    assert.equal(first.address, contentAddressForJson({ nested: { b: true, a: [2, 1] }, z: 3, a: 0 }));
    assert.equal(
      await readFile(first.filePath, "utf8"),
      '{"a":0,"nested":{"a":[2,1],"b":true},"z":3}',
    );
    assert.deepEqual(await store.read(first.address), {
      a: 0,
      nested: { a: [2, 1], b: true },
      z: 3,
    });
  } finally {
    if (filePath) await cleanupSingleArtifact(rootDir, filePath);
  }
});

test("publishes one immutable file when identical content is written concurrently", async () => {
  const rootDir = tempRoot();
  const storeA = new ContentAddressedArtifactStore({ rootDir });
  const storeB = new ContentAddressedArtifactStore({ rootDir });
  let filePath;
  try {
    const results = await Promise.all([
      storeA.put({ id: "artifact-1", values: [1, 2, 3] }),
      storeB.put({ values: [1, 2, 3], id: "artifact-1" }),
    ]);
    filePath = results[0].filePath;

    assert.equal(results[0].address, results[1].address);
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.deepEqual(await storeA.read(results[0].address), {
      id: "artifact-1",
      values: [1, 2, 3],
    });
  } finally {
    if (filePath) await cleanupSingleArtifact(rootDir, filePath);
  }
});

test("read fails closed when stored bytes no longer match their SHA-256 address", async () => {
  const rootDir = tempRoot();
  const store = new ContentAddressedArtifactStore({ rootDir });
  let stored;
  try {
    stored = await store.put({ immutable: true, version: 1 });
    await writeFile(stored.filePath, '{"immutable":false,"version":2}', "utf8");

    await assert.rejects(
      store.read(stored.address),
      (error) =>
        error instanceof ContentAddressedArtifactStoreError &&
        error.code === "ARTIFACT_HASH_MISMATCH",
    );
    await assert.rejects(
      store.put({ immutable: true, version: 1 }),
      (error) =>
        error instanceof ContentAddressedArtifactStoreError &&
        error.code === "ARTIFACT_HASH_MISMATCH",
    );
  } finally {
    if (stored) await cleanupSingleArtifact(rootDir, stored.filePath);
  }
});

test("rejects values that JSON would silently coerce or discard", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse.length = 1;
  const decoratedArray = [1];
  decoratedArray.extra = "discarded";
  const hiddenObject = {};
  Object.defineProperty(hiddenObject, "hidden", { value: true });
  const accessorObject = {};
  Object.defineProperty(accessorObject, "unstable", {
    enumerable: true,
    get: () => "computed",
  });

  for (const value of [
    { missing: undefined },
    { invalid: Number.NaN },
    { invalid: BigInt(1) },
    new Date("2026-08-12T00:00:00.000Z"),
    sparse,
    decoratedArray,
    hiddenObject,
    accessorObject,
    cyclic,
  ]) {
    assert.throws(
      () => canonicalizeJsonContent(value),
      (error) => error instanceof ContentAddressedArtifactStoreError,
    );
  }
});

test("rejects malformed addresses before resolving a file path", async () => {
  const store = new ContentAddressedArtifactStore({ rootDir: tempRoot() });
  await assert.rejects(
    store.read("../../project-secret"),
    (error) =>
      error instanceof ContentAddressedArtifactStoreError &&
      error.code === "INVALID_ARTIFACT_ADDRESS",
  );
});
