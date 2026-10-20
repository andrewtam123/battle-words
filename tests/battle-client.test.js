import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleClient } from '../dist/js/battle-client.js';
import { roundFeedback, roundReviewStatus } from '../dist/js/battle-feedback.js';
import { PROTOCOL_VERSION, DICTIONARY_VERSION } from '../dist/js/battle-protocol.js';

const storage = () => { const map = new Map(); return { getItem: key => map.get(key), setItem: (key,value) => map.set(key,value) }; };
const id = 'a'.repeat(32);

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
