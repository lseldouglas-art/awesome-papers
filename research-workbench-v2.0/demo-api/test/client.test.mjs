import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createClient } from '../src/client.mjs';

const jsonResponse = (envelope, { status = 200, requestId } = {}) => new Response(
  JSON.stringify(envelope),
  {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(requestId === undefined ? {} : { 'X-Request-Id': requestId }),
    },
  },
);

function recordingClient(respond = () => jsonResponse({ data: {} }), baseUrl) {
  const calls = [];
  const client = createClient({
    ...(baseUrl ? { baseUrl } : {}),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return respond(url, options);
    },
  });
  return { client, calls };
}

test('read wrappers use the configured API and unwrap data only', async () => {
  const { client, calls } = recordingClient(() => jsonResponse({
    data: { supported: true },
    requestId: 'envelope-metadata',
    meta: { demo: true },
  }), 'https://workbench.example');

  assert.deepEqual(await client.capabilities(), { supported: true });
  await client.listProjects();
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://workbench.example/api/capabilities',
    'https://workbench.example/api/projects',
  ]);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.get('Accept'), 'application/json');
  assert.equal(calls[0].options.headers.has('X-Request-Id'), false);
  assert.equal('body' in calls[0].options, false);
});

test('writes generate request IDs and serialize JSON without mutating caller data', async () => {
  const body = Object.freeze({ title: '数字学习', scope: Object.freeze({ stage: '领域认识' }) });
  const { client, calls } = recordingClient(() => jsonResponse({ data: { id: 'p1' } }));

  assert.deepEqual(await client.createProject(body), { id: 'p1' });
  await client.request('/api/projects/p1', { method: 'patch', body });

  for (const call of calls) {
    assert.equal(call.options.headers.get('Content-Type'), 'application/json');
    assert.match(call.options.headers.get('X-Request-Id'), /^[0-9a-f-]{36}$/i);
    assert.deepEqual(JSON.parse(call.options.body), body);
  }
  assert.notEqual(calls[0].options.headers.get('X-Request-Id'), calls[1].options.headers.get('X-Request-Id'));
  assert.equal(calls[1].options.method, 'PATCH');
  assert.deepEqual(body, { title: '数字学习', scope: { stage: '领域认识' } });
});

test('callers can reuse the same request ID for explicit command retries', async () => {
  const { client, calls } = recordingClient();
  const payload = { expectedRevisionId: 'r2', text: '新正文' };
  await client.command('p1', 'rewrite', payload, { requestId: 'same-operation' });
  await client.command('p1', 'rewrite', payload, { requestId: 'same-operation' });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ options }) => options.headers.get('X-Request-Id')), [
    'same-operation', 'same-operation',
  ]);
  assert.equal(calls[0].options.body, calls[1].options.body);
});

test('409 conflicts retain server details, message, status, and request ID', async () => {
  const details = { expectedRevisionId: 'r2', currentRevisionId: 'r3', retryable: false };
  const { client, calls } = recordingClient(() => jsonResponse({
    error: { code: 'REVISION_CONFLICT', message: '当前内容已变化', details },
  }, { status: 409, requestId: 'server-operation' }));

  await assert.rejects(
    client.command('p1', 'rewrite', { text: '旧运行结果' }, { requestId: 'client-operation' }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'REVISION_CONFLICT');
      assert.equal(error.message, '当前内容已变化');
      assert.deepEqual(error.details, details);
      assert.equal(error.requestId, 'server-operation');
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test('error request ID falls back to the sent ID when no response header exists', async () => {
  const { client } = recordingClient(() => jsonResponse({
    error: { code: 'SAVE_FAILED', message: '保存失败', details: { saved: false } },
  }, { status: 503 }));
  await assert.rejects(
    client.command('p1', 'save', {}, { requestId: 'save-1' }),
    (error) => error instanceof ApiError && error.requestId === 'save-1',
  );
});

test('GET errors can retain a request ID returned in the JSON envelope', async () => {
  const { client } = recordingClient(() => jsonResponse({
    error: { code: 'NOT_FOUND', message: '项目不存在' },
    requestId: 'server-read-1',
  }, { status: 404 }));
  await assert.rejects(
    client.workspace('missing'),
    (error) => error instanceof ApiError && error.requestId === 'server-read-1',
  );
});

test('network failures propagate unchanged and never trigger automatic retries', async () => {
  const networkError = new TypeError('fetch failed');
  const { client, calls } = recordingClient(() => { throw networkError; });
  await assert.rejects(client.createProject({ title: '未明结果' }), (error) => error === networkError);
  assert.equal(calls.length, 1);
});

test('the exact AbortSignal is passed through and aborts are not retried', async () => {
  const controller = new AbortController();
  controller.abort();
  const abortError = new DOMException('The operation was aborted', 'AbortError');
  const { client, calls } = recordingClient((_url, options) => {
    assert.equal(options.signal, controller.signal);
    assert.equal(options.signal.aborted, true);
    throw abortError;
  });

  await assert.rejects(
    client.request('/api/projects', { method: 'POST', body: {}, signal: controller.signal }),
    (error) => error === abortError,
  );
  assert.equal(calls.length, 1);
});

test('an abort while consuming the response also propagates unchanged', async () => {
  const abortError = new DOMException('Response body aborted', 'AbortError');
  const { client, calls } = recordingClient(() => ({
    status: 200,
    ok: true,
    headers: new Headers(),
    json: async () => { throw abortError; },
  }));
  await assert.rejects(client.capabilities(), (error) => error === abortError);
  assert.equal(calls.length, 1);
});

test('a network failure while consuming the response is not mislabeled as invalid JSON', async () => {
  const networkError = new TypeError('body stream terminated');
  const { client, calls } = recordingClient(() => ({
    status: 200,
    ok: true,
    headers: new Headers(),
    json: async () => { throw networkError; },
  }));
  await assert.rejects(client.capabilities(), (error) => error === networkError);
  assert.equal(calls.length, 1);
});

test('wrapper parameters are encoded as individual URI segments', async () => {
  const { client, calls } = recordingClient(() => jsonResponse({ data: { content: '旧版本' } }));
  const pid = '课题/alpha ?';
  const aid = '稿件#one';
  const rid = 'r/2';
  const name = '保存/批注?';
  const prefix = `http://127.0.0.1:4318/api/projects/${encodeURIComponent(pid)}`;
  const revision = `${prefix}/artifacts/${encodeURIComponent(aid)}/revisions/${encodeURIComponent(rid)}`;

  await client.workspace(pid);
  await client.command(pid, name, { quote: '原文' });
  await client.getRevision(pid, aid, rid);
  assert.deepEqual(await client.exportRevision(pid, aid, rid), { content: '旧版本' });
  assert.deepEqual(calls.map(({ url }) => url), [
    prefix,
    `${prefix}/commands/${encodeURIComponent(name)}`,
    revision,
    `${revision}/export`,
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.body), { quote: '原文' });
});

test('absolute, protocol-relative, backslash, and escaped API paths are rejected before fetch', async () => {
  const { client, calls } = recordingClient();
  const invalidPaths = [
    'https://other.example/api/projects',
    'http://127.0.0.1:4318/api/projects',
    '//other.example/api/projects',
    '/\\other.example/api/projects',
    '/api/../../outside',
    '/api/%2e%2e/outside',
    '/api/..\\outside',
    '/not-api/projects',
    '/api/projects#fragment',
  ];
  for (const path of invalidPaths) {
    await assert.rejects(client.request(path), TypeError);
  }
  assert.equal(calls.length, 0);

  await client.request('/api/projects?source=https%3A%2F%2Fsource.example');
  assert.equal(new URL(calls[0].url).origin, 'http://127.0.0.1:4318');
});

test('malformed success envelopes and non-JSON errors cannot appear successful', async () => {
  const responses = [
    jsonResponse({ saved: true }),
    new Response('upstream unavailable', { status: 502 }),
    jsonResponse({ error: { code: 'NOT_SAVED', message: '未保存' } }),
  ];
  for (const response of responses) {
    const { client, calls } = recordingClient(() => response);
    await assert.rejects(client.capabilities(), ApiError);
    assert.equal(calls.length, 1);
  }
});
