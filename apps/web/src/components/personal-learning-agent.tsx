'use client';
import { ModelPicker } from './model-picker';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  Square,
  LoaderCircle,
  BookOpen,
  ChevronDown,
  FolderPlus,
  Link2,
  Plus,
  Search,
  Sparkles,
  History,
  ImagePlus,
  X,
} from 'lucide-react';
import { useSession } from '../lib/session';
import { apiFetch, API_PUBLIC_BASE } from '../lib/api';
import { AgentActivity, type AgentActivityStep } from './agent-activity';
import { LessonSources } from './lesson-sources';
import { LearningHistoryDialog } from './learning-history-dialog';
import { AgentResponse } from './agent-response';
interface Result {
  sources?: { title: string; page: number; text: string; sourceId: string; passageId: string }[];
  planId?: string;
  proposal?: boolean;
  modelId?: string;
  lessons?: { id: string; title: string }[];
  models?: { id: string; title: string }[];
  labels?: unknown[];
  sourceId?: string;
  image?: boolean;
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
  kind?: string;
  input?: {
    threadId?: string;
    context?: {
      privateModelId?: string;
      assetId?: string;
      asset?: { id: string };
      sourceIds?: string[];
      durationMinutes?: number;
      audience?: string;
      planId?: string;
    };
  };
  progress?: AgentActivityStep[];
  id: string;
  status: string;
  error: string | null;
  result?: Result;
}
type ActivityPage = {
  nextCursor: string | null;
  imageAvailable: boolean;
  tasks: (Task & {
    kind: string;
    title: string;
    threadId?: string;
    planId?: string;
    modelId?: string;
    sourceId?: string;
    format?: string;
    createdAt: string;
  })[];
};
export function PersonalLearningAgent() {
  const router = useRouter();
  const { session } = useSession();
  const client = useQueryClient();
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
    [historyTab, setHistoryTab] = useState<'conversations' | 'activity'>('conversations'),
    [folderForm, setFolderForm] = useState(false),
    [folderTitle, setFolderTitle] = useState(''),
    [attachments, setAttachments] = useState(false),
    [settings, setSettings] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    const resize = () => {
      node.style.height = '0px';
      node.style.height = `${node.value ? Math.min(node.scrollHeight, 180) : 48}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [message]);
  const restoredContext = useRef('');
  const pending = useRef<{ eventKey: string; message: string } | null>(null),
    bottom = useRef<HTMLDivElement>(null);
  const activity = useInfiniteQuery({
    initialPageParam: '',
    getNextPageParam: (last: ActivityPage) => last.nextCursor ?? undefined,
    queryKey: ['agent-activity-history', session?.tenant.id, session?.user.id],
    queryFn: ({ pageParam }) =>
      apiFetch<ActivityPage>(`/learning/agent/activity${pageParam ? `?cursor=${pageParam}` : ''}`),
    refetchInterval: history ? 5000 : false,
  });
  const activities = activity.data?.pages.flatMap((p) => p.tasks) ?? [];
  const conversationHistory = useInfiniteQuery({
    initialPageParam: '',
    getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
    queryKey: ['agent-threads', session?.tenant.id, session?.user.id],
    queryFn: ({ pageParam }) =>
      apiFetch<{
        nextCursor: string | null;
        threads: { id: string; title: string; folderId: string | null }[];
        folders: { id: string; title: string }[];
      }>(`/learning/agent/threads${pageParam ? `?cursor=${pageParam}` : ''}`),
  });
  const list = {
    ...conversationHistory,
    data: conversationHistory.data
      ? {
          threads: conversationHistory.data.pages.flatMap((p) => p.threads),
          folders: conversationHistory.data.pages[0]?.folders ?? [],
        }
      : undefined,
  };
  const thread = useQuery({
    queryKey: ['agent-thread', threadId],
    queryFn: () =>
      apiFetch<{ thread: Thread; tasks: Task[] }>(`/learning/agent/threads/${threadId}`),
    enabled: !!threadId,
    refetchInterval: (q) =>
      q.state.data?.tasks.some((t) => ['queued', 'active'].includes(t.status)) ? 2000 : false,
  });
  const selectedModel = useQuery({
    queryKey: ['model-picker-selected', model],
    enabled: !!model,
    retry: false,
    queryFn: ({ signal }) =>
      apiFetch<{ item: { title: string } }>(
        `/learning/model-picker/selected?reference=${encodeURIComponent(model)}`,
        { signal },
      ),
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
      ['completed', 'failed', 'cancelled'].includes(q.state.data?.task.status ?? '') ? false : 1500,
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
    const incomingSources = (q.get('sources') ?? '')
      .split(',')
      .filter((id) => /^[a-f0-9-]{36}$/i.test(id));
    if (incomingSources.length) setSourceIds([...new Set(incomingSources)].slice(0, 20));
    setThreadId(q.get('thread') ?? '');
    if (q.get('task')) {
      setTaskId(q.get('task')!);
      setHistoryTab('activity');
    }
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
      if (task.data.task.result?.modelId && task.data.task.result.labels) {
        router.push(
          `/console/learn/library/${task.data.task.result.modelId}/annotate?thread=${threadId}&proposal=${taskId}`,
        );
      }

      if (task.data.task.result?.sourceId)
        void client.invalidateQueries({ queryKey: ['learning-sources'] });
      if (task.data.task.result?.planId) setPlanId(task.data.task.result.planId);
      void thread.refetch();
      void list.refetch();
      void lessons.refetch();
      void activity.refetch();
    }
    if (task.data?.task.status === 'failed')
      setError(
        task.data.task.error === 'No configured text provider returned a valid response'
          ? 'The AI service could not finish this request. Your conversation and selected model are saved. Try again or continue with an editable lesson.'
          : (task.data.task.error ?? 'The agent could not finish this turn.'),
      );
  }, [task.data?.task.id, task.data?.task.status]);
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
    if (
      !context ||
      task.data?.task.id !== taskId ||
      !threadId ||
      (task.data.task.input?.threadId && task.data.task.input.threadId !== threadId)
    )
      return;
    if (restoredContext.current === threadId) return;
    {
      if (!sourceIds.length) setSourceIds(context.sourceIds ?? []);
      if (context.durationMinutes) setDuration(context.durationMinutes);
      if (context.audience) setAudience(context.audience);
      restoredContext.current = threadId;
    }
    if (model || new URLSearchParams(location.search).get('modelSelection') === 'none') return;
    const privateId = context.privateModelId;
    const assetId = context.assetId ?? context.asset?.id;
    if (!privateId && !assetId) return;
    setModel(privateId ? `private:${privateId}` : `asset:${assetId}`);
    const url = new URL(location.href);
    url.searchParams.set(privateId ? 'model' : 'asset', (privateId ?? assetId)!);
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [task.data?.task.id, threadId]);
  const running =
    !!taskId && !['completed', 'failed', 'cancelled'].includes(task.data?.task.status ?? '');
  useEffect(() => {
    if (!running || task.data?.task.kind !== 'agent_turn' || typeof EventSource === 'undefined')
      return;
    const events = new EventSource(`${API_PUBLIC_BASE}/learning/agent/runs/${taskId}/events`, {
      withCredentials: true,
    });
    events.onmessage = () => {
      void task.refetch();
    };
    events.addEventListener('terminal', () => {
      events.close();
      void task.refetch();
      void thread.refetch();
    });
    events.onerror = () => events.close(); // Existing polling remains the recovery path.
    return () => events.close();
  }, [taskId, running, task.data?.task.kind]);
  function chooseModel(next: string) {
    restoredContext.current = threadId;
    setModel(next);
    const url = new URL(location.href);
    for (const key of ['model', 'asset', 'modelSelection']) url.searchParams.delete(key);
    if (next.startsWith('private:')) url.searchParams.set('model', next.slice(8));
    else if (next.startsWith('asset:')) url.searchParams.set('asset', next.slice(6));
    else url.searchParams.set('modelSelection', 'none');
    window.history.replaceState(null, '', url.pathname + url.search);
  }
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!message.trim() || busy || running || (threadId && !thread.data)) return;
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
      if (model.startsWith('private:') && /annotat|\blabel|\bpin(?:s)?\b/i.test(message)) {
        sessionStorage.setItem(`void-annotation-prompt:${current.id}`, message.trim());
        router.push(
          `/console/learn/library/${model.slice(8)}/annotate?thread=${current.id}&compose=1`,
        );
        setMessage('');
        return;
      }
      const event =
        pending.current?.message === message.trim()
          ? pending.current
          : { eventKey: crypto.randomUUID(), message: message.trim() };
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
      await client.invalidateQueries({ queryKey: ['agent-thread', current.id] });
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
    restoredContext.current = '';
    setThreadId(id);
    setModel('');
    setSourceIds([]);
    setPlanId('');
    setTaskId('');
    setError('');
    pending.current = null;
    setHistory(false);
    setHistoryTab('conversations');
    window.history.replaceState(null, '', `/console/learn/agent?thread=${id}`);
  }
  return (
    <div className={'agent-room' + (!threadId && !taskId ? ' is-start' : '')}>
      <div className="agent-room-heading">
        <div>
          <h1>Ask AI</h1>
          <p className="agent-room-description">
            Plan lessons, explore models and revise saved work.
          </p>
        </div>
        <div className="agent-room-actions">
          <button
            className="agent-pill"
            disabled={
              busy || running || !message.trim() || !activity.data?.pages[0]?.imageAvailable
            }
            title={
              activity.data?.pages[0]?.imageAvailable
                ? 'Describe an illustration in the message box, then generate it with Flux'
                : 'Image generation is unavailable for now. You can upload images in My sources.'
            }
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const r = await apiFetch<{ task: { id: string } }>('/learning/agent/images', {
                  method: 'POST',
                  body: { prompt: message.trim() },
                });
                setTaskId(r.task.id);
                setMessage('');
                setHistory(true);
                setHistoryTab('activity');
                const url = new URL(location.href);
                url.searchParams.set('task', r.task.id);
                window.history.replaceState(null, '', url.pathname + url.search);
                void activity.refetch();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ImagePlus size={15} />
            {activity.data?.pages[0]?.imageAvailable ? 'Create image' : 'Images unavailable'}
          </button>
          <button
            className="agent-pill"
            aria-label="Search conversations"
            aria-expanded={history}
            onClick={() => setHistory(!history)}
          >
            <History size={15} /> History
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
              setModel('');
              setSourceIds([]);
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
              autoFocus
              maxLength={120}
              value={folderTitle}
              onChange={(e) => setFolderTitle(e.target.value)}
            />
          </label>
          <button className="agent-pill primary" disabled={busy || !folderTitle.trim()}>
            Create folder
          </button>
          <button type="button" className="agent-pill" onClick={() => setFolderForm(false)}>
            Cancel
          </button>
        </form>
      )}
      <LearningHistoryDialog open={history} onClose={() => setHistory(false)}>
        <section className="agent-thread-list" aria-label="Conversations">
          <header className="agent-history-header">
            <h2>History</h2>
            <div>
              <button
                aria-pressed={historyTab === 'conversations'}
                onClick={() => setHistoryTab('conversations')}
              >
                Conversations
              </button>
              <button
                aria-pressed={historyTab === 'activity'}
                onClick={() => setHistoryTab('activity')}
              >
                All AI work
              </button>
            </div>
          </header>
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
          {historyTab === 'conversations' &&
            list.data?.threads
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
          {historyTab === 'conversations' &&
            list.data &&
            !list.data.threads.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
              .length && (
              <p className="p-3 text-xs text-ink-dim">
                No saved conversations match. Start a new chat to create one.
              </p>
            )}
          {historyTab === 'activity' &&
            activities
              .filter((t) => (t.title + ' ' + t.kind).toLowerCase().includes(search.toLowerCase()))
              .map((t) => (
                <article className="agent-history-task" key={t.id}>
                  <div>
                    <strong>{t.title || t.kind.replaceAll('_', ' ')}</strong>
                    <time>{new Date(t.createdAt).toLocaleString()}</time>
                  </div>
                  <AgentActivity steps={t.progress ?? []} status={t.status} compact />
                  {t.threadId ? (
                    <button className="underline" onClick={() => openThread(t.threadId!)}>
                      Open conversation
                    </button>
                  ) : t.planId ? (
                    <Link href={`/console/learn/drafts/${t.planId}`}>Open lesson</Link>
                  ) : t.sourceId ? (
                    <Link href="/console/learn/sources">Open source</Link>
                  ) : null}
                  {t.format && t.status === 'completed' && (
                    <a href={`/api/v1/learning/lesson-plans/exports/${t.id}/file`}>
                      Download {t.format.toUpperCase()}
                    </a>
                  )}
                  {t.kind === 'image_generate' && t.status === 'failed' && (
                    <button
                      className="agent-pill"
                      disabled={busy || !activity.data?.pages[0]?.imageAvailable}
                      title={
                        activity.data?.pages[0]?.imageAvailable
                          ? 'Retry image generation'
                          : 'Image generation is unavailable. You can upload an image in My sources.'
                      }
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = await apiFetch<{ task: { id: string } }>(
                            `/learning/agent/activity/${t.id}/retry`,
                            { method: 'POST' },
                          );
                          setTaskId(r.task.id);
                          const url = new URL(location.href);
                          url.searchParams.set('task', r.task.id);
                          window.history.replaceState(null, '', url.pathname + url.search);
                          void activity.refetch();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Retry image
                    </button>
                  )}
                  {t.status === 'failed' && (
                    <p role="status">
                      {t.error ??
                        'This request could not finish. Your saved material is unchanged.'}
                    </p>
                  )}
                </article>
              ))}
          {historyTab === 'activity' && activities?.length === 0 && (
            <p className="p-3 text-xs text-ink-dim">
              Your AI work will appear here as you create, revise and export lessons.
            </p>
          )}
          {historyTab === 'conversations' && conversationHistory.hasNextPage && (
            <button
              className="agent-pill"
              disabled={conversationHistory.isFetchingNextPage}
              onClick={() => void conversationHistory.fetchNextPage()}
            >
              Load older conversations
            </button>
          )}
          {historyTab === 'activity' && activity.hasNextPage && (
            <button
              className="agent-pill"
              disabled={activity.isFetchingNextPage}
              onClick={() => void activity.fetchNextPage()}
            >
              Load older work
            </button>
          )}
          {(list.isPending || (historyTab === 'activity' && activity.isPending)) && (
            <p role="status">Loading saved history…</p>
          )}
          {(list.error || activity.error) && (
            <div role="alert">
              History could not load.{' '}
              <button
                onClick={() => {
                  void list.refetch();
                  void activity.refetch();
                }}
              >
                Try again
              </button>
            </div>
          )}
        </section>
      </LearningHistoryDialog>
      <div className="agent-conversation-pane">
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
            <span className="learning-eyebrow">
              <Sparkles size={15} /> Your learning partner
            </span>
            <h2>
              What would you like
              <br />
              to teach or learn?
            </h2>
            <p>Turn an idea, your notes or a 3D model into a lesson you can explore.</p>
          </section>
        ) : (
          <section className="agent-message-list" aria-label="Conversation">
            {thread.data.thread.messages.map((m, i) => (
              <article key={`${m.taskId ?? i}-${m.role}`} className={`agent-message ${m.role}`}>
                <span className="mb-1 block text-xs text-ink-dim">
                  {m.role === 'user' ? 'You' : 'Void Space'}
                </span>
                {m.role === 'assistant' ? (
                  <AgentResponse content={m.content} sources={m.result?.sources} />
                ) : (
                  m.content
                )}
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
                {m.taskId &&
                  (m.role === 'assistant' ||
                    !thread.data.thread.messages.some(
                      (other) => other.role === 'assistant' && other.taskId === m.taskId,
                    )) &&
                  (() => {
                    const saved = thread.data.tasks?.find((t) => t.id === m.taskId);
                    return saved ? (
                      <AgentActivity steps={saved.progress ?? []} status={saved.status} compact />
                    ) : null;
                  })()}
                {m.result?.sourceId && m.result.image && (
                  <div className="agent-result-image">
                    <img
                      src={`/api/v1/learning/sources/${m.result.sourceId}/file`}
                      alt="AI-generated educational illustration requiring review"
                    />
                    <p>Generated illustration · review before teaching</p>
                    <Link href="/console/learn/sources">Open in my sources</Link>
                  </div>
                )}
                {m.result?.planId && (
                  <div className="agent-result">
                    <BookOpen size={22} />
                    <div>
                      <p className="text-xs text-ink-dim">
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
                {m.result?.modelId && !m.result.planId && (
                  <div className="agent-result">
                    <Sparkles size={20} />
                    <Link
                      href={`/console/learn/library/${m.result.modelId}/annotate?proposal=${m.taskId}`}
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
        {taskId && !thread.data?.tasks?.some((t) => t.id === taskId) && (
          <div className="agent-status">
            <AgentActivity
              steps={task.data?.task.progress ?? []}
              status={task.data?.task.status ?? 'queued'}
            />
          </div>
        )}
        {task.data?.task.result?.image &&
          task.data.task.result.sourceId &&
          !thread.data?.thread.messages.some(
            (m) => m.role === 'assistant' && m.taskId === taskId,
          ) && (
            <div className="agent-result-image">
              <img
                src={`/api/v1/learning/sources/${task.data.task.result.sourceId}/file`}
                alt="AI-generated illustration requiring review"
              />
              <p>Generated illustration · review before teaching</p>
              <Link href="/console/learn/sources">Open in my sources</Link>
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
                    input.current?.focus();
                  }}
                >
                  Edit and retry
                </button>
              )}
            </div>
          </div>
        )}
        <div className="agent-composer-wrap">
          {(model || sourceIds.length > 0 || planId) && (
            <div className="agent-attachments" aria-label="Selected material">
              {model && (
                <button type="button" className="agent-pill" onClick={() => chooseModel('')}>
                  <BookOpen size={14} />
                  {selectedModel.data?.item.title ?? 'Selected model'}
                  <X size={14} aria-label="Remove model" />
                </button>
              )}
              {!!sourceIds.length && (
                <button type="button" className="agent-pill" onClick={() => setAttachments(true)}>
                  <Link2 size={14} />
                  {sourceIds.length} sources
                </button>
              )}
              {planId && (
                <button type="button" className="agent-pill" onClick={() => setSettings(true)}>
                  <BookOpen size={14} />
                  {lessons.data?.plans.find((p) => p.id === planId)?.title ?? 'Selected lesson'}
                </button>
              )}
            </div>
          )}
          {attachments && (
            <div className="agent-drawer">
              <LessonSources
                selected={sourceIds}
                onChange={(ids) => {
                  restoredContext.current = threadId;
                  setSourceIds(ids);
                }}
              />
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
            <label htmlFor="personal-agent-message" className="sr-only">
              Message your learning agent
            </label>
            <textarea
              ref={input}
              rows={1}
              id="personal-agent-message"
              value={message}
              maxLength={4000}
              onChange={(e) => {
                setMessage(e.target.value);
                pending.current = null;
              }}
              placeholder="Ask your learning agent…"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
                <ModelPicker value={model} onChange={chooseModel} disabled={busy || running} />
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
              {running ? (
                <button
                  className="agent-send"
                  type="button"
                  aria-label={
                    task.data?.task.kind === 'agent_turn'
                      ? 'Stop generation'
                      : 'Generation in progress'
                  }
                  disabled={busy || task.data?.task.kind !== 'agent_turn'}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await apiFetch(`/learning/agent/runs/${taskId}/cancel`, { method: 'POST' });
                      await task.refetch();
                      await thread.refetch();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {task.data?.task.kind === 'agent_turn' ? (
                    <Square size={16} fill="currentColor" aria-hidden="true" />
                  ) : (
                    <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
                  )}
                </button>
              ) : (
                <button
                  className="agent-send"
                  type="submit"
                  aria-label="Send to personal agent"
                  disabled={busy || !message.trim()}
                >
                  <ArrowUp size={19} aria-hidden="true" />
                </button>
              )}
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
          <p className="mt-3 text-center text-xs text-ink-dim">
            Your work starts private. Review before sharing. Enter to send · Shift + Enter for a new
            line.
          </p>
        </div>
      </div>
    </div>
  );
}
