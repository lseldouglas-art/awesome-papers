import { reasoningProfile, DEFAULT_PAPER_BATCH_SIZE } from '../../shared/model-analysis.mjs';
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
  public() { const reasoning = reasoningProfile(this.config.model, this.config.baseUrl); return { reasoning, reasoningEffort: this.config.reasoningEffort ?? reasoning.defaultValue, paperBatchSize: this.config.paperBatchSize ?? DEFAULT_PAPER_BATCH_SIZE, ...createModelAdapter(this.config).capabilities(), baseUrl: this.config.baseUrl ?? '', hasKey: Boolean(this.config.apiKey), invalid: Boolean(this.invalid), contextLimits: this.config.contextLimits ?? null }; }
  save(body) {
    const operation = this.#queue.then(async () => {
      requireThat(body && typeof body.baseUrl === 'string' && typeof body.model === 'string' && typeof body.apiKey === 'string' && typeof body.enabled === 'boolean', 'invalid_configuration', '请填写服务地址、模型与密钥。');
      const sameService = this.config.baseUrl === body.baseUrl.trim() && this.config.model === body.model.trim();
      const config = { baseUrl: body.baseUrl.trim(), model: body.model.trim(), apiKey: body.apiKey.trim() || (sameService ? this.config.apiKey : ''), enabled: body.enabled };
      const profile = reasoningProfile(config.model, config.baseUrl);
      config.reasoningEffort = body.reasoningEffort ?? (sameService ? this.config.reasoningEffort : null) ?? profile.defaultValue;
      requireThat(profile.options.some(option => option.value === config.reasoningEffort), 'invalid_configuration', '所选思考档位不受当前模型支持，请重新选择。');
      config.paperBatchSize = body.paperBatchSize ?? (sameService ? this.config.paperBatchSize : null) ?? DEFAULT_PAPER_BATCH_SIZE;
      requireThat(Number.isSafeInteger(config.paperBatchSize) && config.paperBatchSize >= 50, 'invalid_configuration', '每批文献数应为至少 50 的整数（最后一批可以不足）。');
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
