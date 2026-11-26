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

test('策略模式只影响新策略，过时模式票不可覆盖新选择',()=>{
  const p=createPlant();
  const old=p.strategy();
  p.bindModePoll('picker',0);
  assert.match(p.vote('picker','自动批准'),/自动批准/);
  assert.equal(p.vote('picker','完全权限'),null);
  assert.match(p.strategy(3),/请在 10 分钟内确认/);
  assert.match(p.strategy(2),/模拟后台已接收/);
  assert.match(p.handle({id:'x',operator:false,text:'改到完全权限'}),/仅指定/);
  assert.match(p.handle({id:'y',operator:true,text:'改到完全权限'}),/完全权限/);
  assert.match(p.strategy(3),/模拟后台已接收/);
  assert.match(p.handle({id:'z',operator:true,text:'拒绝',quoted:old}),/已拒绝/);
});

test('无人选择时只提醒一次，已选择后不发超时提醒',()=>{
  const p=createPlant();
  p.bindModePoll('pending',0);
  p.bindModePoll('selected',0);
  assert.match(p.vote('selected','自动批准'),/^模式更改已生效/);
  p.notifyExpiredModePolls();
  assert.equal(p.pendingReplies().length,1);
});

test('已处理的模式改票只通知一次，允许新一轮修改',()=>{
  const p=createPlant();
  p.bindModePoll('first',0);
  p.vote('first','自动批准','self');
  assert.match(p.vote('first','完全权限','self'),/当前使用「自动批准」.*发送「改模式」/);
  assert.equal(p.vote('first','完全权限','self'),null);
  assert.equal(p.setting().mode,'自动批准');
  p.bindModePoll('second',1);
  p.vote('second','完全权限','self');
  assert.equal(p.setting().mode,'完全权限');
});

test('较新的停机确认可关闭旧启动待办，即使设备原本已停机',()=>{
  const p=createPlant();
  let seq=0;
  const send=(text,quoted='')=>p.handle({id:String(++seq),operator:true,text,quoted});
  const start=send('启动 2 号机');
  const other=send('启动 3 号机');
  const stop=send('停止 2 号机');
  assert.match(send('确认',stop),/已达目标/);
  assert.match(send('确认',start),/后续确认取代/);
  assert.match(send('报告'),/命令 0 条/);
  assert.match(send('确认',other),/模拟后台已接收/);
});

test('投票发送失败可使用原编号确认，回执重送不重复发令',async()=>{
  const {deliverReply,flushReplies}=await import('../src/outbox.js');
  const p=createPlant(), proposal=p.strategy(), id=proposal.match(/S[0-9a-f]{8}/)[0];
  await deliverReply(p,proposal,async value=>{if(typeof value!=='string')throw Error('offline');},()=>({poll:true}));
  const recovered=[];
  await flushReplies(p,async body=>recovered.push(body));
  assert.match(recovered[0],new RegExp('确认 '+id));
  const confirm=()=>p.handle({id:'same',text:'确认 '+id,operator:true});
  assert.match(confirm(),/模拟后台已接收/);
  assert.equal(confirm(),null);
  assert.match(p.handle({id:'stats',text:'报告'}),/命令 1 条/);
});

test('后台策略提交保留依据和有效期，重试不重复创建或自动执行',()=>{
  const p=createPlant();
  const input={id:'seq-1',unit:2,action:'启动',reason:'测试负荷预测',expiresAt:new Date(Date.now()+60000).toISOString()};
  assert.equal(p.submitStrategy(input),'accepted');
  assert.equal(p.submitStrategy(input),'duplicate');
  assert.throws(()=>p.submitStrategy({...input,unit:3}),/different data/);
  assert.throws(()=>p.submitStrategy({...input,id:'stale',expiresAt:'2000-01-01'}),/expired/);
  const [proposal]=p.pendingReplies();
  assert.match(proposal.body,/测试负荷预测/);
  p.handle({id:'mode',text:'改成完全权限',operator:true});
  assert.equal(p.submitStrategy(input),'duplicate');
  assert.match(p.handle({id:'report1',text:'报告'}),/命令 0 条/);
  assert.equal(p.submitStrategy({...input,id:'seq-2'}),'accepted');
  assert.match(p.handle({id:'report2',text:'报告'}),/命令 1 条/);
});

test('策略等待发送期间过期时只发送状态，不创建投票',async t=>{
  const {deliverReply}=await import('../src/outbox.js');
  const plant=createPlant();
  const reply=plant.strategy();
  const future=Date.now()+601000;
  t.mock.method(Date,'now',()=>future);
  const sent=[];
  await deliverReply(plant,reply,async body=>sent.push(body),()=>assert.fail('expired poll'));
  assert.equal(sent.length,1);
  assert.match(sent[0],/当前状态：已过期/);
});

test('后台策略下发后，原提议及人工修改都可追踪来源',()=>{
  const plant=createPlant();
  plant.submitStrategy({id:'load-forecast-42',unit:2,action:'启动',reason:'样例预测',expiresAt:new Date(Date.now()+60000).toISOString()});
  const proposal=plant.pendingReplies()[0].body;
  const reason=plant.handle({id:'why',text:'为什么',quoted:proposal});
  assert.match(reason,/样例预测.*来源策略：load-forecast-42/);
  const revised=plant.handle({id:'change',text:'改成 3 号机',quoted:proposal,operator:true});
  assert.match(plant.handle({id:'why2',text:'为什么',quoted:revised}),/工程师修改.*来源策略：load-forecast-42/);
});
