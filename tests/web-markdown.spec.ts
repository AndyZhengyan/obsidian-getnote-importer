import { describe, expect, it } from 'vitest';
import { buildWebJsonContent } from '../src/api-clients/web-markdown';

describe('Web note editor Markdown', () => {
  it('retains headings, combined emphasis, links and inline images', () => {
    const document = JSON.parse(buildWebJsonContent(
      '# Heading\n\n**strong and *emphasis*** [link](https://example.com) ![alt](https://example.com/p.png "Caption")',
    ));
    expect(document).toMatchObject({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Heading' }] },
        { type: 'paragraph', content: [
          { type: 'text', marks: [{ type: 'bold' }], text: 'strong and ' },
          { type: 'text', marks: [{ type: 'bold' }, { type: 'italic' }], text: 'emphasis' },
          { type: 'text', text: ' ' },
          { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }], text: 'link' },
          { type: 'text', text: ' ' },
        ] },
        { type: 'image', attrs: { src: 'https://example.com/p.png', alt: 'alt', title: 'Caption' } },
        { type: 'paragraph' },
      ],
    });
  });

  it('keeps nested lists, quoted code and tables as editor blocks', () => {
    const document = JSON.parse(buildWebJsonContent([
      '2. First', '   - Nested', '', '> `inline`', '', '```js', 'const x = 1;', '```',
      '', '| name |', '| --- |', '| value |',
    ].join('\n')));
    expect(document.content).toMatchObject([
      { type: 'orderedList', attrs: { start: 2 }, content: [
        { type: 'listItem', content: [{ type: 'paragraph' }, { type: 'bulletList' }] },
      ] },
      { type: 'blockquote', content: [
        { type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: 'inline' }] },
      ] },
      { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const x = 1;' }] },
      { type: 'table', content: [
        { type: 'tableRow', content: [{ type: 'tableHeader' }] },
        { type: 'tableRow', content: [{ type: 'tableCell' }] },
      ] },
      { type: 'paragraph' },
    ]);
  });

  it('retains task status and leaves unsupported link schemes as text', () => {
    const document = JSON.parse(buildWebJsonContent('- [x] done\n- [ ] next\n\n[note](obsidian://open)'));
    expect(document.content).toMatchObject([
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ text: 'done' }] }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ text: 'next' }] }] },
      ] },
      { type: 'paragraph', content: [{ type: 'text', text: '[note](obsidian://open)' }] },
      { type: 'paragraph' },
    ]);
  });
});
