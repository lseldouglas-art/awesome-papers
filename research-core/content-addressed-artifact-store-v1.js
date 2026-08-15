import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  unlink,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { TextDecoder } from "node:util";

const SHA256_ADDRESS_PATTERN = /^sha256:([a-f0-9]{64})$/;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export class ContentAddressedArtifactStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ContentAddressedArtifactStoreError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ContentAddressedArtifactStoreError(code, message, details);
}

function isPlainJsonObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Produces one deterministic UTF-8 JSON representation for a JSON value.
 *
 * Object keys are sorted, arrays preserve order, and values that JSON would
 * silently discard or coerce (undefined, sparse slots, non-finite numbers,
 * functions, symbols, bigint, class instances, and cycles) are rejected.
 */
export function canonicalizeJsonContent(value) {
  const ancestors = new Set();

  function serialize(current, path) {
    if (current === null) return "null";

    switch (typeof current) {
      case "string":
      case "boolean":
        return JSON.stringify(current);
      case "number":
        if (!Number.isFinite(current)) {
          fail("NON_JSON_CONTENT", `Non-finite number at ${path}.`, { path });
        }
        return Object.is(current, -0) ? "0" : JSON.stringify(current);
      case "undefined":
      case "function":
      case "symbol":
      case "bigint":
        fail("NON_JSON_CONTENT", `Unsupported JSON value at ${path}.`, {
          path,
          valueType: typeof current,
        });
        break;
      case "object":
        break;
      default:
        fail("NON_JSON_CONTENT", `Unsupported JSON value at ${path}.`, { path });
    }

    if (ancestors.has(current)) {
      fail("CYCLIC_JSON_CONTENT", `Cyclic JSON content at ${path}.`, { path });
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getOwnPropertySymbols(current).length > 0) {
          fail("NON_JSON_CONTENT", `Symbol-keyed property at ${path}.`, { path });
        }
        const expectedIndexKeys = Array.from(
          { length: current.length },
          (_, index) => String(index),
        );
        const enumerableKeys = Object.keys(current);
        const ownNames = Object.getOwnPropertyNames(current);
        if (
          enumerableKeys.length !== expectedIndexKeys.length ||
          enumerableKeys.some((key, index) => key !== expectedIndexKeys[index]) ||
          ownNames.length !== expectedIndexKeys.length + 1 ||
          !ownNames.includes("length")
        ) {
          fail(
            "NON_JSON_CONTENT",
            `Array at ${path} has properties that JSON would discard.`,
            { path },
          );
        }
        const items = [];
        for (let index = 0; index < current.length; index += 1) {
          if (!Object.prototype.hasOwnProperty.call(current, index)) {
            fail("NON_JSON_CONTENT", `Sparse array slot at ${path}[${index}].`, {
              path: `${path}[${index}]`,
            });
          }
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !("value" in descriptor)) {
            fail("NON_JSON_CONTENT", `Accessor array value at ${path}[${index}].`, {
              path: `${path}[${index}]`,
            });
          }
          items.push(serialize(current[index], `${path}[${index}]`));
        }
        return `[${items.join(",")}]`;
      }

      if (!isPlainJsonObject(current)) {
        fail("NON_JSON_CONTENT", `Non-plain object at ${path}.`, { path });
      }
      if (Object.getOwnPropertySymbols(current).length > 0) {
        fail("NON_JSON_CONTENT", `Symbol-keyed property at ${path}.`, { path });
      }

      const enumerableKeys = Object.keys(current);
      const ownNames = Object.getOwnPropertyNames(current);
      if (ownNames.length !== enumerableKeys.length) {
        fail(
          "NON_JSON_CONTENT",
          `Object at ${path} has non-enumerable properties that JSON would discard.`,
          { path },
        );
      }
      for (const key of enumerableKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor)) {
          fail("NON_JSON_CONTENT", `Accessor property at ${path}.${key}.`, {
            path: `${path}.${key}`,
          });
        }
      }

      const entries = enumerableKeys
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${serialize(current[key], `${path}.${key}`)}`,
        );
      return `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  }

  return serialize(value, "$");
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function contentAddressForJson(value) {
  const canonicalContent = canonicalizeJsonContent(value);
  return `sha256:${sha256Hex(canonicalContent)}`;
}

function parseAddress(address) {
  const match = SHA256_ADDRESS_PATTERN.exec(address ?? "");
  if (!match) {
    fail(
      "INVALID_ARTIFACT_ADDRESS",
      "Artifact address must use sha256:<64 lowercase hexadecimal characters>.",
      { address },
    );
  }
  return match[1];
}

async function unlinkIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function syncDirectory(directoryPath) {
  let handle;
  try {
    handle = await open(directoryPath, "r");
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

export class ContentAddressedArtifactStore {
  constructor({ rootDir } = {}) {
    if (typeof rootDir !== "string" || rootDir.trim() === "") {
      fail(
        "INVALID_STORE_CONFIGURATION",
        "rootDir must be a non-empty string.",
      );
    }
    this.rootDir = resolve(rootDir);
  }

  pathForAddress(address) {
    const hash = parseAddress(address);
    return resolve(this.rootDir, "sha256", hash.slice(0, 2), `${hash}.json`);
  }

  async put(content) {
    const canonicalContent = canonicalizeJsonContent(content);
    const hash = sha256Hex(canonicalContent);
    const address = `sha256:${hash}`;
    const filePath = this.pathForAddress(address);
    const directoryPath = dirname(filePath);
    const temporaryPath = resolve(
      directoryPath,
      `.${hash}.${process.pid}.${randomUUID()}.tmp`,
    );

    await mkdir(directoryPath, { recursive: true, mode: 0o700 });

    let temporaryHandle;
    let created = false;
    try {
      temporaryHandle = await open(temporaryPath, "wx", 0o600);
      await temporaryHandle.writeFile(canonicalContent, "utf8");
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = null;

      try {
        // A hard link publishes the fully synced temporary inode only if the
        // content address does not already exist. It never replaces a target.
        await link(temporaryPath, filePath);
        created = true;
        await syncDirectory(directoryPath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = await this.#readAndVerify(address, filePath);
        if (existing.canonicalContent !== canonicalContent) {
          fail(
            "CONTENT_HASH_COLLISION",
            `Existing content at ${address} differs from the submitted content.`,
            { address, filePath },
          );
        }
      }
    } finally {
      await temporaryHandle?.close();
      await unlinkIfPresent(temporaryPath);
    }

    return {
      address,
      hash,
      byteLength: Buffer.byteLength(canonicalContent, "utf8"),
      filePath,
      created,
    };
  }

  async read(address) {
    const record = await this.#readAndVerify(address, this.pathForAddress(address));
    return record.content;
  }

  async #readAndVerify(address, filePath) {
    const expectedHash = parseAddress(address);
    let bytes;
    try {
      bytes = await readFile(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        fail("ARTIFACT_NOT_FOUND", `Artifact not found: ${address}.`, {
          address,
          filePath,
        });
      }
      throw error;
    }

    const actualHash = sha256Hex(bytes);
    if (actualHash !== expectedHash) {
      fail(
        "ARTIFACT_HASH_MISMATCH",
        `Stored bytes no longer match ${address}.`,
        { address, expectedHash, actualHash, filePath },
      );
    }

    let source;
    try {
      source = UTF8_DECODER.decode(bytes);
    } catch (error) {
      fail("INVALID_STORED_ARTIFACT", `Artifact ${address} is not valid UTF-8.`, {
        address,
        cause: error?.message,
      });
    }

    let content;
    try {
      content = JSON.parse(source);
    } catch (error) {
      fail("INVALID_STORED_ARTIFACT", `Artifact ${address} is not valid JSON.`, {
        address,
        cause: error?.message,
      });
    }

    const canonicalContent = canonicalizeJsonContent(content);
    if (canonicalContent !== source) {
      fail(
        "NON_CANONICAL_STORED_ARTIFACT",
        `Artifact ${address} is not stored in normalized JSON form.`,
        { address, filePath },
      );
    }

    return { content, canonicalContent };
  }
}
