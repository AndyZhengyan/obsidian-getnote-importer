import { t } from '../i18n';
import { isRecord, parseJsonObjectOrEmpty } from './api-client-utils';

export interface UploadImageOptions {
  token: string;
  clientId: string;
  filename: string;
  data: ArrayBuffer;
  signal?: AbortSignal;
}

export function getImageType(filename: string): 'jpeg' | 'png' | 'gif' | 'webp' {
  const extension = /\.([^.]+)$/.exec(filename)?.[1].toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'png' || extension === 'gif' || extension === 'webp') return extension;
  throw new Error(t('error.imageUploadUnsupported', { filename }));
}

function isSecureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** The Web and OpenAPI issuers sign different sets of ordered OSS fields. */
export async function uploadSignedImage(
  credential: unknown, options: UploadImageOptions, imageType: ReturnType<typeof getImageType>, mode: 'openapi' | 'web',
): Promise<string> {
  const value = isRecord(credential) ? credential : {};
  const field = (name: string): string => typeof value[name] === 'string' ? value[name] : '';
  const host = field('host');
  const accessUrl = field('access_url');
  const contentType = mode === 'web' ? `image/${imageType}` : field('oss_content_type');
  const sharedFields = [['OSSAccessKeyId', field('accessid')], ['policy', field('policy')]];
  const fields = mode === 'web'
    ? [...sharedFields, ['Signature', field('signature')], ['key', field('object_key')],
      ['callback', field('callback')], ['success_action_status', '201']]
    : [['key', field('object_key')], ...sharedFields, ['signature', field('signature')],
      ['callback', field('callback')], ['Content-Type', contentType]];
  const failure = t('error.imageUploadFailed', { filename: options.filename });
  if (!isSecureUrl(host) || !isSecureUrl(accessUrl) || fields.some(([, value]) => !value)) throw new Error(failure);

  const body = new FormData();
  for (const [name, value] of fields) body.append(name, value);
  body.append('file', new Blob([options.data], { type: contentType }), options.filename);
  const response = await fetch(host, {
    method: 'POST', body, signal: options.signal, credentials: 'omit', redirect: 'error',
  });
  if (!response.ok) throw new Error(failure);
  const result = parseJsonObjectOrEmpty(await response.text());
  if (!isRecord(result.h) || result.h.c !== 0) throw new Error(failure);
  return accessUrl;
}
