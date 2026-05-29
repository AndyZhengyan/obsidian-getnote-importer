import type { GetNoteNote, Attachment } from '../types';
import { t } from '../i18n';

export const GETNOTE_LIST_LIMIT = 20;

function safeJsonParse(text: string): unknown {
  let safe = text.replace(
    /"(id|note_id|parent_id|follow_id|live_id|topic_id|post_id|post_id_alias)"\s*:\s*(\d+)/g,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBearerToken(token: string): string {
  const trimmed = token.trim();
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function buildHeaders(token: string, clientId: string): Record<string, string> {
  return {
    Authorization: normalizeBearerToken(token),
    'X-Client-ID': clientId,
  };
}

function normalizeListData(value: unknown): { notes: GetNoteNote[]; hasMore: boolean } {
  if (!isRecord(value)) return { notes: [], hasMore: false };
  const data = isRecord(value.data) ? value.data : value;
  // Handle not_member error: server returns { success: true, data: { msg: "rejected" } }
  if (data.msg === 'rejected') {
    throw new Error(t('error.openApiNotMember'));
  }
  const notes = Array.isArray(data.notes) ? data.notes as GetNoteNote[] : [];
  const hasMore = Boolean(data.has_more ?? data.hasMore);
  return { notes, hasMore };
}

function normalizeAudio(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  const original = value.original;
  if (typeof original === 'string') return original;
  const firstTextValue = Object.values(value).find((item): item is string => typeof item === 'string');
  return firstTextValue;
}

function normalizeNoteDetailData(value: unknown): Partial<GetNoteNote> | null {
  if (!isRecord(value)) return null;
  const nestedNote = isRecord(value.note) ? value.note : null;
  const source = nestedNote ?? value;
  const detail = { ...source } as Partial<GetNoteNote>;
  const attachments = (value.attachments ?? source.attachments) as Attachment[] | undefined;
  const audio = normalizeAudio(value.audio ?? source.audio);
  const childrenIds = Array.isArray(source.children_ids)
    ? source.children_ids.map(id => String(id))
    : undefined;
  return { ...detail, attachments, audio, children_ids: childrenIds };
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

function parseErrorBody(text: string): Record<string, unknown> {
  try {
    const value = safeJsonParse(text) as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

async function handleRateLimit<T>(
  url: string,
  options: RequestInit,
  res: Response,
  retries: number,
  signal?: AbortSignal
): Promise<T> {
  const text = await res.text().catch(() => '');
  const json = parseErrorBody(text);
  const errObj = (json.error ?? json) as Record<string, unknown>;
  const reason = errObj.reason as string | undefined;
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
  if (res.status === 401) throw new Error(t('error.invalidCredentials'));
  if (res.status === 429) return handleRateLimit<T>(url, options, res, retries, signal);
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text();
    const json = safeJsonParse(text) as Record<string, unknown>;
    if (res.status === 403 && json.success === false) {
      const errObj = (json.error ?? json) as Record<string, unknown>;
      const code = errObj?.code as number | undefined;
      if (code === 10201) throw new Error(t('error.openApiNotMember'));
    }
    throw new Error(t('error.apiServerError', { status: res.status }));
  }
  const text = await res.text();
  const json = safeJsonParse(text) as Record<string, unknown>;
  // Handle HTTP 200 with business-level errors
  if (json.success === false) {
    const errObj = (json.error ?? json) as Record<string, unknown>;
    const code = errObj?.code as number | undefined;
    if (code === 10201) throw new Error(t('error.openApiNotMember'));
    if (code === 10202 && retries > 0) {
      await waitForRetry(signal);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return apiRequest(url, options, retries - 1, signal);
    }
    const rawMsg = (errObj?.message as string) ?? '';
    throw new Error(rawMsg ? t('error.apiGenericWithMsg', { msg: rawMsg }) : t('error.apiGeneric'));
  }
  return json as T;
}

export interface FetchNotesOptions {
  token: string;
  clientId: string;
  sinceId?: string;
  limit?: number;
  signal?: AbortSignal;
  topicIds?: string[];
}

export interface CreateNoteOptions {
  token: string;
  clientId: string;
  title: string;
  content: string;
  noteType: string;
  tags?: string[];
  signal?: AbortSignal;
}

export interface SubscribedTopic {
  topic_id: string;
  name: string;
}

export interface Blogger {
  follow_id: string;
  name?: string;
}

export interface BloggerContent {
  post_id_alias: string;
  title?: string;
  content?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
}

export async function fetchNotes(options: FetchNotesOptions): Promise<{ notes: GetNoteNote[]; hasMore: boolean }> {
  const { token, clientId, sinceId = '0', signal } = options;
  const params = new URLSearchParams();
  params.set('since_id', sinceId);
  const url = `https://openapi.biji.com/open/api/v1/resource/note/list?${params.toString()}`;
  const data = await apiRequest<{ data?: { notes: GetNoteNote[]; has_more: boolean } }>(
    url, { method: 'GET', headers: buildHeaders(token, clientId) }, 3, signal
  );
  return normalizeListData(data);
}

function readArray(value: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function readHasMore(value: Record<string, unknown>): boolean {
  return Boolean(value.has_more ?? value.hasMore);
}

function normalizeData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return isRecord(value.data) ? value.data : value;
}

function normalizeTopic(value: unknown): SubscribedTopic | null {
  if (!isRecord(value)) return null;
  const id = value.topic_id ?? value.id ?? value.id_alias;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return {
    topic_id: String(id),
    name: typeof value.name === 'string' ? value.name : '',
  };
}

function normalizeBlogger(value: unknown): Blogger | null {
  if (!isRecord(value)) return null;
  const id = value.follow_id ?? value.id ?? value.watch_id;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return {
    follow_id: String(id),
    name: typeof value.name === 'string' ? value.name : typeof value.nickname === 'string' ? value.nickname : undefined,
  };
}

function normalizeContent(value: unknown): BloggerContent | null {
  if (!isRecord(value)) return null;
  const id = value.post_id_alias ?? value.post_id ?? value.id_alias ?? value.id;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return {
    post_id_alias: String(id),
    title: typeof value.title === 'string' ? value.title : typeof value.post_name === 'string' ? value.post_name : undefined,
    content: typeof value.content === 'string' ? value.content : typeof value.post_cleaned_summary === 'string' ? value.post_cleaned_summary : undefined,
    summary: typeof value.summary === 'string' ? value.summary : typeof value.post_summary === 'string' ? value.post_summary : undefined,
    created_at: typeof value.created_at === 'string' ? value.created_at : typeof value.post_create_time === 'string' ? value.post_create_time : undefined,
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : typeof value.edit_time === 'string' ? value.edit_time : undefined,
  };
}

function bloggerContentToNote(content: BloggerContent, topic: SubscribedTopic, blogger: Blogger): GetNoteNote {
  const created = content.created_at ?? '';
  const updated = content.updated_at ?? created;
  const body = content.content || content.summary || '';
  return {
    id: `blogger:${topic.topic_id}:${content.post_id_alias}`,
    note_id: `blogger_${content.post_id_alias}`,
    title: content.title ?? '',
    content: body,
    note_type: 'blogger_post',
    source: 'blogger',
    tags: [
      ...(topic.name ? [{ name: topic.name }] : []),
      ...(blogger.name ? [{ name: blogger.name }] : []),
    ],
    created_at: created,
    updated_at: updated,
  };
}

export async function fetchSubscribedTopics(token: string, clientId: string, signal?: AbortSignal): Promise<SubscribedTopic[]> {
  const topics: SubscribedTopic[] = [];
  let page = 1;
  while (true) {
    const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/subscribe/list?page=${page}`;
    const data = await apiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
    const source = normalizeData(data);
    topics.push(...readArray(source, ['topics', 'list', 'items']).map(normalizeTopic).filter((item): item is SubscribedTopic => Boolean(item)));
    if (!readHasMore(source)) break;
    page++;
  }
  return topics;
}

async function fetchTopicBloggers(topicId: string, token: string, clientId: string, signal?: AbortSignal): Promise<Blogger[]> {
  const bloggers: Blogger[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ topic_id: topicId, page: String(page) });
    const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/bloggers?${params.toString()}`;
    const data = await apiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
    const source = normalizeData(data);
    bloggers.push(...readArray(source, ['bloggers', 'list', 'items']).map(normalizeBlogger).filter((item): item is Blogger => Boolean(item)));
    if (!readHasMore(source)) break;
    page++;
  }
  return bloggers;
}

async function fetchBloggerContents(topicId: string, blogger: Blogger, token: string, clientId: string, signal?: AbortSignal): Promise<BloggerContent[]> {
  const contents: BloggerContent[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ topic_id: topicId, follow_id: blogger.follow_id, page: String(page) });
    const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/blogger/contents?${params.toString()}`;
    const data = await apiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
    const source = normalizeData(data);
    contents.push(...readArray(source, ['contents', 'posts', 'list', 'items']).map(normalizeContent).filter((item): item is BloggerContent => Boolean(item)));
    if (!readHasMore(source)) break;
    page++;
  }
  return contents;
}

async function fetchBloggerContentDetail(topicId: string, content: BloggerContent, token: string, clientId: string, signal?: AbortSignal): Promise<BloggerContent> {
  const params = new URLSearchParams({ topic_id: topicId, post_id: content.post_id_alias });
  const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/blogger/content/detail?${params.toString()}`;
  const data = await apiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
  const detail = normalizeContent(normalizeData(data));
  return detail ? { ...content, ...detail } : content;
}

export async function fetchSubscribedKnowledgeNotes(options: FetchNotesOptions): Promise<GetNoteNote[]> {
  const { token, clientId, signal } = options;
  const notes: GetNoteNote[] = [];
  const topics = await fetchSubscribedTopics(token, clientId, signal);
  const targetIds = options.topicIds;
  const filteredTopics = targetIds ? topics.filter(t => targetIds.includes(t.topic_id)) : topics;
  for (const topic of filteredTopics) {
    const bloggers = await fetchTopicBloggers(topic.topic_id, token, clientId, signal);
    for (const blogger of bloggers) {
      const contents = await fetchBloggerContents(topic.topic_id, blogger, token, clientId, signal);
      for (const content of contents) {
        const detail = await fetchBloggerContentDetail(topic.topic_id, content, token, clientId, signal);
        notes.push(bloggerContentToNote(detail, topic, blogger));
      }
    }
  }
  return notes;
}

export async function fetchNoteDetail(
  id: string,
  token: string,
  clientId: string,
  signal?: AbortSignal
): Promise<Partial<GetNoteNote>> {
  const url = `https://openapi.biji.com/open/api/v1/resource/note/detail?id=${encodeURIComponent(id)}`;
  const data = await apiRequest<{
    success?: boolean;
    data?: unknown;
    error?: { message: string };
  }>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
  const detailData = (data.data ?? data) as Record<string, unknown>;
  if (data.success === false || !detailData) {
    throw new Error((data.error as { message?: string })?.message ?? t('error.fetchNoteDetailFailed'));
  }
  const noteDetail = normalizeNoteDetailData(detailData);
  if (!noteDetail) throw new Error(t('error.fetchNoteDetailFailed'));
  return noteDetail;
}

function extractCreatedNoteId(value: unknown): string {
  if (!isRecord(value)) return '';
  const data = isRecord(value.data) ? value.data : value;
  const note = isRecord(data.note) ? data.note : data;
  const id = note.note_id ?? note.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

export async function createNote(options: CreateNoteOptions): Promise<{ noteId: string; detailId?: string }> {
  const url = 'https://openapi.biji.com/open/api/v1/resource/note/save';
  const data = await apiRequest<Record<string, unknown>>(
    url,
    {
      method: 'POST',
      headers: {
        ...buildHeaders(options.token, options.clientId),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: options.title,
        content: options.content,
        note_type: options.noteType,
        source: 'app',
        tags: options.tags ?? [],
      }),
    },
    1,
    options.signal
  );
  const noteId = extractCreatedNoteId(data);
  if (!noteId) throw new Error(t('error.createNoteFailed'));
  return { noteId };
}
