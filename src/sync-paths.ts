import { t } from './i18n';
import { generateDisplayTitle, formatTimestampPrefix } from './note-parser';
import type { GetNoteNote, Settings } from './types';
import { KNOWLEDGE_BASE_CATEGORY } from './date-paths';

function sanitizeKnowledgeBaseSegment(name: string): string {
  const sanitized = name.replace(/[\\/:*?"<>|\0]/g, '_').trim().replace(/^\.+|\.+$/g, '_');
  if (/^(?:asset$|(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$))/i.test(sanitized)) return `_${sanitized}`;
  return sanitized || t('picker.noTitle');
}

export function getKnowledgeBaseDir(name: string, directoryPath: readonly string[] = []): string {
  return [KNOWLEDGE_BASE_CATEGORY, ...[name, ...directoryPath].map(sanitizeKnowledgeBaseSegment)].join('/');
}

export function buildNoteBaseName(note: GetNoteNote, settings: Pick<Settings, 'filenamePrefix'>): string {
  const rawTitle = generateDisplayTitle(note);
  const displayTitle = rawTitle || t('picker.noTitle');
  const prefix = settings.filenamePrefix?.trim();
  if (!prefix) return displayTitle;

  const hasTimestampTokens = /YYYY|MM|DD|HH|mm|ss/.test(prefix);
  if (hasTimestampTokens) {
    const formattedPrefix = formatTimestampPrefix(prefix, note.created_at);
    if (!formattedPrefix) {
      return displayTitle;
    }
    const separator = formattedPrefix.endsWith('_') ? '' : '_';
    return `${formattedPrefix}${separator}${displayTitle}`;
  }

  const separator = prefix.endsWith('_') ? '' : '_';
  return `${prefix}${separator}${displayTitle}`;
}

export function getFileName(note: GetNoteNote, settings: Pick<Settings, 'filenamePrefix'>, parentBaseName?: string): string {
  if (parentBaseName) {
    const childTitle = generateDisplayTitle(note) || t('picker.noTitle');
    return `${parentBaseName}__${childTitle}`;
  }
  return buildNoteBaseName(note, settings);
}

export function getAudioAssetBaseName(note: GetNoteNote, settings: Pick<Settings, 'filenamePrefix'>): string {
  const safeNoteId = note.note_id.replace(/[\\/:*?"<>|]/g, '_');
  return `${getFileName(note, settings)}_${safeNoteId}`;
}

export function getFilePath(categoryDir: string, note: GetNoteNote, settings: Pick<Settings, 'filenamePrefix'>): string {
  return `${categoryDir}/${getFileName(note, settings)}.md`;
}
