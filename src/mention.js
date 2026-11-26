// WhatsApp supplies actual mentions separately from the visible message text.
export function addressedText(body, mentionedIds, selfIds) {
  const mentions = mentionedIds.map(id => typeof id === 'string' ? id : id?._serialized);
  const target = mentions.find(id => id && selfIds.includes(id));
  if (!target) return null;
  const number = target.split('@')[0];
  return body.split(/\s+/u).map(word =>
    word.replace(/^@(\d+)(?!\d)/u, (match, id) => id === number ? '' : match)
  ).join(' ').trim();
}
