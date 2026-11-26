import {classify} from '../src/ai.js';
const examples=[
  ['有冇需要加機？','need',null],
  ['可唔可以幫手開四號機？','start',4],
  ['四號機已經手動關咗','feedback',4],
  ['二号机现在开着吗？','status',2],
  ['中午食咩？','ignore',null],
  ['先唔好開三號機','ignore',null],
  ['我確認開二號機','ignore',null],
  ['有冇需要開3號機？','need',3],
  ['三號機開咗未？','status',3],
  ['三號機開咗喇','feedback',3],
  ['幫我停咗CH3唔該','stop',3],
  ['點解今次建議加機？','why',null]
];
const input=process.argv.slice(2).join(' ');
if(input && input!=='--repeat') console.log(await classify(input));
else for(let round=1;round<=(input==='--repeat'?3:1);round++) for(const [text,intent,unit] of examples){
  const result=await classify(text);
  const pass=result.intent===intent && result.unit===unit;
  console.log(round,pass?'PASS':'FAIL',text,result);
  if(!pass) process.exitCode=1;
}
