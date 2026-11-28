import React, { Fragment, type ReactNode } from 'react';
export interface ResponseSource {
  sourceId: string;
  passageId: string;
  title: string;
  page: number;
}
/** Render a small, inert prose subset. Model output never becomes HTML or executable links. */
function inline(text: string): ReactNode {
  return text
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith('`') && part.endsWith('`') ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}
export function AgentResponse({
  content,
  sources = [],
}: {
  content: string;
  sources?: ResponseSource[];
}) {
  // Substitute only validated references attached to this response, never unknown identifiers.
  let text = content;
  for (const source of sources) text = text.replaceAll(source.sourceId, source.title);
  const lines = text.replace(/\r\n/g, '\n').split('\n'),
    blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) code.push(lines[i++]!);
      if (i < lines.length) i++;
      blocks.push(
        <pre key={blocks.length}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      blocks.push(<h3 key={blocks.length}>{inline(heading[1]!)}</h3>);
      i++;
      continue;
    }
    const listItem = line.match(/^(?:([-*])\s+|\d+[.)]\s+)(.+)$/);
    if (listItem) {
      const ordered = !listItem[1],
        items: ReactNode[] = [];
      while (i < lines.length) {
        const item = lines[i]!.trim().match(ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!item) break;
        items.push(<li key={items.length}>{inline(item[1]!)}</li>);
        i++;
      }
      blocks.push(
        ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>,
      );
      continue;
    }
    const paragraph = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(?:#{1,6}\s|[-*]\s|\d+[.)]\s|```)/.test(lines[i]!.trim())
    )
      paragraph.push(lines[i++]!.trim());
    blocks.push(<p key={blocks.length}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="agent-response">{blocks}</div>;
}
