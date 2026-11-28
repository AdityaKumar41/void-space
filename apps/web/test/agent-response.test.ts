import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AgentResponse } from '../src/components/agent-response';
it('renders explanations with semantic structure and only inert model content', () => {
  const html = renderToStaticMarkup(
    createElement(AgentResponse, {
      content:
        '# Explore\n\n1. **Cube** has faces.\n2. `Sphere` is curved.\n\n<img src=x onerror=alert(1)>\n\n```js\nalert(1)\n```',
    }),
  );
  expect(html).toContain('<h3>Explore</h3>');
  expect(html).toContain('<ol><li><strong>Cube</strong>');
  expect(html).toContain('<code>Sphere</code>');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('<script');
  expect(html).toContain('&lt;img');
  expect(html).toContain('<pre><code>alert(1)</code></pre>');
});
it('turns attached reference IDs into source names without inventing references', () => {
  const html = renderToStaticMarkup(
    createElement(AgentResponse, {
      content: 'Source: source-123, passage p1. Unknown: source-456.',
      sources: [{ sourceId: 'source-123', passageId: 'p1', title: 'Geometry notes', page: 1 }],
    }),
  );
  expect(html).toContain('Source: Geometry notes');
  expect(html).not.toContain('source-123');
  expect(html).toContain('source-456');
});
