import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlant} from '../src/plant.js';
import {createClarifier} from '../src/clarify.js';
import {handleIncoming} from '../src/incoming.js';

test('群聊回放：漏提及、本人引用澄清、状态回读、权限和操作隔离',async()=>{
  const replies=[];
  const prompts=[];
  const plant=createPlant();
  const interpret=async text=>text.includes('查')?'查询 2 号机':null;
  const clarify=createClarifier(interpret,async(sender,request)=>{
    prompts.push({sender,request});
    return {id:{_serialized:'prompt'}};
  });
  let seq=0;
  const send=(body,extra={})=>handleIncoming({
    id:{_serialized:String(++seq)},body,type:'chat',from:'test-group',author:'staff',...extra
  },{plant,group:'test-group',solo:false,selfIds:['99@lid'],operators:new Set(['staff']),
    aiEnabled:true,clarify,interpret,deliver:msg=>replies.push(msg),sendGroup:msg=>replies.push(msg)});
  await send('帮我查下二号机');
  assert.deepEqual(prompts,[{sender:'staff',request:'查询 2 号机'}]);
  const quote={hasQuotedMsg:true,getQuotedMessage:async()=>({id:{_serialized:'prompt'},fromMe:true,body:'澄清'})};
  await send('需要',{...quote,author:'other'});
  assert.equal(replies.length,0);
  await send('需要',quote);
  assert.match(replies.pop(),/2 号机停机/);
  await send('@99 启动 2 号机',{mentionedIds:['99@lid'],author:'other'});
  assert.match(replies.pop(),/仅指定操作员/);
  await send('@99 报告',{mentionedIds:['99@lid']});
  assert.match(replies.pop(),/命令 0 条/);
});

test('询问加机和转述已执行动作均不触发设备操作',async()=>{
  const plant=createPlant(), replies=[];
  for(const [intent,text] of [['need','有無需要加機？'],['feedback','二號機已經手動開咗']]){
    await handleIncoming({type:'chat',from:'g',author:'staff',mentionedIds:['99@lid'],id:{_serialized:intent},body:'@99 '+text},
      {plant,group:'g',solo:false,selfIds:['99@lid'],operators:new Set(['staff']),aiEnabled:true,
       interpret:async original=>({intent,unit:2,original}),deliver:reply=>replies.push(reply)});
  }
  assert.match(replies[0],/无法判断是否需要加机/);
  assert.match(replies[1],/已记录现场反馈.*2 号机停机/);
  assert.match(plant.handle({id:'report',text:'报告'}),/命令 0 条/);
});

test('同一条策略消息在模式变更后重送，仍只产生原提议',async()=>{
  const plant=createPlant(), replies=[];
  const context={plant,group:'g',solo:true,operators:new Set(),selfIds:[],
    aiEnabled:false,deliver:message=>replies.push(message)};
  const message={type:'chat',fromMe:true,to:'g',id:{_serialized:'strategy-1'},body:'strategy 2'};
  await handleIncoming(message,context);
  plant.handle({id:'mode-1',text:'改到完全权限',operator:true});
  await handleIncoming(message,context);
  assert.equal(replies.length,1);
  assert.match(replies[0],/请在 10 分钟内确认/);
  assert.match(plant.handle({id:'report-1',text:'报告'}),/命令 0 条/);
  const next={...message,id:{_serialized:'strategy-2'}};
  await handleIncoming(next,context);
  await handleIncoming(next,context);
  assert.equal(replies.length,2);
  assert.match(plant.handle({id:'report-2',text:'报告'}),/命令 1 条/);
});

test('模型超时会回应已寻址的请求，固定查询仍然可用',async()=>{
  const replies=[], plant=createPlant();
  const ctx={plant,group:'g',solo:false,selfIds:['99@lid'],operators:new Set(),aiEnabled:true,
    interpret:async()=>{throw Error('model timeout');},sendGroup:x=>replies.push(x),deliver:x=>replies.push(x)};
  const m={type:'chat',from:'g',author:'staff',mentionedIds:['99@lid'],id:{_serialized:'one'},body:'@99 查查有冇開'};
  await handleIncoming(m,ctx);
  await handleIncoming({...m,id:{_serialized:'two'},body:'@99 查询 2 号机'},ctx);
  assert.match(replies[0],/暂时无法理解/);
  assert.match(replies[1],/2 号机停机/);
  assert.match(plant.handle({id:'r',text:'报告'}),/命令 0 条/);
});

test('礼貌询问进入分类器；先问原因再暂缓时保留引用和两种意图',async()=>{
  const plant=createPlant(), proposal=plant.strategy(), replies=[];
  const ctx={plant,group:'g',solo:true,operators:new Set(),aiEnabled:true,
    interpret:async text=>{assert.equal(text,'可以帮我查一下二号机吗');return '查询 2 号机';},
    deliver:r=>replies.push(r)};
  const msg={fromMe:true,type:'chat',to:'g',id:{_serialized:'ask'},body:'可以帮我查一下二号机吗'};
  await handleIncoming(msg,ctx);
  await handleIncoming({...msg,id:{_serialized:'hold'},body:'點解要開？先唔好開',hasQuotedMsg:true,
    getQuotedMessage:async()=>({fromMe:true,body:proposal})},ctx);
  assert.match(replies[0],/2 号机停机/);
  assert.match(replies[1],/已暂缓.*记录依据/);
  assert.match(plant.handle({id:'counts',text:'报告'}),/命令 0 条/);
});

test('粤语追问保留操作编号，引用另一张投票时先澄清',async()=>{
  const plant=createPlant(), replies=[];
  const a=plant.strategy().match(/S[0-9a-f]{8}/)[0];
  const b=plant.strategy(3).match(/S[0-9a-f]{8}/)[0];
  const ctx={plant,group:'g',solo:true,operators:new Set(),aiEnabled:true,
    interpret:async()=> '为什么',deliver:r=>replies.push(r)};
  const msg={type:'chat',fromMe:true,to:'g',body:a.toLowerCase()+' 點解要咁做？',id:{_serialized:'why'}};
  await handleIncoming(msg,ctx);
  assert.ok(replies[0].startsWith(a+' 的记录依据'));
  const quote={hasQuotedMsg:true,getQuotedMessage:async()=>({fromMe:true,type:'poll_creation',body:'',pollName:'操作编号：'+b})};
  await handleIncoming({...msg,...quote,id:{_serialized:'conflict'}},ctx);
  assert.match(replies[1],/唯一操作编号/);
  await handleIncoming({...msg,...quote,body:'點解？',id:{_serialized:'poll-why'}},ctx);
  assert.ok(replies[2].startsWith(b+' 的记录依据'));
});
