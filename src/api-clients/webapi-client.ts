import type { GetNoteNote, Attachment } from '../types';
import { t } from '../i18n';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBearerToken(token: string): string {
  const trimmed = token.trim();
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: normalizeBearerToken(token),
    'x-request-id': String(Date.now()),
  };
}

function parseWebApiListResponse(value: unknown): { notes: GetNoteNote[]; hasMore: boolean } {
  if (!isRecord(value)) return { notes: [], hasMore: false };
  const c = value.c;
  if (!isRecord(c)) return { notes: [], hasMore: false };
  const list = c.list;
  if (!Array.isArray(list)) return { notes: [], hasMore: false };
  const hasMore = Boolean(c.has_more);
  // Map Web API fields to GetNoteNote
  const notes: GetNoteNote[] = list.map((n): GetNoteNote => ({
    id: n.id as string,
    note_id: n.note_id as string,
    parent_id: (n.parent_id as string) ?? undefined,
    children_count: typeof n.children_count === 'number'
      ? n.children_count
      : typeof n.sub_note_count === 'number'
        ? n.sub_note_count
        : undefined,
    children_ids: Array.isArray(n.children_ids) ? n.children_ids.map((id: unknown) => String(id)) : undefined,
    is_child_note: typeof n.is_child_note === 'boolean' ? n.is_child_note : undefined,
    title: (n.title as string) ?? '',
    content: (n.content as string) ?? '',
    note_type: (n.note_type as string) ?? 'plain_text',
    source: (n.source as string) ?? 'web',
    tags: (n.tags as { name: string }[]) ?? [],
    created_at: (n.created_at as string) ?? '',
    updated_at: (n.updated_at as string) ?? '',
    attachments: (n.attachments as Attachment[]) ?? [],
    audio: (n.audio as string) ?? undefined,
    prime_id: (n.prime_id as string) ?? undefined,
  }));
  return { notes, hasMore };
}

function normalizeNoteDetailData(value: unknown): Partial<GetNoteNote> | null {
  if (!isRecord(value)) return null;
  // Guard: if value has a list property it is a list response, not a note detail.
  if ('list' in (value as Record<string, unknown>)) return null;
  const nestedNote = isRecord(value.note) ? value.note : null;
  const source = nestedNote ?? value;
  const detail = { ...source } as Partial<GetNoteNote>;
  const attachments = (value.attachments ?? source.attachments) as Attachment[] | undefined;
  const audio = typeof (value.audio ?? source.audio) === 'string' ? (value.audio ?? source.audio) as string : undefined;
  const childrenIds = Array.isArray(source.children_ids)
    ? source.children_ids.map(id => String(id))
    : undefined;
  return { ...detail, attachments, audio, children_ids: childrenIds };
}

function tryParseJsonObject(text: string): Record<string, unknown> {
  try {
    const value = safeJsonParse(text || '{}') as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function safeJsonParse(text: string): unknown {
  const safe = text.replace(
    /"(id|note_id|parent_id|follow_id|live_id)"\s*:\s*(\d+)/g,
    '"$1":"$2"'
  );
  return JSON.parse(safe);
}

async function waitForRetry(signal?: AbortSignal): Promise<void> {
  await new Promise<void>(resolve => {
    const timer = window.setTimeout(() => resolve(), 3000);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function handleRateLimit<T>(
  url: string,
  options: RequestInit,
  res: Response,
  retries: number,
  signal?: AbortSignal
): Promise<T> {
  const text = await res.text().catch(() => '');
  const json = tryParseJsonObject(text);
  const err = (json.error ?? json) as Record<string, unknown>;
  const reason = err.reason as string | undefined;
  if (reason === 'quota_day' || reason === 'quota_month') {
    throw new Error(t('error.quotaExceeded'));
  }
  if (retries > 0) {
    await waitForRetry(signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return apiRequest(url, options, retries - 1, signal);
  }
  throw new Error(t('error.rateLimited'));
}

async function apiRequest<T>(url: string, options: RequestInit, retries = 1, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const res = await fetch(url, { ...options, signal });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => '');
    const json = tryParseJsonObject(text);
    const msg = (json.message as string) ?? '';
    if (msg === 'LoginRequired') throw new Error(t('error.webApiLoginRequired'));
    throw new Error(t('error.webApiForbidden'));
  }
  if (res.status === 429) return handleRateLimit<T>(url, options, res, retries, signal);
  if (res.status < 200 || res.status >= 300) {
    if (res.status >= 500 && retries > 0) {
      await waitForRetry(signal);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return apiRequest(url, options, retries - 1, signal);
    }
    throw new Error(t('error.apiServerError', { status: res.status }));
  }
  const text = await res.text();
  const json = safeJsonParse(text) as Record<string, unknown>;
  if (json.success === false) {
    const err = (json.error ?? json) as Record<string, unknown>;
    const errMsg = (err?.message as string) ?? (json.message as string) ?? '';
    throw new Error(errMsg ? t('error.apiGenericWithMsg', { msg: errMsg }) : t('error.apiGeneric'));
  }
  return json as T;
}

export interface FetchNotesOptions {
  token: string;
  sinceId?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface CreateNoteOptions {
  token: string;
  title: string;
  content: string;
  noteType: string;
  tags?: string[];
  signal?: AbortSignal;
}

export async function fetchNotes(options: FetchNotesOptions): Promise<{ notes: GetNoteNote[]; hasMore: boolean }> {
  const { token, sinceId = '0', limit, signal } = options;
  const params = new URLSearchParams();
  params.set('limit', String(limit ?? 20));
  params.set('since_id', sinceId === '0' ? '' : sinceId);
  params.set('sort', 'create_desc');
  const url = `https://get-notes.luojilab.com/voicenotes/web/notes?${params.toString()}`;
  const data = await apiRequest<{ h?: unknown; c?: unknown }>(url, {
    method: 'GET',
    headers: buildHeaders(token),
  }, 3, signal);
  return parseWebApiListResponse(data);
}

export async function fetchNoteDetail(
  detailId: string,
  token: string,
  signal?: AbortSignal
): Promise<Partial<GetNoteNote>> {
  const url = `https://get-notes.luojilab.com/voicenotes/web/notes/${encodeURIComponent(detailId)}`;
  const data = await apiRequest<{ h?: unknown; c?: unknown; message?: string }>(url, {
    method: 'GET',
    headers: buildHeaders(token),
  }, 2, signal);
  // Web API detail: data is in .c, not .data
  if (data.message) {
    if (data.message === 'LoginRequired') throw new Error(t('error.webApiLoginRequired'));
    const rawMsg = data.message as string;
    throw new Error(rawMsg ? t('error.apiGenericWithMsg', { msg: rawMsg }) : t('error.apiGeneric'));
  }
  const c = data.c;
  if (!isRecord(c)) throw new Error(t('error.fetchNoteDetailFailed'));
  const noteDetail = normalizeNoteDetailData(c);
  // noteDetail.note_id is required — throw if missing (e.g. error response body)
  if (!noteDetail || !noteDetail.note_id) throw new Error(t('error.fetchNoteDetailFailed'));
  return noteDetail;
}
export async function fetchNoteChildren(
  parentPrimeId: string,
  token: string,
  signal?: AbortSignal
): Promise<GetNoteNote[]> {
  const notes: GetNoteNote[] = [];
  let sinceId = '0';

  while (true) {
    const params = new URLSearchParams();
    params.set('limit', '20');
    params.set('since_id', sinceId === '0' ? '' : sinceId);
    params.set('sort', 'create_desc');
    const url = `https://get-notes.luojilab.com/voicenotes/web/notes/${encodeURIComponent(parentPrimeId)}/children?${params.toString()}`;
    const data = await apiRequest<{ h?: unknown; c?: unknown }>(url, {
      method: 'GET',
      headers: buildHeaders(token),
    }, 2, signal);
    const page = parseWebApiListResponse(data);
    notes.push(...page.notes);
    if (!page.hasMore || page.notes.length === 0) break;
    sinceId = page.notes[page.notes.length - 1].note_id;
  }

  return notes;
}

function normalizeCreateContent(content: string): string {
  const trimmed = content.replace(/\s+$/g, '');
  return trimmed ? `${trimmed}\n\n` : '';
}

function buildWebJsonContent(content: string): string {
  const normalized = normalizeCreateContent(content);
  const textLines = normalized.replace(/\n+$/g, '').split('\n').filter(line => line.length > 0);
  const paragraphs: Array<{
    type: string;
    attrs: { textAlign: null };
    content?: Array<{ type: string; text: string }>;
  }> = textLines.map(line => ({
    type: 'paragraph',
    attrs: { textAlign: null },
    content: [{ type: 'text', text: line }],
  }));
  paragraphs.push({
    type: 'paragraph',
    attrs: { textAlign: null },
  });
  return JSON.stringify({ type: 'doc', content: paragraphs });
}

function extractCreatedNoteIds(value: unknown): { noteId: string; detailId?: string } {
  if (!isRecord(value)) return { noteId: '' };
  const source = isRecord(value.c)
    ? value.c
    : isRecord(value.data)
      ? value.data
      : value;
  const id = source.note_id ?? source.id;
  const primeId = source.prime_id;
  return {
    noteId: typeof id === 'string' || typeof id === 'number' ? String(id) : '',
    detailId: typeof primeId === 'string' || typeof primeId === 'number' ? String(primeId) : undefined,
  };
}

export async function createNote(options: CreateNoteOptions): Promise<{ noteId: string; detailId?: string }> {
  const content = normalizeCreateContent(options.content);
  const data = await apiRequest<{ h?: unknown; c?: unknown; data?: unknown }>(
    'https://get-notes.luojilab.com/voicenotes/web/notes',
    {
      method: 'POST',
      headers: {
        ...buildHeaders(options.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: options.title,
        content,
        json_content: buildWebJsonContent(content),
        entry_type: 'manual',
        note_type: options.noteType,
        source: 'web',
        tags: options.tags ?? [],
      }),
    },
    1,
    options.signal
  );
  const { noteId, detailId } = extractCreatedNoteIds(data);
  if (!noteId) throw new Error(t('error.createNoteFailed'));
  return { noteId, detailId };
}
