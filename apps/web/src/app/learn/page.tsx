import Link from 'next/link';
import { API_INTERNAL_URL } from '../../lib/api';
import { starterCatalog } from './starter-catalog';
export const metadata = { title: 'Learn, explore and practise — Void Space' };
export default async function Learn() {
  let items = starterCatalog;
  try {
    const response = await fetch(`${API_INTERNAL_URL}/api/v1/learning/catalog`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) items = (await response.json()).items;
  } catch {}
  return (
    <main id="main" className="mx-auto max-w-6xl space-y-10 px-6 py-14">
      <nav className="flex flex-wrap gap-6">
        <Link href="/">Void Space</Link>
        <Link href="/catalog">Asset marketplace</Link>
        <Link href="/login?next=/console/learn">Sign in</Link>
      </nav>
      <header className="max-w-3xl space-y-5">
        <p className="text-sm text-ink-dim">
          For curious learners, students and educators · Ages 13+
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Understand it.
          <br />
          Explore it. Try it.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-ink-dim">
          Start with your personal AI agent. Create a lesson, explore a model and practise with feedback — on your own or in your institution.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            className="rounded-lg bg-ink px-5 py-3 font-medium text-[color:var(--fc-bg)]"
            href="/learn/signup"
          >
            Start learning
          </Link>
          <Link className="rounded-lg border border-hairline px-5 py-3" href="/learn/discover">
            Explore public lessons
          </Link>
        </div>
      </header>
      <section className="divide-y divide-hairline">
        <h2 className="pb-5 text-2xl font-semibold">Three ways to explore</h2>
        {items.map((item) => (
          <article key={item.id} className="grid gap-4 py-7 sm:grid-cols-[180px_1fr_auto]">
            <p className="text-sm text-ink-dim">
              {item.kind === 'model'
                ? '3D components'
                : item.kind === 'diagram'
                  ? 'Labelled diagram'
                  : 'Process & sequence'}{' '}
              · {item.estimatedMinutes} min
            </p>
            <div className="space-y-2">
              <h3 className="text-xl font-medium">{item.title}</h3>
              <p className="max-w-2xl text-ink-dim">{item.summary}</p>
            </div>
            <Link href={`/console/learn?starter=${item.id}`} className="self-start underline">
              Explore →
            </Link>
          </article>
        ))}
      </section>
      <p className="max-w-2xl text-sm text-ink-dim">
        AI practice stays private. Educators review shared material before publishing. Ordinary
        study and manual authoring work without an AI provider.
      </p>
    </main>
  );
}
