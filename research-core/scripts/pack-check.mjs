import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cacheDir = join(tmpdir(), "pi-research-workbench-npm-cache");
mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
const command = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(command, ["pack", "--dry-run"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, npm_config_cache: cacheDir },
  encoding: "utf8",
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
