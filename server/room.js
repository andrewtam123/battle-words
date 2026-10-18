import {
  createMatch, joinSeat, readyPlayer, advanceMatch, submitAnswer,
  shufflePlayer, nextAlarmAt, snapshotFor, publicResults,
} from '../dist/js/battle-rules.js';
import { PROTOCOL_VERSION, DICTIONARY_VERSION } from '../dist/js/battle-protocol.js';
import {
  HttpError, ID_PATTERN, json, errorResponse, checkVersion, checkCredential,
  cleanName, readJson, randomId, randomSeed, digest, allowedOrigin,
} from './http.js';

const TICKET_MS = 30_000;
const MAX_MESSAGE_CHARS = 1024;

/**
 * One serial authority per room. The network boundary supplies receipt times;
 * the pure rules module never trusts a browser's clock or outcome claims.
 * SQLite-backed Durable Object storage retains this small, private envelope.
 */
export class RoomService {
  constructor(ctx, env, { pools, acceptedWords }) {
    this.ctx = ctx;
    this.env = env;
    this.pools = pools;
    this.acceptedWords = acceptedWords;
    this.record = null;
    this.pendingSocketEvents = 0;
    this.httpWindow = { start: 0, count: 0 };
    // Do not block incoming event delivery while reading: each socket handler
    // must capture its receipt time before waiting for an earlier write.
    this.queue = ctx.storage.get('room', { allowConcurrency: true }).then(record => {
      this.record = record || null;
    }).catch(error => { this.loadError = error; });
  }

  enqueue(operation) {
    const result = this.queue.then(() => {
      if (this.loadError) throw this.loadError;
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async save(previous) {
    try {
      const alarm = nextAlarmAt(this.record.match);
      // Writes issued together, without an intervening await, are atomic on
      // SQLite-backed Durable Objects. Never opt out of durable output gates.
      await Promise.all([
        this.ctx.storage.put('room', this.record, { allowConcurrency: true }),
        alarm === null ? this.ctx.storage.deleteAlarm({ allowConcurrency: true })
          : this.ctx.storage.setAlarm(alarm, { allowConcurrency: true }),
      ]);
    } catch (error) {
      this.record = previous;
      throw error;
    }
  }

  async change(operation) {
    const before = JSON.stringify(this.record);
    const previous = this.record ? structuredClone(this.record) : null;
    let result;
    let thrown;
    try { result = operation(); } catch (error) { thrown = error; }
    if (this.record?.match.phase === 'expired') {
      // Unstarted rooms become small tombstones. Keep the ID reserved without
      // retaining unused puzzles or browser credentials indefinitely.
      this.record.match.rounds = [];
      this.record.match.players = [null, null];
      this.record.credentials = [null, null];
      this.record.tickets = [null, null];
    }
    const changed = before !== JSON.stringify(this.record);
    // Advancing time may be necessary even when the requested action fails.
    if (changed) await this.save(previous);
    if (changed && this.record) this.broadcastChanged(previous);
    if (thrown) throw thrown;
    return result;
  }

  stateFor(seat, now = Date.now()) {
    const state = snapshotFor(this.record.match, seat, now);
    state.connected = [0, 1].map(player => this.sockets().some(ws => this.session(ws)?.seat === player));
    return state;
  }

  session(ws) {
    const session = ws.deserializeAttachment();
    if (!session || !this.record || ![0, 1].includes(session.seat) ||
        session.generation !== this.record.generations[session.seat]) return null;
    return session;
  }

  sockets() {
    return this.ctx.getWebSockets().filter(ws => ws.readyState === 1 && this.session(ws));
  }

  send(ws, message) {
    try { ws.send(JSON.stringify(message)); } catch { /* A disconnected player can reconnect. */ }
  }

  broadcast() {
    for (const ws of this.sockets()) this.send(ws, { type: 'state', state: this.stateFor(this.session(ws).seat) });
  }

  broadcastChanged(previous) {
    for (const ws of this.sockets()) {
      const seat = this.session(ws).seat;
      const oldView = previous ? snapshotFor(previous.match, seat, 0) : null;
      const newView = snapshotFor(this.record.match, seat, 0);
      // Private claims, shuffle use, ticket issuance and connection generations
      // must not create an opponent event that reveals pending submissions.
      if (JSON.stringify(oldView) !== JSON.stringify(newView)) {
        this.send(ws, { type: 'state', state: this.stateFor(seat) });
      }
    }
  }

  requireRoom() {
    if (!this.record) throw new HttpError(404, 'ROOM_NOT_FOUND', 'This room does not exist.');
  }

  requireActive() {
    this.requireRoom();
    if (this.record.match.phase === 'expired') throw new HttpError(410, 'ROOM_EXPIRED', 'This waiting room has expired. Create a new room.');
    if (this.record.match.phase === 'finished') throw new HttpError(409, 'MATCH_FINISHED', 'This match has ended. Open its results.');
  }

  seatFor(hash) {
    const seat = this.record.credentials.indexOf(hash);
    if (seat < 0) throw new HttpError(403, 'NOT_A_PLAYER', 'This browser does not hold either player seat.');
    return seat;
  }

  limitHttp(now) {
    if (now - this.httpWindow.start >= 10_000) this.httpWindow = { start: now, count: 0 };
    if (++this.httpWindow.count > 30) throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Please wait a moment before trying again.');
  }

  async fetch(request) {
    const url = new URL(request.url);
    const route = /^\/rooms\/([a-f0-9]{32})(?:\/(create|join|connect|socket))?$/.exec(url.pathname);
    if (!route) return errorResponse(new HttpError(404, 'NOT_FOUND', 'That battle address does not exist.'));
    const [, id, action] = route;
    try {
      if (action === 'socket') {
        this.limitHttp(Date.now());
        if (!allowedOrigin(request, this.env)) throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'This page is not allowed to connect.');
        if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          throw new HttpError(426, 'UPGRADE_REQUIRED', 'A WebSocket connection is required.');
        }
        const ticket = url.searchParams.get('ticket');
        if (!ticket || !ID_PATTERN.test(ticket)) throw new HttpError(403, 'INVALID_TICKET', 'Reconnect to obtain a new connection ticket.');
        const hash = await digest(`${id}:${ticket}`);
        const now = Date.now();
        return await this.enqueue(() => this.upgrade(hash, now));
      }
      if (!action && request.method === 'GET') {
        const now = Date.now();
        return await this.enqueue(async () => {
          this.requireRoom();
          await this.change(() => advanceMatch(this.record.match, now));
          const match = this.record.match;
          const result = {
            id, phase: match.phase, players: match.players,
            version: PROTOCOL_VERSION, dictionaryVersion: match.dictionaryVersion,
          };
          if (match.phase === 'finished') result.results = publicResults(match);
          return json(result, 200, match.phase === 'finished'
            ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {});
        });
      }
      if (!['create', 'join', 'connect'].includes(action) || request.method !== 'POST') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'That request method is not supported.');
      }
      if (!allowedOrigin(request, this.env)) throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'This page is not allowed to access this room.');
      this.limitHttp(Date.now());
      const body = await readJson(request);
      checkVersion(body);
      const credential = checkCredential(body.credential);
      const name = action === 'connect' ? null : cleanName(body.name);
      const hash = await digest(`${id}:${credential}`);
      // HTTP body reading and cryptography happen before entering the queue so
      // a slow request body cannot stall a live match's submission ordering.
      const now = Date.now();
      return await this.enqueue(async () => {
        if (action === 'connect') return this.connect(hash, now);
        let seat;
        await this.change(() => {
          if (this.record) {
            advanceMatch(this.record.match, now);
            seat = this.record.credentials.indexOf(hash);
            if (seat >= 0) return;
            if (action === 'create') throw new HttpError(409, 'ROOM_EXISTS', 'That room already exists. Create a new room.');
            this.requireActive();
            if (this.record.match.phase !== 'lobby') throw new HttpError(409, 'MATCH_STARTED', 'This match has already started.');
            seat = this.record.credentials.indexOf(null);
            if (seat < 0) throw new HttpError(409, 'ROOM_FULL', 'Both player seats are already reserved.');
          } else {
            if (action !== 'create') throw new HttpError(404, 'ROOM_NOT_FOUND', 'This room does not exist.');
            this.record = {
              match: createMatch({ id, pools: this.pools, seed: randomSeed(), now, dictionaryVersion: DICTIONARY_VERSION }),
              credentials: [null, null], tickets: [null, null], generations: [0, 0],
            };
            seat = 0;
          }
          this.record.credentials[seat] = hash;
          joinSeat(this.record.match, seat, name, now);
        });
        return json({ seat, state: this.stateFor(seat) });
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async connect(hash, now) {
    this.requireRoom();
    let seat;
    const ticket = randomId();
    const ticketHash = await digest(`${this.record.match.id}:${ticket}`);
    await this.change(() => {
      advanceMatch(this.record.match, now);
      this.requireActive();
      seat = this.seatFor(hash);
      this.record.tickets[seat] = { hash: ticketHash, expiresAt: now + TICKET_MS };
    });
    return json({ ticket, expiresAt: now + TICKET_MS });
  }

  async upgrade(hash, now) {
    this.requireRoom();
    let seat;
    await this.change(() => {
      advanceMatch(this.record.match, now);
      this.requireActive();
      seat = this.record.tickets.findIndex(ticket => ticket?.hash === hash && ticket.expiresAt > now);
      if (seat < 0) throw new HttpError(403, 'INVALID_TICKET', 'Reconnect to obtain a new connection ticket.');
      this.record.tickets[seat] = null;
      this.record.generations[seat] += 1;
    });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.deserializeAttachment()?.seat === seat) {
        this.send(ws, { type: 'replaced' });
        try { ws.close(4001, 'This player continued in another tab.'); } catch { /* Already closed. */ }
      }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [`seat:${seat}`]);
    server.serializeAttachment({ seat, generation: this.record.generations[seat], windowStart: now, count: 0 });
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    // Capture BEFORE any await. Queued submissions retain their receipt order
    // and 200 ms eligibility even if an earlier disk write is slow.
    const receivedAt = Date.now();
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) {
      this.send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Send a small JSON message.' });
      try { ws.close(1009, 'Message too large.'); } catch {}
      return Promise.resolve();
    }
    const attachment = ws.deserializeAttachment();
    if (!attachment) { try { ws.close(1008, 'Player session required.'); } catch {} return Promise.resolve(); }
    if (receivedAt - attachment.windowStart >= 1000) { attachment.windowStart = receivedAt; attachment.count = 0; }
    attachment.count += 1;
    ws.serializeAttachment(attachment);
    if (attachment.count > 20 || this.pendingSocketEvents >= 64) {
      this.send(ws, { type: 'error', code: 'TOO_MANY_REQUESTS', message: 'Please slow down before reconnecting.' });
      try { ws.close(1008, 'Too many messages.'); } catch {}
      return Promise.resolve();
    }
    this.pendingSocketEvents += 1;
    return this.enqueue(async () => {
      const session = this.session(ws);
      if (!session) { try { ws.close(4001, 'This connection was replaced.'); } catch {} return; }
      try {
        let message;
        try { message = JSON.parse(raw); } catch { throw new HttpError(400, 'INVALID_MESSAGE', 'Send a JSON object.'); }
        if (!message || Array.isArray(message) || typeof message !== 'object') throw new HttpError(400, 'INVALID_MESSAGE', 'Send a JSON object.');
        if (message.type === 'ping') {
          this.send(ws, { type: 'pong', id: typeof message.id === 'string' ? message.id.slice(0, 64) : null, now: receivedAt });
          return;
        }
        let acknowledgement;
        await this.change(() => {
          if (message.type === 'ready') acknowledgement = readyPlayer(this.record.match, session.seat, receivedAt);
          else if (message.type === 'shuffle') acknowledgement = shufflePlayer(this.record.match, session.seat, message.round, receivedAt);
          else if (message.type === 'submit') {
            if (!Number.isInteger(message.round) || message.round < 0 || message.round >= 20 ||
                typeof message.submissionId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(message.submissionId) ||
                typeof message.answer !== 'string' || !/^[a-z]{4,10}$/.test(message.answer)) {
              throw new HttpError(400, 'INVALID_SUBMISSION', 'That answer submission is invalid.');
            }
            acknowledgement = submitAnswer(this.record.match, {
              seat: session.seat, round: message.round, submissionId: message.submissionId, answer: message.answer,
            }, this.acceptedWords, receivedAt);
          } else throw new HttpError(400, 'UNKNOWN_MESSAGE', 'That game action is not supported.');
        });
        if (message.type === 'submit') {
          // Accepted acknowledges durable receipt only; it never names a
          // provisional winner or exposes the other player's pending answer.
          this.send(ws, { type: 'ack', submissionId: message.submissionId, ...acknowledgement });
        }
        this.send(ws, { type: 'state', state: this.stateFor(session.seat) });
      } catch (error) {
        this.send(ws, { type: 'error', code: error instanceof HttpError ? error.code : 'SERVICE_ERROR',
          message: error instanceof HttpError ? error.message : 'The room could not process that action. Reconnect to retry.' });
        if (!(error instanceof HttpError)) { try { ws.close(1011, 'Please reconnect.'); } catch {} }
      }
    }).finally(() => { this.pendingSocketEvents -= 1; });
  }

  webSocketClose(ws) {
    return this.enqueue(() => {
      try { ws.close(1000, 'Connection closed.'); } catch {}
      this.broadcast();
    });
  }

  webSocketError(ws) { return this.webSocketClose(ws); }

  alarm() {
    const now = Date.now();
    return this.enqueue(async () => {
      if (!this.record) return;
      try {
        await this.change(() => advanceMatch(this.record.match, now));
      } catch (error) {
        // Keep scheduling recovery if a transient failure outlasts the
        // platform's bounded retries. Storage failure still propagates.
        await this.ctx.storage.setAlarm(Date.now() + 5000, { allowConcurrency: true });
        throw error;
      }
      // A duplicate/early alarm may not mutate state but must leave its next
      // deadline scheduled. Completed matches retain their immutable results.
      const next = nextAlarmAt(this.record.match);
      if (next !== null) await this.ctx.storage.setAlarm(next, { allowConcurrency: true });
    });
  }
}
