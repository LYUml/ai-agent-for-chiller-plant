import {createPlant} from './plant.js';
const plant=createPlant();
const strategy=plant.strategy();
console.log(strategy);
for(const [i,text] of ['为什么','改成 3 号机','启动 2 号机','查询 2 号机','报告'].entries()){
  const reply=plant.handle({id:String(i),text,quoted:strategy,operator:true});
  console.log(text,'→',reply);
  if(i===1) console.log('确认 →',plant.handle({id:'confirm',text:'确认',quoted:reply,operator:true}));
}
