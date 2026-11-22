import { lexer, type MarkedToken, type Token, type Tokens } from 'marked';

interface EditorMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface EditorNode extends EditorMark {
  text?: string;
  marks?: EditorMark[];
  content?: EditorNode[];
}

function textNode(text: string, marks: EditorMark[] = []): EditorNode[] {
  return text ? [{ type: 'text', text, ...(marks.length > 0 ? { marks } : {}) }] : [];
}

function paragraph(content: EditorNode[] = []): EditorNode {
  return { type: 'paragraph', attrs: { textAlign: null }, ...(content.length > 0 ? { content } : {}) };
}

function inlineNodes(tokens: Token[], marks: EditorMark[] = []): EditorNode[] {
  return tokens.flatMap(rawToken => {
    const token = rawToken as MarkedToken;
    switch (token.type) {
      case 'strong':
        return inlineNodes(token.tokens, [...marks, { type: 'bold' }]);
      case 'em':
        return inlineNodes(token.tokens, [...marks, { type: 'italic' }]);
      case 'del':
        return inlineNodes(token.tokens, [...marks, { type: 'strike' }]);
      case 'codespan':
        return textNode(token.text, [...marks, { type: 'code' }]);
      case 'link':
        return /^(?:https?:\/\/|mailto:|tel:|#)/i.test(token.href)
          ? inlineNodes(token.tokens, [...marks, { type: 'link', attrs: { href: token.href } }])
          : textNode(token.raw, marks);
      case 'image':
        return /^(?:https?:)?\/\//i.test(token.href)
          ? [{ type: 'image', attrs: { src: token.href, alt: token.text, title: token.title } }]
          : textNode(token.raw, marks);
      case 'br':
        return [{ type: 'hardBreak' }];
      case 'checkbox':
        return textNode(token.checked ? '[x] ' : '[ ] ', marks);
      case 'text':
        return token.tokens ? inlineNodes(token.tokens, marks) : textNode(token.text, marks);
      case 'escape':
        return textNode(token.text, marks);
      default:
        return textNode(rawToken.raw, marks);
    }
  });
}

function splitImages(nodes: EditorNode[], wrap: (content: EditorNode[]) => EditorNode): EditorNode[] {
  const result: EditorNode[] = [];
  let inline: EditorNode[] = [];
  for (const node of nodes) {
    if (node.type === 'image') {
      if (inline.length > 0) result.push(wrap(inline));
      result.push(node);
      inline = [];
    } else {
      inline.push(node);
    }
  }
  if (inline.length > 0 || result.length === 0) result.push(wrap(inline));
  return result;
}

function tableRow(cells: Tokens.TableCell[], type: 'tableHeader' | 'tableCell'): EditorNode {
  return {
    type: 'tableRow',
    content: cells.map(cell => ({ type, content: splitImages(inlineNodes(cell.tokens), paragraph) })),
  };
}

function listNode(token: Tokens.List): EditorNode {
  const tasks = !token.ordered && token.items.every(item => item.task);
  const content = token.items.map(item => {
    let tokens = item.tokens;
    const first = tokens[0] as Tokens.Paragraph | Tokens.Checkbox | undefined;
    if (tasks && first?.type === 'checkbox') {
      tokens = tokens.slice(1);
    } else if (tasks && first?.type === 'paragraph' && first.tokens[0]?.type === 'checkbox') {
      tokens = [{ ...first, tokens: first.tokens.slice(1) }, ...tokens.slice(1)];
    }
    const blocks = blockNodes(tokens);
    if (blocks[0]?.type !== 'paragraph') blocks.unshift(paragraph());
    return tasks
      ? { type: 'taskItem', attrs: { checked: Boolean(item.checked) }, content: blocks }
      : { type: 'listItem', content: blocks };
  });
  if (tasks) return { type: 'taskList', content };
  if (token.ordered) return { type: 'orderedList', attrs: { start: token.start }, content };
  return { type: 'bulletList', content };
}

function blockNodes(tokens: Token[]): EditorNode[] {
  return tokens.flatMap(rawToken => {
    const token = rawToken as MarkedToken;
    switch (token.type) {
      case 'space':
      case 'def':
        return [];
      case 'heading':
        return splitImages(inlineNodes(token.tokens), content => ({
          type: 'heading', attrs: { level: token.depth, textAlign: null }, content,
        }));
      case 'paragraph':
        return splitImages(inlineNodes(token.tokens), paragraph);
      case 'text':
        return splitImages(token.tokens ? inlineNodes(token.tokens) : textNode(token.text), paragraph);
      case 'blockquote':
        return [{ type: 'blockquote', content: blockNodes(token.tokens) }];
      case 'code':
        return [{ type: 'codeBlock', attrs: { language: token.lang?.split(/\s/, 1)[0] || null }, content: textNode(token.text) }];
      case 'hr':
        return [{ type: 'horizontalRule' }];
      case 'list':
        return [listNode(token)];
      case 'table':
        return [{ type: 'table', content: [
          tableRow(token.header, 'tableHeader'),
          ...token.rows.map(row => tableRow(row, 'tableCell')),
        ] }];
      default:
        return [paragraph(textNode(rawToken.raw))];
    }
  });
}

export function buildWebJsonContent(markdown: string): string {
  return JSON.stringify({ type: 'doc', content: [...blockNodes(lexer(markdown)), paragraph()] });
}
