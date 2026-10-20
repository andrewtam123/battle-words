import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomService } from '../server/room.js';
import { routeRequest, randomSeed } from '../server/http.js';
import { PROTOCOL_VERSION, DICTIONARY_VERSION } from '../dist/js/battle-protocol.js';

const origin = 'https://example.test';
const id = 'a'.repeat(32);
const credentials = ['1'.repeat(32), '2'.repeat(32), '3'.repeat(32)];
const pools = { 4: ['race'], 5: ['races'], 6: ['traces'], 7: ['tracees'], 8: ['traceess'], 9: ['traceesss'], 10: ['traceessss'] };
const acceptedWords = new Set([...Object.values(pools).flat(), 'care']);
const env = { ALLOWED_ORIGINS: origin };
const version = { version: PROTOCOL_VERSION, dictionaryVersion: DICTIONARY_VERSION };

class MemoryStorage {
  constructor() { this.data = new Map(); this.writes = 0; this.alarm = null; this.pause = null; }
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) {
    const saved = structuredClone(value);
    if (this.pause) await this.pause;
    this.data.set(key, saved);
    this.writes += 1;
  }
  async setAlarm(time) { this.alarm = time; }
  async deleteAlarm() { this.alarm = null; }
}

class Socket {
  constructor(attachment = null) { this.attachment = attachment; this.messages = []; this.readyState = 1; }
  serializeAttachment(value) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  send(value) { this.messages.push(JSON.parse(value)); }
  close(code) { this.readyState = 3; this.closeCode = code; }
}

function setup(t, stored) {
  const clock = { now: 1000 };
  t.mock.method(Date, 'now', () => clock.now);
  const storage = stored || new MemoryStorage();
  const ctx = { storage, sockets: [], getWebSockets() { return this.sockets; }, acceptWebSocket(ws) { this.sockets.push(ws); } };
  const room = new RoomService(ctx, env, { pools, acceptedWords });
  return { clock, storage, ctx, room };
}

function request(action = '', body, requestOrigin = origin) {
  return new Request(`https://battle.test/rooms/${id}${action ? `/${action}` : ''}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(requestOrigin ? { Origin: requestOrigin } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const player = (seat, extra = {}) => ({ ...version, credential: credentials[seat], name: `Player ${seat}`, ...extra });
const send = (room, socket, message) => room.webSocketMessage(socket, JSON.stringify(message));

async function playing(t) {
  const fixture = setup(t);
  const { room, ctx, clock } = fixture;
  assert.equal((await room.fetch(request('create', player(0)))).status, 200);
  assert.equal((await room.fetch(request('join', player(1)))).status, 200);
  const sockets = [0, 1].map(seat => new Socket({ seat, generation: 0, windowStart: clock.now, count: 0 }));
  ctx.sockets.push(...sockets);
  await send(room, sockets[0], { type: 'ready' });
  await send(room, sockets[1], { type: 'ready' });
  clock.now = 4000;
  await room.alarm();
  sockets.forEach(socket => { socket.messages = []; });
  return { ...fixture, sockets };
}

test('reserves exactly two persistent seats, including concurrent joins and idempotent retry', async t => {
  const { room, storage } = setup(t);
  const first = await room.fetch(request('create', player(0, { name: ' Shared name ' })));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).seat, 0);
  const retries = await room.fetch(request('create', player(0)));
  assert.equal((await retries.json()).state.players[0].name, 'Shared name');
  const results = await Promise.all([room.fetch(request('join', player(1))), room.fetch(request('join', player(2)))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(room.record.match.players.filter(Boolean).length, 2);
  const stored = JSON.stringify(storage.data.get('room'));
  assert.equal(stored.includes(credentials[0]), false);
  const publicData = await (await room.fetch(request())).json();
  assert.equal(publicData.phase, 'lobby');
  assert.equal('rounds' in publicData, false);
  assert.equal('credentials' in publicData, false);
  assert.equal('results' in publicData, false);
});

test('enforces origin, protocol, credential, names and payload limits before reserving a seat', async t => {
  const { room, storage } = setup(t);
  assert.equal((await room.fetch(request('create', player(0), 'https://evil.test'))).status, 403);
  assert.equal((await room.fetch(request('create', player(0, { version: 99 })))).status, 409);
  assert.equal((await room.fetch(request('create', player(0, { dictionaryVersion: 'other' })))).status, 409);
  assert.equal((await room.fetch(request('create', player(0, { credential: 'short' })))).status, 400);
  assert.equal((await room.fetch(request('create', player(0, { name: 'x'.repeat(25) })))).status, 400);
  assert.equal((await room.fetch(request('create', player(0, { extra: 'x'.repeat(5000) })))).status, 413);
  assert.equal(storage.writes, 0);
  assert.equal((await room.fetch(request('create', player(0, { name: '<b>Same name</b>' })))).status, 200);
  assert.equal(room.record.match.players[0].name, '<b>Same name</b>'); // Names are data; the UI uses textContent.
});

test('Worker rejects foreign origins and malformed paths without allocating rooms', async () => {
  let fetched = 0;
  const runtime = { ...env, ROOMS: { idFromName(value) { return value; }, get() { fetched += 1; return { fetch: () => new Response('{}') }; } } };
  assert.equal((await routeRequest(request('create', player(0), 'https://evil.test'), runtime)).status, 403);
  assert.equal((await routeRequest(request('create', player(0), null), runtime)).status, 403);
  assert.equal((await routeRequest(new Request('https://battle.test/rooms/guessable'), runtime)).status, 404);
  assert.equal(fetched, 0);
  const publicResponse = await routeRequest(request(), runtime);
  assert.equal(publicResponse.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(fetched, 1);
});

test('server revalidates answers and keeps both provisional results and opponent events private', async t => {
  const { room, sockets, storage, clock } = await playing(t);
  const before = storage.writes;
  await send(room, sockets[0], { type: 'submit', round: 0, submissionId: 'invalid', answer: 'xxxx' });
  assert.equal(storage.writes, before);
  assert.equal(sockets[0].messages.find(message => message.type === 'ack').accepted, false);
  clock.now = 4500;
  sockets.forEach(socket => { socket.messages = []; });
  await send(room, sockets[0], { type: 'submit', round: 0, submissionId: 'first', answer: 'race' });
  assert.equal(sockets[1].messages.length, 0);
  assert.equal(sockets[0].messages.some(message => JSON.stringify(message).includes('resolutionAt')), false);
  assert.deepEqual(room.record.match.scores, [0, 0]);
  assert.equal(sockets[0].messages.find(message => message.type === 'ack').receivedAt, 4500);
  clock.now = 4700;
  await room.alarm();
  const state = sockets[1].messages.at(-1).state;
  assert.equal(state.phase, 'reveal');
  assert.deepEqual(state.scores, [1, 0]);
  assert.equal(state.results[0].target, 'race');
});

test('slow storage preserves receipt timestamps and tie eligibility of queued submissions', async t => {
  const { room, sockets, storage, clock } = await playing(t);
  let release;
  storage.pause = new Promise(resolve => { release = resolve; });
  clock.now = 5000;
  const first = send(room, sockets[0], { type: 'submit', round: 0, submissionId: 'one', answer: 'race' });
  await Promise.resolve();
  clock.now = 5199;
  const second = send(room, sockets[1], { type: 'submit', round: 0, submissionId: 'two', answer: 'care' });
  clock.now = 6000;
  const alarm = room.alarm();
  storage.pause = null;
  release();
  await Promise.all([first, second, alarm]);
  assert.equal(room.record.match.results[0].outcome, 'tie');
  assert.deepEqual(room.record.match.scores, [0.5, 0.5]);
  assert.deepEqual(storage.data.get('room').match.scores, [0.5, 0.5]);
  assert.deepEqual(room.record.match.rounds[0].claims.map(claim => claim.receivedAt), [5000, 5199]);
});

test('queued HTTP reads cannot advance past an earlier eligible socket receipt', async t => {
  const { room, sockets, storage, clock } = await playing(t);
  let release;
  storage.pause = new Promise(resolve => { release = resolve; });
  clock.now = 33900;
  const shuffle = send(room, sockets[0], { type: 'shuffle', round: 0 });
  await Promise.resolve();
  clock.now = 33950;
  const read = room.fetch(request());
  clock.now = 33999;
  const answer = send(room, sockets[1], { type: 'submit', round: 0, submissionId: 'before-deadline', answer: 'race' });
  clock.now = 35000;
  const alarm = room.alarm();
  storage.pause = null;
  release();
  await Promise.all([shuffle, read, answer, alarm]);
  assert.equal(room.record.match.results[0].winner, 1);
});

test('state and scores survive reconstruction; all rounds complete with no connected browsers', async t => {
  const { room, sockets, storage, clock } = await playing(t);
  clock.now = 5000;
  await send(room, sockets[0], { type: 'submit', round: 0, submissionId: 'durable', answer: 'race' });
  const restored = new RoomService({ storage, getWebSockets: () => [] }, env, { pools, acceptedWords });
  clock.now = 1_000_000;
  await restored.alarm();
  assert.equal(restored.record.match.phase, 'finished');
  assert.equal(restored.record.match.results.length, 20);
  assert.deepEqual(restored.record.match.scores, [1, 0]);
  assert.equal(storage.alarm, null);
  const resultResponse = await restored.fetch(request());
  assert.match(resultResponse.headers.get('Cache-Control'), /public.*immutable/);
  const result = await resultResponse.json();
  assert.equal(result.results.results.length, 20);
  assert.equal(result.results.winner, 0);
  assert.equal('credentials' in result, false);
  assert.equal((await restored.fetch(request('create', player(2)))).status, 409);
  const before = JSON.stringify(result);
  clock.now += 10_000_000;
  await restored.alarm();
  assert.equal(JSON.stringify(await (await restored.fetch(request())).json()), before);
});

test('connection tickets expire, are one-use, and replace only their own seat connection', async t => {
  const { room, ctx, sockets, clock } = await playing(t);
  const NativeResponse = Response;
  const NativePair = globalThis.WebSocketPair;
  globalThis.WebSocketPair = class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } };
  t.mock.method(globalThis, 'Response', class extends NativeResponse {
    constructor(body, init) {
      super(body, init?.status === 101 ? { status: 200 } : init);
      if (init?.status === 101) { Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init.webSocket; }
    }
  });
  t.after(() => { if (NativePair) globalThis.WebSocketPair = NativePair; else delete globalThis.WebSocketPair; });
  const connect = await room.fetch(request('connect', player(0)));
  const { ticket } = await connect.json();
  assert.match(ticket, /^[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(room.record).includes(ticket), false);
  const socketRequest = () => new Request(`https://battle.test/rooms/${id}/socket?ticket=${ticket}`, { headers: { Origin: origin, Upgrade: 'websocket' } });
  assert.equal((await room.fetch(socketRequest())).status, 101);
  assert.equal(sockets[0].closeCode, 4001);
  assert.equal(sockets[0].messages.at(-1).type, 'replaced');
  assert.equal(sockets[1].readyState, 1);
  assert.equal(ctx.sockets.filter(socket => socket.readyState === 1).length, 2);
  assert.equal((await room.fetch(socketRequest())).status, 403);
  const replacement = ctx.sockets.at(-1);
  assert.equal(replacement.attachment.seat, 0);
  await send(room, sockets[0], { type: 'shuffle', round: 0 });
  assert.equal(room.record.match.rounds[0].shuffleUsed[0], false);
  const expiring = await (await room.fetch(request('connect', player(1)))).json();
  clock.now += 30_000;
  const expiredRequest = new Request(`https://battle.test/rooms/${id}/socket?ticket=${expiring.ticket}`, { headers: { Origin: origin, Upgrade: 'websocket' } });
  assert.equal((await room.fetch(expiredRequest)).status, 403);
});

test('accepted submission IDs remain idempotent after a restart and never award twice', async t => {
  const { room, sockets, storage, clock } = await playing(t);
  const claim = { type: 'submit', round: 0, submissionId: 'retry-me', answer: 'race' };
  clock.now = 4500;
  await send(room, sockets[0], claim);
  clock.now = 4700;
  await room.alarm();
  const context = { storage, getWebSockets: () => sockets };
  const restored = new RoomService(context, env, { pools, acceptedWords });
  clock.now = 4800;
  await send(restored, sockets[0], claim);
  const ack = sockets[0].messages.filter(message => message.type === 'ack').at(-1);
  assert.equal(ack.accepted, true);
  assert.equal(ack.receivedAt, 4500);
  assert.deepEqual(restored.record.match.scores, [1, 0]);
});

test('restored active legacy rooms persist tie points and retries never award them twice', async t => {
  const { room, sockets, storage, clock } = await playing(t);
  const claims = [
    { type: 'submit', round: 0, submissionId: 'tied-zero', answer: 'race' },
    { type: 'submit', round: 0, submissionId: 'tied-one', answer: 'care' },
  ];
  clock.now = 4500;
  await send(room, sockets[0], claims[0]);
  clock.now = 4600;
  await send(room, sockets[1], claims[1]);
  clock.now = 6700;
  await room.alarm();
  const legacy = storage.data.get('room');
  legacy.match.scores = [0, 0];
  const before = structuredClone(legacy.match);
  const writes = storage.writes;
  const restored = new RoomService({ storage, getWebSockets: () => sockets }, env, { pools, acceptedWords });
  await restored.fetch(request());
  assert.deepEqual(storage.data.get('room').match, { ...before, scores: [0.5, 0.5] });
  assert.equal(storage.writes, writes + 1);
  for (const seat of [0, 1]) {
    await send(restored, sockets[seat], claims[seat]);
    const ack = sockets[seat].messages.filter(message => message.type === 'ack').at(-1);
    assert.equal(ack.accepted, true);
    assert.equal(ack.receivedAt, seat === 0 ? 4500 : 4600);
  }
  assert.deepEqual(restored.record.match.scores, [0.5, 0.5]);
  assert.equal(restored.record.match.results.length, 1);
  assert.equal(storage.writes, writes + 1);
});

test('reading finished legacy rooms updates stored totals without removing public history', async t => {
  const { room, sockets, storage, clock } = await playing(t);
  clock.now = 4500;
  await send(room, sockets[0], { type: 'submit', round: 0, submissionId: 'old-tie-zero', answer: 'race' });
  clock.now = 4600;
  await send(room, sockets[1], { type: 'submit', round: 0, submissionId: 'old-tie-one', answer: 'care' });
  clock.now = 1_000_000;
  await room.alarm();
  const legacy = storage.data.get('room');
  legacy.match.scores = [0, 0];
  const before = structuredClone(legacy.match);
  const writes = storage.writes;
  const restored = new RoomService({ storage, getWebSockets: () => [] }, env, { pools, acceptedWords });
  const result = (await (await restored.fetch(request())).json()).results;
  assert.deepEqual(result.scores, [0.5, 0.5]);
  assert.equal(result.winner, null);
  assert.deepEqual(result.results, before.results);
  assert.equal(result.results.length, 20);
  assert.equal(result.finishedAt, before.finishedAt);
  assert.deepEqual(storage.data.get('room').match, { ...before, scores: [0.5, 0.5] });
  assert.equal(storage.writes, writes + 1);
  assert.equal(storage.alarm, null);
  assert.deepEqual((await (await restored.fetch(request())).json()).results, result);
  assert.equal(storage.writes, writes + 1, 'later reads do not rewrite normalized history');
});

test('battle seeds are safe integers independent of the visible creation timestamp', () => {
  const seeds = Array.from({ length: 10 }, randomSeed);
  assert.ok(seeds.every(Number.isSafeInteger));
  assert.equal(new Set(seeds).size, seeds.length);
});

test('expired lobbies retain only a tombstone and can never become a different match', async t => {
  const { room, clock, storage } = setup(t);
  await room.fetch(request('create', player(0)));
  clock.now += 30 * 60_000;
  await room.alarm();
  assert.equal(room.record.match.phase, 'expired');
  assert.deepEqual(room.record.match.rounds, []);
  assert.deepEqual(room.record.credentials, [null, null]);
  assert.equal(storage.alarm, null);
  assert.equal((await room.fetch(request('create', player(2)))).status, 409);
  assert.equal((await room.fetch(request('join', player(2)))).status, 410);
  assert.equal((await (await room.fetch(request())).json()).phase, 'expired');
});

test('only completed public results enter the canonical edge cache, before CORS is added', async t => {
  const originalCaches = globalThis.caches;
  const entries = new Map();
  let puts = 0;
  globalThis.caches = { default: {
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, response) {
      puts += 1;
      assert.equal(key.headers.get('Cookie'), null);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
      entries.set(key.url, response);
    },
  } };
  t.after(() => { if (originalCaches) globalThis.caches = originalCaches; else delete globalThis.caches; });
  const jobs = [];
  const ctx = { waitUntil(promise) { jobs.push(promise); } };
  let finished = false;
  let fetches = 0;
  const runtime = { ...env, ROOMS: { idFromName(value) { return value; }, get() { return { async fetch() {
    fetches += 1;
    return new Response(JSON.stringify({ phase: finished ? 'finished' : 'playing' }), {
      headers: { 'Cache-Control': finished ? 'public, max-age=31536000, immutable' : 'no-store' },
    });
  } }; } } };
  await routeRequest(request(), runtime, ctx);
  assert.equal(puts, 0);
  finished = true;
  const first = new Request(`https://battle.test/rooms/${id}?view=1`, { headers: { Origin: origin, Cookie: 'private=1' } });
  const response = await routeRequest(first, runtime, ctx);
  await Promise.all(jobs);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(puts, 1);
  assert.equal(entries.size, 1);
  await routeRequest(new Request(`https://battle.test/rooms/${id}?view=2`), runtime, ctx);
  assert.equal(fetches, 2);
});

test('failed persistence cannot acknowledge a successful claim or retain it in memory', async t => {
  const { room, sockets, storage, clock } = await playing(t);
  t.mock.method(storage, 'put', async () => { throw new Error('Disk unavailable'); });
  clock.now = 5000;
  await send(room, sockets[0], { type: 'submit', round: 0, submissionId: 'failed-save', answer: 'race' });
  assert.equal(sockets[0].messages.some(message => message.type === 'ack' && message.accepted), false);
  assert.equal(sockets[0].closeCode, 1011);
  assert.equal(sockets[1].messages.length, 0);
  assert.equal(room.record.match.rounds[0].claims[0], null);
  assert.equal(storage.data.get('room').match.rounds[0].claims[0], null);
});

test('failed initial storage load never treats an existing room as empty', async t => {
  const { storage, ctx } = setup(t);
  t.mock.method(storage, 'get', async () => { throw new Error('Storage unavailable'); });
  const room = new RoomService(ctx, env, { pools, acceptedWords });
  assert.equal((await room.fetch(request('create', player(0)))).status, 503);
  assert.equal((await room.fetch(request('create', player(0)))).status, 503);
  assert.equal(storage.writes, 0);
});

test('oversized and flooded WebSocket packets are bounded before waiting for storage', async t => {
  const { room, sockets, ctx, storage } = await playing(t);
  await room.webSocketMessage(sockets[0], 'x'.repeat(1025));
  assert.equal(sockets[0].closeCode, 1009);
  const socket = new Socket({ seat: 0, generation: 0, windowStart: 4000, count: 0 });
  ctx.sockets.push(socket);
  let release;
  storage.pause = new Promise(resolve => { release = resolve; });
  const shuffle = send(room, socket, { type: 'shuffle', round: 0 });
  await Promise.resolve();
  const messages = Array.from({ length: 100 }, () => send(room, socket, { type: 'ping' }));
  assert.equal(socket.closeCode, 1008);
  assert.ok(room.pendingSocketEvents <= 20);
  storage.pause = null;
  release();
  await Promise.all([shuffle, ...messages]);
  assert.equal(room.pendingSocketEvents, 0);
});

test('queued credential requests use their arrival time when a write crosses the round deadline', async t => {
  const { room, sockets, storage, clock } = await playing(t);
  let release;
  storage.pause = new Promise(resolve => { release = resolve; });
  clock.now = 33900;
  const shuffle = send(room, sockets[0], { type: 'shuffle', round: 0 });
  await Promise.resolve();
  let queued;
  const wasQueued = new Promise(resolve => { queued = resolve; });
  const enqueue = room.enqueue.bind(room);
  t.mock.method(room, 'enqueue', operation => { queued(); return enqueue(operation); });
  clock.now = 33950;
  const connection = room.fetch(request('connect', player(0)));
  await wasQueued;
  clock.now = 33999;
  const answer = send(room, sockets[1], { type: 'submit', round: 0, submissionId: 'timely', answer: 'race' });
  clock.now = 35000;
  const alarm = room.alarm();
  storage.pause = null;
  release();
  await Promise.all([shuffle, connection, answer, alarm]);
  assert.equal(room.record.match.results[0].winner, 1);
});
