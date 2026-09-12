import { readFile, open, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createModelAdapter } from './model-adapter.mjs';
import { requireThat } from './errors.mjs';
import { materialContextLimits } from './workflows.mjs';

export class ModelSettings {
  #queue = Promise.resolve();
  constructor(directory) { this.filename = join(directory, 'model-private.json'); this.config = {}; }
  async initialize() {
    try { this.config = JSON.parse(await readFile(this.filename, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') { this.config = {}; this.invalid = true; } }
    return this;
  }
  public() { return { ...createModelAdapter(this.config).capabilities(), baseUrl: this.config.baseUrl ?? '', hasKey: Boolean(this.config.apiKey), invalid: Boolean(this.invalid), contextLimits: this.config.contextLimits ?? null }; }
  save(body) {
    const operation = this.#queue.then(async () => {
      requireThat(body && typeof body.baseUrl === 'string' && typeof body.model === 'string' && typeof body.apiKey === 'string' && typeof body.enabled === 'boolean', 'invalid_configuration', '请填写服务地址、模型与密钥。');
      const sameService = this.config.baseUrl === body.baseUrl.trim() && this.config.model === body.model.trim();
      const config = { baseUrl: body.baseUrl.trim(), model: body.model.trim(), apiKey: body.apiKey.trim() || (sameService ? this.config.apiKey : ''), enabled: body.enabled };
      if (body.contextLimits !== undefined && body.contextLimits !== null) {
        const limits = materialContextLimits({ contextLimits: body.contextLimits });
        config.contextLimits = { maxInputTokens: limits.maxInputTokens, maxOutputTokens: limits.maxOutputTokens, contextWindowTokens: limits.contextWindowTokens };
      } else if (sameService && body.contextLimits === undefined && this.config.contextLimits) config.contextLimits = this.config.contextLimits;
      requireThat(createModelAdapter(config).capabilities().configured, 'invalid_configuration', '配置不合法：远程服务须使用 HTTPS，地址不含用户名或查询参数，模型与密钥不能为空。');
      const temp = `${this.filename}.${randomUUID()}.tmp`, file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(config)); await file.sync(); } finally { await file.close(); }
      await rename(temp, this.filename);
      const directory = await open(dirname(this.filename), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      this.config = config; this.invalid = false;
      return this.public();
    });
    this.#queue = operation.catch(() => {}); return operation;
  }
}
