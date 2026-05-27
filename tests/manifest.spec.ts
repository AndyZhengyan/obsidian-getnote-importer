import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';

describe('plugin manifest', () => {
  it('keeps old and new GetNote brand terms searchable in the description', () => {
    expect(manifest.description).toContain('GetNote');
    expect(manifest.description).toContain('得到大脑');
    expect(manifest.description).toContain('Get笔记');
  });
});
