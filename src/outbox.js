export async function flushReplies(plant, send) {
  for (const {id, body} of plant.pendingReplies()) {
    try {
      await send(body,id);
      plant.markReplySent(id);
      console.log('已发送投票回执', id);
    } catch (error) {
      console.error('投票回执待重试', id, error.message);
      break;
    }
  }
}

export async function deliverReply(plant, reply, send, makePoll) {
  const draft = reply.match(/^\[模拟 · 操作编号：(S[0-9a-f]{8})\] (启动|停止) ([23]) 号机/);
  if (draft) {
    const status = plant.proposalState(draft[1]);
    if (status !== '待确认') {
      await send('操作编号 '+draft[1]+' 当前状态：'+status+'。');
      return;
    }
  }
  try {
    await send(reply);
  } catch (error) {
    plant.queueReply(reply);
    console.error('文字回复待补发', error.message);
    return;
  }
  if (!draft) return;
  const [, id, action, unit] = draft;
  try {
    const title = '模拟：'+action+' '+unit+' 号机？（操作编号：'+id+'）';
    const sent = await send(makePoll(title, ['确认操作','取消操作']));
    plant.bindPoll(sent.id._serialized, id);
    console.log(id, '已发送投票', sent.id._serialized);
  } catch (error) {
    plant.queueReply('操作编号 '+id+' 的投票未能核实。可在原有效期内回复「确认 '+id+'」或「拒绝 '+id+'」。');
    console.error(id, '投票发送或登记失败', error.message);
  }
}
