import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlant} from '../src/plant.js';
test('同群两条建议、修改、权限、重复投递和点位回读',()=>{
 const plant=createPlant(), a=plant.strategy();
 let i=0;
 const send=(text,quoted='',operator=true,id=String(++i))=>plant.handle({text,quoted,operator,id});
 const b=send('启动 3 号机');
 assert.match(send('确认'),/唯一/);
 assert.match(send('确认',a+b),/唯一/);
 assert.equal(send('午饭到了'),null);
 assert.match(send('先别开，为什么',a),/已暂缓.*负荷/);
 const c=send('改成 3 号机',a);
 assert.match(send('确认',a),/已替换/);
 assert.match(send('确认',c,false),/仅指定/);
 assert.match(send('确认',c,true,'retry'),/模拟后台已接收/);
 assert.equal(send('确认',c,true,'retry'),null);
 assert.match(send('查询 3 号机'),/运行/);
 assert.match(send('拒绝',b),/已拒绝/);
 assert.match(send('报告'),/命令 1 条/);
});

test('投票绑定操作，改票或重复送达只处理一次',()=>{
  const plant=createPlant();
  const id=plant.strategy().match(/S[0-9a-f]{8}/)[0];
  plant.bindPoll('poll1',id);
  assert.equal(plant.vote('unknown','确认'),null);
  assert.match(plant.vote('poll1','确认'),/模拟后台已接收/);
  assert.equal(plant.vote('poll1','拒绝'),null);
  assert.equal(plant.vote('poll1','确认'),null);
});

test('过期投票与文字确认均不能发出命令', (t)=>{
  const plant=createPlant();
  const id=plant.strategy().match(/S[0-9a-f]{8}/)[0];
  plant.bindPoll('expired-poll',id);
  const future=Date.now()+601_000;
  t.mock.method(Date,'now',()=>future);
  assert.match(plant.vote('expired-poll','确认'),/已过期/);
  assert.match(plant.handle({id:'late',text:'确认 '+id,operator:true}),/已过期/);
  assert.match(plant.handle({id:'report-expiry',text:'报告'}),/命令 0 条/);
});

test('取消已持久化，发送失败后重启可补发且不产生命令', async ()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {flushReplies}=await import('../src/outbox.js');
  const dir=mkdtempSync(join(tmpdir(),'plant-test-'));
  try {
    const path=join(dir,'plant.sqlite');
    let plant=createPlant(path);
    const id=plant.strategy().match(/S[0-9a-f]{8}/)[0];
    plant.bindPoll('cancel',id);
    assert.match(plant.vote('cancel','拒绝'),/已拒绝/);
    await flushReplies(plant,async()=>{throw Error('offline');});
    plant=createPlant(path);
    assert.equal(plant.vote('cancel','确认'),null);
    const replies=[];
    await flushReplies(plant,async body=>{replies.push(body);});
    assert.equal(replies.length,1);
    assert.match(replies[0],/取消操作.*已拒绝/);
    assert.deepEqual(plant.pendingReplies(),[]);
    assert.match(plant.handle({id:'report-outbox',text:'报告'}),/命令 0 条/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
