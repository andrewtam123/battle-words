import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleClient } from '../dist/js/battle-client.js';
import { roundFeedback, roundReviewStatus } from '../dist/js/battle-feedback.js';
import { PROTOCOL_VERSION, DICTIONARY_VERSION } from '../dist/js/battle-protocol.js';

const storage = () => { const map = new Map(); return { getItem: key => map.get(key), setItem: (key,value) => map.set(key,value) }; };
const id = 'a'.repeat(32);
const legacyDictionaryVersion = 'scowl-2020.12.07:0ac42b1613d53c6f06b4b7f240b00086c3a2f96b596c0e966b00bc16fa964f7d:dbd074bb98944d70e5791f544c62d213d92303c163ebec5d7721398b566b16de';
const oldDictionaryVersions = [legacyDictionaryVersion,
  `${legacyDictionaryVersion}:regular-inflections-v1:4de0f47dd08b450262ba32a1e6230e5c85a387acfb97857ce9098eeba88d75f7`];

test('pending words have no outcome; final feedback distinguishes wins, ties and late correct losses', () => {
  assert.deepEqual(roundFeedback(null,0,'care'), {appearance:'',text:''});
  assert.equal(roundFeedback({outcome:'win',winner:0},0,'care').appearance, 'correct');
  assert.equal(roundFeedback({outcome:'tie',winner:null},0,'care').appearance, 'tie');
  assert.deepEqual(roundFeedback({outcome:'win',winner:1},0,'care'), {appearance:'lost',text:'Almost!'});
  assert.deepEqual(roundFeedback({outcome:'timeout',winner:null},0,''), {appearance:'unclaimed',text:'Neither player found it.'});
  assert.equal(roundFeedback({outcome:'timeout',winner:null},0,'care').appearance, 'unclaimed');
  assert.equal(roundFeedback({outcome:'win',winner:1},0,'').appearance, 'lost');
});

test('review uses the winner receipt time or the lower tied time and omits time for misses', () => {
  const players = [{name:'Alex'}, {name:'Taylor'}];
  assert.deepEqual(roundReviewStatus({outcome:'win',winner:1,elapsedMs:[null,4321]},players),
    {appearance:'solved',text:'✓ Taylor (4.3s)'});
  for (const elapsedMs of [[4321,4519], [4519,4321]]) {
    assert.deepEqual(roundReviewStatus({outcome:'tie',winner:null,elapsedMs},players),
      {appearance:'tied',text:'= Tied (4.3s)'});
  }
  assert.deepEqual(roundReviewStatus({outcome:'timeout',winner:null,elapsedMs:[null,null]},players),
    {appearance:'unclaimed',text:'× Missed'});
});

test('credentials are saved before a join request and names are independent of identity', async () => {
  const store = storage();
  let credential;
  const client = new BattleClient({apiUrl:'https://example.test',storage:store,prefix:'test:',fetchImpl:async (url,options) => {
    const body=JSON.parse(options.body); credential=body.credential;
    assert.equal(store.getItem(`test:room:${id}`),credential);
    assert.equal(body.name,'Alex');
    return Response.json({seat:1,state:{id}});
  }});
  await client.join(id,' Alex ');
  const restored = new BattleClient({apiUrl:'https://example.test',storage:store,prefix:'test:'});
  assert.equal(restored.name,'Alex');
  assert.equal(restored.credential(id),credential);
  assert.notEqual(restored.credential('b'.repeat(32)),credential);
});

test('a lost create response retries the same room and saved credential', async () => {
  const requests=[];
  const client=new BattleClient({apiUrl:'https://example.test',storage:storage(),fetchImpl:async (url,options)=>{
    requests.push([url,JSON.parse(options.body).credential]);
    if(requests.length===1) throw new TypeError('Network failed');
    return Response.json({seat:0,state:{id:'test'}});
  }});
  await assert.rejects(client.create('Alex'));
  await client.create('Alex');
  assert.deepEqual(requests[0],requests[1]);
});

test('blocked local storage retains a usable seat for this page without claiming persistence', () => {
  const client=new BattleClient({apiUrl:'https://example.test',storage:{getItem(){throw new Error();},setItem(){throw new Error();}}});
  const credential=client.credential(id);
  assert.equal(client.credential(id),credential);
  assert.equal(client.storageAvailable,false);
});

test('renamed Pages scope recovers cached names and seats without removing legacy values', () => {
  const store = storage();
  const credential = 'b'.repeat(32);
  store.setItem('battle-words:/20words/:name', 'Alex');
  store.setItem(`battle-words:/20words/:room:${id}`, credential);
  const client = new BattleClient({apiUrl:'https://example.test',storage:store,prefix:'battle-words:/battle-words/:'});
  assert.equal(client.name, 'Alex');
  assert.equal(client.hasCredential(id), true);
  assert.equal(client.credential(id), credential);
  for (const prefix of ['battle-words:/20words/:', 'battle-words:/battle-words/:']) {
    assert.equal(store.getItem(`${prefix}name`), 'Alex');
    assert.equal(store.getItem(`${prefix}room:${id}`), credential);
  }
});

test('Pages migration preserves newer values and never imports into other scopes', () => {
  const store = storage();
  const credential = 'c'.repeat(32);
  store.setItem('battle-words:/20words/:name', 'Alex');
  store.setItem(`battle-words:/20words/:room:${id}`, 'b'.repeat(32));
  store.setItem('battle-words:/battle-words/:name', 'Taylor');
  store.setItem(`battle-words:/battle-words/:room:${id}`, credential);
  const client = new BattleClient({apiUrl:'https://example.test',storage:store,prefix:'battle-words:/battle-words/:'});
  assert.equal(client.name, 'Taylor');
  assert.equal(client.credential(id), credential);
  client.saveName('');
  assert.equal(new BattleClient({apiUrl:'https://example.test',storage:store,prefix:'battle-words:/battle-words/:'}).name, '');
  for (const prefix of ['battle-words:/:', 'battle-words:/other/:', 'custom:']) {
    const unrelated = new BattleClient({apiUrl:'https://example.test',storage:store,prefix});
    assert.equal(unrelated.name, '');
    assert.equal(unrelated.hasCredential(id), false);
    assert.equal(store.getItem(`${prefix}room:${id}`), undefined);
  }
});

test('a failed migration write retains recovered credentials in memory and reports unavailable storage', () => {
  const store = storage();
  const credential = 'b'.repeat(32);
  store.setItem('battle-words:/20words/:name', 'Alex');
  store.setItem(`battle-words:/20words/:room:${id}`, credential);
  store.setItem = () => { throw new Error('Storage quota exceeded'); };
  const client = new BattleClient({apiUrl:'https://example.test',storage:store,prefix:'battle-words:/battle-words/:'});
  assert.equal(client.name, 'Alex');
  assert.equal(client.credential(id), credential);
  assert.equal(client.storageAvailable, false);
  store.getItem = () => { throw new Error('Storage blocked'); };
  assert.equal(client.read('name'), 'Alex');
  assert.equal(client.credential(id), credential);
});

test('reconnect resends one pending submission with its original ID and drops it on round advancement', () => {
  const sent=[];
  const client=new BattleClient({apiUrl:'https://example.test',storage:storage(),now:()=>1000});
  client.roomId=id;
  client.socket={readyState:1,send:message=>sent.push(JSON.parse(message))};
  client.submit(0,'care','fixed-id');
  const restoredSocket={readyState:1,send:message=>sent.push(JSON.parse(message))};
  client.socket=restoredSocket;
  const state={id,protocolVersion:PROTOCOL_VERSION,dictionaryVersion:DICTIONARY_VERSION,serverNow:1000,index:0,phase:'playing',ownSubmission:null};
  client.acceptState(state,restoredSocket);
  client.acceptState(state,restoredSocket);
  assert.equal(sent.length,2);
  assert.deepEqual(sent[0],sent[1]);
  client.acceptState({...state,index:1},restoredSocket);
  assert.equal(client.pending,null);
});

test('outdated snapshots stop play and pending retries with a new-battle instruction', () => {
  for (const [dictionaryVersion, protocolVersion] of [
    ...oldDictionaryVersions.map(version => [version, PROTOCOL_VERSION]),
    [legacyDictionaryVersion.replace('dbd074bb', '00000000'), PROTOCOL_VERSION],
    [legacyDictionaryVersion.replace('0ac42b16', '00000000'), PROTOCOL_VERSION],
    [legacyDictionaryVersion, PROTOCOL_VERSION + 1],
    [DICTIONARY_VERSION, PROTOCOL_VERSION + 1],
    ['unknown', PROTOCOL_VERSION],
  ]) {
    const errors = [];
    const client = new BattleClient({
      apiUrl: 'https://example.test', storage: storage(),
      onState: () => assert.fail('incompatible state must not be rendered'),
      onError: error => errors.push(error),
    });
    client.roomId = id;
    client.status = 'connected';
    client.pending = { round: 0, answer: 'care', submissionId: 'unsent' };
    client.acceptState({ id, dictionaryVersion, protocolVersion, phase: 'playing' });
    assert.equal(client.state, null);
    assert.equal(client.status, 'disconnected');
    assert.equal(errors[0].code, 'ROOM_OUTDATED');
    assert.match(errors[0].message, /Start a new battle from Home/);
    assert.equal(client.pending, null);
  }
});

test('opening outdated unfinished rooms fails before joining; current rooms remain available', async () => {
  for (const dictionaryVersion of [DICTIONARY_VERSION, ...oldDictionaryVersions]) {
    const info = { id, phase: 'lobby', version: PROTOCOL_VERSION, dictionaryVersion, players: [null, null] };
    const client = new BattleClient({ apiUrl: 'https://example.test', storage: storage(),
      fetchImpl: async () => Response.json(info) });
    if (dictionaryVersion === DICTIONARY_VERSION) assert.deepEqual(await client.open(id), info);
    else await assert.rejects(client.open(id), error => error.code === 'ROOM_OUTDATED' && /Start a new battle from Home/.test(error.message));
  }
});

test('outdated room connection errors stop automatic reconnecting', async () => {
  const errors = [];
  const client = new BattleClient({ apiUrl: 'https://example.test', storage: storage(),
    onError: error => errors.push(error),
    fetchImpl: async () => Response.json({ error: { code: 'ROOM_OUTDATED', message: 'Start a new battle from Home.' } }, { status: 409 }) });
  client.credential(id);
  await assert.rejects(client.connect(id), error => error.code === 'ROOM_OUTDATED');
  assert.equal(client.status, 'disconnected');
  assert.equal(client.retryTimer, 0);
  assert.equal(errors.length, 1);
});

test('an outdated-room socket error clears pending submissions and stops reconnecting', async () => {
  const errors = [];
  let socket;
  class TestSocket {
    constructor() { socket = this; this.readyState = 1; this.handlers = new Map(); }
    addEventListener(name, handler) { this.handlers.set(name, handler); }
    close() { this.readyState = 3; this.handlers.get('close')?.({ code: 4002 }); }
  }
  const client = new BattleClient({ apiUrl: 'https://example.test', storage: storage(),
    onError: error => errors.push(error), WebSocketImpl: TestSocket,
    fetchImpl: async () => Response.json({ ticket: 'b'.repeat(32) }) });
  client.credential(id);
  await client.connect(id);
  client.pending = { round: 0, answer: 'care', submissionId: 'unsent' };
  socket.handlers.get('message')({ data: JSON.stringify({ type: 'error', code: 'ROOM_OUTDATED', message: 'Start a new battle from Home.' }) });
  assert.equal(client.status, 'disconnected');
  assert.equal(client.retryTimer, 0);
  assert.equal(client.pending, null);
  assert.equal(client.socket, null);
  assert.equal(errors[0].code, 'ROOM_OUTDATED');
});

for (const [index, legacyDictionaryVersion] of oldDictionaryVersions.entries()) {
test(`completed public link ${index + 1} remains readable with its original dictionary version`, async () => {
  const result = { id, phase: 'finished', dictionaryVersion: legacyDictionaryVersion, results: { rounds: [] } };
  const client = new BattleClient({
    apiUrl: 'https://example.test', storage: storage(),
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      return Response.json(result);
    },
  });
  assert.deepEqual(await client.open(id), result);
});
}
