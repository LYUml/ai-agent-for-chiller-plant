// WhatsApp can emit message_create before sendMessage resolves with its ID.
export function createGroupMessages(send, plant) {
  const pending = new Set();
  return {
    async send(content, options) {
      const task = Promise.resolve().then(async () => {
        const message = await send(content, options);
        plant().rememberOutgoing(message.id._serialized);
        return message;
      });
      pending.add(task);
      try { return await task; }
      finally { pending.delete(task); }
    },
    async isOutgoing(id) {
      await Promise.allSettled([...pending]);
      return plant().isOutgoing(id);
    }
  };
}
