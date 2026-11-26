import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Single test group per database. Every reply and simulated write is transactional.
export function createPlant(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS ops(id TEXT PRIMARY KEY, unit INTEGER, action TEXT, status TEXT, reason TEXT);
    CREATE TABLE IF NOT EXISTS points(unit INTEGER PRIMARY KEY, running INTEGER, sampled TEXT);
    CREATE TABLE IF NOT EXISTS commands(op TEXT PRIMARY KEY, submitted TEXT);
    INSERT OR IGNORE INTO points VALUES(2,0,CURRENT_TIMESTAMP),(3,0,CURRENT_TIMESTAMP);`);
  if (!db.prepare('PRAGMA table_info(ops)').all().some(column => column.name === 'expires')) {
    db.exec('ALTER TABLE ops ADD COLUMN expires INTEGER');
  }
  const run = (sql,...args) => db.prepare(sql).run(...args);
  const get = (sql,...args) => db.prepare(sql).get(...args);
  function draft(unit,action,reason) {
    const id = 'S'+randomUUID().slice(0,8);
    run("INSERT INTO ops(id,unit,action,status,reason,expires) VALUES(?,?,?,'待确认',?,unixepoch()+600)",id,unit,action,reason);
    return `[模拟 · 操作编号：${id}] ${action} ${unit} 号机。依据：${reason}。请在 10 分钟内确认。回复「确认 ${id}」，或引用本消息拒绝、修改、追问。`;
  }
  function strategy() {
    const p=get('SELECT * FROM points WHERE unit=2');
    if(p.running) return '模拟策略检查：2 号机已运行，无需启动。';
    return draft(2,'启动','样例预测显示下一小时负荷上升，当前 2 号机停机');
  }
  function route({text,quoted='',operator=false}) {
    const t=text.trim();
    const ids=[...new Set((t+' '+quoted).match(/S[0-9a-f]{8}\b/g)||[])];
    const op=ids.length===1 && get('SELECT * FROM ops WHERE id=?',ids[0]);
    const body=t.replace(/S[0-9a-f]{8}\b/g,'').trim();
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
    if(body.startsWith('为什么')) return op.id+' 的记录依据：'+op.reason;
    if(!operator) return '仅指定操作员可处理此操作。';
    if(op.status!=='待确认' && op.status!=='暂缓') return op.id+' 当前状态：'+op.status;
    const status=s=>run('UPDATE ops SET status=? WHERE id=?',s,op.id);
    if (!op.expires || op.expires <= Date.now()/1000) {
      status('已过期');
      return '操作编号 '+op.id+' 已过期，请重新发起操作。';
    }
    if(/^(暂缓|先别)/.test(body)) {status('暂缓');return '已暂缓 '+op.id+(/为什么/.test(body)?'。记录依据：'+op.reason:'');}
    if(body==='拒绝') {status('已拒绝');return '已拒绝 '+op.id;}
    if(/^(修改为|改成)\s*[23]\s*号机$/.test(body)) {status('已替换');return draft(+unit[1],op.action,'工程师修改了待确认操作的目标设备');}
    const p=get('SELECT * FROM points WHERE unit=?',op.unit);
    if(body.startsWith('已经手动')) {status('暂缓');return '已暂缓并记录现场反馈；模拟点位显示'+(p.running?'运行':'停机')+'，请核对。';}
    if(body!=='确认') return '请明确回复「确认 '+op.id+'」、拒绝、暂缓或改成 3 号机。';
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
  return {strategy,
    pendingReplies(){return db.prepare('SELECT id, body FROM outbox ORDER BY rowid').all();},
    markReplySent(id){run('DELETE FROM outbox WHERE id=?',id);},
    pendingPolls(){return db.prepare("SELECT message FROM polls JOIN ops ON polls.op=ops.id WHERE status IN ('待确认','暂缓') AND expires > unixepoch()").all();},
    bindPoll(message,op){run('INSERT INTO polls VALUES(?,?)',message,op);},
    vote(message,choice){
      const poll=get('SELECT op FROM polls WHERE message=?',message);
      if(!poll || !['确认','拒绝'].includes(choice)) return null;
      return this.handle({id:'poll:'+message,text:choice+' '+poll.op,operator:true},'收到投票「'+(choice==='确认'?'确认操作':'取消操作')+'」。');
    },
    handle(m, replyPrefix){
    db.exec('BEGIN IMMEDIATE');
    try {
      const fresh=run('INSERT OR IGNORE INTO messages VALUES(?)',m.id).changes;
      const reply=fresh?route(m):null;
      if(fresh && m.text.startsWith('已经手动')) run('INSERT INTO feedback VALUES(?,?)',m.id,m.text+' '+(m.quoted||''));
      if(reply && replyPrefix) run('INSERT INTO outbox VALUES(?,?)',m.id,replyPrefix+reply);
      db.exec('COMMIT');return reply;
    } catch(e){db.exec('ROLLBACK');throw e;}
  }};
}
