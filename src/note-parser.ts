import type { GetNoteNote } from './types';

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
function buildFrontmatter(note: GetNoteNote): string {
  const tags = note.tags.map(t => `"${t.name}"`).join(', ');
  const tagBlock = tags ? `[${tags}]` : '[]';

  const title = sanitizeTitle(note.title) ||
    (note.content || '').slice(0, 10).replace(/"/g, '\\"').replace(/\n/g, ' ');

  const lines = [
    '---',
    `uid: "${note.note_id}"`,
    `title: "${title}"`,
    `created: ${formatDateTime(note.created_at)}`,
    `modified: ${formatDateTime(note.updated_at)}`,
    `source: Get笔记`,
    `note_type: ${note.note_type}`,
    `tags: ${tagBlock}`,
    '---',
    '',
  ];

  return lines.join('\n');
}

/**
 * 将 GetNoteNote 渲染为完整的 Markdown 字符串
 */
export function renderNote(note: GetNoteNote): string {
  const frontmatter = buildFrontmatter(note);
  let body = note.content || '';

  if (note.attachments?.some(a => a.type === 'audio') && note.audio) {
    const filename = generateDisplayTitle(note);
    const audioLink = `[🔊 录音](asset/${filename}.mp3)\n[📝 转写](asset/${filename}.md)\n`;
    const transcriptHeader = '\n\n---\n\n### 原始录音转写\n\n';
    body = audioLink + body + transcriptHeader + note.audio;
  }

  return frontmatter + body;
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
