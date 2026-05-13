// No import needed - using native fetch
import type { ListResponse, GetNoteNote, Attachment } from './types';
import { t } from './i18n';

const BASE_URL = 'https://openapi.biji.com/open/api/v1';
export const GETNOTE_LIST_LIMIT = 20;

function safeJsonParse(text: string): unknown {
  const safe = text.replace(
    /"(id|note_id|parent_id|follow_id|live_id)"\s*:\s*(\d+)/g,
    '"$1":"$2"'
  );
  return JSON.parse(safe);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

  return {
    ...detail,
    attachments,
    audio,
  };
}

async function apiRequest<T>(
  url: string,
  options: RequestInit,
  retries = 1,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const res = await fetch(url, {
    ...options,
    signal,
  });

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (res.status === 401) {
    throw new Error(t('error.invalidCredentials'));
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const limitRemaining = res.headers.get('X-RateLimit-Remaining');

    if ((limitRemaining === '0' || !retryAfter) && retries > 0) {
      throw new Error(t('error.quotaExceeded'));
    }

    if (retryAfter) {
      const baseDelay = parseInt(retryAfter, 10);
      const delay = Math.min(baseDelay, 60) * 1000;
      await new Promise((r, reject) => {
        const timer = window.setTimeout(() => r(undefined), delay);
        signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
      });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return apiRequest(url, options, retries - 1, signal);
    }

    throw new Error(t('error.apiFailed', { status: 429, msg: 'Rate limit exceeded' }));
  }

  if (res.status < 200 || res.status >= 300) {
    const text = await res.text();
    throw new Error(t('error.apiFailed', { status: res.status, msg: text }));
  }

  const text = await res.text();
  const data = safeJsonParse(text) as Record<string, unknown>;

  // Handle rate limit error code 10202 (qps_bucket_exceeded)
  if (data.success === false) {
    const error = data.error as Record<string, unknown> | undefined;
    if (error?.code === 10202) {
      if (retries > 0) {
        await new Promise((r, reject) => {
          const timer = window.setTimeout(() => r(undefined), 3000);
          signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
        });
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return apiRequest(url, options, retries - 1, signal);
      }
      throw new Error(t('error.apiFailed', { status: 429, msg: '请求频率超限' }));
    }
  }

  return data as T;
}

export interface FetchNotesOptions {
  token: string;
  clientId: string;
  sinceId?: string;
  limit?: number;
  signal?: AbortSignal;
}

export async function fetchNotes(options: FetchNotesOptions): Promise<{
  notes: GetNoteNote[];
  hasMore: boolean;
}> {
  const { token, clientId, sinceId = '0', signal } = options;
  const url = `${BASE_URL}/resource/note/list?since_id=${sinceId}`;

  const data = await apiRequest<ListResponse>(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Client-ID': clientId,
    },
  }, 3, signal);

  return {
    notes: data.data.notes,
    hasMore: data.data.has_more,
  };
}

export async function fetchNoteDetail(
  id: string,
  token: string,
  clientId: string,
  signal?: AbortSignal
): Promise<Partial<GetNoteNote>> {
  const url = `${BASE_URL}/resource/note/detail?id=${id}`;
  const data = await apiRequest<{
    success: boolean;
    data?: unknown;
    error?: { message: string };
  }>(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Client-ID': clientId,
    },
  }, 2, signal);

  if (!data.success || !data.data) {
    throw new Error(data.error?.message ?? 'Failed to fetch note detail');
  }

  const noteDetail = normalizeNoteDetailData(data.data);
  if (!noteDetail) {
    throw new Error('Failed to parse note detail');
  }

  return noteDetail;
}

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

export async function fetchOAuthDeviceCode(
  signal?: AbortSignal
): Promise<OAuthDeviceCodeResponse> {
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

  // Support both { success, data } wrapper and flat response
  const source = (json.data ?? json) as Record<string, unknown>;

  if (json.success === false) {
    throw new Error(t('error.oauthDeviceCodeFailed', { status: res.status, msg: (json.message as string) ?? 'unknown' }));
  }

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
  // The API returns { success: true, data: { ... }, error, meta, request_id }
  const inner = (json.data ?? json) as Record<string, unknown>;

  // Check for pending/expired messages in data.msg
  const dataMsg = inner.msg as string | undefined;

  if (dataMsg === 'authorization_pending') {
    return { status: 10012, message: '', apiKey: '', clientId: '', isSuccess: false };
  }

  if (dataMsg === 'expired_token') {
    return { status: 10013, message: t('error.oauthExpired'), apiKey: '', clientId: '', isSuccess: false };
  }

  // Check for credentials in either inner (from data: { ... }) or flat
  const apiKey = (inner.api_key as string) ?? (inner.apiKey as string) ?? (json.api_key as string) ?? '';
  const clientId = (inner.client_id as string) ?? (inner.clientId as string) ?? (json.client_id as string) ?? '';
  const message = (json.message as string) ?? (inner.message as string) ?? '';

  if (apiKey && clientId) {
    return { status: 0, message: '', apiKey, clientId, isSuccess: true };
  }

  // Unknown state
  const status = json.status as number | undefined ?? -1;
  return { status, message, apiKey: '', clientId: '', isSuccess: false };
}

export async function pollOAuthToken(
  code: string,
  interval: number,
  signal?: AbortSignal
): Promise<OAuthTokenResponse> {
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const res = await fetch(`${BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'device_code',
        client_id: 'cli_a1b2c3d4e5f6789012345678abcdef90',
        code,
      }),
      signal,
    });

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    if (res.status < 200 || res.status >= 300) {
      const text = await res.text();
      throw new Error(t('error.apiFailed', { status: res.status, msg: text }));
    }
    const text = await res.text();
    const json = safeJsonParse(text) as Record<string, unknown>;
    const parsed = parseOAuthTokenResponse(json);

    if (parsed.isSuccess) {
      return { api_key: parsed.apiKey, client_id: parsed.clientId };
    }

    if (parsed.status === 10012) {
      // still pending, wait interval seconds
      await new Promise<void>((resolve, reject) => {
        const t = window.setTimeout(() => resolve(), interval * 1000);
        signal?.addEventListener('abort', () => { window.clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); });
      });
      continue;
    }

    if (parsed.status === 10013) {
      throw new Error(t('error.oauthExpired'));
    }

    const rawMsg = JSON.stringify(json).slice(0, 200);
    throw new Error(
      (parsed.message ? parsed.message + ' ' : '') + t('error.oauthUnknown', { status: parsed.status }) + ` (${rawMsg})`
    );
  }

  throw new Error(t('error.oauthTimeout'));
}

export async function* fetchAllNotes(
  token: string,
  clientId: string,
  signal?: AbortSignal,
  startCursor?: string | null
): AsyncGenerator<GetNoteNote[]> {
  let cursor = startCursor && startCursor !== '0' ? startCursor : '0';

  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { notes, hasMore } = await fetchNotes({
      token,
      clientId,
      sinceId: cursor,
      signal,
    });

    if (notes && notes.length > 0) {
      yield notes;
    }

    if (!hasMore || notes.length === 0) break;
    cursor = notes[notes.length - 1].note_id;
  }
}
