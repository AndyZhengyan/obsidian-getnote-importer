import type { App, TFile } from 'obsidian';
import { Lexer } from 'marked';
import { uploadImage } from './api';
import { t } from './i18n';
import type { AuthCredentials } from './types';

const IMAGE_EXTENSION = /\.(?:apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
const EXTERNAL_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

interface ImageEmbed {
  index: number;
  original: string;
  target: string;
  alt: string;
  title?: string;
}

/** Collect image embeds while leaving escaped examples, code and comments alone. */
function imageEmbeds(body: string): ImageEmbed[] {
  const fencedCode = /^ {0,3}(?<fence>`{3,}|~{3,})[^\r\n]*(?:\r?\n[\s\S]*?(?:^ {0,3}\k<fence>[`~]*[ \t]*\r?$|(?![\s\S]))|(?![\s\S]))/;
  const inlineCode = /(?<!`)(?<ticks>`+)(?!`)[\s\S]*?(?<!`)\k<ticks>(?!`)/;
  const comment = /<!--[\s\S]*?(?:-->|(?![\s\S]))|%%[\s\S]*?(?:%%|(?![\s\S]))/;
  const wikilink = /!\[\[(?<wiki>[^\]\n]+)\]\]/;
  const markdown = /!\[(?<alt>(?:\\.|[^\]\\\n])*)\]\([ \t]*(?:<(?<angle>[^>\n]+)>|(?<plain>(?:\\.|[^()\\\n]|\([^()\n]*\))*?))(?:[ \t]+(?<title>"[^"\n]*"|'[^'\n]*'))?[ \t]*\)/;
  const reference = /!\[(?<referenceAlt>[^\]\n]+)\](?:\[(?<referenceId>[^\]\n]*)\])?/;
  const tokens = new RegExp([fencedCode, /\\[^\n]/, inlineCode, comment, wikilink, markdown, reference].map(pattern => pattern.source).join('|'), 'gm');
  const embeds: ImageEmbed[] = [];
  let links: ReturnType<typeof Lexer.lex>['links'] | undefined;
  for (const match of body.matchAll(tokens)) {
    const { wiki, alt, angle, plain, title, referenceAlt, referenceId } = match.groups ?? {};
    if (wiki !== undefined) {
      const [target, alias = ''] = wiki.split('|', 2);
      embeds.push({ index: match.index, original: match[0], target: target.trim(), alt: /^\d+(?:x\d+)?$/i.test(alias) ? '' : alias });
    } else if (alt !== undefined) {
      const target = (angle ?? plain ?? '').trim().replace(/\\([()])/g, '$1');
      embeds.push({ index: match.index, original: match[0], target, alt, title });
    } else if (referenceAlt !== undefined) {
      links ??= Lexer.lex(body).links;
      const key = (referenceId || referenceAlt).trim().replace(/\s+/g, ' ').toLowerCase();
      const link = Object.hasOwn(links, key) ? links[key] : undefined;
      if (link) embeds.push({ index: match.index, original: match[0], target: link.href,
        alt: referenceAlt, title: link.title ? JSON.stringify(link.title) : undefined });
    }
  }
  return embeds;
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function imageLabel(value: string): string {
  return value.replace(/(?<!\\)[[\]]/g, '\\$&');
}

function isDedaoImage(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'get-notes.umiwi.com' || host.endsWith('.biji.com') || host.endsWith('.aliyuncs.com');
  } catch {
    return false;
  }
}

export async function prepareUploadImages(
  app: App,
  file: TFile,
  body: string,
  credentials: AuthCredentials,
  signal: AbortSignal,
  purpose: 'create' | 'update',
): Promise<string> {
  const uploaded = new Map<string, string>();
  const parts: string[] = [];
  let offset = 0;
  for (const embed of imageEmbeds(body)) {
    if (EXTERNAL_URL.test(embed.target)) {
      // Older OpenAPI create endpoints reject image markup with third-party URLs.
      if (purpose === 'create' && credentials.authMode === 'openapi' && /^https?:\/\//i.test(embed.target) && !isDedaoImage(embed.target)) {
        parts.push(body.slice(offset, embed.index), `[${imageLabel(embed.alt || embed.target)}](${embed.target}${embed.title ? ` ${embed.title}` : ''})`);
        offset = embed.index + embed.original.length;
      }
      continue;
    }
    const path = decodePath(embed.target.split('#', 1)[0]);
    if (!IMAGE_EXTENSION.test(path)) continue;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const attachment = app.metadataCache.getFirstLinkpathDest(path, file.path);
    if (!attachment || !IMAGE_EXTENSION.test(attachment.name)) throw new Error(t('reverseSync.imageMissing', { path }));
    let url = uploaded.get(attachment.path);
    if (!url) {
      const data = await app.vault.readBinary(attachment);
      url = await uploadImage({ ...credentials, filename: attachment.name, data, signal });
      uploaded.set(attachment.path, url);
    }
    const label = imageLabel(embed.alt || (embed.original.startsWith('![[') ? attachment.basename : ''));
    parts.push(body.slice(offset, embed.index), `![${label}](${url}${embed.title ? ` ${embed.title}` : ''})`);
    offset = embed.index + embed.original.length;
  }
  return parts.length ? parts.join('') + body.slice(offset) : body;
}
