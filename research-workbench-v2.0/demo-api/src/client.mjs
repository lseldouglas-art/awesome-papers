/** A server error with enough context for the UI to explain or resolve it. */
export class ApiError extends Error {
  constructor(status, code, details, requestId, message = code) {
    super(message || `API request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const segment = (value) => encodeURIComponent(String(value));

/**
 * Dependency-free JSON client, suitable for browser or Node.js callers.
 * Retries are deliberately left to the caller, who can reuse a requestId.
 */
export function createClient({
  baseUrl = 'http://127.0.0.1:4318',
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new TypeError('baseUrl must use HTTP or HTTPS');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }

  function apiUrl(path) {
    if (
      typeof path !== 'string'
      || !/^\/api(?:\/|\?|$)/.test(path)
      || path.includes('\\')
      || path.includes('#')
    ) {
      throw new TypeError('path must be a relative /api path without a fragment');
    }
    const url = new URL(path, base);
    if (
      url.origin !== base.origin
      || !(url.pathname === '/api' || url.pathname.startsWith('/api/'))
    ) {
      throw new TypeError('path must stay inside the configured /api origin and path');
    }
    return url;
  }

  async function request(path, {
    method = 'GET',
    body,
    requestId,
    signal,
  } = {}) {
    const url = apiUrl(path);
    const verb = method.toUpperCase();
    const writes = !['GET', 'HEAD', 'OPTIONS'].includes(verb);
    if (requestId !== undefined && (typeof requestId !== 'string' || !requestId.trim())) {
      throw new TypeError('requestId must be a non-empty string');
    }
    const outgoingId = requestId ?? (writes ? globalThis.crypto.randomUUID() : undefined);
    const headers = new Headers({ Accept: 'application/json' });
    if (writes || body !== undefined) headers.set('Content-Type', 'application/json');
    if (outgoingId !== undefined) headers.set('X-Request-Id', outgoingId);

    // Serialize into a new string: never add transport metadata to caller data.
    const options = { method: verb, headers, signal };
    if (body !== undefined) options.body = JSON.stringify(body);

    // Network and abort errors intentionally propagate unchanged, with no retry.
    const response = await fetchImpl(url.href, options);
    const headerId = response.headers.get('X-Request-Id');
    let envelope;
    try {
      envelope = await response.json();
    } catch (error) {
      // Body transport/abort errors remain transport errors, not JSON errors.
      if (error?.name !== 'SyntaxError') throw error;
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        null,
        headerId || outgoingId,
        'The server did not return a valid JSON response',
      );
    }

    const objectEnvelope = envelope !== null && typeof envelope === 'object' && !Array.isArray(envelope);
    const envelopeId = objectEnvelope && typeof envelope.requestId === 'string' ? envelope.requestId : undefined;
    const returnedId = headerId || envelopeId || outgoingId;
    const serverError = objectEnvelope && envelope.error;
    if (!response.ok || serverError) {
      throw new ApiError(
        response.status,
        serverError?.code || 'HTTP_ERROR',
        serverError?.details ?? null,
        returnedId,
        serverError?.message || `API request failed (${response.status})`,
      );
    }
    if (!objectEnvelope || !hasOwn(envelope, 'data')) {
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        null,
        returnedId,
        'The server response is missing its data envelope',
      );
    }
    return envelope.data;
  }

  const projectPath = (projectId) => `/api/projects/${segment(projectId)}`;
  const revisionPath = (projectId, artifactId, revisionId) => (
    `${projectPath(projectId)}/artifacts/${segment(artifactId)}/revisions/${segment(revisionId)}`
  );

  return {
    request,
    capabilities: () => request('/api/capabilities'),
    listProjects: () => request('/api/projects'),
    createProject: (body) => request('/api/projects', { method: 'POST', body }),
    workspace: (projectId) => request(projectPath(projectId)),
    command: (projectId, name, payload, { requestId } = {}) => request(
      `${projectPath(projectId)}/commands/${segment(name)}`,
      { method: 'POST', body: payload, requestId },
    ),
    getRevision: (projectId, artifactId, revisionId) => request(
      revisionPath(projectId, artifactId, revisionId),
    ),
    exportRevision: (projectId, artifactId, revisionId) => request(
      `${revisionPath(projectId, artifactId, revisionId)}/export`,
    ),
  };
}
