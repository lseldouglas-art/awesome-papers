import { reasoningProfile, DEFAULT_PAPER_BATCH_SIZE, DEFAULT_EXTRACTION_CONCURRENCY } from '../../shared/model-analysis.mjs';
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
  public() { const reasoning = reasoningProfile(this.config.model, this.config.baseUrl); return { reasoning, reasoningEffort: this.config.reasoningEffort ?? reasoning.defaultValue, paperBatchSize: this.config.paperBatchSize ?? DEFAULT_PAPER_BATCH_SIZE,
    extractionReasoningEffort: this.config.extractionReasoningEffort ?? 'inherit', extractionConcurrency: this.config.extractionConcurrency ?? DEFAULT_EXTRACTION_CONCURRENCY,
    ...createModelAdapter(this.config).capabilities(), baseUrl: this.config.baseUrl ?? '', hasKey: Boolean(this.config.apiKey), invalid: Boolean(this.invalid), contextLimits: this.config.contextLimits ?? null }; }
  save(body) {
    const operation = this.#queue.then(async () => {
      requireThat(body && typeof body.baseUrl === 'string' && typeof body.model === 'string' && typeof body.apiKey === 'string' && typeof body.enabled === 'boolean', 'invalid_configuration', '请填写服务地址、模型与密钥。');
      const sameService = this.config.baseUrl === body.baseUrl.trim() && this.config.model === body.model.trim();
      const config = { baseUrl: body.baseUrl.trim(), model: body.model.trim(), apiKey: body.apiKey.trim() || (sameService ? this.config.apiKey : ''), enabled: body.enabled };
      const profile = reasoningProfile(config.model, config.baseUrl);
      config.reasoningEffort = body.reasoningEffort ?? (sameService ? this.config.reasoningEffort : null) ?? profile.defaultValue;
      requireThat(profile.options.some(option => option.value === config.reasoningEffort), 'invalid_configuration', '所选思考档位不受当前模型支持，请重新选择。');
      config.paperBatchSize = body.paperBatchSize ?? (sameService ? this.config.paperBatchSize : null) ?? DEFAULT_PAPER_BATCH_SIZE;
      requireThat(Number.isSafeInteger(config.paperBatchSize) && config.paperBatchSize >= 1, 'invalid_configuration', '每批文献数应为正整数；只影响单次整理，不限制总篇数。');
      config.extractionReasoningEffort = body.extractionReasoningEffort ?? (sameService ? this.config.extractionReasoningEffort : null) ?? 'inherit';
      requireThat(config.extractionReasoningEffort === 'inherit' || profile.options.some(o => o.value === config.extractionReasoningEffort), 'invalid_configuration', '逐篇整理档位不受当前模型支持。');
      config.extractionConcurrency = body.extractionConcurrency ?? (sameService ? this.config.extractionConcurrency : null) ?? DEFAULT_EXTRACTION_CONCURRENCY;
      requireThat(Number.isSafeInteger(config.extractionConcurrency) && config.extractionConcurrency >= 1 && config.extractionConcurrency <= 4, 'invalid_configuration', '同时整理批数应为 1 至 4；需符合服务商的并发额度。');
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
