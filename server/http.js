import { PROTOCOL_VERSION, DICTIONARY_VERSION } from '../dist/js/battle-protocol.js';

export const ID_PATTERN = /^[a-f0-9]{32}$/;
export const MAX_BODY_BYTES = 4096;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function errorResponse(error) {
  return json({ error: {
    code: error instanceof HttpError ? error.code : 'SERVICE_ERROR',
    message: error instanceof HttpError ? error.message : 'The battle service could not complete that request. Please reconnect.',
  } }, error instanceof HttpError ? error.status : 503);
}

export function checkVersion(body) {
  if (body.version !== PROTOCOL_VERSION || body.dictionaryVersion !== DICTIONARY_VERSION) {
    throw new HttpError(409, 'VERSION_MISMATCH', 'The game has been updated. Reload this page before joining.');
  }
}

export function checkCredential(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new HttpError(400, 'INVALID_CREDENTIAL', 'A valid browser room credential is required.');
  }
  return value;
}

export function cleanName(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_NAME', 'Enter a name to join.');
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || Array.from(name).length > 24) {
    throw new HttpError(400, 'INVALID_NAME', 'Use a name between 1 and 24 characters.');
  }
  return name;
}

export async function readJson(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'JSON_REQUIRED', 'Send a JSON request.');
  }
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) {
    throw new HttpError(413, 'REQUEST_TOO_LARGE', 'That request is too large.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'INVALID_JSON', 'Send a JSON object.');
  const parts = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, 'REQUEST_TOO_LARGE', 'That request is too large.');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Send a JSON object.');
  }
}

export function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function randomSeed() {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return (values[0] & 0x1fffff) * 0x100000000 + values[1];
}

export async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

export function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

export function cors(response, origin) {
  // A Cloudflare WebSocket upgrade response must be returned without reconstructing it.
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}

export async function routeRequest(request, env, ctx) {
  const origin = allowedOrigin(request, env);
  const suppliedOrigin = request.headers.get('Origin');
  const mutation = request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
  if ((suppliedOrigin && !origin) || (mutation && !origin)) {
    return errorResponse(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'This page is not allowed to access the battle service.'));
  }
  if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);
  try {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') {
      return cors(json({ ok: true, version: PROTOCOL_VERSION, dictionaryVersion: DICTIONARY_VERSION }), origin);
    }
    const match = /^\/rooms\/([a-f0-9]{32})(?:\/(create|join|connect|socket))?$/.exec(path);
    if (!match) throw new HttpError(404, 'NOT_FOUND', 'That battle address does not exist.');
    if ((match[2] === 'socket' || !match[2]) ? request.method !== 'GET' : request.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'That request method is not supported.');
    }
    const cache = !match[2] && globalThis.caches && ctx ? caches.default : null;
    const cacheKey = cache ? new Request(`${new URL(request.url).origin}${path}`) : null;
    if (cache) {
      const cached = await cache.match(cacheKey);
      if (cached) return cors(cached, origin);
    }
    const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
    const response = await room.fetch(request);
    if (cache && response.headers.get('Cache-Control')?.startsWith('public,')) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return cors(response, origin);
  } catch (error) {
    return cors(errorResponse(error), origin);
  }
}
