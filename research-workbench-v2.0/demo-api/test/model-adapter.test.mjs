import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter } from '../src/model-adapter.mjs';

const config = { enabled: true, baseUrl: 'https://models.example.test/v1', apiKey: 'stub-secret-not-real', model: 'demo-model' };
const request = { instruction: '比较这条演示摘要的内容与未知。', requestId: 'REQ-DEMO-01',
  materials: [{ sourceId: 'SRC-DEMO-01', accessId: 'ACC-DEMO-01', text: '虚构演示摘要；未报告样本量。' }] };
const responseBody = (overrides = {}) => ({ model: 'demo-model-2026', choices: [
  { finish_reason: 'stop', message: { role: 'assistant', content: '仅演示生成，样本量摘要未报告。' } },
], usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 }, ...overrides });
const jsonResponse = (value = responseBody()) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const rejectCode = (code, status) => (error) => {
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  assert.equal(error.name, 'ModelAdapterError');
  assert.equal(error.cause, undefined);
  assert.ok(!JSON.stringify(error).includes(config.apiKey));
  assert.ok(!error.message.includes(config.apiKey));
  return true;
};

test('supported GLM structured requests enable JSON mode without changing other providers or connection tests', async () => {
  for (const [settings, instruction, expected] of [
    [{ ...config, baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'GLM-5.3-Flash' }, '只返回 JSON 对象。', { type: 'json_object' }],
    [{ ...config, baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'GLM-5.3-Flash' }, '仅回复连接成功。', undefined],
    [config, '只返回 JSON 对象。', undefined],
  ]) {
    const adapter = createModelAdapter(settings, { fetchImpl: async (_, init) => {
      assert.deepEqual(JSON.parse(init.body).response_format, expected); return jsonResponse();
    } });
    const output = await adapter.generate({ ...request, instruction });
    assert.deepEqual(output.provenance.generationOptions.response_format, expected);
  }
});

test('default configuration stays disabled and does not consult credentials or fetch', async () => {
  const adapter = createModelAdapter({}, { fetchImpl: () => assert.fail('must not fetch') });
  assert.deepEqual(adapter.capabilities(), { configured: false, enabled: false, model: null, protocol: 'openai-chat-completions' });
  await assert.rejects(adapter.generate(request), rejectCode('not_configured', 503));
});

test('configured but disabled adapter does not fetch, and capabilities expose only public fields', async () => {
  const adapter = createModelAdapter({ ...config, enabled: false }, { fetchImpl: () => assert.fail('must not fetch') });
  assert.deepEqual(adapter.capabilities(), { configured: true, enabled: false, model: 'demo-model', protocol: 'openai-chat-completions' });
  await assert.rejects(adapter.generate(request), rejectCode('model_disabled', 403));
  const first = adapter.capabilities();
  first.enabled = true;
  assert.equal(adapter.capabilities().enabled, false);
});

test('single compatible POST sends only supplied materials and returns source-bound provenance', async () => {
  let calls = 0;
  const mutableConfig = { ...config };
  const adapter = createModelAdapter(mutableConfig, { fetchImpl: async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://models.example.test/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${config.apiKey}`);
    assert.equal(init.headers['X-Client-Request-Id'], request.requestId);
    assert.ok(init.signal instanceof AbortSignal);
    const body = JSON.parse(init.body);
    assert.equal(body.model, config.model);
    assert.equal(body.stream, false);
    assert.equal(body.tools, undefined);
    assert.deepEqual(JSON.parse(body.messages[1].content), { instruction: request.instruction, materials: request.materials });
    assert.ok(!init.body.includes(config.apiKey));
    return jsonResponse();
  } });
  mutableConfig.baseUrl = 'https://changed.example.test';
  const output = await adapter.generate(request);
  assert.equal(calls, 1);
  assert.equal(output.provenance.provider, 'models.example.test');
  assert.equal(output.provenance.model, 'demo-model-2026');
  assert.equal(output.provenance.requestId, request.requestId);
  assert.deepEqual(output.provenance.materialRefs, [{ sourceId: 'SRC-DEMO-01', accessId: 'ACC-DEMO-01' }]);
  assert.ok(Date.parse(output.provenance.completedAt) >= Date.parse(output.provenance.startedAt));
  assert.deepEqual(output.usage, { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 });
  assert.deepEqual(output.cost, { status: 'unknown', amount: null });
});

test('URL joining accepts version prefixes, full endpoints and loopback HTTP', async () => {
  for (const [baseUrl, expected] of [
    ['https://models.example.test/v1/', 'https://models.example.test/v1/chat/completions'],
    ['https://models.example.test/api/v1/chat/completions/', 'https://models.example.test/api/v1/chat/completions'],
    ['http://127.0.0.1:9000/v1', 'http://127.0.0.1:9000/v1/chat/completions'],
    ['http://localhost:9000', 'http://localhost:9000/chat/completions'],
    ['http://[::1]:9000/v1', 'http://[::1]:9000/v1/chat/completions'],
  ]) {
    const adapter = createModelAdapter({ ...config, baseUrl }, { fetchImpl: async (url) => {
      assert.equal(url, expected);
      return jsonResponse();
    } });
    await adapter.generate(request);
  }
});

test('unsafe endpoints and malformed configuration fail closed without exposing input', async () => {
  for (const override of [
    { baseUrl: 'https://user:password@models.example.test/v1' },
    { baseUrl: 'http://models.example.test/v1' }, { baseUrl: 'http://localhost.evil.test/v1' },
    { baseUrl: 'https://models.example.test/v1?token=private' },
    { baseUrl: 'https://models.example.test/v1#secret' }, { baseUrl: 'file:///etc/passwd' },
    { baseUrl: 'not a url' }, { enabled: 'true' }, { apiKey: 'secret\r\nInjected: true' }, { model: 'bad\nmodel' },
  ]) {
    const adapter = createModelAdapter({ ...config, ...override }, { fetchImpl: () => assert.fail('must not fetch') });
    assert.equal(adapter.capabilities().configured, false);
    await assert.rejects(adapter.generate(request), rejectCode('invalid_configuration', 503));
  }
});

test('input validation rejects missing, extra and duplicate material fields', async () => {
  const adapter = createModelAdapter(config, { fetchImpl: () => assert.fail('must not fetch') });
  const item = request.materials[0];
  for (const input of [undefined, null, {}, { ...request, instruction: '' },
    { ...request, requestId: 'bad\r\nheader' }, { ...request, signal: {} },
    { ...request, materials: undefined }, { ...request, materials: [{ ...item, filePath: '/private/file' }] },
    { ...request, materials: [{ sourceId: item.sourceId, text: item.text }] },
    { ...request, materials: [item, item] },
  ]) await assert.rejects(adapter.generate(input), rejectCode('invalid_input', 400));
});

test('explicit empty material scope is allowed and absent usage remains unknown', async () => {
  const adapter = createModelAdapter(config, { fetchImpl: async () => jsonResponse(responseBody({ model: undefined, usage: undefined })) });
  const output = await adapter.generate({ instruction: '解释界面中的演示状态。', materials: [] });
  assert.equal(output.provenance.model, config.model);
  assert.match(output.provenance.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(output.provenance.materialRefs, []);
  assert.equal(output.usage, null);
  assert.equal(output.cost.amount, null);
});

test('non-2xx does not read provider error body or retry', async () => {
  let calls = 0;
  let read = false;
  const adapter = createModelAdapter(config, { fetchImpl: async () => {
    calls += 1;
    return { ok: false, status: 429, statusText: config.apiKey,
      get text() { read = true; throw new Error(config.apiKey); } };
  } });
  await assert.rejects(adapter.generate(request), rejectCode('model_rate_limited', 502));
  assert.equal(calls, 1);
  assert.equal(read, false);
});

test('network errors are sanitized and not retried', async () => {
  let calls = 0;
  const adapter = createModelAdapter(config, { fetchImpl: async () => { calls += 1; throw new Error(config.apiKey); } });
  await assert.rejects(adapter.generate(request), rejectCode('model_network_error', 502));
  assert.equal(calls, 1);
});

test('malformed JSON, invalid shapes, redirects and invalid usage are rejected', async () => {
  const factories = [() => new Response('{bad json'), () => jsonResponse(null), () => jsonResponse({ choices: [] }),
    () => jsonResponse(responseBody({ choices: [{ message: { content: [] } }] })),
    () => jsonResponse(responseBody({ usage: { prompt_tokens: -1 } })),
    () => jsonResponse(responseBody({ usage: { prompt_tokens: '12' } })),
    () => jsonResponse(responseBody({ choices: [{ finish_reason: 'tool_calls', message: { content: 'run tool', tool_calls: [{}] } }] })),
    () => ({ ok: true, status: 200, redirected: true }),
  ];
  for (const factory of factories) {
    const adapter = createModelAdapter(config, { fetchImpl: async () => factory() });
    await assert.rejects(adapter.generate(request), rejectCode('model_invalid_response', 502));
  }
});

test('empty, truncated and refused content have explicit errors', async () => {
  for (const [body, code] of [
    [responseBody({ choices: [{ message: { content: null } }] }), 'model_empty_response'],
    [responseBody({ choices: [{ message: { content: '  ' } }] }), 'model_empty_response'],
    [responseBody({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }), 'model_incomplete_response'],
    [responseBody({ choices: [{ message: { content: null, refusal: 'private provider refusal' } }] }), 'model_refused'],
  ]) {
    const adapter = createModelAdapter(config, { fetchImpl: async () => jsonResponse(body) });
    await assert.rejects(adapter.generate(request), rejectCode(code, 502));
  }
  const emptyAdapter = createModelAdapter(config, { fetchImpl: async () => new Response(null, { status: 204 }) });
  await assert.rejects(emptyAdapter.generate(request), rejectCode('model_empty_response', 502));
});

test('oversized response streams are stopped', async () => {
  let cancelled = false;
  const adapter = createModelAdapter(config, { fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1_048_577)); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(adapter.generate(request), rejectCode('model_invalid_response', 502));
  assert.equal(cancelled, true);
});

test('already aborted requests do not fetch or disclose abort reason', async () => {
  const controller = new AbortController();
  controller.abort(new Error(config.apiKey));
  const adapter = createModelAdapter(config, { fetchImpl: () => assert.fail('must not fetch') });
  await assert.rejects(adapter.generate({ ...request, signal: controller.signal }), rejectCode('model_cancelled', 499));
});

test('cancellation aborts transport even when injected fetch does not settle', async () => {
  const controller = new AbortController();
  let transportSignal;
  const adapter = createModelAdapter(config, { fetchImpl: (_, init) => { transportSignal = init.signal; return new Promise(() => {}); } });
  const pending = adapter.generate({ ...request, signal: controller.signal });
  controller.abort(new Error(config.apiKey));
  await assert.rejects(pending, rejectCode('model_cancelled', 499));
  assert.equal(transportSignal.aborted, true);
});

test('180-second deadline includes stalled fetch and response body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let bodyReaderOpened = false;
  const stalledBody = { ok: true, status: 200, headers: new Headers(), body: {
    getReader() { bodyReaderOpened = true; return { read: () => new Promise(() => {}), releaseLock() {} }; },
  } };
  for (const fetchImpl of [() => new Promise(() => {}), async () => stalledBody]) {
    const adapter = createModelAdapter(config, { fetchImpl });
    const pending = adapter.generate(request);
    const checked = assert.rejects(pending, rejectCode('model_timeout', 504));
    await Promise.resolve();
    await Promise.resolve();
    t.mock.timers.tick(180_000);
    await checked;
  }
  assert.equal(bodyReaderOpened, true);
});


test('a complete answer after 30 seconds succeeds in one attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const adapter = createModelAdapter(config, { fetchImpl: async () => { count++; await new Promise(resolve => setTimeout(resolve, 45_000)); return jsonResponse(); } });
  const promise = adapter.generate(request);
  t.mock.timers.tick(45_000);
  assert.equal((await promise).usage.total_tokens, 32);
  assert.equal(count, 1);
});
test('provider HTTP failures are actionable and do not expose provider bodies', async () => {
  for (const [status, code] of [[401, 'model_auth_error'], [403, 'model_auth_error'], [429, 'model_rate_limited'], [503, 'model_unavailable'], [400, 'model_http_error']]) {
    let count = 0;
    const adapter = createModelAdapter(config, { fetchImpl: async () => { count++; return new Response(config.apiKey, { status }); } });
    await assert.rejects(adapter.generate(request), rejectCode(code, 502));
    assert.equal(count, 1);
  }
});

test('GLM Flash uses a bounded research response profile only on its configured provider', async () => {
  for (const [baseUrl, model, expected] of [
    ['https://open.bigmodel.cn/api/coding/paas/v4', 'GLM-5.3-Flash', true],
    ['https://open.bigmodel.cn/api/paas/v4', 'glm-5.3-flash', true],
    ['https://models.example.test/v1', 'GLM-5.3-Flash', false],
    ['https://open.bigmodel.cn/api/paas/v4', 'other-model', false],
  ]) {
    const adapter = createModelAdapter({ ...config, baseUrl, model }, { fetchImpl: async (_, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.reasoning_effort, expected ? 'low' : undefined);
      assert.equal(body.max_tokens, expected ? 32768 : undefined);
      assert.equal(body.thinking, undefined);
      return jsonResponse();
    } });
    const result = await adapter.generate(request);
    assert.equal(result.provenance.timeoutMs, expected ? 720000 : 180000);
  }
});

test('complete long instructions and 60 large metadata packets reach the provider without truncation', async () => {
  const materials = Array.from({ length: 60 }, (_, i) => ({ sourceId: `S-${i}`, accessId: `A-${i}`, ref: `R${i + 1}`, title: `Paper ${i}`, authors: ['Author One'], year: '2026', pmid: String(i + 1), level: 'abstract', text: `${'完整摘要'.repeat(6000)} LAST-${i}` }));
  const instruction = '很长的已存简报。'.repeat(3000) + '末尾的短追问';
  let received;
  const adapter = createModelAdapter(config, { fetchImpl: async (_url, options) => { received = JSON.parse(JSON.parse(options.body).messages[1].content); return jsonResponse(responseBody()); } });
  const result = await adapter.generate({ instruction, materials });
  assert.equal(received.instruction, instruction); assert.equal(received.materials.length, 60);
  assert.equal(received.materials.at(-1).passages.map(p => p.text).join(''), materials.at(-1).text);
  assert.equal(received.materials[0].passages.map(p => p.text).join(''), materials[0].text);
  assert.deepEqual(received.materials.at(-1).authors, ['Author One']);
  assert.equal(received.materials.at(-1).ref, 'R60');
  assert.equal(JSON.stringify(received.materials).includes('sourceId'), false);
  assert.equal(result.provenance.materialRefs.length, 60);
});

const streamConfig = { ...config, baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', model: 'GLM-5.3-Flash' };
const event = (content, finish_reason = null) => `data: ${JSON.stringify({ model: 'GLM-5.3-Flash', choices: [{ index: 0, delta: { content }, finish_reason }] })}\r\n\r\n`;
function streamResponse(text, split = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
test('provider streaming preserves split UTF-8, waits for completion, and retains usage in one call', async () => {
  let calls = 0;
  const adapter = createModelAdapter(streamConfig, { fetchImpl: async (_, init) => {
    calls++; assert.equal(JSON.parse(init.body).stream, true);
    return streamResponse(': keepalive\r\n\r\n' + event('历史与') + event('证据 α。') + event('', 'stop') + 'data: {"choices":[],"usage":{"prompt_tokens":500,"completion_tokens":100,"total_tokens":600}}\r\n\r\ndata: [DONE]\r\n\r\n', 2);
  } });
  const result = await adapter.generate(request); assert.equal(result.text, '历史与证据 α。'); assert.equal(result.usage.total_tokens, 600); assert.equal(calls, 1); assert.equal(result.provenance.timeoutMs, 720000);
});
test('stream truncation, missing finish markers, explicit errors and output exhaustion remain failures', async () => {
  for (const [body, code] of [
    [event('partial'), 'model_incomplete_response'],
    [event('partial') + 'data: [DONE]\n\n', 'model_incomplete_response'],
    [event('partial', 'length') + 'data: [DONE]\n\n', 'model_incomplete_response'],
    ['data: {"error":{"message":"stub-secret-not-real"}}\n\n', 'model_invalid_response'],
    ['data: broken\n\n', 'model_invalid_response'],
  ]) {
    let calls = 0; const adapter = createModelAdapter(streamConfig, { fetchImpl: async () => { calls++; return streamResponse(body); } });
    await assert.rejects(adapter.generate(request), rejectCode(code, 502)); assert.equal(calls, 1);
  }
});
test('stream cancellation aborts the live transport and never yields a partial research result', async () => {
  let transport; const controller = new AbortController();
  const adapter = createModelAdapter(streamConfig, { fetchImpl: async (_, init) => { transport = init.signal; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(event('partial'))); } }), { headers: { 'Content-Type': 'text/event-stream' } }); } });
  const promise = adapter.generate({ ...request, signal: controller.signal }); await Promise.resolve(); controller.abort();
  await assert.rejects(promise, rejectCode('model_cancelled', 499)); assert.equal(transport.aborted, true);
});
test('provider long-response deadline includes a stalled stream body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const adapter = createModelAdapter(streamConfig, { fetchImpl: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(event('partial'))); } }), { headers: { 'Content-Type': 'text/event-stream' } }) });
  const promise = adapter.generate(request), checked = assert.rejects(promise, rejectCode('model_timeout', 504));
  await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(720000); await checked;
});
