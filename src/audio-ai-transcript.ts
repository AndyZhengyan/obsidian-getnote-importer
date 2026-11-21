import { t } from './i18n';
import { parseSourceBody, SOURCE_BODY_END } from './source-body';
import type { GetNoteNote } from './types';

const START = '<!-- dedao-brain-sync:audio-ai-transcript:start -->';
const END = '<!-- dedao-brain-sync:audio-ai-transcript:end -->';

export function readTranscriptScalar(content: string, key: 'uid' | 'dedao_parent_uid' | 'dedao_generated_asset' | 'dedao_transcript_variant'): string | undefined {
  const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!fm) return undefined;
  const match = new RegExp(`^${key}[ \\t]*:[ \\t]*("(?:[^"\\\\]|\\\\.)*"|'(?:[^']|'')*'|[^\\r\\n]*?)[ \\t]*(?:#.*)?$`, 'm').exec(fm[1]);
  if (!match) return undefined;
  const raw = match[1].trim();
  if (raw.startsWith('"')) {
    try { const value: unknown = JSON.parse(raw); return typeof value === 'string' ? value : undefined; }
    catch { return undefined; }
  }
  if (raw.startsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw && !/^(?:null$|~$|[\[\]{}>|&*!])/.test(raw) ? raw : undefined;
}

export function renderAudioAiTranscriptBlock(note: Pick<GetNoteNote, 'audioAiTranscriptPath' | 'audioAiTranscriptError'>, parentPath?: string): string {
  let body = '';
  if (note.audioAiTranscriptPath) {
    let path = note.audioAiTranscriptPath;
    if (parentPath) {
      const parent = parentPath.slice(0, parentPath.lastIndexOf('/') + 1);
      if (path.startsWith(parent)) path = path.slice(parent.length);
    } else {
      const assetIndex = path.lastIndexOf('/asset/');
      if (assetIndex >= 0) path = path.slice(assetIndex + 1);
    }
    // URI-encode Markdown delimiters while preserving directory separators.
    const target = path.split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16)}`)).join('/');
    body = `> [${t('audioAiTranscript.label')}](${target})`;
  } else if (note.audioAiTranscriptError) {
    body = `> ⚠ ${note.audioAiTranscriptError.replace(/[\r\n]+/g, ' ')}`;
  }
  return body ? `${START}\n${body}\n${END}` : '';
}

/** Replace only our generated block; never change source-body or user text. */
export function upsertAudioAiTranscriptBlock(content: string, block: string): string {
  if (!block) return content;
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  const source = parseSourceBody(content);
  if (source.kind === 'invalid') throw new Error('Invalid source markers; existing content preserved');
  if (start < 0 && end < 0) return `${content}\n\n${block}\n`;
  if (start < 0 || end < start || content.indexOf(START, start + START.length) >= 0 || content.indexOf(END, end + END.length) >= 0) {
    throw new Error('Ambiguous AI transcript reference block; existing content preserved');
  }
  const sourceEnd = content.indexOf(SOURCE_BODY_END);
  if (source.kind === 'valid' && start < sourceEnd) {
    throw new Error('AI transcript reference overlaps source content; existing content preserved');
  }
  return content.slice(0, start) + block + content.slice(end + END.length);
}
