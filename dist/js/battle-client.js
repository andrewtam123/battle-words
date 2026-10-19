import { PROTOCOL_VERSION, DICTIONARY_VERSION } from './battle-protocol.js';

export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
const ID = /^[a-f0-9]{32}$/;
const noop = () => {};

/** Browser transport and seat storage. Gameplay outcomes are always server-owned. */
export class BattleClient {
  constructor({ apiUrl, onState = noop, onStatus = noop, onError = noop, onAck = noop,
    fetchImpl = globalThis.fetch.bind(globalThis), WebSocketImpl = globalThis.WebSocket,
    storage, now = () => Date.now(), prefix = `battle-words:${new URL('../', import.meta.url).pathname}:` }) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    Object.assign(this, { onState, onStatus, onError, onAck, fetchImpl, WebSocketImpl, now, prefix });
    try { this.storage = storage === undefined ? globalThis.localStorage : storage; } catch { this.storage = null; }
    this.storageAvailable = Boolean(this.storage);
    this.memory = new Map();
    this.controllers = new Set();
    this.name = this.read('name') || '';
    this.state = null;
    this.roomId = null;
    this.status = 'disconnected';
    this.epoch = 0;
    this.attempts = 0;
    this.offset = 0;
    this.rtt = 0;
    this.pending = null;
    this.socket = null;
    this.retryTimer = this.heartbeat = 0;
    this.pings = new Map();
  }

  read(key) {
    try {
      const value = this.storage?.getItem(this.prefix + key);
      if (value != null) return value || this.memory.get(key) || null;
      if (this.memory.has(key)) return this.memory.get(key) || null;
      // The Pages rename keeps the origin, so recover its existing names and seats.
      if (this.prefix === 'battle-words:/battle-words/:' && (key === 'name' || /^room:[a-f0-9]{32}$/.test(key))) {
        const legacy = this.storage?.getItem(`battle-words:/20words/:${key}`);
        if (legacy) { this.write(key, legacy); return legacy; }
      }
      return null;
    }
    catch { this.storageAvailable = false; return this.memory.get(key) || null; }
  }

  write(key, value) {
    this.memory.set(key, value);
    try { if (this.storage) this.storage.setItem(this.prefix + key, value); }
    catch { this.storageAvailable = false; }
  }

  saveName(name) { this.name = name.trim(); this.write('name', this.name); }
  hasCredential(id) { return ID.test(id) && ID.test(this.read(`room:${id}`) || ''); }
  credential(id) {
    let value = this.read(`room:${id}`);
    if (!ID.test(value || '')) { value = randomId(); this.write(`room:${id}`, value); }
    return value;
  }
  serverNow() { return this.now() + this.offset; }
  setStatus(value) { this.status = value; this.onStatus(value); }

  async request(path, body) {
    if (!this.apiUrl) throw new Error('Online battles aren’t configured here yet.');
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetchImpl(this.apiUrl + path, {
        method: body ? 'POST' : 'GET',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, version: PROTOCOL_VERSION, dictionaryVersion: DICTIONARY_VERSION }) } : {}),
        signal: controller.signal,
        credentials: 'omit',
      });
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error?.message || 'The battle service could not complete that request.');
        error.code = result.error?.code;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The connection took too long. Please try again.');
      if (error instanceof TypeError) throw new Error('Couldn’t reach the battle service. Check your connection and try again.');
      throw error;
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }

  async create(name) {
    this.saveName(name);
    if (!this.createAttempt || this.createAttempt.name !== this.name) this.createAttempt = { id: randomId(), name: this.name };
    const id = this.createAttempt.id;
    const result = await this.request(`/rooms/${id}/create`, { name: this.name, credential: this.credential(id) });
    this.createAttempt = null;
    return { ...result, id };
  }

  async join(id, name) {
    if (!ID.test(id)) throw new Error('That room link is invalid.');
    this.saveName(name);
    return this.request(`/rooms/${id}/join`, { name: this.name, credential: this.credential(id) });
  }

  async open(id) {
    if (!ID.test(id)) throw new Error('That room link is invalid.');
    return this.request(`/rooms/${id}`);
  }

  stop(clearPending) {
    this.epoch += 1;
    clearTimeout(this.retryTimer);
    clearInterval(this.heartbeat);
    this.retryTimer = this.heartbeat = 0;
    for (const controller of this.controllers) controller.abort();
    const ws = this.socket;
    this.socket = null;
    try { ws?.close(); } catch { /* Already closed. */ }
    if (clearPending) this.pending = null;
  }

  disconnect() { this.stop(true); this.setStatus('disconnected'); }

  async connect(id) {
    if (!this.hasCredential(id)) throw new Error('This browser does not hold a player seat.');
    this.stop(this.roomId !== id);
    this.roomId = id;
    this.attempts = 0;
    this.setStatus('connecting');
    return this.attempt(this.epoch);
  }

  async attempt(epoch) {
    try {
      const { ticket } = await this.request(`/rooms/${this.roomId}/connect`, { credential: this.read(`room:${this.roomId}`) });
      if (epoch !== this.epoch) return;
      const url = new URL(`${this.apiUrl}/rooms/${this.roomId}/socket`);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('ticket', ticket);
      const ws = new this.WebSocketImpl(url.href);
      this.socket = ws;
      const current = () => this.epoch === epoch && this.socket === ws;
      const handshake = setTimeout(() => { if (current() && ws.readyState !== 1) ws.close(); }, 10_000);
      ws.addEventListener('open', () => {
        clearTimeout(handshake);
        if (!current()) return;
        this.attempts = 0;
        this.lastMessage = this.now();
        this.setStatus('connected');
        this.ping();
        clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => {
          if (!current()) return;
          if (this.now() - this.lastMessage > 25_000) ws.close(); else this.ping();
        }, 10_000);
      });
      ws.addEventListener('message', event => {
        if (!current()) return;
        this.lastMessage = this.now();
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'replaced') {
          this.stop(false);
          this.setStatus('replaced');
        } else if (message.type === 'state') this.acceptState(message.state, ws);
        else if (message.type === 'ack') {
          if (this.pending?.submissionId === message.submissionId) this.pending = null;
          this.onAck(message);
        } else if (message.type === 'pong' && this.pings.has(message.id)) {
          this.rtt = Math.max(0, this.now() - this.pings.get(message.id));
          this.offset = message.now + this.rtt / 2 - this.now();
          this.pings.delete(message.id);
        } else if (message.type === 'error') {
          const error = Object.assign(new Error(message.message), { code: message.code });
          this.onError(error);
          if (message.code === 'SERVICE_ERROR') ws.close();
        }
      });
      ws.addEventListener('close', event => {
        clearTimeout(handshake);
        if (!current()) return;
        clearInterval(this.heartbeat);
        this.socket = null;
        if (event.code === 4001) { this.stop(false); this.setStatus('replaced'); }
        else this.scheduleReconnect(epoch);
      });
      ws.addEventListener('error', () => { if (current()) ws.close(); });
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (['MATCH_FINISHED', 'ROOM_EXPIRED', 'ROOM_NOT_FOUND', 'NOT_A_PLAYER', 'VERSION_MISMATCH'].includes(error.code)) {
        this.stop(false);
        this.setStatus('disconnected');
      } else this.scheduleReconnect(epoch);
      this.onError(error);
      throw error;
    }
  }

  scheduleReconnect(epoch) {
    if (epoch !== this.epoch || this.status === 'replaced') return;
    this.setStatus('reconnecting');
    clearTimeout(this.retryTimer);
    const delay = Math.min(8000, 500 * 2 ** this.attempts++);
    this.retryTimer = setTimeout(() => { if (epoch === this.epoch) this.attempt(epoch).catch(noop); }, delay);
  }

  acceptState(state, ws) {
    if (!state || state.id !== this.roomId) return;
    if (state.protocolVersion !== PROTOCOL_VERSION || state.dictionaryVersion !== DICTIONARY_VERSION) {
      this.stop(false);
      this.setStatus('disconnected');
      this.onError(Object.assign(new Error('The game has been updated. Reload before continuing.'), { code: 'VERSION_MISMATCH' }));
      return;
    }
    this.offset = state.serverNow + this.rtt / 2 - this.now();
    this.state = state;
    if (this.pending && (this.pending.round !== state.index || state.phase !== 'playing' || state.ownSubmission)) this.pending = null;
    this.onState(state);
    if (this.pending && this.pending.sentOn !== ws) {
      this.pending.sentOn = ws;
      this.send({ type: 'submit', round: this.pending.round, answer: this.pending.answer, submissionId: this.pending.submissionId });
    }
    if (state.phase === 'finished' || state.phase === 'expired') {
      this.stop(true);
      this.setStatus('disconnected');
    }
  }

  send(message) {
    if (this.socket?.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify(message)); return true; }
    catch { this.socket.close(); return false; }
  }

  ping() {
    const id = randomId();
    this.pings.clear();
    this.pings.set(id, this.now());
    this.send({ type: 'ping', id });
  }

  ready() { this.send({ type: 'ready' }); }
  shuffle(round) { this.send({ type: 'shuffle', round }); }
  submit(round, answer, submissionId = randomId()) {
    this.pending = { round, answer, submissionId, sentOn: this.socket };
    this.send({ type: 'submit', round, answer, submissionId });
    return submissionId;
  }
}
