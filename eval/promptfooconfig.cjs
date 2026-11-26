module.exports={
  prompts:['{{utterance}}'],providers:['file://./provider.cjs'],
  tests:require('./cases.json').map(([utterance,intent,unit])=>({
    vars:{utterance},assert:[{type:'equals',value:JSON.stringify({intent,unit})}]
  }))
};
