import type { GetNoteNote, Attachment, LinkOriginal, SubscribedTopic } from '../types';
import { t } from '../i18n';
import { isRecord, normalizeBearerToken, normalizeTopicMemberships, parseJsonObjectOrEmpty, parseJsonPreservingIds, waitForRetryDelay } from './api-client-utils';
import { getImageType, uploadSignedImage, type UploadImageOptions } from './image-upload';
import { buildWebJsonContent } from './web-markdown';

export class WebApiAuthenticationError extends Error {
  constructor(
    readonly reason: 'expired' | 'forbidden',
    message: string,
  ) {
    super(message);
    this.name = 'WebApiAuthenticationError';
  }
}

export function isWebApiAuthenticationError(error: unknown): error is WebApiAuthenticationError {
  return error instanceof WebApiAuthenticationError;
}

function createWebApiAuthenticationError(message: string): WebApiAuthenticationError {
  return new WebApiAuthenticationError(
    message === 'LoginRequired' ? 'expired' : 'forbidden',
    message === 'LoginRequired' ? t('error.webApiLoginRequired') : t('error.webApiForbidden'),
  );
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: normalizeBearerToken(token),
    'x-request-id': String(Date.now()),
  };
}

function buildKnowledgeHeaders(token: string): Record<string, string> {
  return {
    ...buildHeaders(token),
    'X-Appid': '3',
    'X-Av': '1.2.2',
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
  const notes: GetNoteNote[] = list.map((raw): GetNoteNote => {
    const n: Record<string, unknown> = isRecord(raw) ? raw : {};
    const stringField = (key: string): string => (typeof n[key] === 'string' ? n[key] : '');
    const childCountRaw = n.children_count;
    const subNoteCountRaw = n.sub_note_count;
    const topics = normalizeTopicMemberships(n.topics);
    return {
      id: stringField('id'),
      note_id: stringField('note_id'),
      parent_id: stringField('parent_id') || undefined,
      children_count: typeof childCountRaw === 'number'
        ? childCountRaw
        : typeof subNoteCountRaw === 'number'
          ? subNoteCountRaw
          : undefined,
      children_ids: Array.isArray(n.children_ids) ? n.children_ids.map((id: unknown) => String(id)) : undefined,
      is_child_note: typeof n.is_child_note === 'boolean' ? n.is_child_note : undefined,
      title: stringField('title'),
      content: stringField('content'),
      note_type: stringField('note_type') || 'plain_text',
      source: stringField('source') || 'web',
      tags: Array.isArray(n.tags) ? (n.tags as { name: string }[]) : [],
      created_at: stringField('created_at'),
      updated_at: stringField('updated_at'),
      attachments: Array.isArray(n.attachments) ? (n.attachments as Attachment[]) : [],
      audio: stringField('audio') || undefined,
      prime_id: stringField('prime_id') || undefined,
      ...(topics ? { topics } : {}),
    };
  });
  return { notes, hasMore };
}

function normalizeNoteDetailData(value: unknown): Partial<GetNoteNote> | null {
  if (!isRecord(value)) return null;
  // Guard: if value has a list property it is a list response, not a note detail.
  if ('list' in value) return null;
  const nestedNote = isRecord(value.note) ? value.note : null;
  const source = nestedNote ?? value;
  const detail = { ...source } as Partial<GetNoteNote>;
  const attachments = (value.attachments ?? source.attachments) as Attachment[] | undefined;
  const audio = typeof (value.audio ?? source.audio) === 'string' ? (value.audio ?? source.audio) as string : undefined;
  const childCountRaw = source.children_count;
  const subNoteCountRaw = source.sub_note_count;
  const childrenCount = typeof childCountRaw === 'number'
    ? childCountRaw
    : typeof subNoteCountRaw === 'number'
      ? subNoteCountRaw
      : undefined;
  const childrenIds = Array.isArray(source.children_ids)
    ? source.children_ids.map(id => String(id))
    : undefined;
  const topics = normalizeTopicMemberships(source.topics ?? value.topics);
  return { ...detail, attachments, audio, children_count: childrenCount, children_ids: childrenIds, ...(topics ? { topics } : {}) };
}

function normalizeLinkOriginal(value: unknown): LinkOriginal | null {
  if (!isRecord(value)) return null;
  const source = isRecord(value.c) ? value.c : value;
  const content = typeof source.content === 'string' ? source.content.trim() : '';
  if (!content) return null;
  const title = typeof source.title === 'string' && source.title.trim() ? source.title.trim() : undefined;
  const url = typeof source.url === 'string' && source.url.trim() ? source.url.trim() : undefined;
  return { ...(title ? { title } : {}), ...(url ? { url } : {}), content };
}

function tryParseJsonObject(text: string): Record<string, unknown> {
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
  const json = tryParseJsonObject(text);
  const err = (json.error ?? json) as Record<string, unknown>;
  const reason = err.reason as string | undefined;
  if (reason === 'quota_day' || reason === 'quota_daily_exceeded' || reason === 'quota_month' || reason === 'quota_monthly_exceeded') {
    throw new Error(t('error.quotaExceeded'));
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
  if (res.status === 401 || res.status === 403) {
    const text = await res.text().catch(() => '');
    const json = tryParseJsonObject(text);
    const msg = (json.message as string) ?? '';
    throw createWebApiAuthenticationError(msg);
  }
  if (res.status === 429) return handleRateLimit<T>(url, options, res, retries, signal);
  if (res.status < 200 || res.status >= 300) {
    if (res.status >= 500 && retries > 0) {
      await waitForRetryDelay(signal);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return apiRequest(url, options, retries - 1, signal);
    }
    throw new Error(t('error.apiServerError', { status: res.status }));
  }
  const text = await res.text();
  const json = parseJsonPreservingIds(text) as Record<string, unknown>;
  if (json.success === false) {
    const err = (json.error ?? json) as Record<string, unknown>;
    const errMsg = (err?.message as string) ?? (json.message as string) ?? '';
    if (errMsg === 'LoginRequired') throw createWebApiAuthenticationError(errMsg);
    throw new Error(errMsg ? t('error.apiGenericWithMsg', { msg: errMsg }) : t('error.apiGeneric'));
  }
  return json as T;
}

export interface FetchNotesOptions {
  token: string;
  sinceId?: string;
  limit?: number;
  signal?: AbortSignal;
  topicIds?: string[];
  createdTopicIds?: string[];
  selectedNoteIds?: string[];
}

export interface CreateNoteOptions {
  token: string;
  title: string;
  content: string;
  noteType: string;
  tags?: string[];
  topicId?: string;
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

function normalizeWebData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  if (isRecord(value.c)) return value.c;
  return isRecord(value.data) ? value.data : value;
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function findTopicByAlias(rawTopics: unknown[], topicId: string): Record<string, unknown> | null {
  for (const t of rawTopics) {
    if (!isRecord(t)) continue;
    const alias = t.id_alias ?? t.id;
    if (String(alias ?? '') === topicId) return t;
  }
  return null;
}

function noteFromKnowledgeResource(resource: unknown, topicName?: string): GetNoteNote | null {
  if (!isRecord(resource) || resource.resource_type === 'FILE') return null;
  const meta = isRecord(resource.resource_note_meta_data) ? resource.resource_note_meta_data : resource;
  const id = meta.note_id ?? resource.resource_id_alias ?? resource.id_alias ?? resource.id;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const noteId = String(id);
  const title = typeof meta.title === 'string'
    ? meta.title
    : typeof resource.post_name === 'string'
      ? resource.post_name
      : '';
  const content = typeof meta.content === 'string'
    ? meta.content
    : typeof meta.body_text === 'string'
      ? meta.body_text
      : typeof resource.post_cleaned_summary === 'string'
        ? resource.post_cleaned_summary
        : '';
  const created = typeof meta.created_at === 'string'
    ? meta.created_at
    : typeof resource.post_create_time === 'string'
      ? resource.post_create_time
      : '';
  const updated = typeof meta.edit_time === 'string'
    ? meta.edit_time
    : typeof meta.updated_at === 'string'
      ? meta.updated_at
      : created;
  const noteType = typeof meta.note_type === 'string'
    ? meta.note_type
    : resource.resource_type === 'BLOGGER_POST'
      ? 'blogger_post'
      : 'plain_text';
  const source = typeof meta.source === 'string' ? meta.source : resource.resource_type === 'BLOGGER_POST' ? 'blogger' : 'web';
  const rawTags = Array.isArray(meta.tags) ? meta.tags as { name?: string }[] : [];
  const tags = [
    ...rawTags.filter((tag): tag is { name: string } => typeof tag.name === 'string'),
    ...(topicName ? [{ name: topicName }] : []),
  ];
  return {
    id: noteId,
    note_id: noteType === 'blogger_post' && !noteId.startsWith('blogger_') ? `blogger_${noteId}` : noteId,
    title,
    content,
    note_type: noteType,
    source,
    tags,
    created_at: created,
    updated_at: updated,
    attachments: (meta.attachments as Attachment[]) ?? [],
    audio: typeof meta.audio === 'string' ? meta.audio : undefined,
    prime_id: typeof meta.prime_id === 'string' ? meta.prime_id : undefined,
    topic_name: topicName,
  };
}

async function fetchOwnedTopicRecords(token: string, signal?: AbortSignal): Promise<Map<string, Record<string, unknown>>> {
  const topics = new Map<string, Record<string, unknown>>();
  const size = 20;
  for (let page = 1; ; page++) {
    const data = await apiRequest<Record<string, unknown>>(
      `https://knowledge-api.trytalks.com/v1/web/topic/mine/list?page=${page}&size=${size}`,
      { method: 'GET', headers: buildKnowledgeHeaders(token) }, 2, signal,
    );
    const source = data.c ?? data.data ?? data;
    const wrapper = isRecord(source) ? source : {};
    const items = wrapper.items ?? wrapper.list ?? wrapper.topics ?? source;
    if (!Array.isArray(items) || items.length === 0) break;
    const previousSize = topics.size;
    for (const item of items.filter(isRecord)) {
      const id = identifier(item.id);
      if (id && typeof item.name === 'string' && item.name.trim()) topics.set(id, item);
    }
    if (topics.size === previousSize || !(wrapper.has_next ?? wrapper.has_more ?? (items.length >= size))) break;
  }
  return topics;
}

export async function fetchWritableTopics(token: string, signal?: AbortSignal): Promise<SubscribedTopic[]> {
  const topics = await fetchOwnedTopicRecords(token, signal);
  return [...topics].map(([topic_id, item]) => ({ topic_id, name: String(item.name), source: 'created' }));
}

async function fetchSubscribedTopicRecords(token: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const listUrl = 'https://knowledge-api.trytalks.com/v1/web/subscribe/topic/list?page=1&size=200&exclude_mine=true';
  const listData = await apiRequest<Record<string, unknown>>(listUrl, {
    method: 'GET',
    headers: buildKnowledgeHeaders(token),
  }, 2, signal);
  const topicsData = normalizeWebData(listData);
  return Array.isArray(topicsData.list) ? topicsData.list.filter(isRecord) : [];
}

export async function fetchSubscribedTopics(token: string, signal?: AbortSignal): Promise<SubscribedTopic[]> {
  const [records, owned] = await Promise.all([fetchSubscribedTopicRecords(token, signal), fetchWritableTopics(token, signal)]);
  const topics = new Map(owned.map(topic => [topic.topic_id, topic]));
  for (const item of records) {
    // id_alias is used when available; falls back to id
    const id = identifier(item.id_alias ?? item.id);
    if (!id || topics.has(id)) continue;
    topics.set(id, {
      topic_id: id,
      name: typeof item.name === 'string' ? item.name : '',
      source: 'subscribed',
    });
  }
  return [...topics.values()];
}

export async function fetchSubscribedKnowledgeNotes(options: FetchNotesOptions): Promise<GetNoteNote[]> {
  const notes: GetNoteNote[] = [];
  const remainingNoteIds = options.selectedNoteIds?.length ? new Set(options.selectedNoteIds) : undefined;
  const topicIdSet = options.topicIds === undefined || (remainingNoteIds && options.topicIds.length === 0)
    ? undefined
    : new Set(options.topicIds);
  const topics: Array<{ id: string; record: Record<string, unknown> }> = [];
  if (options.createdTopicIds?.length) {
    const wanted = new Set(options.createdTopicIds);
    for (const [id, record] of await fetchOwnedTopicRecords(options.token, options.signal)) {
      if (wanted.has(id) || wanted.has(identifier(record.id_alias) ?? '')) topics.push({ id, record });
    }
  }
  if (options.createdTopicIds?.length ? Boolean(topicIdSet?.size) : topicIdSet?.size !== 0) {
    for (const record of await fetchSubscribedTopicRecords(options.token, options.signal)) {
      const id = identifier(record.id_alias ?? record.id);
      if (id && (!topicIdSet || topicIdSet.has(id))) topics.push({ id, record });
    }
  }
  for (const topic of topics) {
    notes.push(...await fetchKnowledgeTopicNotes(topic, options, remainingNoteIds));
    if (remainingNoteIds?.size === 0) break;
  }
  return notes;
}

function topicCoordinates(record: Record<string, unknown>): { alias: string; rootId: string; name?: string } | undefined {
  const alias = identifier(record.id_alias ?? record.id);
  const rootId = isRecord(record.root_dir) ? identifier(record.root_dir.id) : undefined;
  return alias && rootId ? { alias, rootId, name: typeof record.name === 'string' ? record.name : undefined } : undefined;
}

async function readKnowledgeDirectoryPage(topicAlias: string, directoryId: string, page: number, token: string, signal?: AbortSignal) {
  const params = new URLSearchParams({
    topic_id: '-1', topic_id_alias: topicAlias, directory_id: directoryId,
    sort: 'create_time_desc', resource_type: '0', page: String(page),
  });
  const source = normalizeWebData(await apiRequest<Record<string, unknown>>(
    `https://knowledge-api.trytalks.com/v1/web/topic/resource/list/mix?${params.toString()}`,
    { method: 'GET', headers: buildKnowledgeHeaders(token) }, 2, signal,
  ));
  const resources = Array.isArray(source.resources) ? source.resources : [];
  const children: { id: string; name: string }[] = [];
  for (const child of (Array.isArray(source.directories) ? source.directories : []).filter(isRecord)) {
    const id = identifier(child.id);
    const name = typeof child.name === 'string' ? child.name.trim() : '';
    if (id && name && (!child.type || child.type === 'DEFAULT')) children.push({ id, name });
  }
  return { resources, children, hasNext: Boolean(source.has_next) && (resources.length > 0 || children.length > 0) };
}

async function fetchKnowledgeTopicNotes(
  topic: { id: string; record: Record<string, unknown> }, options: FetchNotesOptions, remainingNoteIds?: Set<string>,
): Promise<GetNoteNote[]> {
  const coordinates = topicCoordinates(topic.record);
  if (!coordinates) return [];
  const { alias, rootId, name } = coordinates;
  const noteIds = new Set<string>();
  const pending = [{ id: rootId, path: [] as string[] }];
  const visited = new Set([rootId]);
  const notes: GetNoteNote[] = [];
  for (const directory of pending) {
    for (let page = 1; ; page++) {
      const { resources, children, hasNext } = await readKnowledgeDirectoryPage(alias, directory.id, page, options.token, options.signal);
      for (const resource of resources) {
        const note = noteFromKnowledgeResource(resource, name);
        if (!note || noteIds.has(note.note_id) || (remainingNoteIds && !remainingNoteIds.has(note.note_id))) continue;
        note.topic_id = topic.id;
        note.topic_directory_path = directory.path;
        noteIds.add(note.note_id);
        notes.push(note);
        remainingNoteIds?.delete(note.note_id);
      }
      if (remainingNoteIds?.size === 0) return notes;
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        pending.push({ id: child.id, path: [...directory.path, child.name] });
      }
      if (!hasNext) break;
    }
  }
  return notes;
}

export async function fetchTopicContentPreviews(
  topicId: string,
  token: string,
  signal?: AbortSignal,
  options: { maxPages?: number; maxBloggers?: number } = {}
): Promise<{ note_id: string; title: string; updated_at: string; topic_id: string }[]> {
  const items: { note_id: string; title: string; updated_at: string; topic_id: string }[] = [];
  const listUrl = 'https://knowledge-api.trytalks.com/v1/web/subscribe/topic/list?page=1&size=200&exclude_mine=true';
  const listData = await apiRequest<Record<string, unknown>>(listUrl, { method: 'GET', headers: buildKnowledgeHeaders(token) }, 2, signal);
  const topicsData = normalizeWebData(listData);
  const rawTopics = Array.isArray(topicsData.list) ? topicsData.list : [];
  const rawTopic = findTopicByAlias(rawTopics, topicId);
  if (!rawTopic) return items;
  const topicAlias = rawTopic.id_alias ?? rawTopic.id;
  const rootDir = isRecord(rawTopic.root_dir) ? rawTopic.root_dir : {};
  const directoryId = rootDir.id;
  if ((typeof topicAlias !== 'string' && typeof topicAlias !== 'number') || (typeof directoryId !== 'string' && typeof directoryId !== 'number')) return items;
  let page = 1;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  while (page <= maxPages) {
    const params = new URLSearchParams({
      topic_id: '-1',
      topic_id_alias: String(topicAlias),
      directory_id: String(directoryId),
      sort: 'create_time_desc',
      resource_type: '0',
      page: String(page),
    });
    const url = `https://knowledge-api.trytalks.com/v1/web/topic/resource/list/mix?${params.toString()}`;
    const data = await apiRequest<Record<string, unknown>>(url, { method: 'GET', headers: buildKnowledgeHeaders(token) }, 2, signal);
    const source = normalizeWebData(data);
    const resources = Array.isArray(source.resources) ? source.resources : [];
    for (const resource of resources) {
      const note = noteFromKnowledgeResource(resource, typeof rawTopic.name === 'string' ? rawTopic.name : undefined);
      if (note) items.push({ note_id: note.note_id, title: note.title, updated_at: note.updated_at, topic_id: topicId });
    }
    if (!source.has_next || resources.length === 0) break;
    page++;
  }
  return items;
}

export interface WebDirectoryPreviewCursor {
  topicAlias: string;
  topicName?: string;
  directoryIds: string[];
  directoryIndex: number;
}

export async function fetchTopicContentPreviewPage(
  topicId: string,
  token: string,
  signal?: AbortSignal,
  cursor: { bloggerIndex: number; page: number; webDirectory?: WebDirectoryPreviewCursor } = { bloggerIndex: 0, page: 1 },
  topicSource?: SubscribedTopic['source'],
): Promise<{
  items: { note_id: string; title: string; updated_at: string; topic_id: string }[];
  nextCursor?: { bloggerIndex: number; page: number; webDirectory: WebDirectoryPreviewCursor };
}> {
  let { page, webDirectory } = cursor;
  if (!webDirectory) {
    const topic = topicSource === 'created'
      ? (await fetchOwnedTopicRecords(token, signal)).get(topicId)
      : findTopicByAlias(await fetchSubscribedTopicRecords(token, signal), topicId);
    const coordinates = topic && topicCoordinates(topic);
    if (!coordinates) return { items: [] };
    webDirectory = { topicAlias: coordinates.alias, topicName: coordinates.name, directoryIds: [coordinates.rootId], directoryIndex: 0 };
  }
  const { topicAlias, topicName } = webDirectory;
  const directoryIds = [...webDirectory.directoryIds];
  let { directoryIndex } = webDirectory;
  while (directoryIndex < directoryIds.length) {
    const { resources, children, hasNext } = await readKnowledgeDirectoryPage(topicAlias, directoryIds[directoryIndex], page, token, signal);
    for (const child of children) {
      if (!directoryIds.includes(child.id)) directoryIds.push(child.id);
    }
    if (hasNext) page++;
    else {
      page = 1;
      directoryIndex++;
    }
    const items = resources
      .map(resource => noteFromKnowledgeResource(resource, topicName))
      .filter((note): note is GetNoteNote => Boolean(note))
      .map(note => ({ note_id: note.note_id, title: note.title, updated_at: note.updated_at, topic_id: topicId, content: note.content, tags: note.tags }));
    if (items.length === 0) continue;
    const nextCursor = directoryIndex < directoryIds.length
      ? { bloggerIndex: 0, page, webDirectory: { topicAlias, topicName, directoryIds, directoryIndex } }
      : undefined;
    return nextCursor ? { items, nextCursor } : { items };
  }
  return { items: [] };
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
    if (data.message === 'LoginRequired') throw createWebApiAuthenticationError(data.message);
    throw new Error(data.message ? t('error.apiGenericWithMsg', { msg: data.message }) : t('error.apiGeneric'));
  }
  const c = data.c;
  if (!isRecord(c)) throw new Error(t('error.fetchNoteDetailFailed'));
  const noteDetail = normalizeNoteDetailData(c);
  // noteDetail.note_id is required — throw if missing (e.g. error response body)
  if (!noteDetail || !noteDetail.note_id) throw new Error(t('error.fetchNoteDetailFailed'));
  return noteDetail;
}

export async function fetchNoteOriginal(
  detailId: string,
  token: string,
  signal?: AbortSignal
): Promise<LinkOriginal | null> {
  const url = `https://get-notes.luojilab.com/voicenotes/web/notes/${encodeURIComponent(detailId)}/original`;
  const data = await apiRequest<{ h?: unknown; c?: unknown; message?: string }>(url, {
    method: 'GET',
    headers: buildHeaders(token),
  }, 2, signal);
  if (data.message) {
    if (data.message === 'LoginRequired') throw createWebApiAuthenticationError(data.message);
    throw new Error(data.message ? t('error.apiGenericWithMsg', { msg: data.message }) : t('error.apiGeneric'));
  }
  return normalizeLinkOriginal(data);
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
  const resource = options.topicId ? 'topics/notes' : 'notes';
  const data = await apiRequest<{ h?: unknown; c?: unknown; data?: unknown }>(
    `https://get-notes.luojilab.com/voicenotes/web/${resource}`,
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
        ...(options.topicId ? { topic_id: options.topicId } : {}),
      }),
    },
    0,
    options.signal
  );
  const { noteId, detailId } = extractCreatedNoteIds(data);
  if (!noteId) throw new Error(t('error.createNoteFailed'));
  return { noteId, detailId };
}

export async function uploadImage(options: UploadImageOptions): Promise<string> {
  const imageType = getImageType(options.filename);
  const data = await apiRequest<Record<string, unknown>>(
    'https://get-notes.luojilab.com/voicenotes/web/token/image',
    { method: 'POST', headers: { ...buildHeaders(options.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'web', type: imageType }) },
    0, options.signal,
  );
  const credentials = data.c ?? data.data;
  return uploadSignedImage(Array.isArray(credentials) ? credentials[0] : undefined, options, imageType, 'web');
}
