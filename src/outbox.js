export async function flushReplies(plant, send) {
  for (const {id, body} of plant.pendingReplies()) {
    try {
      await send(body);
      plant.markReplySent(id);
      console.log('已发送投票回执', id);
    } catch (error) {
      console.error('投票回执待重试', id, error.message);
      break;
    }
  }
}
