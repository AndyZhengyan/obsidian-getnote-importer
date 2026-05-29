import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';

describe('plugin manifest', () => {
  it('uses sync wording for the bidirectional plugin name', () => {
    expect(manifest.name).toBe('Dedao Brain Sync');
    expect(manifest.name).not.toContain('Importer');
    expect(manifest.name).toMatch(/^[\x20-\x7E]+$/);
  });

  it('keeps legacy and current brand terms searchable in the description', () => {
    expect(manifest.description).toContain('GetNote');
    expect(manifest.description).toContain('得到大脑');
    expect(manifest.description).toContain('Get笔记');
    expect(manifest.description).toContain('得到大脑（原Get笔记）');
    expect(manifest.description.toLowerCase()).toContain('sync');
    expect(manifest.description).not.toContain('migration');
  });
});
