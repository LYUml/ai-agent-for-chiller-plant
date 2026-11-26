import wa from 'whatsapp-web.js';
import qr from 'qrcode-terminal';
import { mkdirSync,existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createPlant } from './plant.js';

const group=process.env.TEST_GROUP_ID;
const operators=new Set((process.env.OPERATOR_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));
if(group && !group.endsWith('@g.us')) throw Error('TEST_GROUP_ID 必须是群 ID');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const client=new wa.Client({authStrategy:new wa.LocalAuth(),puppeteer:{
  executablePath:process.env.CHROME_PATH || (existsSync(chrome)?chrome:undefined),headless:true
}});
mkdirSync('data',{recursive:true});
const plant=createPlant('data/'+(group||'discovery').replace(/[^\w-]/g,'_')+'.sqlite');
client.on('qr',code=>qr.generate(code,{small:true}));
client.on('ready',async()=>{
  if(!group){
    for(const chat of await client.getChats()) if(chat.isGroup) console.log(chat.name,chat.id._serialized);
    console.log('只读发现模式。设置 TEST_GROUP_ID 后重启。');return;
  }
  console.log('已连接测试群。终端输入 strategy 推送模拟策略。');
  createInterface({input:process.stdin}).on('line',async line=>{
    if(line.trim()==='strategy') try {await client.sendMessage(group,plant.strategy());}catch(e){console.error(e.message);}
  });
});
client.on('message',async m=>{
  if(!group || m.from!==group || m.fromMe || m.type!=='chat') return;
  try{
    console.log('测试群发送人 ID:',m.author);
    const q=m.hasQuotedMsg?await m.getQuotedMessage():null;
    const reply=plant.handle({id:m.id._serialized,text:m.body,quoted:q?.fromMe?q.body:'',operator:operators.has(m.author)});
    if(reply) await m.reply(reply);
  }catch(e){console.error('消息处理失败',e.message);}
});
client.on('disconnected',reason=>{console.error('连接已断开，请重启并检查登录状态',reason);process.exit(1);});
await client.initialize();
