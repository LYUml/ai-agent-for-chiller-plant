import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const MODES=['手动批准','自动批准','完全权限'];
export function modeRequest(text){
  const t=text.trim().replace(/[？?。]$/,'');
  if(/^(当前模式|查看模式|现在是什么模式|查询模式)$/.test(t)) return 'show';
  if(/^(改模式|切换模式|更改模式|修改模式)$/.test(t)) return 'pick';
  return t.match(/^(?:改到|改为|改成|切换到|切换为|设置为)(手动批准|自动批准|完全权限)$/)?.[1];
}
// Single test group per database. Every reply and simulated write is transactional.
export function createPlant(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=5000');
  db.exec(`CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS ops(id TEXT PRIMARY KEY, unit INTEGER, action TEXT, status TEXT, reason TEXT);
    CREATE TABLE IF NOT EXISTS points(unit INTEGER PRIMARY KEY, running INTEGER, sampled TEXT);
    CREATE TABLE IF NOT EXISTS commands(op TEXT PRIMARY KEY, submitted TEXT);
    INSERT OR IGNORE INTO points VALUES(2,0,CURRENT_TIMESTAMP),(3,0,CURRENT_TIMESTAMP);`);
  if (!db.prepare('PRAGMA table_info(ops)').all().some(column => column.name === 'expires')) {
    db.exec('ALTER TABLE ops ADD COLUMN expires INTEGER');
  }
  if (!db.prepare('PRAGMA table_info(ops)').all().some(column => column.name === 'source_strategy')) {
    db.exec('ALTER TABLE ops ADD COLUMN source_strategy TEXT');
  }
  const run = (sql,...args) => db.prepare(sql).run(...args);
  const get = (sql,...args) => db.prepare(sql).get(...args);
  function draft(unit,action,reason,deadline=null,source=null) {
    const id = 'S'+randomUUID().slice(0,8);
    run("INSERT INTO ops(id,unit,action,status,reason,expires,source_strategy) VALUES(?,?,?,'待确认',?,min(unixepoch()+600,coalesce(?,unixepoch()+600)),?)",id,unit,action,reason,deadline,source);
    return `[模拟 · 操作编号：${id}] ${action} ${unit} 号机。依据：${reason}。${deadline ? "最迟于 "+new Date(Math.min(deadline*1000,Date.now()+600000)).toISOString()+" 确认。" : "请在 10 分钟内确认。"}回复「确认 ${id}」，或引用本消息拒绝、修改、追问。`;
  }
  db.exec("CREATE TABLE IF NOT EXISTS mode_setting(id INTEGER PRIMARY KEY, mode TEXT, revision INTEGER); INSERT OR IGNORE INTO mode_setting VALUES(1,'手动批准',0); CREATE TABLE IF NOT EXISTS mode_poll(message TEXT PRIMARY KEY, revision INTEGER, expires INTEGER)");
  const setting=()=>get('SELECT mode,revision FROM mode_setting WHERE id=1');
  function strategy(unit=2, messageId) {
    if(![2,3].includes(unit)) throw Error('Unsupported simulated unit');
    db.exec('BEGIN IMMEDIATE');
    try {
      const fresh = messageId === undefined ||
        run('INSERT OR IGNORE INTO messages VALUES(?)',messageId).changes === 1;
      const result = fresh ? newStrategy(unit) : null;
      db.exec('COMMIT');
      return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function newStrategy(unit,action='启动',reason='样例预测显示下一小时负荷上升，当前 '+unit+' 号机停机', deadline=null, source=null) {
    const p=get('SELECT * FROM points WHERE unit=?',unit);
    if(p.running===Number(action==='启动')) return '模拟策略检查：'+unit+' 号机已达目标，无需'+action+'。';
    const {mode}=setting();
    const proposal=draft(unit,action,reason,deadline,source);
    if(mode==='手动批准' || (mode==='自动批准' && (unit!==2 || action!=='启动'))) return proposal+' 策略模式：'+mode;
    const id=proposal.match(/S[0-9a-f]{8}/)[0];
    return '模拟策略（'+mode+'）：'+route({text:'确认 '+id,operator:true});

  }
  function route({id,text,observation,quoted='',operator=false}) {
    if(observation?.intent==='need'){
      return '当前模拟后台没有实时负荷和可用容量数据，无法判断是否需要加机。可以查询机组状态或引用一条策略查看当次依据。';
    }
    if(observation?.intent==='feedback'){
      run('INSERT INTO feedback VALUES(?,?)',id,text+' '+quoted);
      const point=get('SELECT running,sampled FROM points WHERE unit=?',observation.unit);
      return point
        ? '已记录现场反馈。模拟点位显示 '+observation.unit+' 号机'+(point.running?'运行':'停机')+'，采样时间 '+point.sampled+' UTC。'
        : '已记录现场反馈。当前没有对应设备的模拟点位可供核对。';
    }
    const t=text.trim();
    const request=modeRequest(t);
    if(request==='show') return '当前策略模式：'+setting().mode;
    if(MODES.includes(request)){
      if(!operator) return '仅指定操作员可修改模式。';
      run('UPDATE mode_setting SET mode=?, revision=revision+1 WHERE id=1',request);
      return '模式更改已生效。当前策略模式：'+request+'。';
    }
    const references=(t+' '+quoted).match(/S[0-9a-f]{8}\b/gi) ?? [];
    const ids=[...new Set(references.map(id=>'S'+id.slice(1).toLowerCase()))];
    const op=ids.length===1 && get('SELECT * FROM ops WHERE id=?',ids[0]);
    const body=t.replace(/S[0-9a-f]{8}\b/gi,'').trim();
    const unit=body.match(/([23])\s*号机/);
    if (/^(查询|状态|现在|.*开了吗)/.test(body) && unit) {
      const p=get('SELECT * FROM points WHERE unit=?',+unit[1]);
      return `模拟点位：${p.unit} 号机${p.running?'运行':'停机'}，采样时间 ${p.sampled} UTC。`;
    }
    if (/^(报告|report)$/i.test(body)) return '模拟运行报告：'+db.prepare('SELECT * FROM points ORDER BY unit').all().map(p=>p.unit+' 号机'+(p.running?'运行':'停机')).join('，')+'；累计模拟命令 '+get('SELECT count(*) n FROM commands').n+' 条。';
    const direct=body.match(/^(启动|开启|关闭|停止)\s*([23])\s*号机$/);
    if(direct) return operator?draft(+direct[2],['启动','开启'].includes(direct[1])?'启动':'停止','工程师直接要求'):'仅指定操作员可创建操作。';
    if(!/^(确认|拒绝|修改|改成|为什么|暂缓|先别|已经手动|收到|可以)/.test(body)) return null;
    if(body==='收到') return null;
    if(!op) return '请引用对应操作消息或附上唯一操作编号。';
    if(body.startsWith('为什么')) return op.id+' 的记录依据：'+op.reason+(op.source_strategy?'（来源策略：'+op.source_strategy+'）':'');
    if(!operator) return '仅指定操作员可处理此操作。';
    if(op.status!=='待确认' && op.status!=='暂缓') return op.id+' 当前状态：'+op.status;
    const status=s=>run('UPDATE ops SET status=? WHERE id=?',s,op.id);
    if (!op.expires || op.expires <= Date.now()/1000) {
      status('已过期');
      return '操作编号 '+op.id+' 已过期，请重新发起操作。';
    }
    if(/^(暂缓|先别)/.test(body)) {status('暂缓');return '已暂缓 '+op.id+(/为什么/.test(body)?'。记录依据：'+op.reason:'');}
    if(body==='拒绝') {status('已拒绝');return '已拒绝 '+op.id;}
    if(/^(修改为|改成)\s*[23]\s*号机$/.test(body)) {status('已替换');return draft(+unit[1],op.action,'工程师修改了待确认操作的目标设备',op.expires,op.source_strategy);}
    const p=get('SELECT * FROM points WHERE unit=?',op.unit);
    if(body.startsWith('已经手动')) {status('暂缓');return '已暂缓并记录现场反馈；模拟点位显示'+(p.running?'运行':'停机')+'，请核对。';}
    if(body!=='确认') return '请明确回复「确认 '+op.id+'」、拒绝、暂缓或改成 3 号机。';
    // A confirmed target supersedes earlier conflicting proposals, even when
    // the unit already has the requested state. A draft alone changes nothing.
    run(`UPDATE ops SET status='已被后续确认取代'
         WHERE unit=? AND action<>? AND status IN ('待确认','暂缓')
           AND rowid < (SELECT rowid FROM ops WHERE id=?)`, op.unit, op.action, op.id);
    const target=Number(op.action==='启动');
    if(p.running===target) {status('已达目标');return '模拟点位已达目标，无需发令。';}
    run('INSERT INTO commands VALUES(?,CURRENT_TIMESTAMP)',op.id);
    run('UPDATE points SET running=?, sampled=CURRENT_TIMESTAMP WHERE unit=?',target,op.unit);
    status('模拟执行完成');
    return op.id+' 模拟后台已接收；模拟点位回读：'+op.unit+' 号机'+(get('SELECT running FROM points WHERE unit=?',op.unit).running?'运行':'停机')+'。';
  }
  db.exec('CREATE TABLE IF NOT EXISTS feedback(message TEXT PRIMARY KEY, content TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS polls(message TEXT PRIMARY KEY, op TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS decided_poll(message TEXT PRIMARY KEY, voter TEXT, accepted TEXT, seen TEXT, decided INTEGER)');
  db.exec('CREATE TABLE IF NOT EXISTS clarifications(sender TEXT PRIMARY KEY, prompt TEXT, request TEXT, until INTEGER)');
  const clarifications={
    read(){
      run('DELETE FROM clarifications WHERE until<=?',Date.now());
      return db.prepare('SELECT * FROM clarifications').all();
    },
    save(sender,entry){
      run('INSERT OR REPLACE INTO clarifications VALUES(?,?,?,?)',sender,entry.prompt,entry.request,entry.until);
    },
    remove(sender,prompt){
      return run('DELETE FROM clarifications WHERE sender=? AND prompt=?',sender,prompt).changes===1;
    }
  };
  db.exec('CREATE TABLE IF NOT EXISTS strategy_input(id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  function submitStrategy({id,unit,action,reason,expiresAt}){
    const deadline=Date.parse(expiresAt);
    if(typeof id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id) ||
       ![2,3].includes(unit) || !['启动','停止'].includes(action) ||
       typeof reason!=='string' || !reason.trim() || reason.length>1000 || !Number.isFinite(deadline))
      throw Error('Invalid strategy: expected id, unit, action, reason and expiresAt');
    const payload=JSON.stringify([unit,action,reason,deadline]);
    db.exec('BEGIN IMMEDIATE');
    try{
      const prior=get('SELECT payload FROM strategy_input WHERE id=?',id);
      if(prior && prior.payload!==payload) throw Error('Strategy ID already used with different data');
      if(!prior){
        if(deadline<=Date.now()) throw Error('Strategy expired');
        run('INSERT INTO strategy_input VALUES(?,?)',id,payload);
        const result=newStrategy(unit,action,reason,Math.floor(deadline/1000),id);
        run('INSERT INTO outbox VALUES(?,?)','strategy:'+id,result);
      }
      db.exec('COMMIT');
      return prior?'duplicate':'accepted';
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function proposalState(id){
    const op=get('SELECT status,expires FROM ops WHERE id=?',id);
    if(!op) return '未知';
    if(op.status==='待确认' && op.expires*1000<=Date.now()) return '已过期';
    return op.status;
  }
  return {strategy,submitStrategy,setting,clarifications,proposalState,
    restoreFirstSoloModeVote(){
      const state=setting();
      const records=db.prepare("SELECT substr(id,6) AS message FROM messages WHERE id LIKE 'mode:%'").all();
      if(state.revision===1 && records.length===1)
        run("INSERT OR IGNORE INTO decided_poll VALUES(?,'self',?,?,unixepoch())",records[0].message,state.mode,state.mode);
    },
    bindModePoll(message,revision){run('INSERT INTO mode_poll VALUES(?,?,unixepoch()+600)',message,revision);},
    notifyExpiredModePolls(){
      db.exec('BEGIN IMMEDIATE');
      try {
        run("INSERT OR IGNORE INTO outbox SELECT 'expired-mode:'||message, '未改变策略模式。当前策略模式：'||mode||'。' FROM mode_poll JOIN mode_setting USING(revision) WHERE expires<=unixepoch()");
        run('DELETE FROM mode_poll WHERE expires<=unixepoch()');
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    queueReply(body){
      run('INSERT INTO outbox VALUES(?,?)','delivery:'+randomUUID(),body);
    },
    pendingReplies(){return db.prepare('SELECT id, body FROM outbox ORDER BY rowid').all();},
    markReplySent(id){run('DELETE FROM outbox WHERE id=?',id);},
    pendingPolls(){return db.prepare("SELECT message FROM polls JOIN ops ON polls.op=ops.id WHERE status IN ('待确认','暂缓') AND expires > unixepoch() UNION ALL SELECT message FROM mode_poll WHERE revision=(SELECT revision FROM mode_setting WHERE id=1) AND expires>unixepoch() UNION SELECT message FROM decided_poll WHERE decided>unixepoch()-86400 ORDER BY message").all();},
    bindPoll(message,op){run('INSERT INTO polls VALUES(?,?)',message,op);},
    vote(message,choice,voter){
      const previous=get('SELECT * FROM decided_poll WHERE message=?',message);
      if(previous){
        if(!voter || voter!==previous.voter || !choice || previous.seen===choice) return null;
        db.exec('BEGIN IMMEDIATE');
        try{
          run('UPDATE decided_poll SET seen=? WHERE message=?',choice,message);
          const notice=MODES.includes(previous.accepted)
            ? '当前使用「'+setting().mode+'」。这轮模式选择已经结束，想换个模式的话，发送「改模式」就能重新选择。'
            : '这项操作已经处理过了。如需调整，请重新发起操作。';
          run('INSERT INTO outbox VALUES(?,?)','revote:'+randomUUID(),notice);
          db.exec('COMMIT');
          return notice;
        }catch(error){db.exec('ROLLBACK');throw error;}
      }
      const decision=voter?{message,choice,voter}:null;
      if(MODES.includes(choice)){
        const active=get('SELECT message FROM mode_poll WHERE message=? AND expires>unixepoch() AND revision=?',message,setting().revision);
        if(!active) return null;
        return this.handle({id:'mode:'+message,text:'切换到'+choice,operator:true},'',decision);
      }
      const poll=get('SELECT op FROM polls WHERE message=?',message);
      if(!poll || !['确认','拒绝'].includes(choice)) return null;
      return this.handle({id:'poll:'+message,text:choice+' '+poll.op,operator:true},'收到投票「'+(choice==='确认'?'确认操作':'取消操作')+'」。',decision);
    },
    handle(m, replyPrefix, decision){
    db.exec('BEGIN IMMEDIATE');
    try {
      const fresh=run('INSERT OR IGNORE INTO messages VALUES(?)',m.id).changes;
      const reply=fresh?route(m):null;
      if(fresh && !m.observation && m.text.startsWith('已经手动')) run('INSERT INTO feedback VALUES(?,?)',m.id,m.text+' '+(m.quoted||''));
      if(reply && decision) run('INSERT INTO decided_poll VALUES(?,?,?,?,unixepoch())',decision.message,decision.voter,decision.choice,decision.choice);
      if(reply && replyPrefix!==undefined) run('INSERT INTO outbox VALUES(?,?)',m.id,replyPrefix+reply);
      db.exec('COMMIT');return reply;
    } catch(e){db.exec('ROLLBACK');throw e;}
  }};
}
