import {createGroupMessages} from './group-messages.js';
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
  clarify=createClarifier(interpret,(sender,request,quotedMessageId)=>sendGroup(
  '@'+sender.split('@')[0]+' 你是想让我处理「'+request+'」吗？请在 5 分钟内引用本条回复「需要」或「不用」。',
  {mentions:[sender],quotedMessageId}),plant.clarifications);
  if(solo){
    plant.restoreFirstSoloModeVote();
    await client.pupPage.exposeFunction('onSoloGroupText',data=>onChat(new wa.Message(client,data)));
    await client.pupPage.evaluate(target=>{
      const forward=msg=>{
        if(msg.isNewMsg && msg.type==='chat' && msg.id.fromMe && msg.id.remote.toString()===target)
          void window.onSoloGroupText(window.WWebJS.getMessageModel(msg));
      };
      const {Msg}=window.require('WAWebCollections');
      Msg.on('add',forward);
      Msg.on('add',msg=>{
        if(msg.isNewMsg && msg.type==='ciphertext') msg.once('change:type',()=>forward(msg));
      });
    },group);
  }
  void reconcilePolls();
  console.log('已连接测试群。终端输入 strategy 推送模拟策略。');
  createInterface({input:process.stdin}).on('line',async line=>{
    if(solo && line.trim()==='mode-poll') try {await sendModePoll();}catch(e){console.error(e.message);}
    if(line.trim()==='strategy') try {await deliver(plant.strategy(),sendStrategy);}catch(e){console.error(e.message);}
  });
});
const solo=process.env.WA_SELF_TEST==='1';
const messages=createGroupMessages((content,options)=>client.sendMessage(group,content,options),()=>plant);
const sendGroup=messages.send;
function sendStrategy(content){
  return sendGroup(typeof content==='string'?'*冷站策略建议*\n'+content:content);
}
if(!solo) client.on('message',onChat);
function onChat(m){
  const reply=async(content,options)=>{
    // A new outgoing message from the same account is quotable after server acknowledgement.
    if(solo && m.fromMe && !(m.ack>0)){
      await client.pupPage.waitForFunction(id=>
        window.require('WAWebCollections').Msg.get(id)?.ack>0,
        {timeout:15000},m.id._serialized);
    }
    return sendGroup(content,{...options,quotedMessageId:m.id._serialized,ignoreQuoteErrors:false});
  };
  return handleIncoming(m,{
    plant,group,solo,selfIds,operators,aiEnabled:Boolean(process.env.DEEPSEEK_API_KEY),
    clarify,interpret,isOutgoing:messages.isOutgoing,sendGroup:reply,
    deliver:body=>deliver(body,reply,m.id._serialized),sendModePoll:()=>sendModePoll(reply)
  });
}
async function sendModePoll(send=sendGroup){
      const {mode,revision}=plant.setting();
      const sent=await send(new wa.Poll('切换模拟策略模式（当前：'+mode+'）',MODES,{allowMultipleAnswers:false}));
      plant.bindModePoll(sent.id._serialized,revision);
  console.log('模式投票已发送并绑定');
}
async function deliver(reply,send=sendGroup,quotedMessageId){
  return deliverReply(plant,reply,send,(title,options)=>
    new wa.Poll(title,options,{allowMultipleAnswers:false}),quotedMessageId);
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
  await flushReplies(plant,(body,id)=>{
    if(id.startsWith('strategy:')) return deliver(body,sendStrategy);
    const quote=id.match(/^(?:poll|mode|expired-mode|delivery:[^:]+):(.+)$/)?.[1];
    return sendGroup(body,quote?{quotedMessageId:quote}:undefined);
  });
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
