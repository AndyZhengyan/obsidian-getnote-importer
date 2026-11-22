export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeBearerToken(token: string): string {
  const trimmed = token.trim();
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

export function parseJsonPreservingIds(text: string): unknown {
  let safe = text.replace(
    /"(id|id_alias|note_id|prime_id|parent_id|follow_id|live_id|topic_id|directory_id|post_id|post_id_alias)"\s*:\s*(\d+)/g,
    '"$1":"$2"'
  );
  safe = safe.replace(/"children_ids"\s*:\s*\[([^\]]*)\]/g, (_match, body: string) => {
    const normalized = body
      .split(',')
      .map(item => {
        const trimmed = item.trim();
        return /^\d{15,}$/.test(trimmed) ? `"${trimmed}"` : item;
      })
      .join(',');
    return `"children_ids":[${normalized}]`;
  });
  return JSON.parse(safe);
}

export function normalizeTopicMemberships(value: unknown): Array<{ id: string; name: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).flatMap(topic => {
    const id = topic.id ?? topic.topic_id;
    if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim()
      || typeof topic.name !== 'string' || !topic.name.trim()) return [];
    return [{ id: String(id), name: topic.name }];
  });
}

export function parseJsonObjectOrEmpty(text: string): Record<string, unknown> {
  try {
    const value = parseJsonPreservingIds(text || '{}');
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

export async function waitForRetryDelay(signal?: AbortSignal): Promise<void> {
  await new Promise<void>(resolve => {
    const timer = window.setTimeout(() => resolve(), 3000);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
