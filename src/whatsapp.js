import {createClarifier} from './clarify.js';
import {flushReplies} from './outbox.js';
import { addressedText } from './mention.js';
import { interpret } from './ai.js';
import wa from 'whatsapp-web.js';
import qr from 'qrcode-terminal';
import { mkdirSync,existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createPlant, MODES, modeRequest } from './plant.js';

let group=process.env.TEST_GROUP_ID;
const groupName=process.env.TEST_GROUP_NAME;
const operators=new Set((process.env.OPERATOR_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));
if(group && !group.endsWith('@g.us')) throw Error('TEST_GROUP_ID 必须是群 ID');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const client=new wa.Client({webVersionCache:{type:'none'},authStrategy:new wa.LocalAuth(),puppeteer:{
  executablePath:process.env.CHROME_PATH || (existsSync(chrome)?chrome:undefined),headless:process.env.WA_SHOW_BROWSER!=='1'
}});
mkdirSync('data',{recursive:true});
let plant;
let selfIds=[];
let retried=false;
client.on('authenticated',()=>{
  console.log('WhatsApp authenticated');
  if(retried) return;
  retried=true;
  setTimeout(async()=>{
    if(plant) return;
    try {
      await client.pupPage.evaluate(()=>window.onAppStateHasSyncedEvent());
    } catch(e){ console.error('WhatsApp initialization:',e.message); }
  },8000);
});
client.on('auth_failure',()=>console.error('WhatsApp authentication failed'));
client.on('qr',code=>qr.generate(code,{small:true}));
client.on('ready',async()=>{
  if(plant) return;
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
  plant=createPlant('data/'+group.replace(/[^\w-]/g,'_')+'.sqlite');
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
const clarify=createClarifier(interpret,(sender,request)=>sendGroup(
  '@'+sender.split('@')[0]+' 你是想让我处理「'+request+'」吗？请在 5 分钟内引用本条回复「需要」或「不用」。',
  {mentions:[sender]}));
client.on(solo?'message_create':'message',async m=>{
  if(!plant || m.type!=='chat') return;
  if(solo){
    if(!m.fromMe || (m.id.remote!==group && m.to!==group) || m.body.startsWith('助手｜')) return;
  }else if(m.fromMe || m.from!==group) return;
  try{
    let text=solo?m.body.trim().replace(/^[/／]test\s+/iu,''):addressedText(m.body,m.mentionedIds || [],selfIds);
    if(text===null && process.env.DEEPSEEK_API_KEY) text=await clarify(m);
    if(text===null) return;
    if(!text){await sendGroup('请告诉我想查询的设备或要处理的操作。');return;}
    console.log('收到测试群消息',m.id._serialized,'发送人',m.author);
    const q=m.hasQuotedMsg?await m.getQuotedMessage():null;
    const request=modeRequest(text);
    if(request==='pick'){
      if(!solo && !operators.has(m.author)){await deliver('仅指定操作员可修改模式。');return;}
      await sendModePoll();
      return;
    }
    if(solo && /^strategy(?: [23])?$/.test(text)){await deliver(plant.strategy(Number(text.split(' ')[1]||2)));return;}
    if(!request && process.env.DEEPSEEK_API_KEY && !/^(确认|拒绝|修改|改成|为什么|暂缓|先别|已经手动|收到|可以|查询|状态|报告|report|启动|开启|关闭|停止)/i.test(text.trim())){
      text=await interpret(text);
      if(!text){
        if(solo) await sendGroup('这条消息没有识别成可处理的请求。可以说「查询 2 号机」或「启动 2 号机」。');
        return;
      }
    }
    const reply=plant.handle({id:m.id._serialized,text,quoted:q?.fromMe?q.body:'',operator:solo || operators.has(m.author)});
    if(reply) await deliver(reply);
  }catch(e){console.error('消息处理失败',e.message);}
});
async function sendModePoll(){
      const {mode,revision}=plant.setting();
      const sent=await sendGroup(new wa.Poll('切换模拟策略模式（当前：'+mode+'）',MODES,{allowMultipleAnswers:false}));
      plant.bindModePoll(sent.id._serialized,revision);
  console.log('模式投票已发送并绑定');
}
async function deliver(reply){
  await sendGroup(reply);
  const draft=reply.match(/^\[模拟 · 操作编号：(S[0-9a-f]{8})\] (启动|停止) ([23]) 号机/);
  if(!draft) return;
  const [,id,action,unit]=draft;
  const poll=new wa.Poll('模拟：'+action+' '+unit+' 号机？（操作编号：'+id+'，10 分钟内有效）',['确认操作','取消操作'],{allowMultipleAnswers:false});
  const sent=await sendGroup(poll);
  plant.bindPoll(sent.id._serialized,id);
  console.log(id,'已发送投票',sent.id._serialized);
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
  await flushReplies(plant, body=>sendGroup(body));
  setTimeout(reconcilePolls,5000);
}
client.on('disconnected',reason=>{console.error('连接已断开，请重启并检查登录状态',reason);process.exit(1);});
await client.initialize();
