import language from '../kb/language.json' with {type:'json'};
// The model can suggest a query or a draft, never an approval.
export async function classify(text) {
  // Mixed equipment requests need a broader tool than the chiller-only demo.
  if (/\b(?:CT|CWP|PCHWP)[-\s]*\d|冷却塔|冷卻塔|散熱塔|散热塔/iu.test(text)) {
    return {intent:'ignore',unit:null};
  }
  if (/^(?:我(?:已|要)?\s*)?(?:确认|確認)/u.test(text.trim())) {
    return {intent: 'ignore', unit: null};
  }
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {Authorization: 'Bearer '+process.env.DEEPSEEK_API_KEY, 'Content-Type':'application/json'},
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
      temperature:0, thinking: {type:'disabled'}, response_format: {type:'json_object'},
      messages: [
        {role:'system', content:'冷站测试群意图分类。只输出 JSON {"intent":"status","unit":2}。status 表示询问机组是否运行，例如二号机现在转起来没有；start 或 stop 表示明确请求启停，后续必须人工确认。report 表示查询报告，why 表示询问策略依据。询问是否需要加机用 need；已执行或报告故障用 feedback；闲聊、否定、复合指令、引述、确认或不确定用 ignore。设备编号1到4，CH4和四号机都是4，缺设备用null。只查询且要求不要操作时优先 status。转述已经完成的动作是 feedback，包括“师傅说已经停了”；引用未执行的命令才 ignore。'+language.terms},
        {role:'user',content:text}
      ]
    })
  });
  if(!response.ok) throw Error('DeepSeek HTTP '+response.status);
  const payload=await response.json();
  const {intent,unit}=JSON.parse(payload.choices[0].message.content);
  if(!['status','start','stop','report','why','need','feedback','ignore'].includes(intent) ||
     !(unit===null || [1,2,3,4].includes(unit))) throw Error('Invalid intent response');
  return {intent,unit:intent==='ignore'?null:unit};
}

export async function interpret(text) {
  const {intent,unit}=await classify(text);
  if(intent==='need' || intent==='feedback') return {intent,unit,original:text};
  if(intent==='why') return '为什么';
  if(intent==='report') return '报告';
  const verb=new Map([['status','查询'],['start','启动'],['stop','停止']]).get(intent);
  return verb && [2,3].includes(unit) ? verb+' '+unit+' 号机' : null;
}
