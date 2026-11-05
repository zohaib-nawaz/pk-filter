const MEDIA_SCHEMA_TYPES = new Set(['VideoObject', 'AudioObject', 'MediaObject']);
const MAX_NODES = 500;

function isMediaNode(record: Record<string, unknown>): boolean {
  const type = record['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((value) => typeof value === 'string' && MEDIA_SCHEMA_TYPES.has(value));
}

export function mediaUrlsFromJsonLd(text: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const urls: string[] = [];
  const queue: unknown[] = [data];
  for (let visited = 0; queue.length > 0 && visited < MAX_NODES; visited += 1) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (!node || typeof node !== 'object') {
      continue;
    }
    const record = node as Record<string, unknown>;
    if (isMediaNode(record) && typeof record.contentUrl === 'string') {
      urls.push(record.contentUrl);
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }
  return urls;
}
