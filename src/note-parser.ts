import type { GetNoteNote } from './types';
import { createSourceHash, renderSourceBody } from './source-body';

/**
 * 解析 ISO 时间字符串为 Obsidian 格式
 * "2026-04-27T22:26:17+08:00" → "2026-04-27 22:26:17"
 */
export function formatDateTime(iso: string): string {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (match) {
    return `${match[1]} ${match[2]}`;
  }
  return iso;
}

/**
 * 过滤内容中的非法文件名字符
 */
function sanitizeTitle(title: string | undefined | null): string {
  if (!title || !title.trim()) return '';
  return title.replace(/[\\/:*?"<>|]/g, '').trim();
}

function escapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function sanitizeObsidianTag(tag: string): string {
  return tag.trim().replace(/\s+/g, '-');
}

const PLUGIN_FRONTMATTER_KEYS = new Set([
  'uid',
  'topic_id',
  'title',
  'created',
  'modified',
  'source',
  'note_type',
  'tags',
  'parent_id',
  'prime_id',
  'is_child_note',
  'children_count',
  'children_ids',
  'dedao_sync_schema',
  'dedao_source_hash',
]);

/**
 * 从笔记内容生成回退标题（取第一个标点前的文字，不超过20字）
 */
function fallbackTitle(content: string): string {
  const cleaned = content.replace(/\n/g, ' ').trim();
  if (!cleaned) return '';

  const punctMatch = cleaned.match(/[。，！？；：、,.!?;:]/);
  if (punctMatch && punctMatch.index !== undefined && punctMatch.index > 0 && punctMatch.index <= 20) {
    return cleaned.slice(0, punctMatch.index).trim();
  }
  return cleaned.slice(0, 20).trim();
}

/**
 * 从笔记生成 Obsidian 文件名安全的标题
 * 优先用 note.title，无标题则用正文内容生成
 */
export function generateDisplayTitle(note: GetNoteNote): string {
  if (note.title && note.title.trim()) {
    return sanitizeTitle(note.title);
  }
  return sanitizeTitle(fallbackTitle(note.content || ''));
}

/**
 * 将时间戳格式字符串替换为实际日期值
 * 支持：YYYY, MM, DD, HH, mm, ss
 */
export function formatTimestampPrefix(format: string, isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return '';

  const [, year, month, day, hour, minute, second] = match;

  return format
    .replace(/YYYY/g, year)
    .replace(/MM/g, month)
    .replace(/DD/g, day)
    .replace(/HH/g, hour)
    .replace(/mm/g, minute)
    .replace(/ss/g, second);
}

/**
 * 生成 frontmatter
 */
function frontmatterTags(note: GetNoteNote): string[] {
  return note.tags
    .map(t => sanitizeObsidianTag(t.name))
    .filter(Boolean);
}

function frontmatterTitle(note: GetNoteNote): string {
  return escapeYamlDoubleQuoted(sanitizeTitle(note.title) || sanitizeTitle(note.content || ''));
}

function buildFrontmatter(note: GetNoteNote, extraLines: string[] = [], sourceBody: string = note.content || ''): string {
  const normalizedTags = frontmatterTags(note);
  const tags = normalizedTags.map(tag => `"${escapeYamlDoubleQuoted(tag)}"`).join(', ');
  const tagBlock = tags ? `[${tags}]` : '[]';
  const childrenIds = note.children_ids?.map(id => `"${escapeYamlDoubleQuoted(id)}"`).join(', ');
  const title = frontmatterTitle(note);

  const lines = [
    '---',
    ...extraLines,
    `uid: "${note.note_id}"`,
    `title: "${title}"`,
    `created: ${formatDateTime(note.created_at)}`,
    `modified: ${formatDateTime(note.updated_at)}`,
    `source: 得到大脑`,
    `note_type: ${note.note_type}`,
    `tags: ${tagBlock}`,
    'dedao_sync_schema: 1',
    `dedao_source_hash: "${createSourceHash(title, normalizedTags, sourceBody)}"`,
  ];

  if (note.topic_id) {
    lines.splice(7, 0, `topic_id: "${escapeYamlDoubleQuoted(note.topic_id)}"`);
  }

  if (note.parent_id) {
    lines.push(`parent_id: "${escapeYamlDoubleQuoted(note.parent_id)}"`);
  }
  if (note.prime_id) {
    lines.push(`prime_id: "${escapeYamlDoubleQuoted(note.prime_id)}"`);
  }
  if (typeof note.is_child_note === 'boolean') {
    lines.push(`is_child_note: ${note.is_child_note}`);
  }
  if (typeof note.children_count === 'number') {
    lines.push(`children_count: ${note.children_count}`);
  }
  if (note.children_ids) {
    lines.push(`children_ids: [${childrenIds ?? ''}]`);
  }

  lines.push('---', '');
  return lines.join('\n');
}

/**
 * 生成内部 wiki 链接行（主子文档互链）
 */
function buildRelationLinks(note: GetNoteNote, parentFileName?: string, childFileNames?: string[]): string {
  const lines: string[] = [];

  // 子文档：链接到父文档文件名
  if (note.is_child_note && parentFileName) {
    lines.push(`\n\n> ⬆️ 主笔记: [[${parentFileName}]]`);
  }

  // 父文档：链接到子文档文件名
  if (childFileNames?.length) {
    for (const childName of childFileNames) {
      lines.push(`\n\n> ⬇️ 追加笔记: [[${childName}]]`);
    }
  }

  return lines.join('');
}

function safeAssetRef(path: string): string {
  return /[\s()]/.test(path) ? `<${path}>` : path;
}

function relativeAssetPath(path: string): string {
  const assetIndex = path.lastIndexOf('/asset/');
  return assetIndex >= 0 ? `asset/${path.slice(assetIndex + '/asset/'.length)}` : path;
}

function buildAssetBlock(assetPaths: string[]): string {
  if (!assetPaths.length) return '';
  const groups = assetPaths.reduce(
    (acc, p) => {
      if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/i.test(p)) acc.images.push(p);
      else if (/\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(p)) acc.videos.push(p);
      else acc.others.push(p);
      return acc;
    },
    { images: [] as string[], videos: [] as string[], others: [] as string[] },
  );

  const lines: string[] = [];

  if (groups.images.length > 0) {
    const safePaths = groups.images
      .map(p => {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return null;
        if (/[<>{}|`]/.test(p) || Array.from(p).some(char => char.charCodeAt(0) <= 0x1f)) return null;
        return relativeAssetPath(p);
      })
      .filter((p): p is string => Boolean(p))
      .filter(p => !p.includes('../') && !p.includes('/..'))
      .map(p => `> ![](${safeAssetRef(p)})`);
    if (safePaths.length) {
      lines.push('---', '> 📷 图片');
      lines.push(...safePaths);
      lines.push('---', '');
    }
  }

  if (groups.videos.length > 0) {
    const safePaths = groups.videos
      .filter(p => !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p))
      .map(relativeAssetPath)
      .map(p => `> ![](${safeAssetRef(p)})`);
    lines.push('---', '> 🎬 视频');
    lines.push(...safePaths);
    lines.push('---', '');
  }

  if (groups.others.length > 0) {
    lines.push('---', '> 📎 附件');
    for (const p of groups.others) {
      const name = p.split('/').pop() || p;
      lines.push(`> [${name}](${safeAssetRef(relativeAssetPath(p))})`);
    }
    lines.push('---', '');
  }

  return lines.join('\n');
}

interface TemplateParts {
  frontmatterLines: string[];
  body: string;
}

function splitTemplate(template: string): TemplateParts {
  const normalized = template.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { frontmatterLines: [], body: normalized };
  }

  const lines = normalized.split('\n');
  const closeIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closeIndex < 0) {
    return { frontmatterLines: [], body: normalized };
  }

  return {
    frontmatterLines: lines.slice(1, closeIndex),
    body: lines.slice(closeIndex + 1).join('\n'),
  };
}

function unquoteYamlValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineTagList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return [unquoteYamlValue(trimmed)].filter(Boolean);
  }

  return trimmed
    .slice(1, -1)
    .split(',')
    .map(unquoteYamlValue)
    .filter(Boolean);
}

function cleanTemplateFrontmatter(lines: string[]): { lines: string[]; tags: string[] } {
  const kept: string[] = [];
  const tags: string[] = [];
  let inTagsBlock = false;

  for (const line of lines) {
    const keyMatch = /^([A-Za-z0-9_-]+)\s*:(.*)$/.exec(line);
    if (keyMatch) {
      inTagsBlock = false;
      const key = keyMatch[1];
      const value = keyMatch[2];
      if (key === 'tags') {
        tags.push(...parseInlineTagList(value));
        inTagsBlock = value.trim() === '';
        continue;
      }
      if (PLUGIN_FRONTMATTER_KEYS.has(key)) {
        continue;
      }
    } else if (inTagsBlock) {
      const itemMatch = /^\s*-\s*(.+)$/.exec(line);
      if (itemMatch) {
        tags.push(unquoteYamlValue(itemMatch[1]));
        continue;
      }
      if (!line.trim()) {
        continue;
      }
      inTagsBlock = false;
    }
    kept.push(line);
  }

  return { lines: kept, tags };
}

function mergeTags(noteTags: GetNoteNote['tags'], templateTags: string[]): GetNoteNote['tags'] {
  const merged: GetNoteNote['tags'] = [];
  const seen = new Set<string>();
  const add = (name: string | undefined) => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ name: trimmed });
  };
  for (const tag of noteTags) add(tag.name);
  for (const tag of templateTags) add(tag);
  return merged;
}

function applyTemplateTitle(value: string, note: GetNoteNote): string {
  const title = generateDisplayTitle(note) || note.title || '';
  return value.replace(/\{\{title\}\}/g, title);
}

function appendBody(templateBody: string, body: string): string {
  if (!templateBody.trim()) return body;
  const separator = templateBody.endsWith('\n\n')
    ? ''
    : templateBody.endsWith('\n')
      ? '\n'
      : '\n\n';
  return `${templateBody}${separator}${body}`;
}

function buildLinkOriginalBlock(note: GetNoteNote): string {
  if (!note.linkOriginal?.content || !note.linkOriginalFileName) return '';
  return `---\n> 📄 链接原文\n> [[${note.linkOriginalFileName}]]\n---\n`;
}

function buildBody(note: GetNoteNote, assetFileName?: string, parentFileName?: string, childFileNames?: string[]): string {
  let prefix = '';
  let suffix = '';

  const hasAudioAttachment = note.assetPaths?.some(path => /_audio\.mp3$/i.test(path));
  const hasTranscript = Boolean(note.audio);

  if (hasAudioAttachment) {
    const filename = assetFileName ?? generateDisplayTitle(note);
    const transcriptLine = hasTranscript ? `> 📝 转写\n> [[${filename}_transcript]]\n` : '';
    const audioBlock =
      `---\n` +
      `> 🔊 录音\n` +
      `> ![[${filename}_audio.mp3]]\n` +
      transcriptLine +
      `---\n`;
    prefix = audioBlock;
    if (hasTranscript) {
      const transcriptHeader = '\n### 原始录音转写\n\n';
      suffix += transcriptHeader + note.audio;
    }
  }

  if (note.assetPaths?.length) {
    suffix += '\n' + buildAssetBlock(note.assetPaths);
  } else if ((note.attachments ?? []).some(a => a.type !== 'audio')) {
    suffix += '\n> 📎 附件\n> _(附件将在下次完整同步时显示)_\n';
  }

  suffix += buildRelationLinks(note, parentFileName, childFileNames);
  return prefix + renderSourceBody(note.content || '') + suffix;
}

/**
 * 将 GetNoteNote 渲染为完整的 Markdown 字符串
 */
export function renderNote(note: GetNoteNote, assetFileName?: string, parentFileName?: string, childFileNames?: string[]): string {
  const frontmatter = buildFrontmatter(note, [], note.content || '');
  return frontmatter + buildLinkOriginalBlock(note) + buildBody(note, assetFileName, parentFileName, childFileNames);
}

export function renderNoteWithTemplate(
  note: GetNoteNote,
  template: string,
  assetFileName?: string,
  parentFileName?: string,
  childFileNames?: string[]
): string {
  const parts = splitTemplate(template);
  const cleaned = cleanTemplateFrontmatter(parts.frontmatterLines);
  if (parts.frontmatterLines.some(line => line.includes('{{content}}'))) {
    throw new Error('Template frontmatter cannot contain a content placeholder');
  }
  const contentPlaceholderCount = (parts.body.match(/\{\{content\}\}/g) ?? []).length;
  if (contentPlaceholderCount > 1) {
    throw new Error('Template can contain at most one content placeholder');
  }
  const noteWithMergedTags = {
    ...note,
    tags: mergeTags(note.tags, cleaned.tags),
  };
  const body = buildBody(note, assetFileName, parentFileName, childFileNames);
  const templateBody = applyTemplateTitle(parts.body, noteWithMergedTags);
  const renderedBody = buildLinkOriginalBlock(note) + (parts.body.includes('{{content}}')
    ? templateBody.replace('{{content}}', body)
    : appendBody(templateBody, body));
  const extraLines = cleaned.lines.map(line => applyTemplateTitle(line, noteWithMergedTags));

  return buildFrontmatter(noteWithMergedTags, extraLines, note.content || '') + renderedBody;
}

/**
 * 从 note.title 生成可读标题（用于日志/通知）
 */
export function getNoteTitle(note: GetNoteNote): string {
  if (note.title && note.title.trim()) {
    return note.title.trim();
  }
  const content = note.content || '';
  const preview = content.slice(0, 10).replace(/\n/g, ' ');
  return preview + (content.length > 10 ? '...' : '');
}
