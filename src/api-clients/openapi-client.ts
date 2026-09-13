import type { GetNoteNote, Attachment, LinkOriginal, RecallSearchResult, SubscribedTopic, ApiQuotaState } from '../types';
import { t } from '../i18n';
import { isRecord, normalizeBearerToken, parseJsonObjectOrEmpty, parseJsonPreservingIds, waitForRetryDelay } from './api-client-utils';

export const GETNOTE_LIST_LIMIT = 20;

class FatalOpenApiError extends Error {}

// Module-level quota tracker. Updated before throwing quota-day/month errors so
// the calling layer can persist it via Settings.lastQuotaState.
let lastQuota: ApiQuotaState = { exhausted: false };
export function getLastQuotaState(): ApiQuotaState {
  return lastQuota;
}
export function resetQuotaState(): void {
  lastQuota = { exhausted: false };
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
    throw new FatalOpenApiError(t('error.openApiNotMember'));
  }
  const notes = Array.isArray(data.notes) ? data.notes as GetNoteNote[] : [];
  const hasMore = Boolean(data.has_more ?? data.hasMore);
  return { notes, hasMore };
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function normalizeRecallResults(value: unknown): RecallSearchResult[] {
  if (!isRecord(value)) return [];
  const data = normalizeData(value);
  const rawResults = readArray(data, ['results', 'list', 'notes']);
  const normalized = rawResults
    .map((raw): RecallSearchResult | null => {
      if (!isRecord(raw)) return null;
      const source = isRecord(raw.note) ? raw.note : raw;
      const noteId = stringValue(source.note_id ?? source.id ?? source.resource_id ?? raw.note_id ?? raw.id);
      if (!noteId) return null;
      const title = stringValue(source.title ?? raw.title);
      const content = stringValue(source.content ?? source.snippet ?? source.summary ?? raw.content ?? raw.snippet);
      const noteType = stringValue(source.note_type ?? raw.note_type) || 'plain_text';
      const updatedAt = stringValue(source.updated_at ?? raw.updated_at);
      const createdAt = stringValue(source.created_at ?? raw.created_at);
      const score = typeof raw.score === 'number'
        ? raw.score
        : typeof source.score === 'number'
          ? source.score
          : undefined;
      return {
        note_id: noteId,
        title,
        content,
        note_type: noteType,
        ...(updatedAt ? { updated_at: updatedAt } : {}),
        ...(createdAt ? { created_at: createdAt } : {}),
        ...(score !== undefined ? { score } : {}),
      };
    })
    .filter((result): result is RecallSearchResult => Boolean(result));
  const seenNoteIds = new Set<string>();
  return normalized.filter(result => {
    if (seenNoteIds.has(result.note_id)) return false;
    seenNoteIds.add(result.note_id);
    return true;
  });
}

function normalizeAudio(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  const original = value.original;
  if (typeof original === 'string') return original;
  const firstTextValue = Object.values(value).find((item): item is string => typeof item === 'string');
  return firstTextValue;
}

function normalizeLinkOriginal(value: unknown): LinkOriginal | undefined {
  if (!isRecord(value)) return undefined;
  const content = typeof value.content === 'string' ? value.content.trim() : '';
  if (!content) return undefined;
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : undefined;
  const url = typeof value.url === 'string' && value.url.trim() ? value.url.trim() : undefined;
  return { ...(title ? { title } : {}), ...(url ? { url } : {}), content };
}

function normalizeNoteDetailData(value: unknown): Partial<GetNoteNote> | null {
  if (!isRecord(value)) return null;
  const nestedNote = isRecord(value.note) ? value.note : null;
  const source = nestedNote ?? value;
  const detail = { ...source } as Partial<GetNoteNote>;
  const attachments = (source.attachments ?? nestedNote?.attachments ?? value.attachments) as Attachment[] | undefined;
  const audio = normalizeAudio(value.audio ?? source.audio ?? nestedNote?.audio);
  const linkOriginal = normalizeLinkOriginal(source.web_page ?? nestedNote?.web_page ?? value.web_page);
  const childrenIds = Array.isArray(source.children_ids)
    ? source.children_ids.map(id => String(id))
    : undefined;
  return { ...detail, attachments, audio, linkOriginal, children_ids: childrenIds };
}

function parseErrorBody(text: string): Record<string, unknown> {
  return parseJsonObjectOrEmpty(text);
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
    lastQuota = { exhausted: true, reason, checkedAt: Date.now() };
    throw new FatalOpenApiError(t('error.quotaExceeded'));
  }
  if (retries > 0) {
    await waitForRetryDelay(signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return apiRequest(url, options, retries - 1, signal);
  }
  throw new Error(t('error.rateLimited'));
}

async function apiRequest<T>(url: string, options: RequestInit, retries = 1, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const res = await fetch(url, { ...options, signal });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (res.status === 401) throw new FatalOpenApiError(t('error.invalidCredentials'));
  if (res.status === 429) return handleRateLimit<T>(url, options, res, retries, signal);
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text();
    const json = parseJsonPreservingIds(text) as Record<string, unknown>;
    if (res.status === 403 && json.success === false) {
      const errObj = (json.error ?? json) as Record<string, unknown>;
      const code = errObj?.code as number | undefined;
      if (code === 10201) throw new FatalOpenApiError(t('error.openApiNotMember'));
    }
    throw new Error(t('error.apiServerError', { status: res.status }));
  }
  const text = await res.text();
  const json = parseJsonPreservingIds(text) as Record<string, unknown>;
  // Handle HTTP 200 with business-level errors
  if (json.success === false) {
    const errObj = (json.error ?? json) as Record<string, unknown>;
    const code = errObj?.code as number | undefined;
    if (code === 10201) throw new FatalOpenApiError(t('error.openApiNotMember'));
    if (code === 10202 && retries > 0) {
      await waitForRetryDelay(signal);
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
  createdTopicIds?: string[];
  bloggerIds?: string[];
  selectedNoteIds?: string[];
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

export interface AddNotesToKnowledgeBaseOptions {
  token: string; clientId: string; topicId: string; noteIds: string[]; signal?: AbortSignal;
}

export interface Blogger {
  follow_id: string;
  name?: string;
}

interface BloggerContent {
  post_id_alias: string;
  title?: string;
  content?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
}

const KNOWLEDGE_API_TIMEOUT_MS = 10_000;

async function knowledgeApiRequest<T>(
  url: string,
  options: RequestInit,
  retries: number,
  signal?: AbortSignal
): Promise<T> {
  const timeoutController = new AbortController();
  let timeoutId: number | undefined;
  const abortRequest = () => timeoutController.abort();
  signal?.addEventListener('abort', abortRequest, { once: true });
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        timeoutController.abort();
        reject(new DOMException('Timed out', 'TimeoutError'));
      }, KNOWLEDGE_API_TIMEOUT_MS);
    });
    return await Promise.race([
      apiRequest<T>(url, options, retries, timeoutController.signal),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortRequest);
  }
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

export async function fetchRecallSearch(options: {
  query: string;
  token: string;
  clientId: string;
  topK?: number;
  signal?: AbortSignal;
}): Promise<RecallSearchResult[]> {
  const url = 'https://openapi.biji.com/open/api/v1/resource/recall';
  const body = JSON.stringify({
    query: options.query,
    top_k: options.topK ?? 10,
  });
  const data = await apiRequest<Record<string, unknown>>(
    url,
    {
      method: 'POST',
      headers: {
        ...buildHeaders(options.token, options.clientId),
        'Content-Type': 'application/json',
      },
      body,
    },
    2,
    options.signal
  );
  return normalizeRecallResults(data);
}

function readArray(value: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function readHasMore(value: Record<string, unknown>): boolean {
  return Boolean(value.has_more ?? value.hasMore ?? value.has_next ?? value.hasNext);
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
    name: typeof value.name === 'string'
      ? value.name
      : typeof value.account_name === 'string'
        ? value.account_name
      : typeof value.nickname === 'string'
        ? value.nickname
        : undefined,
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
    topic_id: topic.topic_id,
    tags: [
      ...(topic.name ? [{ name: topic.name }] : []),
      ...(blogger.name ? [{ name: blogger.name }] : []),
    ],
    created_at: created,
    updated_at: updated,
  };
}

export async function fetchSubscribedTopics(
  token: string,
  clientId: string,
  signal?: AbortSignal,
  sources: Array<NonNullable<SubscribedTopic['source']>> = ['created', 'subscribed']
): Promise<SubscribedTopic[]> {
  const topics: SubscribedTopic[] = [];
  for (const sourceType of sources) {
    let page = 1;
    while (true) {
      const endpoint = sourceType === 'created' ? 'list' : 'subscribe/list';
      const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/${endpoint}?page=${page}`;
      const data = await knowledgeApiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
      const source = normalizeData(data);
      for (const topic of readArray(source, ['topics', 'list', 'items']).map(normalizeTopic).filter((item): item is SubscribedTopic => Boolean(item))) {
        if (!topics.some(existing => existing.topic_id === topic.topic_id)) topics.push({ ...topic, source: sourceType });
      }
      if (!readHasMore(source)) break;
      page++;
    }
  }
  return topics;
}

async function fetchCreatedTopicNotes(topic: SubscribedTopic, token: string, clientId: string, signal?: AbortSignal, selectedNoteIds?: Set<string>): Promise<GetNoteNote[]> {
  const notes: GetNoteNote[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ topic_id: topic.topic_id, page: String(page) });
    const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/notes?${params.toString()}`;
    const data = await knowledgeApiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
    const source = normalizeData(data);
    const pageNotes = readArray(source, ['notes', 'list', 'items'])
      .filter(isRecord)
      .map(value => {
        const tags = readArray(value, ['tags'])
          .filter(isRecord)
          .map(tag => ({ name: typeof tag.name === 'string' ? tag.name : '' }))
          .filter(tag => tag.name);
        if (topic.name && !tags.some(tag => tag.name === topic.name)) tags.push({ name: topic.name });
        return {
          ...value,
          id: value.note_id,
          note_id: String(value.note_id ?? ''),
          title: typeof value.title === 'string' ? value.title : '',
          content: typeof value.content === 'string' ? value.content : '',
          note_type: typeof value.note_type === 'string' ? value.note_type : 'plain_text',
          source: 'knowledge',
          tags,
          created_at: typeof value.created_at === 'string' ? value.created_at : '',
          updated_at: typeof value.updated_at === 'string' ? value.updated_at : typeof value.edit_time === 'string' ? value.edit_time : '',
        } as GetNoteNote;
      })
      .filter(note => !selectedNoteIds || selectedNoteIds.has(note.note_id));
    notes.push(...pageNotes);
    for (const note of pageNotes) selectedNoteIds?.delete(note.note_id);
    if (selectedNoteIds?.size === 0 || !readHasMore(source)) break;
    page++;
  }
  return notes;
}

export async function fetchTopicBloggers(topicId: string, token: string, clientId: string, signal?: AbortSignal): Promise<Blogger[]> {
  const bloggers: Blogger[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ topic_id: topicId, page: String(page) });
    const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/bloggers?${params.toString()}`;
    const data = await knowledgeApiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
    const source = normalizeData(data);
    bloggers.push(...readArray(source, ['bloggers', 'list', 'items']).map(normalizeBlogger).filter((item): item is Blogger => Boolean(item)));
    if (!readHasMore(source)) break;
    page++;
  }
  return bloggers;
}

export async function fetchTopicContentPreviews(
  topicId: string,
  _topicName: string | undefined,
  token: string,
  clientId: string,
  signal?: AbortSignal,
  options: { maxPages?: number; maxBloggers?: number } = {}
): Promise<{ note_id: string; title: string; updated_at: string; blogger_name: string; topic_id: string; blogger_id: string }[]> {
  const items: { note_id: string; title: string; updated_at: string; blogger_name: string; topic_id: string; blogger_id: string }[] = [];
  const bloggers = await fetchTopicBloggers(topicId, token, clientId, signal);
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  const maxBloggers = options.maxBloggers ?? Number.POSITIVE_INFINITY;
  for (const blogger of bloggers.slice(0, maxBloggers)) {
    let page = 1;
    while (page <= maxPages) {
      const params = new URLSearchParams({ topic_id: topicId, follow_id: blogger.follow_id, page: String(page) });
      const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/blogger/contents?${params.toString()}`;
      const data = await knowledgeApiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
      const source = normalizeData(data);
      const contents = readArray(source, ['contents', 'posts', 'list', 'items']).map(normalizeContent).filter((item): item is BloggerContent => Boolean(item));
      for (const content of contents) {
        const created = content.created_at ?? '';
        const updated = content.updated_at ?? created;
        items.push({
          note_id: `blogger_${content.post_id_alias}`,
          title: content.title ?? '',
          updated_at: updated,
          blogger_name: blogger.name ?? '',
          topic_id: topicId,
          blogger_id: blogger.follow_id,
        });
      }
      if (!readHasMore(source) || contents.length === 0) break;
      page++;
    }
  }
  return items;
}

export async function fetchTopicContentPreviewPage(
  topicId: string,
  _topicName: string | undefined,
  token: string,
  clientId: string,
  signal?: AbortSignal,
  cursor: { bloggerIndex: number; page: number } = { bloggerIndex: 0, page: 1 },
  topicSource?: SubscribedTopic['source']
): Promise<{
  items: {
    note_id: string;
    title: string;
    updated_at: string;
    blogger_name: string;
    topic_id: string;
    blogger_id: string;
    summary?: string;
    content?: string;
    tags?: { name: string }[];
  }[];
  nextCursor?: { bloggerIndex: number; page: number };
}> {
  if (topicSource === 'created') {
    const topic: SubscribedTopic = { topic_id: topicId, name: _topicName ?? topicId, source: 'created' };
    const notes = await fetchCreatedTopicNotes(topic, token, clientId, signal);
    const items = notes.map(note => ({
      note_id: note.note_id,
      title: note.title,
      updated_at: note.updated_at,
      blogger_name: '',
      topic_id: topicId,
      blogger_id: '',
      content: note.content,
      tags: note.tags,
    }));
    return { items };
  }
  const bloggers = await fetchTopicBloggers(topicId, token, clientId, signal);
  const blogger = bloggers[cursor.bloggerIndex];
  if (!blogger) return { items: [] };

  const params = new URLSearchParams({
    topic_id: topicId,
    follow_id: blogger.follow_id,
    page: String(cursor.page),
  });
  const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/blogger/contents?${params.toString()}`;
  const data = await knowledgeApiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
  const source = normalizeData(data);
  const contents = readArray(source, ['contents', 'posts', 'list', 'items'])
    .map(normalizeContent)
    .filter((item): item is BloggerContent => Boolean(item));
  const items = contents.map(content => {
    const created = content.created_at ?? '';
    const updated = content.updated_at ?? created;
    return {
      note_id: `blogger_${content.post_id_alias}`,
      title: content.title ?? '',
      updated_at: updated,
      blogger_name: blogger.name ?? '',
      topic_id: topicId,
      blogger_id: blogger.follow_id,
      summary: content.summary,
      content: content.content,
      tags: [
        ...(_topicName ? [{ name: _topicName }] : []),
        ...(blogger.name ? [{ name: blogger.name }] : []),
      ],
    };
  });
  const nextCursor = readHasMore(source) && contents.length > 0
    ? { bloggerIndex: cursor.bloggerIndex, page: cursor.page + 1 }
    : cursor.bloggerIndex + 1 < bloggers.length
      ? { bloggerIndex: cursor.bloggerIndex + 1, page: 1 }
      : undefined;

  return nextCursor ? { items, nextCursor } : { items };
}

async function fetchBloggerContents(topicId: string, blogger: Blogger, token: string, clientId: string, signal?: AbortSignal, remainingNoteIds?: Set<string>): Promise<BloggerContent[]> {
  const contents: BloggerContent[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ topic_id: topicId, follow_id: blogger.follow_id, page: String(page) });
    const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/blogger/contents?${params.toString()}`;
    const data = await knowledgeApiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildHeaders(token, clientId) }, 2, signal);
    const source = normalizeData(data);
    const pageContents = readArray(source, ['contents', 'posts', 'list', 'items']).map(normalizeContent).filter((item): item is BloggerContent => Boolean(item));
    for (const content of pageContents) {
      const noteId = `blogger_${content.post_id_alias}`;
      if (remainingNoteIds && !remainingNoteIds.has(noteId)) continue;
      contents.push(content);
      remainingNoteIds?.delete(noteId);
    }
    if (remainingNoteIds?.size === 0) break;
    if (!readHasMore(source)) break;
    page++;
  }
  return contents;
}

async function fetchBloggerContentDetail(
  topicId: string,
  content: BloggerContent,
  token: string,
  clientId: string,
  signal?: AbortSignal
): Promise<{ content: BloggerContent; error?: string }> {
  const params = new URLSearchParams({ topic_id: topicId, post_id: content.post_id_alias });
  const url = `https://openapi.biji.com/open/api/v1/resource/knowledge/blogger/content/detail?${params.toString()}`;
  try {
    const data = await knowledgeApiRequest<Record<string, unknown>>(
      url,
      { method: 'GET', headers: buildHeaders(token, clientId) },
      2,
      signal
    );
    const detail = normalizeContent(normalizeData(data));
    if (!detail) {
      return {
        content,
        error: 'Invalid blogger content detail payload',
      };
    }
    return {
      content: { ...content, ...detail, post_id_alias: content.post_id_alias },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof FatalOpenApiError) throw error;
    return {
      content,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchSubscribedKnowledgeNotes(options: FetchNotesOptions): Promise<GetNoteNote[]> {
  const { token, clientId, signal } = options;
  const notes: GetNoteNote[] = [];
  const remainingNoteIds = options.selectedNoteIds?.length ? new Set(options.selectedNoteIds) : undefined;
  const topicIdSet = options.topicIds === undefined || (remainingNoteIds && options.topicIds.length === 0)
    ? undefined
    : new Set(options.topicIds);
  const createdTopicIdSet = options.createdTopicIds === undefined || (remainingNoteIds && options.createdTopicIds.length === 0)
    ? undefined
    : new Set(options.createdTopicIds);
  const bloggerIdSet = options.bloggerIds?.length ? new Set(options.bloggerIds) : undefined;
  const sources: Array<NonNullable<SubscribedTopic['source']>> = [];
  if (createdTopicIdSet) sources.push('created');
  if (topicIdSet || sources.length === 0) sources.push('subscribed');
  const topics = await fetchSubscribedTopics(token, clientId, signal, sources);
  for (const topic of topics) {
    if (topic.source === 'created') {
      if (!createdTopicIdSet?.has(topic.topic_id)) continue;
      notes.push(...await fetchCreatedTopicNotes(topic, token, clientId, signal, remainingNoteIds));
      if (remainingNoteIds?.size === 0) return notes;
      continue;
    }
    if (topicIdSet && !topicIdSet.has(topic.topic_id)) continue;
    const bloggers = await fetchTopicBloggers(topic.topic_id, token, clientId, signal);
    for (const blogger of bloggers) {
      if (bloggerIdSet && !bloggerIdSet.has(blogger.follow_id)) continue;
      const contents = await fetchBloggerContents(topic.topic_id, blogger, token, clientId, signal, remainingNoteIds);
      for (const content of contents) {
        const detailResult = await fetchBloggerContentDetail(topic.topic_id, content, token, clientId, signal);
        const note = bloggerContentToNote(detailResult.content, topic, blogger);
        if (detailResult.error) note.fetch_error = detailResult.error;
        notes.push(note);
      }
      if (remainingNoteIds?.size === 0) return notes;
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

export async function addNotesToKnowledgeBase(options: AddNotesToKnowledgeBaseOptions): Promise<void> {
  if (!options.topicId.trim() || options.noteIds.length === 0) throw new Error('Invalid knowledge-base assignment');
  const data = await apiRequest<Record<string, unknown>>(
    'https://openapi.biji.com/open/api/v1/resource/knowledge/note/batch-add',
    {
      method: 'POST',
      headers: { ...buildHeaders(options.token, options.clientId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: options.topicId, note_ids: options.noteIds.map(String) }),
    },
    1,
    options.signal,
  );
  if (data.success === false) throw new Error(t('error.addKnowledgeBaseNoteFailed'));
}

export interface UpdateNoteOptions {
  token: string; clientId: string; id: string; title?: string; content?: string; tags?: string[]; signal?: AbortSignal;
}

/** Contract: getnote-cli/internal/client/client.go NoteUpdate (POST, string id). */
export async function updateNote(options: UpdateNoteOptions): Promise<void> {
  if (!options.id.trim()) throw new Error(t('bidirectional.invalid'));
  const data = await apiRequest<Record<string, unknown>>(
    'https://openapi.biji.com/open/api/v1/resource/note/update',
    { method: 'POST', headers: { ...buildHeaders(options.token, options.clientId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: options.id,
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.content !== undefined ? { content: options.content } : {}),
        ...(options.tags !== undefined ? { tags: options.tags } : {}),
      }),
    }, 0, options.signal,
  );
  if (data.success !== true) throw new Error(t('bidirectional.unconfirmed'));
}
