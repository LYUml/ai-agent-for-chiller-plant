import {addressedText} from './mention.js';
import {modeRequest} from './plant.js';

// Keep identifiers intact when a single reply both pauses and questions a proposal.
function pendingFollowup(text) {
  const hold = /先别(?:开|执行|操作)|暫緩|暂缓|先唔好(?:開|執行)/u.test(text);
  const reason = /为什么|為什麼|点解|點解/u.test(text);
  if (!hold || !reason) return text;
  return ['暂缓，为什么', ...(text.match(/S[0-9a-f]{8}\b/g) ?? [])].join(' ');
}

function isDirectInput(text) {
  if (/^(确认|拒绝|修改|改成|为什么|暂缓|先别|已经手动)/u.test(text)) return true;
  if (/^(收到|可以)(?:\s+S[0-9a-f]{8})?$|^(报告|report)$/iu.test(text)) return true;
  return /^(查询|状态|启动|开启|关闭|停止)\s*[23]\s*号机$/u.test(text);
}

export async function handleIncoming(m,{plant,group,solo,selfIds,operators,aiEnabled,clarify,interpret,sendGroup,deliver,sendModePoll}){
  if(!plant || m.type!=='chat') return;
  if(solo){
    if(!m.fromMe || (m.id.remote!==group && m.to!==group) || m.body.startsWith('助手｜')) return;
  }else if(m.fromMe || m.from!==group) return;
  try{
    let text=solo?m.body.trim().replace(/^[/／]test\s+/iu,''):addressedText(m.body,m.mentionedIds || [],selfIds);
    if(text===null && aiEnabled) text=await clarify(m);
    if(text===null) return;
    if(!text){await sendGroup('请告诉我想查询的设备或要处理的操作。');return;}
    console.log('收到测试群消息',m.id._serialized,'发送人',m.author);
    const q=m.hasQuotedMsg?await m.getQuotedMessage():null;
    text=pendingFollowup(text);
    const request=modeRequest(text);
    if(request==='pick'){
      if(!solo && !operators.has(m.author)){await deliver('仅指定操作员可修改模式。');return;}
      await sendModePoll();
      return;
    }
    if(solo && /^strategy(?: [23])?$/.test(text)){
      const result=plant.strategy(Number(text.split(' ')[1]||2),m.id._serialized);
      if(result) await deliver(result);
      return;
    }
    if(!request && aiEnabled && !isDirectInput(text.trim())){
      try {
        text=await interpret(text);
      } catch (error) {
        console.error('意图识别失败',error.message);
        await sendGroup('暂时无法理解这条请求。可以使用明确指令，例如「查询 2 号机」。');
        return;
      }
      if(!text){
        if(solo) await sendGroup('这条消息没有识别成可处理的请求。可以说「查询 2 号机」或「启动 2 号机」。');
        return;
      }
    }
    const observation=typeof text==='object'?text:null;
    const reply=plant.handle({id:m.id._serialized,text:observation?.original ?? text,observation,quoted:q?.fromMe?q.body:'',operator:solo || operators.has(m.author)});
    if(reply) await deliver(reply);
  }catch(e){console.error('消息处理失败',e.message);}
}
