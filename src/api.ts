// Central API entry point - delegates to client implementations based on authMode
import { createNote as openapiCreateNote, fetchNotes as openapiFetchNotes, fetchNoteDetail as openapiFetchNoteDetail, fetchSubscribedKnowledgeNotes as openapiFetchSubscribedKnowledgeNotes, fetchSubscribedTopics as openapiFetchSubscribedTopics } from './api-clients/openapi-client';
import { createNote as webapiCreateNote, fetchNotes as webapiFetchNotes, fetchNoteChildren as webapiFetchNoteChildren, fetchNoteDetail as webapiFetchNoteDetail, fetchSubscribedKnowledgeNotes as webapiFetchSubscribedKnowledgeNotes, fetchSubscribedTopics as webapiFetchSubscribedTopics } from './api-clients/webapi-client';
import type { GetNoteNote, AuthMode, SubscribedTopic } from './types';
import { t } from './i18n';

export const GETNOTE_LIST_LIMIT = 20;

export interface FetchNotesOptions {
  token: string;
  clientId: string;
  sinceId?: string;
  limit?: number;
  signal?: AbortSignal;
  authMode?: AuthMode;
  webCsrfToken?: string;
  topicIds?: string[];
}

export async function fetchNotes(options: FetchNotesOptions): Promise<{
  notes: GetNoteNote[];
  hasMore: boolean;
}> {
  const { token, clientId, authMode } = options;
  if (authMode === 'web') {
    return webapiFetchNotes({ token, sinceId: options.sinceId, limit: options.limit, signal: options.signal });
  }
  return openapiFetchNotes({ token, clientId, sinceId: options.sinceId, limit: options.limit, signal: options.signal });
}

export async function fetchNoteDetail(
  id: string,
  token: string,
  clientId: string,
  signal?: AbortSignal,
  authMode?: AuthMode,
  _csrfToken?: string // kept for API compatibility, unused
): Promise<Partial<GetNoteNote>> {
  if (authMode === 'web') {
    return webapiFetchNoteDetail(id, token, signal);
  }
  return openapiFetchNoteDetail(id, token, clientId, signal);
}

export async function fetchNoteChildren(
  parentPrimeId: string,
  token: string,
  signal?: AbortSignal,
  authMode?: AuthMode
): Promise<GetNoteNote[]> {
  if (authMode !== 'web') return [];
  return webapiFetchNoteChildren(parentPrimeId, token, signal);
}

export async function fetchSubscribedTopics(options: FetchNotesOptions): Promise<SubscribedTopic[]> {
  if (options.authMode === 'web') {
    return webapiFetchSubscribedTopics(options.token, options.signal);
  }
  return openapiFetchSubscribedTopics(options.token, options.clientId, options.signal);
}

export async function fetchSubscribedKnowledgeNotes(options: FetchNotesOptions): Promise<GetNoteNote[]> {
  if (options.authMode === 'web') {
    return webapiFetchSubscribedKnowledgeNotes({
      token: options.token,
      sinceId: options.sinceId,
      limit: options.limit,
      signal: options.signal,
    });
  }
  return openapiFetchSubscribedKnowledgeNotes({
    token: options.token,
    clientId: options.clientId,
    sinceId: options.sinceId,
    limit: options.limit,
    signal: options.signal,
  });
}

export interface CreateNoteOptions {
  token: string;
  clientId: string;
  authMode?: AuthMode;
  title: string;
  content: string;
  noteType: string;
  tags?: string[];
  signal?: AbortSignal;
}

export interface CreateNoteResult {
  noteId: string;
  detailId?: string;
}

export async function createNote(options: CreateNoteOptions): Promise<CreateNoteResult> {
  if (options.authMode === 'web') {
    return webapiCreateNote({
      token: options.token,
      title: options.title,
      content: options.content,
      noteType: options.noteType,
      tags: options.tags,
      signal: options.signal,
    });
  }
  return openapiCreateNote({
    token: options.token,
    clientId: options.clientId,
    title: options.title,
    content: options.content,
    noteType: options.noteType,
    tags: options.tags,
    signal: options.signal,
  });
}

export async function* fetchAllNotes(
  token: string,
  clientId: string,
  signal?: AbortSignal,
  startCursor?: string | null,
  authMode?: AuthMode,
  _csrfToken?: string
): AsyncGenerator<GetNoteNote[]> {
  let cursor = startCursor && startCursor !== '0' ? startCursor : '0';
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { notes, hasMore } = await fetchNotes({ token, clientId, sinceId: cursor, signal, authMode });
    if (notes.length > 0) yield notes;
    if (!hasMore || notes.length === 0) break;
    cursor = notes[notes.length - 1].note_id;
  }
}

// === OAuth functions (OpenAPI only) ===

function safeJsonParse(text: string): unknown {
  const safe = text.replace(
    /"(id|note_id|parent_id|follow_id|live_id)"\s*:\s*(\d+)/g,
    '"$1":"$2"'
  );
  return JSON.parse(safe);
}

const BASE_URL = 'https://openapi.biji.com/open/api/v1';

export interface OAuthDeviceCodeResponse {
  verification_uri: string;
  user_code: string;
  code: string;
  interval: number;
}

export interface OAuthTokenResponse {
  api_key: string;
  client_id: string;
}

export async function fetchOAuthDeviceCode(signal?: AbortSignal): Promise<OAuthDeviceCodeResponse> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const res = await fetch(`${BASE_URL}/oauth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'cli_a1b2c3d4e5f6789012345678abcdef90' }),
    signal,
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text();
    throw new Error(t('error.oauthDeviceCodeFailed', { status: res.status, msg: text }));
  }
  const text = await res.text();
  const json = safeJsonParse(text) as Record<string, unknown>;
  if (json.success === false) {
    const err = (json.error ?? json) as Record<string, unknown>;
    const code = err?.code as number | undefined;
    if (code === 10201) throw new Error(t('error.openApiNotMember'));
    throw new Error(t('error.oauthDeviceCodeFailed', { status: res.status, msg: (json.message as string) ?? 'unknown' }));
  }
  const source = (json.data ?? json) as Record<string, unknown>;
  if (!source.code && !source.verification_uri) {
    throw new Error(t('error.oauthDeviceCodeFailed', { status: res.status, msg: (json.message as string) ?? 'unknown' }));
  }
  return {
    verification_uri: source.verification_uri as string,
    user_code: source.user_code as string,
    code: (source.code as string) ?? (source.device_code as string),
    interval: (source.interval as number) ?? 5,
  };
}

function parseOAuthTokenResponse(json: Record<string, unknown>): { status: number; message: string; apiKey: string; clientId: string; isSuccess: boolean } {
  const inner = (json.data ?? json) as Record<string, unknown>;
  const dataMsg = inner.msg as string | undefined;
  if (dataMsg === 'authorization_pending') return { status: 10012, message: '', apiKey: '', clientId: '', isSuccess: false };
  if (dataMsg === 'expired_token') return { status: 10013, message: t('error.oauthExpired'), apiKey: '', clientId: '', isSuccess: false };
  if (dataMsg === 'rejected') return { status: 10014, message: t('error.oauthRejected'), apiKey: '', clientId: '', isSuccess: false };
  const apiKey = (inner.api_key as string) ?? (inner.apiKey as string) ?? (json.api_key as string) ?? '';
  const clientId = (inner.client_id as string) ?? (inner.clientId as string) ?? (json.client_id as string) ?? '';
  const message = (json.message as string) ?? (inner.message as string) ?? '';
  if (apiKey && clientId) return { status: 0, message: '', apiKey, clientId, isSuccess: true };
  const status = json.status as number | undefined ?? -1;
  return { status, message, apiKey: '', clientId: '', isSuccess: false };
}

export async function pollOAuthToken(code: string, interval: number, signal?: AbortSignal): Promise<OAuthTokenResponse> {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const res = await fetch(`${BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'device_code', client_id: 'cli_a1b2c3d4e5f6789012345678abcdef90', code }),
      signal,
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (res.status < 200 || res.status >= 300) {
      const text = await res.text();
      throw new Error(t('error.apiFailed', { status: res.status, msg: text }));
    }
    const text = await res.text();
    const json = safeJsonParse(text) as Record<string, unknown>;
    if (json.success === false) {
      const err = (json.error ?? json) as Record<string, unknown>;
      const code = err?.code as number | undefined;
      if (code === 10201) throw new Error(t('error.openApiNotMember'));
      if (code === 10202) {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => resolve(), 3000);
          signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
        });
        continue;
      }
    }
    const parsed = parseOAuthTokenResponse(json);
    if (parsed.isSuccess) return { api_key: parsed.apiKey, client_id: parsed.clientId };
    if (parsed.status === 10012) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => resolve(), interval * 1000);
        signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
      });
      continue;
    }
    if (parsed.status === 10013) throw new Error(t('error.oauthExpired'));
    if (parsed.status === 10014) throw new Error(t('error.oauthRejected'));
    const rawMsg = JSON.stringify(json).slice(0, 200);
    const baseErr = t('error.oauthUnknown', { status: parsed.status });
    const withMsg = parsed.message ? `${parsed.message} ${baseErr}` : baseErr;
    throw new Error(`${withMsg} (${rawMsg})`);
  }
  throw new Error(t('error.oauthTimeout'));
}
