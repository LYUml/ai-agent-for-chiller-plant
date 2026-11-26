import {authDirectory, dataDirectory, groupDatabasePath} from './storage.js';
import {createClarifier} from './clarify.js';
import {deliverReply,flushReplies} from './outbox.js';
import {handleIncoming} from './incoming.js';
import { interpret } from './ai.js';
import wa from 'whatsapp-web.js';
import qr from 'qrcode-terminal';
import { mkdirSync,existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createPlant, MODES } from './plant.js';

let group=process.env.TEST_GROUP_ID;
const groupName=process.env.TEST_GROUP_NAME;
const operators=new Set((process.env.OPERATOR_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));
if(group && !group.endsWith('@g.us')) throw Error('TEST_GROUP_ID 必须是群 ID');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const client=new wa.Client({webVersionCache:{type:'none'},authStrategy:new wa.LocalAuth({dataPath:authDirectory}),puppeteer:{
  executablePath:process.env.CHROME_PATH || (existsSync(chrome)?chrome:undefined),headless:process.env.WA_SHOW_BROWSER!=='1'
}});
mkdirSync(dataDirectory,{recursive:true});
let plant;
let clarify;
let selfIds=[];
let retried=false;
let readyStarted=false;
client.on('authenticated',()=>{
  console.log('WhatsApp authenticated');
  if(retried) return;
  retried=true;
  setTimeout(async()=>{
    if(readyStarted) return;
    try {
      await client.pupPage.evaluate(()=>window.onAppStateHasSyncedEvent());
    } catch(e){ console.error('WhatsApp initialization:',e.message); }
  },8000);
});
client.on('auth_failure',()=>console.error('WhatsApp authentication failed'));
client.on('qr',code=>qr.generate(code,{small:true}));
client.on('ready',async()=>{
  if(readyStarted) return;
  readyStarted=true;
  console.log('WhatsApp ready');
  if(group && groupName){
    const target=await client.getChatById(group);
    if(!target?.isGroup || target.name!==groupName){console.error('测试群名称不匹配');return;}
  }
  if(!group && groupName){
    const matches=(await client.getChats()).filter(c=>c.isGroup && c.name===groupName);
    if(matches.length!==1){console.error('未找到唯一匹配的测试群');return;}
    group=matches[0].id._serialized;
  }
  if(!group){
    for(const chat of await client.getChats()) if(chat.isGroup) console.log(chat.name,chat.id._serialized);
    console.log('只读发现模式。设置 TEST_GROUP_ID 后重启。');return;
  }
  const ownId=client.info?.wid?._serialized || await client.pupPage.evaluate(()=>window.require('WAWebUserPrefsMeUser').getMaybeMePnUser()?._serialized);
  if(ownId){
    selfIds=[ownId];
    try{
      const [ids]=await client.getContactLidAndPhone(ownId);
      selfIds.push(ids.lid,ids.pn);
    }catch{console.warn('仅使用当前账号标识匹配提及');}
  }
  plant=createPlant(groupDatabasePath(group));
  clarify=createClarifier(interpret,(sender,request)=>sendGroup(
  '@'+sender.split('@')[0]+' 你是想让我处理「'+request+'」吗？请在 5 分钟内引用本条回复「需要」或「不用」。',
  {mentions:[sender]}),plant.clarifications);
  if(solo) plant.restoreFirstSoloModeVote();
  void reconcilePolls();
  console.log('已连接测试群。终端输入 strategy 推送模拟策略。');
  createInterface({input:process.stdin}).on('line',async line=>{
    if(solo && line.trim()==='mode-poll') try {await sendModePoll();}catch(e){console.error(e.message);}
    if(line.trim()==='strategy') try {await deliver(plant.strategy());}catch(e){console.error(e.message);}
  });
});
const solo=process.env.WA_SELF_TEST==='1';
function sendGroup(content,options){
  const body=solo && typeof content==='string'?'助手｜'+content:content;
  return client.sendMessage(group,body,options);
}
client.on(solo?'message_create':'message',m=>handleIncoming(m,{
  plant,group,solo,selfIds,operators,aiEnabled:Boolean(process.env.DEEPSEEK_API_KEY),
  clarify,interpret,sendGroup,deliver,sendModePoll
}));
async function sendModePoll(){
      const {mode,revision}=plant.setting();
      const sent=await sendGroup(new wa.Poll('切换模拟策略模式（当前：'+mode+'）',MODES,{allowMultipleAnswers:false}));
      plant.bindModePoll(sent.id._serialized,revision);
  console.log('模式投票已发送并绑定');
}
async function deliver(reply){
  return deliverReply(plant,reply,sendGroup,(title,options)=>
    new wa.Poll(title,options,{allowMultipleAnswers:false}));
}

// Read the current selection rather than accepting a delayed vote event.
// A selection already processed is final even if it is later withdrawn.
async function handleVote(vote,messageId){
  try{
    if(!plant || vote.selectedOptions.length!==1) return;
    const raw=vote.voter;
    const voter=typeof raw==='string'?raw:raw?._serialized || raw?.$1;
    if(!voter) return;
    if(solo){
      const self=client.info?.wid?._serialized || (await client.pupPage.evaluate(()=>String(window.require('WAWebUserPrefsMeUser').getMaybeMePnUser())));
      if(voter!==self){
        const [aliases]=await client.getContactLidAndPhone(self);
        if(voter!==aliases.lid && voter!==aliases.pn) return;
      }
    }else if(!operators.has(voter)) return;
    const option=vote.selectedOptions[0].name;
    const choice=MODES.includes(option)?option:new Map([['确认操作','确认'],['取消操作','拒绝']]).get(option);
    const result=plant.vote(messageId || vote.parentMessage.id._serialized,choice,solo?'self':voter);
    if(result) console.log('已记录投票结果',result);
  }catch(e){console.error('投票处理失败',e.message);}
}
async function reconcilePolls(){
  try{
    plant.notifyExpiredModePolls();
    for(const {message} of plant.pendingPolls()){
      try {
        const votes=await client.getPollVotes(message);
        for(const vote of votes) await handleVote(vote,message);
      } catch(error){
        console.error('读取投票失败',String(error));
      }
    }
  }catch(e){console.error('读取当前投票失败',String(e));}
  await flushReplies(plant, (body,id)=>id.startsWith('strategy:')?deliver(body):sendGroup(body));
  setTimeout(reconcilePolls,5000);
}
let stopping=false;
async function shutdown(code){
  if(stopping) return;
  stopping=true;
  const timeout=setTimeout(()=>process.exit(code),5000);
  timeout.unref();
  try {await client.destroy();} finally {process.exit(code);}
}
process.once('SIGINT',()=>void shutdown(0));
process.once('SIGTERM',()=>void shutdown(0));
client.on('disconnected',reason=>{
  console.error('连接已断开，请重启并检查登录状态',reason);
  void shutdown(1);
});
await client.initialize();
