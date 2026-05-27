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

function escapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
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
  const childrenIds = note.children_ids?.map(id => `"${escapeYamlDoubleQuoted(id)}"`).join(', ');

  const title = sanitizeTitle(note.title) ||
    escapeYamlDoubleQuoted(sanitizeTitle(note.content || ''));

  const lines = [
    '---',
    `uid: "${note.note_id}"`,
    `title: "${title}"`,
    `created: ${formatDateTime(note.created_at)}`,
    `modified: ${formatDateTime(note.updated_at)}`,
    `source: Get笔记`,
    `note_type: ${note.note_type}`,
    `tags: ${tagBlock}`,
  ];

  if (note.parent_id) {
    lines.push(`parent_id: "${escapeYamlDoubleQuoted(note.parent_id)}"`);
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

function buildImageBlock(assetPaths: string[]): string {
  if (!assetPaths.length) return '';
  const markdownImageTarget = (path: string): string => /[\s()]/.test(path) ? `<${path}>` : path;
  const imageLines = assetPaths
    .map(p => {
      // Reject any URL scheme (http/https/data/javascript) — only vault-relative paths allowed
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return null;
      // Reject paths with control characters or suspicious patterns
      if (/[<>{}|\\`\x00-\x1f]/.test(p)) return null;
      if (!/\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/i.test(p)) return null;
      const assetIndex = p.lastIndexOf('/asset/');
      const relativePath = assetIndex >= 0 ? `asset/${p.slice(assetIndex + '/asset/'.length)}` : p;
      if (!relativePath.startsWith('asset/')) return null;
      if (relativePath.includes('../') || relativePath.includes('/..')) return null;
      return relativePath;
    })
    .filter((p): p is string => Boolean(p))
    .map(p => `> ![](${markdownImageTarget(p)})`)
    .join('\n');
  return `---\n> 📷 图片\n${imageLines}\n---\n`;
}

/**
 * 将 GetNoteNote 渲染为完整的 Markdown 字符串
 */
export function renderNote(note: GetNoteNote, assetFileName?: string, parentFileName?: string, childFileNames?: string[]): string {
  const frontmatter = buildFrontmatter(note);
  let body = note.content || '';

  const hasAudio = note.attachments?.some(a => a.type === 'audio') && note.audio;

  if (hasAudio) {
    const filename = assetFileName ?? generateDisplayTitle(note);
    const audioBlock =
      `---\n` +
      `> 🔊 录音\n` +
      `> ![[${filename}_audio.mp3]]\n` +
      `> 📝 转写\n` +
      `> [[${filename}_transcript]]\n` +
      `---\n`;
    const transcriptHeader = '\n### 原始录音转写\n\n';
    body = audioBlock + body + transcriptHeader + note.audio;
  }

  if (note.assetPaths?.length) {
    body += '\n' + buildImageBlock(note.assetPaths);
  } else if ((note.attachments ?? []).some(a => a.type === 'image')) {
    body += '\n> 📷 图片\n> _(图片将在下次完整同步时显示)_\n';
  }

  // 添加主子文档互链
  body += buildRelationLinks(note, parentFileName, childFileNames);

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
