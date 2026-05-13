import { describe, it, expect } from 'vitest';
import { renderNote, getNoteTitle, generateDisplayTitle, formatTimestampPrefix } from '../src/note-parser';
import type { GetNoteNote } from '../src/types';

function makeNote(overrides: Partial<GetNoteNote> = {}): GetNoteNote {
  return {
    id: 1,
    note_id: '12345',
    title: '测试笔记',
    content: '这是正文内容',
    note_type: 'plain_text',
    source: 'app',
    tags: [{ name: 'tag1' }, { name: 'tag2' }],
    created_at: '2026-04-27T22:26:17+08:00',
    updated_at: '2026-04-28T10:00:00+08:00',
    ...overrides,
  };
}

// ---- renderNote ----
describe('renderNote', () => {
  it('生成包含 frontmatter 和正文的完整 markdown', () => {
    const result = renderNote(makeNote());
    expect(result).toContain('---');
    expect(result).toContain('uid: "12345"');
    expect(result).toContain('title: "测试笔记"');
    expect(result).toContain('created: 2026-04-27 22:26:17');
    expect(result).toContain('modified: 2026-04-28 10:00:00');
    expect(result).toContain('source: Get笔记');
    expect(result).toContain('note_type: plain_text');
    expect(result).toContain('tags: ["tag1", "tag2"]');
    expect(result).toContain('这是正文内容');
  });

  it('标题为空时用正文前10字作为 title', () => {
    const result = renderNote(makeNote({ title: '', content: '一段比较长的正文开头部分' }));
    // content.slice(0, 10) = '一段比较长的正文开头' (10个字符)
    expect(result).toContain('title: "一段比较长的正文开头"');
  });

  it('正文回退 title 会转义反斜杠和双引号', () => {
    const result = renderNote(makeNote({ title: '', content: 'a\\b"c\ndefghijkl' }));
    expect(result).toContain('title: "a\\\\b\\"c defg"');
  });

  it('标题含双引号时被过滤（双引号是非法文件名字符）', () => {
    const result = renderNote(makeNote({ title: '他说"你好"世界' }));
    // sanitizeTitle 直接删除双引号，不是转义
    expect(result).toContain('title: "他说你好世界"');
  });

  it('标题含非法文件名字符时过滤掉', () => {
    const result = renderNote(makeNote({ title: 'a:b/c?d*e"f<g>h|i' }));
    expect(result).toContain('title: "abcdefghi"');
  });

  it('tags 为空数组时输出空数组', () => {
    const result = renderNote(makeNote({ tags: [] }));
    expect(result).toContain('tags: []');
  });

  it('正文为空时只输出 frontmatter', () => {
    const result = renderNote(makeNote({ content: '' }));
    expect(result.endsWith('---\n')).toBe(true);
  });
});

// ---- getNoteTitle ----
describe('getNoteTitle', () => {
  it('有标题时返回标题', () => {
    expect(getNoteTitle(makeNote({ title: '我的笔记' }))).toBe('我的笔记');
  });

  it('有标题带首尾空格时去除空格', () => {
    expect(getNoteTitle(makeNote({ title: '  标题  ' }))).toBe('标题');
  });

  it('空标题时用正文前10字', () => {
    expect(getNoteTitle(makeNote({ title: '', content: 'ABCDEFGHIJKLMN' }))).toBe('ABCDEFGHIJ...');
  });

  it('正文不足10字时不加省略号', () => {
    expect(getNoteTitle(makeNote({ title: '', content: '短' }))).toBe('短');
  });

  it('正文含换行符时替换为空格', () => {
    // content.slice(0,10) after replacing \n → 第一行 第二行 第三 (10个中文字符)
    expect(getNoteTitle(makeNote({ title: '', content: '第一行\n第二行\n第三行\n第四行\n' }))).toBe(
      '第一行 第二行 第三...'
    );
  });
});

// ---- sanitizeTitle (private, tested via renderNote) ----
describe('sanitizeTitle (via renderNote)', () => {
  it('空标题时用正文前10字', () => {
    const result = renderNote(makeNote({ title: '', content: '1234567890123' }));
    expect(result).toContain('title: "1234567890"');
  });

  it('过滤 Windows 非法文件名字符', () => {
    const result = renderNote(
      makeNote({ title: 'a\\b/c:d*e?f"g<h>i|j', content: 'body' })
    );
    expect(result).toContain('title: "abcdefghij"');
  });

  it('正常中文标题原样保留', () => {
    const result = renderNote(makeNote({ title: '2026年度总结', content: '' }));
    expect(result).not.toContain('title: ""');
  });
});

// ---- generateDisplayTitle ----
describe('generateDisplayTitle', () => {
  it('有标题时返回清洗后的标题', () => {
    expect(generateDisplayTitle(makeNote({ title: '我的笔记' }))).toBe('我的笔记');
  });

  it('标题含首尾空格时去除空格', () => {
    expect(generateDisplayTitle(makeNote({ title: '  标题  ' }))).toBe('标题');
  });

  it('标题含非法文件名字符时过滤掉', () => {
    expect(generateDisplayTitle(makeNote({ title: 'a:b/c?d*e"f<g>h|i', content: 'body' }))).toBe('abcdefghi');
  });

  it('标题含双引号时被删除', () => {
    expect(generateDisplayTitle(makeNote({ title: '他说"你好"世界', content: 'body' }))).toBe('他说你好世界');
  });

  it('空标题时用正文第一个标点前的文字', () => {
    expect(generateDisplayTitle(makeNote({ title: '', content: '这是第一段。这是第二段内容。' }))).toBe('这是第一段');
  });

  it('空标题时标点在20字之后则取前20字', () => {
    expect(generateDisplayTitle(makeNote({ title: '', content: '这是很长的第一段文字超过二十个字了。这里是第二段。' }))).toBe('这是很长的第一段文字超过二十个字了');
  });

  it('空标题无标点时取前20字', () => {
    expect(generateDisplayTitle(makeNote({ title: '', content: '没有标点的很长的内容' }))).toBe('没有标点的很长的内容');
  });

  it('标题和正文都为空时返回空字符串', () => {
    expect(generateDisplayTitle(makeNote({ title: '', content: '' }))).toBe('');
  });

  it('正文有换行符时被替换为空格', () => {
    const note = makeNote({ title: '', content: '第一行\n第二行有标点。第一段结束。' });
    expect(generateDisplayTitle(note)).toBe('第一行 第二行有标点');
  });
});

// ---- renderNote — audio note ----
describe('renderNote — audio note', () => {
  it('在正文前插入音频链接，并将转写文本追加到正文', () => {
    const note: GetNoteNote = {
      id: 1,
      note_id: 'note_audio_001',
      title: '我的录音',
      content: '### 📑 智能总结\n这是AI摘要',
      note_type: 'recorder_audio',
      source: 'app',
      tags: [],
      created_at: '2026-04-30T12:45:24+08:00',
      updated_at: '2026-04-30T13:00:07+08:00',
      attachments: [
        { type: 'audio', url: 'https://example.com/test.mp3', title: '', duration: 883920 },
      ],
      audio: '🟢 说话人1 [00:00:01]\n测试转写内容',
    };

    const result = renderNote(note);

    // frontmatter 存在
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('note_type: recorder_audio');

    // frontmatter 之后、正文之前有音频链接（blockquote + 分割线格式）
    expect(result).toContain('---\n> 🔊 录音');
    expect(result).toContain('> ![[我的录音_audio.mp3]]');
    expect(result).toContain('> 📝 转写');
    expect(result).toContain('> [[我的录音_transcript]]');
    expect(result).toContain('### 原始录音转写');

    // 转写文本在正文之后
    expect(result).toContain('### 原始录音转写');
    expect(result).toContain('说话人1 [00:00:01]');
  });

  it('无音频附件时行为不变', () => {
    const note: GetNoteNote = {
      id: 1,
      note_id: 'note_001',
      title: '普通笔记',
      content: '正文内容',
      note_type: 'plain_text',
      source: 'app',
      tags: [],
      created_at: '2026-04-30T12:45:24+08:00',
      updated_at: '2026-04-30T13:00:07+08:00',
    };
    const result = renderNote(note);
    expect(result).not.toContain('asset/');
    expect(result).toContain('正文内容');
  });
});

// ---- formatTimestampPrefix ----
describe('formatTimestampPrefix', () => {
  it('YYYY-MM-DD 格式', () => {
    expect(formatTimestampPrefix('YYYY-MM-DD', '2026-04-27T22:26:17+08:00')).toBe('2026-04-27');
  });

  it('YYYYMMDD_HHmm 格式', () => {
    expect(formatTimestampPrefix('YYYYMMDD_HHmm', '2026-04-27T22:26:17+08:00')).toBe('20260427_2226');
  });

  it('HH:mm:ss 格式', () => {
    expect(formatTimestampPrefix('HH:mm:ss', '2026-04-27T22:26:17+08:00')).toBe('22:26:17');
  });

  it('带其他字符的格式', () => {
    expect(formatTimestampPrefix('[YYYY年MM月DD日]', '2026-04-27T22:26:17+08:00')).toBe('[2026年04月27日]');
  });

  it('无效 ISO 日期返回空字符串', () => {
    expect(formatTimestampPrefix('YYYY-MM-DD', 'invalid')).toBe('');
  });
});
