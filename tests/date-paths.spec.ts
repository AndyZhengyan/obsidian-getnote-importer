import { describe, expect, it } from 'vitest';
import {
  buildCanonicalCategoryDir,
  formatCreatedDatePath,
  validateDatePathFormat,
} from '../src/date-paths';

describe('created-date paths', () => {
  it('formats the default YYYY/MM path from created time', () => {
    expect(formatCreatedDatePath('2026-07-03T23:59:00+08:00', 'YYYY/MM'))
      .toBe('2026/07');
  });

  it('supports the DD token and safe separators', () => {
    expect(formatCreatedDatePath('2026-07-03T23:59:00+08:00', 'YYYY/MM/DD'))
      .toBe('2026/07/03');
    expect(formatCreatedDatePath('2026-07-03T23:59:00+08:00', 'YYYY-MM-DD'))
      .toBe('2026-07-03');
  });

  it('places the date before the normal category', () => {
    expect(buildCanonicalCategoryDir(
      '得到大脑',
      '纯文本',
      '2026-07-03T23:59:00+08:00',
      'YYYY/MM',
    )).toBe('得到大脑/2026/07/纯文本');
  });

  it('places knowledge-base notes directly under the complete category hierarchy', () => {
    expect(buildCanonicalCategoryDir(
      '得到大脑',
      '知识库/我的知识库/子目录',
      '',
      'YYYY/MM',
    )).toBe('得到大脑/知识库/我的知识库/子目录');
  });

  it('uses created time rather than any updated time', () => {
    const createdAt = '2024-01-02T03:04:05+08:00';
    const updatedAt = '2026-07-03T23:59:00+08:00';
    expect(formatCreatedDatePath(createdAt, 'YYYY/MM')).toBe('2024/01');
    expect(formatCreatedDatePath(updatedAt, 'YYYY/MM')).not.toBe('2024/01');
  });

  it.each([
    '',
    'YYYY/QQ',
    '../YYYY/MM',
    'YYYY//MM',
    '/YYYY/MM',
    'YYYY/MM/',
    'YYYY\\MM',
    'YYYY/CON/MM',
    'YYYY/AUX.txt/MM',
    'YYYY/COM1/MM',
    'YYYY/LPT9.md/MM',
    'YYYY/folder./MM',
    'YYYY/folder /MM',
  ])('rejects unsafe or unsupported format %j', (format) => {
    expect(validateDatePathFormat(format)).toBe(false);
    expect(() => formatCreatedDatePath('2026-07-03T23:59:00+08:00', format))
      .toThrow();
  });

  it.each(['', 'not-a-date', '2026-02-30T10:00:00+08:00'])(
    'rejects invalid created time %j',
    (createdAt) => {
      expect(() => formatCreatedDatePath(createdAt, 'YYYY/MM')).toThrow();
    },
  );

  it.each(['../纯文本', '知识库/../秘密', '/绝对路径', '知识库\\名字'])(
    'rejects traversal in category path %j',
    (categoryDir) => {
      expect(() => buildCanonicalCategoryDir(
        '得到大脑',
        categoryDir,
        '2026-07-03T23:59:00+08:00',
        'YYYY/MM',
      )).toThrow();
    },
  );

  it.each([
    'CON',
    'PRN.md',
    '知识库/AUX',
    '知识库/NUL.txt',
    '知识库/COM9',
    '知识库/LPT1.backup',
    '知识库/尾随.',
    '知识库/尾随 ',
  ])('rejects Windows-reserved category segment %j', (categoryDir) => {
    expect(() => buildCanonicalCategoryDir(
      '得到大脑',
      categoryDir,
      '2026-07-03T23:59:00+08:00',
      'YYYY/MM',
    )).toThrow();
  });
});
