import test from 'node:test';
import assert from 'node:assert/strict';
import {createClarifier} from '../src/clarify.js';
test('漏提及须由原发送人引用确认，只恢复一次',async()=>{
  let guesses=0, prompts=0;
  const clarify=createClarifier(async()=>{guesses++;return '启动 2 号机';},async()=>{prompts++;return {id:{_serialized:'p'}};});
  const m={author:'a',body:'帮我开二号机'};
  await clarify({...m,mentionedIds:['b']});
  await clarify({...m,body:'午饭吃什么'});
  assert.equal(guesses,0);
  await Promise.all([clarify(m),clarify(m)]);
  assert.equal(prompts,1);
  const yes={...m,body:'需要',hasQuotedMsg:true,getQuotedMessage:async()=>({id:{_serialized:'p'}})};
  assert.equal(await clarify({...yes,author:'b'}),null);
  assert.equal(await clarify(yes),'启动 2 号机');
  assert.equal(await clarify(yes),null);
});
