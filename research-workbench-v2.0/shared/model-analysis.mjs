// Model-specific documentation takes precedence over generic provider aliases.
export function reasoningProfile(model, baseUrl = '') {
  let host; try { host = new URL(baseUrl).hostname; } catch { /* Unconfigured. */ }
  if (host === 'open.bigmodel.cn' && /^glm-5\.3-flash$/i.test(model ?? '')) return {
    defaultValue: 'low', options: [{value:'low',label:'低 · 文献整理'}, {value:'high',label:'高 · 深入论证'}, {value:'max',label:'最高 · 复杂推理'}],
    source: 'https://huggingface.co/zai-org/GLM-5.3-Flash/blob/main/README.md',
    note: '该模型支持低、高、最高；未设置或传入其他值会使用最高档。' };
  return { defaultValue: 'default', options: [{value:'default',label:'模型默认'}], source:null,
    note: '尚未核对该模型的思考档位，使用服务默认设置。' };
}
export const DEFAULT_PAPER_BATCH_SIZE = 50;
