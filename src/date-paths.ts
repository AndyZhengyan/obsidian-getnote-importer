const DATE_TOKEN_PATTERN = /YYYY|MM|DD/g;
const SAFE_SEPARATOR_PATTERN = /^[\/._ -]*$/;
const RESERVED_SEGMENT_PATTERN = /[\\:*?"<>|\0]/;
const WINDOWS_DEVICE_SEGMENT_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

export const KNOWLEDGE_BASE_CATEGORY = '知识库';

export function isKnowledgeBaseCategory(categoryDir: string): boolean {
  return categoryDir.startsWith(`${KNOWLEDGE_BASE_CATEGORY}/`);
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.endsWith('/') || path.includes('\\')) return false;
  return path.split('/').every(segment =>
    segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.endsWith('.')
    && !segment.endsWith(' ')
    && !WINDOWS_DEVICE_SEGMENT_PATTERN.test(segment)
    && !RESERVED_SEGMENT_PATTERN.test(segment)
  );
}

function parseCreatedDate(createdAt: string): { year: string; month: string; day: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(createdAt.trim());
  if (!match || Number.isNaN(Date.parse(createdAt))) {
    throw new Error('Invalid created timestamp');
  }

  const [, year, month, day] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const daysInMonth = new Date(Date.UTC(numericYear, numericMonth, 0)).getUTCDate();
  if (numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > daysInMonth) {
    throw new Error('Invalid created timestamp');
  }

  return { year, month, day };
}

export function validateDatePathFormat(format: string): boolean {
  const trimmed = format.trim();
  if (!trimmed || !DATE_TOKEN_PATTERN.test(trimmed)) return false;
  DATE_TOKEN_PATTERN.lastIndex = 0;

  const separators = trimmed.replace(DATE_TOKEN_PATTERN, '');
  DATE_TOKEN_PATTERN.lastIndex = 0;
  if (!SAFE_SEPARATOR_PATTERN.test(separators)) return false;

  const sample = trimmed
    .replaceAll('YYYY', '2026')
    .replaceAll('MM', '07')
    .replaceAll('DD', '03');
  return isSafeRelativePath(sample);
}

export function formatCreatedDatePath(createdAt: string, format: string): string {
  const trimmedFormat = format.trim();
  if (!validateDatePathFormat(trimmedFormat)) {
    throw new Error('Invalid date path format');
  }

  const { year, month, day } = parseCreatedDate(createdAt);
  const path = trimmedFormat
    .replaceAll('YYYY', year)
    .replaceAll('MM', month)
    .replaceAll('DD', day);
  if (!isSafeRelativePath(path)) {
    throw new Error('Unsafe date path');
  }
  return path;
}

export function buildCanonicalCategoryDir(
  rootFolder: string,
  categoryDir: string,
  createdAt: string,
  format: string,
): string {
  if (rootFolder !== rootFolder.trim() || categoryDir !== categoryDir.trim()) {
    throw new Error('Unsafe category path');
  }
  const root = rootFolder;
  const category = categoryDir;
  if (!isSafeRelativePath(root) || !isSafeRelativePath(category)) {
    throw new Error('Unsafe category path');
  }
  if (isKnowledgeBaseCategory(category)) return `${root}/${category}`;
  return `${root}/${formatCreatedDatePath(createdAt, format)}/${category}`;
}
