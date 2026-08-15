import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = mkdtempSync(join(tmpdir(), "pi-research-install-smoke-"));
const packedDir = join(workspace, "packed");
const installedDir = join(workspace, "installed");
const projectDir = join(workspace, "project");
const agentDir = join(workspace, "pi-agent");
const cacheDir = join(workspace, "npm-cache");
const installCacheDir = join(tmpdir(), "pi-research-package-smoke-cache");
for (const path of [packedDir, installedDir, projectDir, agentDir, cacheDir, installCacheDir]) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    env: { ...process.env, npm_config_cache: options.cacheDir ?? cacheDir, ...(options.env ?? {}) },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr ?? ""}`);
  return result.stdout ?? "";
}

const packOutput = run(
  npmCommand,
  ["pack", "--json", "--pack-destination", packedDir],
  { capture: true },
);
const packed = JSON.parse(packOutput);
assert.equal(packed.length, 1);
const tarball = join(packedDir, packed[0].filename);

writeFileSync(
  join(installedDir, "package.json"),
  `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  "utf8",
);
const packageLocalPi = resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent");
const workspaceLocalPi = resolve(packageRoot, "..", "node_modules", "@earendil-works", "pi-coding-agent");
const localPiPackage = process.env.PI_CODING_AGENT_PACKAGE
  ? resolve(process.env.PI_CODING_AGENT_PACKAGE)
  : existsSync(packageLocalPi)
    ? packageLocalPi
    : workspaceLocalPi;
const localPiVersion = JSON.parse(
  readFileSync(join(localPiPackage, "package.json"), "utf8"),
).version;
assert.equal(localPiVersion, "0.84.1", "package smoke must run against Pi 0.84.1");
const packageNodeModules = join(installedDir, "node_modules");
mkdirSync(packageNodeModules, { recursive: true, mode: 0o700 });
run(npmCommand, [
  "install",
  "--ignore-scripts",
  "--offline",
  "--legacy-peer-deps",
  "--no-audit",
  "--no-fund",
  "--prefix",
  installedDir,
  tarball,
], { cacheDir: installCacheDir });
const installedScopeDir = join(packageNodeModules, "@earendil-works");
mkdirSync(installedScopeDir, { recursive: true, mode: 0o700 });
for (const dependency of ["pi-agent-core", "pi-ai", "pi-coding-agent", "pi-telemetry"]) {
  const source = join(packageRoot, "node_modules", "@earendil-works", dependency);
  const target = join(installedScopeDir, dependency);
  if (!existsSync(target)) symlinkSync(source, target, "junction");
}
const installedTypebox = join(packageNodeModules, "typebox");
if (!existsSync(installedTypebox)) {
  symlinkSync(join(packageRoot, "node_modules", "typebox"), installedTypebox, "junction");
}

const installedPackage = join(installedDir, "node_modules", "pi-research-workbench");
const cliPath = join(
  installedDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "research-pi.cmd" : "research-pi",
);
run(cliPath, ["init", "--source", installedPackage], { cwd: projectDir });
const settings = JSON.parse(
  readFileSync(join(projectDir, ".pi", "settings.json"), "utf8"),
);
assert.deepEqual(settings.packages, [installedPackage]);

const piIndex = join(
  installedDir,
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "index.js",
);
const discoveryScript = `
import { createAgentSession } from ${JSON.stringify(pathToFileURL(piIndex).href)};
const { session } = await createAgentSession({
  cwd: ${JSON.stringify(projectDir)},
  agentDir: ${JSON.stringify(agentDir)},
});
const skills = session.resourceLoader.getSkills();
const prompts = session.resourceLoader.getPrompts();
const result = {
  tools: session.getAllTools().map((item) => item.name).filter((name) => name.startsWith("research_")),
  commands: session.extensionRunner.getRegisteredCommands().map((item) => item.name).filter((name) => name.startsWith("research-")),
  skills: skills.skills.map((item) => item.name),
  prompts: prompts.prompts.map((item) => item.name),
  extensionErrors: session.resourceLoader.getExtensions().errors,
  skillDiagnostics: skills.diagnostics,
  promptDiagnostics: prompts.diagnostics,
};
process.stdout.write(JSON.stringify(result));
`;
const discovery = JSON.parse(
  run(process.execPath, ["--input-type=module", "--eval", discoveryScript], {
    cwd: projectDir,
    env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
    capture: true,
  }),
);

assert.deepEqual(discovery.extensionErrors, []);
assert.deepEqual(discovery.skillDiagnostics, []);
assert.deepEqual(discovery.promptDiagnostics, []);
assert.deepEqual(discovery.tools.sort(), [
  "research_export",
  "research_literature_landscape",
  "research_project_create",
  "research_project_list",
  "research_project_read",
  "research_query_preview",
  "research_resume_current_step",
  "research_run_current_step",
]);
assert.deepEqual(discovery.commands.sort(), [
  "research-continue",
  "research-decide",
  "research-export",
  "research-new",
  "research-resume",
  "research-revise-protocol",
  "research-status",
]);
assert.ok(discovery.skills.includes("scientific-research"));
assert.deepEqual(discovery.prompts.sort(), [
  "research-audit",
  "research-brief",
  "research-pubmed",
  "research-question",
]);

process.stdout.write(
  `${JSON.stringify({ ok: true, piVersion: localPiVersion, tarball: packed[0].filename, ...discovery }, null, 2)}\n`,
);
