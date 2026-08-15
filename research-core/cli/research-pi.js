#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createAndRun,
  createResearchServiceForContext,
  exportProject,
  researchDataDir,
  runProject,
} from "../extensions/index.js";

const packageRoot = resolve(new URL("..", import.meta.url).pathname);

function print(payload) {
  process.stdout.write(`${typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)}\n`);
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = { _: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      options._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

function fakeContext(cwd) {
  return {
    cwd,
    mode: "print",
    hasUI: false,
    model: undefined,
    modelRegistry: undefined,
    signal: undefined,
  };
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function init(cwd, options) {
  const piDir = join(cwd, ".pi");
  const settingsPath = join(piDir, "settings.json");
  await mkdir(piDir, { recursive: true, mode: 0o700 });
  let settings = {};
  if (await exists(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, "utf8"));
    } catch (error) {
      throw new Error(`不能解析现有 ${settingsPath}：${error.message}`);
    }
  }
  const source = options.source
    ? isAbsolute(options.source)
      ? resolve(options.source)
      : resolve(cwd, options.source)
    : packageRoot;
  const packages = Array.isArray(settings.packages) ? [...settings.packages] : [];
  if (!packages.includes(source)) packages.push(source);
  const next = { ...settings, packages };
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await mkdir(researchDataDir(cwd), { recursive: true, mode: 0o700 });
  print({
    ok: true,
    settingsPath,
    packageSource: source,
    dataDir: researchDataDir(cwd),
    next: "在此目录启动 pi，然后运行 /research-new。",
  });
}

async function doctor(cwd) {
  const service = await createResearchServiceForContext(fakeContext(cwd));
  const runtime = service.describeRuntime();
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const checks = {
    node: {
      required: ">=22.19",
      current: process.versions.node,
      ok: (() => {
        const [major, minor] = process.versions.node.split(".").map(Number);
        return major > 22 || (major === 22 && minor >= 19);
      })(),
    },
    package: {
      name: packageJson.name,
      version: packageJson.version,
      manifest: packageJson.pi,
      ok: Boolean(packageJson.pi?.extensions?.length && packageJson.pi?.skills?.length),
    },
    data: {
      path: researchDataDir(cwd),
      exists: await exists(researchDataDir(cwd)),
    },
    pubmed: {
      host: "eutils.ncbi.nlm.nih.gov",
      configuredIdentity: Boolean(process.env.NCBI_EMAIL || process.env.NCBI_API_KEY),
      tested: false,
      note: "doctor 默认不发出网络请求；使用 --live-check 可执行一条 PubMed 探测。",
    },
    agent: {
      ...runtime.agent,
      outputMaturity:
        runtime.agent?.mode === "live"
          ? "可执行实时模型研究；仍需完成所有人工门禁与审计。"
          : "guided 模式只生成受限研究产物，不得表述为正式科研结论。",
    },
  };
  print({ ok: checks.node.ok && checks.package.ok, checks });
}

async function liveCheck(cwd) {
  const service = await createResearchServiceForContext(fakeContext(cwd));
  const gateway = service.toolGateway;
  const result = await gateway.searchPubMed({ query: "sleep", limit: 1 });
  print({
    ok: true,
    provider: result.provider,
    query: result.query,
    total: result.total,
    returnedIds: result.resultIds.length,
    accessLevel: result.accessLevel,
  });
}

async function run(cwd, options) {
  const service = await createResearchServiceForContext(fakeContext(cwd));
  let result;
  if (options.id) {
    if (options.query) {
      throw Object.assign(
        new Error("冻结检索协议不能用 --query 直接覆盖；请回到 Pi 运行 research_query_preview 并修订对应协议。"),
        { code: "REVISED_QUERY_REQUIRES_PROTOCOL_REVISION" },
      );
    }
    result = await runProject(service, options.id, Number(options["max-steps"] ?? 100));
  } else {
    if (![options.title, options.question, options.query].every((item) => typeof item === "string" && item.trim())) {
      throw new Error("建立项目需要 --title、--question 和 --query；继续项目使用 --id。 ");
    }
    result = await createAndRun(service, {
      title: options.title,
      question: options.question,
      searchQuery: options.query,
      searchLimit: Number(options.limit ?? 8),
      completionProfileId: options.profile ?? "audited_review",
    });
  }
  const boundary = result.projection.boundary;
  print({
    ok: !result.retrievalError,
    projectId: result.project.id,
    title: result.project.title,
    phase: result.projection.phase,
    activity: result.projection.activity,
    status: ["human_gate", "human_review"].includes(boundary.type)
      ? "awaiting_user_decision"
      : boundary.type,
    boundary: {
      type: boundary.type,
      nodeId: boundary.nodeId ?? null,
      gateId: boundary.gateId ?? null,
      fingerprint: boundary.fingerprint ?? null,
      reviewerRole: boundary.reviewerRole ?? null,
      blockers: boundary.blockers ?? [],
    },
    retrievalRuns: [
      result.project.retrievalRuns?.pilot,
      result.project.retrievalRuns?.orientationCorpus,
      ...(Array.isArray(result.project.retrievalRuns?.focusedCalibration)
        ? result.project.retrievalRuns.focusedCalibration
        : []),
      result.project.retrievalRuns?.finalLibrary,
    ].filter(Boolean).map((run) => ({
      purpose: run.purpose,
      query: run.query,
      total: run.receipt?.total ?? null,
      savedCount: run.receipt?.records?.length ?? 0,
      receiptHash: run.receipt?.receiptHash ?? null,
    })),
    retrievalError: result.retrievalError ?? null,
    notice: ["human_gate", "human_review"].includes(boundary.type)
      ? "Headless 模式不会批准人工决定。请在 Pi TUI 中运行 /research-decide。"
      : null,
  });
}

async function exportCommand(cwd, options) {
  if (!options.id) throw new Error("export 需要 --id。");
  const format = options.format ?? "json";
  if (!["json", "markdown", "bibtex"].includes(format)) {
    throw new Error("--format 仅支持 json、markdown 或 bibtex。");
  }
  const service = await createResearchServiceForContext(fakeContext(cwd));
  print({ ok: true, ...(await exportProject(service, options.id, format, cwd)) });
}

function help() {
  print(`research-pi — Pi 科研包命令行\n\n用法：\n  research-pi init [--source <package-path>]\n  research-pi doctor [--live-check]\n  research-pi run --title <name> --question <question> --query <pubmed-query> [--limit 8] [--profile audited_review]\n  research-pi run --id <project-id> [--max-steps 100]\n  research-pi export --id <project-id> [--format json|markdown|bibtex]\n\n重要：headless run 遇到人工 Gate 只返回 awaiting_user_decision，绝不会自动批准；冻结检索式不能通过 run 命令覆盖。`);
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const { command, options } = parseArgs(argv);
  try {
    if (command === "init") return await init(resolve(cwd), options);
    if (command === "doctor") {
      if (options["live-check"]) return await liveCheck(resolve(cwd));
      return await doctor(resolve(cwd));
    }
    if (command === "run") return await run(resolve(cwd), options);
    if (command === "export") return await exportCommand(resolve(cwd), options);
    if (["help", "--help", "-h"].includes(command)) return help();
    throw new Error(`未知命令：${command}`);
  } catch (error) {
    fail(JSON.stringify({ ok: false, code: error?.code ?? "RESEARCH_PI_FAILED", message: error?.message ?? String(error) }));
  }
}

if (
  process.argv[1] &&
  (
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href ||
    basename(process.argv[1]) === "research-pi"
  )
) {
  await main();
}
