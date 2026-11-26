import language from '../kb/language.json' with {type:'json'};
// At most one outstanding clarification per sender in the configured group.
export function createClarifier(interpret, ask, store) {
  const pending = new Map((store?.read() ?? []).map(entry=>[entry.sender,entry]));
  return async function clarify(m) {
    const sender = m.author;
    if (!sender) return null;
    for (const [id, item] of pending) if (item.until <= Date.now()) {
      pending.delete(id);
      if (item.prompt) store?.remove(id,item.prompt);
    }
    const item = pending.get(sender);
    if (m.hasQuotedMsg) {
      if (!item?.prompt) return null;
      const quoted = await m.getQuotedMessage();
      if (quoted?.id._serialized !== item.prompt || pending.get(sender)!==item) return null;
      const answer = m.body.trim();
      if (!['需要','不用'].includes(answer)) return null;
      pending.delete(sender);
      if (store && !store.remove(sender,item.prompt)) return null;
      return item.until>Date.now() && answer === '需要' ? item.request : null;
    }
    if (item || m.mentionedIds?.length || m.isForwarded || m.body.includes('@')) return null;
    if (!language.cues.some(cue=>m.body.includes(cue))) return null;
    const entry = {until: Date.now()+300000};
    pending.set(sender,entry);
    try {
      const request = await interpret(m.body);
      if (typeof request!=='string' || !/^(查询|启动|停止) [23] 号机$|^报告$/u.test(request)) {
        pending.delete(sender);
        return null;
      }
      entry.request = request;
      const sent = await ask(sender,request);
      entry.prompt = sent.id._serialized;
      store?.save(sender,entry);
    } catch(error) {
      pending.delete(sender);
      throw error;
    }
    return null;
  };
}
