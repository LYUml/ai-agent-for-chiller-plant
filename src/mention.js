// WhatsApp supplies actual mentions separately from the visible message text.
export function addressedText(body, mentionedIds, selfIds) {
  const mentions = mentionedIds.map(id => typeof id === 'string' ? id : id?._serialized);
  const target = mentions.find(id => id && selfIds.includes(id));
  if (!target) return null;
  const aliases = new Set(selfIds.filter(Boolean).map(id => id.split('@')[0]));
  return body.replace(/@(\d+)/gu, (mention, number) =>
    aliases.has(number) ? '' : mention
  ).trim();
}
