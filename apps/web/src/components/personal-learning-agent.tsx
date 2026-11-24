'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  FolderPlus,
  Link2,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { AgentActivity, type AgentActivityStep } from './agent-activity';
import { LessonSources } from './lesson-sources';
interface Result {
  sources?: { title: string; page: number; text: string; sourceId: string; passageId: string }[];
  planId?: string;
  proposal?: boolean;
  modelId?: string;
  lessons?: { id: string; title: string }[];
  models?: { id: string; title: string }[];
  labels?: unknown[];
}
interface Message {
  role: 'user' | 'assistant';
  content: string;
  taskId?: string;
  result?: Result;
}
interface Thread {
  id: string;
  title: string;
  revision: number;
  folderId: string | null;
  messages: Message[];
}
interface Task {
  input?: { context?: { privateModelId?: string; assetId?: string; asset?: { id: string } } };
  progress?: AgentActivityStep[];
  id: string;
  status: string;
  error: string | null;
  result?: Result;
}
function AgentPresence() {
  return (
    <svg className="agent-orb" viewBox="0 0 220 260" fill="none" aria-hidden="true">
      <ellipse cx="110" cy="218" rx="67" ry="15" fill="#efeff2" />
      {Array.from({ length: 30 }, (_, i) => (
        <ellipse
          key={i}
          cx="110"
          cy={55 + i * 5.1}
          rx="66"
          ry="23"
          stroke={i === 0 || i === 29 ? '#c5c7cd' : '#dedfe5'}
          strokeWidth={i === 0 || i === 29 ? 1.5 : 0.6}
        />
      ))}
      {Array.from({ length: 22 }, (_, i) => (
        <path
          key={i}
          d={`M ${45 + i * 6} 55 Q ${28 + i * 7} 130 ${45 + i * 6} 204`}
          stroke="#e0e1e6"
          strokeWidth="0.7"
        />
      ))}
      <ellipse cx="110" cy="55" rx="66" ry="23" fill="#fafafa" stroke="#c6c8ce" />
      <path d="M110 107l8 20 21 8-21 8-8 21-8-21-21-8 21-8z" fill="white" stroke="#dfe1e8" />
    </svg>
  );
}
export function PersonalLearningAgent() {
  const [threadId, setThreadId] = useState(''),
    [message, setMessage] = useState(''),
    [sourceIds, setSourceIds] = useState<string[]>([]),
    [model, setModel] = useState(''),
    [planId, setPlanId] = useState(''),
    [duration, setDuration] = useState(30),
    [audience, setAudience] = useState('Learners aged 13+'),
    [taskId, setTaskId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [history, setHistory] = useState(false),
    [search, setSearch] = useState(''),
    [folderForm, setFolderForm] = useState(false),
    [folderTitle, setFolderTitle] = useState(''),
    [attachments, setAttachments] = useState(false),
    [settings, setSettings] = useState(false);
  const pending = useRef<{ eventKey: string; message: string } | null>(null),
    bottom = useRef<HTMLDivElement>(null);
  const list = useQuery({
    queryKey: ['agent-threads'],
    queryFn: () =>
      apiFetch<{
        threads: { id: string; title: string; folderId: string | null }[];
        folders: { id: string; title: string }[];
      }>('/learning/agent/threads'),
  });
  const thread = useQuery({
    queryKey: ['agent-thread', threadId],
    queryFn: () => apiFetch<{ thread: Thread }>(`/learning/agent/threads/${threadId}`),
    enabled: !!threadId,
    refetchInterval: taskId ? 2000 : false,
  });
  const models = useQuery({
    queryKey: ['learning-library'],
    queryFn: () => apiFetch<{ models: { id: string; title: string }[] }>('/learning/library'),
  });
  const assets = useQuery({
    queryKey: ['agent-workspace-assets'],
    queryFn: () =>
      apiFetch<{ items: { id: string; name: string; status: string }[] }>('/assets?pageSize=50'),
  });
  const lessons = useQuery({
    queryKey: ['lesson-plans'],
    queryFn: () => apiFetch<{ plans: { id: string; title: string }[] }>('/learning/lesson-plans'),
  });
  const task = useQuery({
    queryKey: ['agent-task', taskId],
    queryFn: () => apiFetch<{ task: Task }>(`/learning/tasks/${taskId}`),
    enabled: !!taskId,
    refetchInterval: (q) =>
      ['completed', 'failed'].includes(q.state.data?.task.status ?? '') ? false : 1500,
  });
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const startingPrompt = sessionStorage.getItem('void-start-prompt');
    if (startingPrompt) {
      setMessage(startingPrompt);
      sessionStorage.removeItem('void-start-prompt');
    }
    if (q.get('attach') === 'true' || sessionStorage.getItem('void-start-attachments') === 'true') {
      setAttachments(true);
      sessionStorage.removeItem('void-start-attachments');
    }
    setThreadId(q.get('thread') ?? '');
    setPlanId(q.get('plan') ?? '');
    if (q.get('asset')) setModel(`asset:${q.get('asset')}`);
    if (q.get('model')) setModel(`private:${q.get('model')}`);
    if (q.get('intent') === 'labels')
      setMessage(
        'Propose component labels for the selected model. Keep uncertain parts unidentified.',
      );
  }, []);
  useEffect(() => {
    if (task.data?.task.status === 'completed') {
      if (task.data.task.result?.planId) setPlanId(task.data.task.result.planId);
      void thread.refetch();
      void list.refetch();
      void lessons.refetch();
    }
    if (task.data?.task.status === 'failed')
      setError(
        task.data.task.error === 'No configured text provider returned a valid response'
          ? 'The AI service could not finish this request. Your conversation and selected model are saved. Try again or continue with an editable lesson.'
          : (task.data.task.error ?? 'The agent could not finish this turn.'),
      );
  }, [task.data?.task.status]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [thread.data?.thread.messages.length]);
  useEffect(() => {
    const last = [...(thread.data?.thread.messages ?? [])].reverse().find((m) => m.taskId);
    if (last?.taskId && !taskId) setTaskId(last.taskId);
  }, [thread.data, taskId]);
  useEffect(() => {
    const result = [...(thread.data?.thread.messages ?? [])]
      .reverse()
      .find((m) => m.role === 'assistant' && m.result?.planId)?.result;
    if (result?.planId) setPlanId(result.planId);
  }, [thread.data?.thread.id]);
  useEffect(() => {
    const context = task.data?.task.input?.context;
    if (model || !context) return;
    const privateId = context.privateModelId;
    const assetId = context.assetId ?? context.asset?.id;
    if (!privateId && !assetId) return;
    setModel(privateId ? `private:${privateId}` : `asset:${assetId}`);
    const url = new URL(location.href);
    url.searchParams.set(privateId ? 'model' : 'asset', (privateId ?? assetId)!);
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [task.data?.task.id]);
  const running = !!taskId && !['completed', 'failed'].includes(task.data?.task.status ?? '');
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!message.trim() || busy || running) return;
    setBusy(true);
    setError('');
    try {
      let current = thread.data?.thread;
      if (!current) {
        const r = await apiFetch<{ thread: Thread }>('/learning/agent/threads', {
          method: 'POST',
          body: { title: message.slice(0, 90) },
        });
        current = r.thread;
        setThreadId(current.id);
        const url = new URL(location.href);
        url.searchParams.set('thread', current.id);
        window.history.replaceState(null, '', url.pathname + url.search);
      }
      const event = pending.current ?? { eventKey: crypto.randomUUID(), message: message.trim() };
      pending.current = event;
      const r = await apiFetch<{ taskId: string }>(
        `/learning/agent/threads/${current.id}/messages`,
        {
          method: 'POST',
          body: {
            ...event,
            revision: current.revision,
            sourceIds,
            durationMinutes: duration,
            audience,
            ...(model.startsWith('private:') ? { privateModelId: model.slice(8) } : {}),
            ...(model.startsWith('asset:') ? { assetId: model.slice(6) } : {}),
            ...(planId ? { planId } : {}),
          },
        },
      );
      pending.current = null;
      setTaskId(r.taskId);
      setMessage('');
      await thread.refetch();
      await list.refetch();
      setAttachments(false);
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 409) {
        pending.current = null;
        await thread.refetch();
      }
    } finally {
      setBusy(false);
    }
  }
  function openThread(id: string) {
    setThreadId(id);
    setModel('');
    setPlanId('');
    setTaskId('');
    setError('');
    pending.current = null;
    setHistory(false);
    window.history.replaceState(null, '', `/console/learn/agent?thread=${id}`);
  }
  return (
    <div className="agent-room">
      <div className="agent-room-heading">
        <h1>Ask AI</h1>
        <div className="agent-room-actions">
          <button
            className="agent-pill"
            aria-label="Search conversations"
            onClick={() => setHistory(!history)}
          >
            <Search size={15} />
            Search thread
          </button>
          <button
            className="agent-pill"
            aria-label="Create conversation folder"
            onClick={() => setFolderForm(!folderForm)}
          >
            <FolderPlus size={15} />
            Create folder
          </button>
          <button
            className="agent-pill primary"
            aria-label="New conversation"
            onClick={() => {
              setThreadId('');
              setPlanId('');
              setTaskId('');
              setMessage('');
              setError('');
              pending.current = null;
              window.history.replaceState(null, '', '/console/learn/agent');
            }}
          >
            <Plus size={16} />
            New chat
          </button>
        </div>
      </div>
      {folderForm && (
        <form
          className="agent-drawer flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void apiFetch('/learning/agent/folders', {
              method: 'POST',
              body: { title: folderTitle },
            })
              .then(() => {
                setFolderForm(false);
                setFolderTitle('');
                void list.refetch();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label className="grid gap-2 text-xs">
            Folder name
            <input
              className="rounded-lg border border-hairline bg-white p-2"
              maxLength={120}
              value={folderTitle}
              onChange={(e) => setFolderTitle(e.target.value)}
            />
          </label>
          <button className="agent-pill primary" disabled={busy || !folderTitle.trim()}>
            Create folder
          </button>
        </form>
      )}
      {history && (
        <section className="agent-thread-list" aria-label="Conversations">
          <label className="flex items-center gap-2 p-2">
            <Search size={16} />
            <input
              className="w-full bg-transparent"
              aria-label="Find conversation"
              placeholder="Search conversations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {list.data?.threads
            .filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
            .map((t) => (
              <button
                className="block w-full rounded-lg p-3 text-left text-xs hover:bg-surface-raised"
                key={t.id}
                onClick={() => openThread(t.id)}
              >
                {t.title}
                {t.folderId && (
                  <span className="ml-2 text-ink-dim">
                    / {list.data?.folders.find((f) => f.id === t.folderId)?.title}
                  </span>
                )}
              </button>
            ))}
          {!list.data?.threads.length && (
            <p className="p-3 text-xs text-ink-dim">Your conversations will appear here.</p>
          )}
        </section>
      )}
      {thread.data?.thread && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-ink-dim">
          <span>{thread.data.thread.title}</span>
          <label className="ml-auto">
            Folder{' '}
            <select
              className="rounded-lg border border-hairline p-2"
              value={thread.data.thread.folderId ?? ''}
              onChange={(e) =>
                void apiFetch(`/learning/agent/threads/${threadId}`, {
                  method: 'PATCH',
                  body: { folderId: e.target.value || null },
                })
                  .then(() => {
                    void thread.refetch();
                    void list.refetch();
                  })
                  .catch((e) => setError(e.message))
              }
            >
              <option value="">No folder</option>
              {list.data?.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {!thread.data?.thread.messages.length ? (
        <section className="agent-hero">
          <AgentPresence />
          <h2>
            <span>Hello, what’s on</span> your mind?
          </h2>
          <p>
            Your personal learning agent. Plan a lesson, explore a model, or work through an idea.
          </p>
        </section>
      ) : (
        <section className="agent-message-list" aria-label="Conversation">
          {thread.data.thread.messages.map((m, i) => (
            <article key={`${m.taskId ?? i}-${m.role}`} className={`agent-message ${m.role}`}>
              <span className="mb-1 block text-[10px] text-ink-dim">
                {m.role === 'user' ? 'You' : 'Void Space'}
              </span>
              {m.content}
              {!!m.result?.sources?.length && (
                <details className="mt-3 whitespace-normal text-xs">
                  <summary className="cursor-pointer">Sources used</summary>
                  {m.result.sources.map((p) => (
                    <blockquote
                      className="mt-3 border-l border-hairline pl-3"
                      key={`${p.sourceId}:${p.passageId}`}
                    >
                      {p.text}
                      <cite className="block">
                        {p.title} · page {p.page}
                      </cite>
                    </blockquote>
                  ))}
                </details>
              )}
              {m.result?.planId && (
                <div className="agent-result">
                  <BookOpen size={22} />
                  <div>
                    <p className="text-[10px] text-ink-dim">
                      {m.result.proposal ? 'Reviewable revision' : 'Private lesson draft'}
                    </p>
                    <Link
                      href={`/console/learn/drafts/${m.result.planId}${m.result.proposal ? `?proposal=${m.taskId}` : ''}`}
                    >
                      {m.result.proposal ? 'Review proposed changes' : 'Open your lesson'}
                    </Link>
                  </div>
                </div>
              )}
              {m.result?.modelId && (
                <div className="agent-result">
                  <Sparkles size={20} />
                  <Link
                    href={`/console/learn/library?model=${m.result.modelId}&proposal=${m.taskId}`}
                  >
                    Review component labels
                  </Link>
                </div>
              )}
              {m.result?.lessons?.map((l) => (
                <div className="agent-result" key={l.id}>
                  <Link href={`/console/learn/drafts/${l.id}`}>{l.title}</Link>
                </div>
              ))}
              {m.result?.models?.map((l) => (
                <div className="agent-result" key={l.id}>
                  <Link href={`/console/learn/library?model=${l.id}`}>{l.title}</Link>
                </div>
              ))}
            </article>
          ))}
          <div ref={bottom} />
        </section>
      )}
      {taskId && (
        <div className="agent-status">
          <AgentActivity
            steps={task.data?.task.progress ?? []}
            status={task.data?.task.status ?? 'queued'}
          />
        </div>
      )}
      {thread.error && (
        <p role="alert" className="agent-status agent-error">
          {thread.error.message}
        </p>
      )}
      {error && (
        <div role="alert" className="agent-status agent-error">
          {error}
          <div className="mt-2 flex flex-wrap gap-3">
            <Link
              className="underline"
              href={
                model.startsWith('private:')
                  ? `/console/learn/library?model=${model.slice(8)}`
                  : model.startsWith('asset:')
                    ? `/console/learn/create?asset=${model.slice(6)}`
                    : '/console/learn/create'
              }
            >
              {model.startsWith('private:')
                ? 'Continue with this model without AI'
                : 'Use editable lesson structure'}
            </Link>
            {thread.data?.thread.messages.at(-1)?.role === 'user' && (
              <button
                className="underline"
                onClick={() => {
                  setMessage(thread.data!.thread.messages.at(-1)!.content);
                  setTaskId('');
                  setError('');
                }}
              >
                Retry request
              </button>
            )}
          </div>
        </div>
      )}
      <div className="agent-composer-wrap">
        {attachments && (
          <div className="agent-drawer">
            <LessonSources selected={sourceIds} onChange={setSourceIds} />
            <Link className="mt-3 inline-block text-xs underline" href="/console/learn/library">
              Upload a private 3D model in Library
            </Link>
          </div>
        )}
        {settings && (
          <div className="agent-drawer grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2 text-xs">
              Audience
              <input
                className="rounded-lg border border-hairline bg-white p-2"
                value={audience}
                maxLength={200}
                onChange={(e) => setAudience(e.target.value)}
              />
            </label>
            <label className="grid gap-2 text-xs">
              Lesson to revise
              <select
                className="rounded-lg border border-hairline bg-white p-2"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                <option value="">Create a new lesson</option>
                {lessons.data?.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <form className="agent-composer" onSubmit={(e) => void send(e)}>
          <label htmlFor="personal-agent-message" className="agent-composer-label">
            <Sparkles size={16} />
            <span>
              <strong className="font-medium text-ink">Ask me anything</strong> — I’m your personal
              learning agent.
            </span>
          </label>
          <textarea
            id="personal-agent-message"
            value={message}
            maxLength={4000}
            onChange={(e) => {
              setMessage(e.target.value);
              pending.current = null;
            }}
            placeholder="Create a 30-minute anatomy lesson using my model, with component labels and a quiz…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="agent-composer-bar">
            <div className="agent-compose-tools">
              <button
                type="button"
                className="agent-compose-tool"
                aria-expanded={attachments}
                onClick={() => setAttachments(!attachments)}
              >
                <Link2 size={13} />
                Attach{sourceIds.length ? ` (${sourceIds.length})` : ''}
              </button>
              <label className="agent-compose-tool">
                <BookOpen size={13} />
                <select
                  aria-label="Choose a model for the agent"
                  value={model}
                  onChange={(e) => {
                    const next = e.target.value;
                    setModel(next);
                    const url = new URL(location.href);
                    url.searchParams.delete('model');
                    url.searchParams.delete('asset');
                    if (next.startsWith('private:')) url.searchParams.set('model', next.slice(8));
                    else if (next.startsWith('asset:'))
                      url.searchParams.set('asset', next.slice(6));
                    window.history.replaceState(null, '', url.pathname + url.search);
                  }}
                >
                  <option value="">Choose a model</option>
                  {models.data?.models.map((m) => (
                    <option value={`private:${m.id}`} key={m.id}>
                      {m.title} · private
                    </option>
                  ))}
                  {assets.data?.items
                    .filter((a) => ['approved', 'published'].includes(a.status))
                    .map((a) => (
                      <option value={`asset:${a.id}`} key={a.id}>
                        {a.name} · workspace
                      </option>
                    ))}
                </select>
              </label>
              <label className="agent-compose-tool">
                <select
                  aria-label="Lesson duration"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {[15, 30, 45, 60, 90, 120].map((n) => (
                    <option key={n} value={n}>
                      {n} min
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="agent-compose-tool"
                onClick={() => setSettings(!settings)}
              >
                Lesson settings
                <ChevronDown size={11} />
              </button>
            </div>
            <button
              className="agent-send"
              type="submit"
              aria-label="Send to personal agent"
              disabled={busy || running || !message.trim()}
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
        {!thread.data?.thread.messages.length && (
          <div className="agent-suggestions">
            <button
              onClick={() =>
                setMessage(
                  'Create a 30-minute lesson about the structure and function of the human heart. Include exploration and quizzes between explanations.',
                )
              }
            >
              Plan an anatomy lesson
            </button>
            <button
              onClick={() =>
                setMessage(
                  'Help me understand the components of my selected model. Ask me for missing context before making factual claims.',
                )
              }
            >
              Explore my 3D model
            </button>
            <button
              onClick={() =>
                setMessage('Find my existing lesson plans so I can continue working on one.')
              }
            >
              Continue a lesson
            </button>
          </div>
        )}
        <p className="mt-3 text-center text-[10px] text-ink-dim">
          Drafts stay private. Review facts and labels before sharing. Ctrl / ⌘ + Enter to send.
        </p>
      </div>
    </div>
  );
}
