import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

// Keep the same locations used by earlier versions started from the project root.
export const authDirectory = fileURLToPath(new URL('../.wwebjs_auth/', import.meta.url));
export const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));

export function groupDatabasePath(groupId) {
  if (!groupId.endsWith('@g.us')) throw new Error('Expected a WhatsApp group ID');
  return join(dataDirectory, groupId.replace(/[^\w-]/g, '_') + '.sqlite');
}
