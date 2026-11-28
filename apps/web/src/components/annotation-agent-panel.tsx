'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Square, Sparkles } from 'lucide-react';
import { apiFetch, API_PUBLIC_BASE } from '../lib/api';
import { AgentActivity, type AgentActivityStep } from './agent-activity';
import { AgentResponse } from './agent-response';
interface Run {
  id: string;
  status: string;
  progress?: AgentActivityStep[];
  error?: string;
  result?: { modelId?: string; modelRevision?: number; labels?: unknown[] };
}
interface Conversation {
  thread: {
    id: string;
    revision: number;
    messages: { role: string; content: string; taskId?: string }[];
  };
  tasks?: Run[];
}
/** The existing durable learning harness, scoped to one private model. It never saves proposals itself. */
export function AnnotationAgentPanel({
  modelId,
  selectedId,
  dirty,
  aiAllowed,
  prepareViews,
  onProposal,
  ready,
}: {
  ready: boolean;
  modelId: string;
  selectedId: string | null;
  dirty: boolean;
  aiAllowed: boolean;
  prepareViews: () => Promise<void>;
  onProposal: (taskId: string) => void;
}) {
  const client = useQueryClient();
  const [autoStart, setAutoStart] = useState(false);
  const [scopeSelected, setScopeSelected] = useState(false);
  const [threadId, setThreadId] = useState(''),
    [taskId, setTaskId] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null),
    latestProposal = useRef('');
  const pending = useRef<{ content: string; eventKey: string } | null>(null);
  const callback = useRef(onProposal);
  callback.current = onProposal;
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setThreadId(q.get('thread') ?? '');
    setTaskId(q.get('task') ?? q.get('proposal') ?? '');
    const incoming = q.get('thread');
    if (incoming && q.get('compose') === '1') {
      const prompt = sessionStorage.getItem(`void-annotation-prompt:${incoming}`);
      if (prompt) {
        setMessage(prompt);
        setAutoStart(true);
        sessionStorage.removeItem(`void-annotation-prompt:${incoming}`);
      }
      const url = new URL(location.href);
      url.searchParams.delete('compose');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }, [modelId]);
  const conversation = useQuery({
    queryKey: ['annotation-chat', modelId, threadId],
    enabled: !!threadId,
    queryFn: () => apiFetch<Conversation>(`/learning/agent/threads/${threadId}`),
  });
  const task = useQuery({
    queryKey: ['annotation-run', modelId, taskId],
    enabled: !!taskId,
    queryFn: () => apiFetch<{ task: Run }>(`/learning/tasks/${taskId}`),
    refetchInterval: (q) =>
      ['completed', 'failed', 'cancelled'].includes(q.state.data?.task.status ?? '') ? false : 1200,
  });
  const running =
    !!taskId && !['completed', 'failed', 'cancelled'].includes(task.data?.task.status ?? '');
  useEffect(() => {
    if (!running || !taskId) return;
    const events = new EventSource(`${API_PUBLIC_BASE}/learning/agent/runs/${taskId}/events`, {
      withCredentials: true,
    });
    events.onmessage = () => {
      void task.refetch();
    };
    events.onerror = () => events.close();
    return () => events.close();
  }, [taskId, running]);
  useEffect(() => {
    const run = task.data?.task;
    if (!run || !['completed', 'failed', 'cancelled'].includes(run.status)) return;
    if (threadId) void conversation.refetch();
    if (
      run.status === 'completed' &&
      run.result?.modelId === modelId &&
      run.result.labels &&
      latestProposal.current !== run.id
    ) {
      latestProposal.current = run.id;
      callback.current(run.id);
    }
  }, [task.data?.task.id, task.data?.task.status, modelId]);
  useEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = '0px';
    node.style.height = `${message ? Math.min(node.scrollHeight, 140) : 44}px`;
  }, [message]);
  useEffect(() => {
    if (autoStart && ready && conversation.data?.thread && !busy && !dirty) {
      setAutoStart(false);
      void send();
    }
  }, [autoStart, ready, conversation.data?.thread.id, busy, dirty]);
  async function send() {
    if (!message.trim() || !aiAllowed || !ready || busy || running) return;
    if (dirty) {
      setError('Save or discard the current annotation draft before asking AI to revise it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await prepareViews();
      let current = conversation.data?.thread;
      if (!threadId) {
        const created = await apiFetch<Conversation>('/learning/agent/threads', {
          method: 'POST',
          body: { title: 'Model annotations' },
        });
        current = created.thread;
        setThreadId(current.id);
      }
      if (!current) throw new Error('Conversation is loading. Try again in a moment.');
      const content = JSON.stringify({
        message: message.trim(),
        selectedId: scopeSelected ? selectedId : null,
      });
      if (pending.current?.content !== content)
        pending.current = { content, eventKey: crypto.randomUUID() };
      const result = await apiFetch<{ taskId: string }>(
        `/learning/agent/threads/${current.id}/messages`,
        {
          method: 'POST',
          body: {
            eventKey: pending.current.eventKey,
            revision: current.revision,
            message: message.trim(),
            privateModelId: modelId,
            annotationWorkspace: true,
            ...(scopeSelected && selectedId ? { selectedAnnotationId: selectedId } : {}),
          },
        },
      );
      pending.current = null;
      setTaskId(result.taskId);
      setMessage('');
      const url = new URL(location.href);
      url.searchParams.set('thread', current.id);
      url.searchParams.set('task', result.taskId);
      url.searchParams.delete('proposal');
      window.history.replaceState(null, '', url.pathname + url.search);
      await client.invalidateQueries({ queryKey: ['annotation-chat', modelId, current.id] });
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 409 && threadId) {
        pending.current = null;
        await conversation.refetch();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="annotation-agent" aria-label="Model AI assistant">
      <header>
        <Sparkles size={17} />
        <div>
          <h3>Work with AI</h3>
          <p>
            {scopeSelected && selectedId
              ? 'Only the selected annotation will be changed.'
              : 'Create or refine annotations on this model.'}
          </p>
        </div>
      </header>
      <label className="annotation-ai-scope">
        Edit scope
        <select
          aria-label="AI annotation scope"
          value={scopeSelected ? 'selected' : 'all'}
          onChange={(e) => setScopeSelected(e.target.value === 'selected')}
        >
          <option value="all">Whole model</option>
          <option value="selected" disabled={!selectedId}>
            Selected annotation
          </option>
        </select>
      </label>
      <div className="annotation-agent-messages" aria-live="polite">
        {!threadId && (
          <div className="annotation-agent-intro">
            <p>
              Describe what to label or change. AI can suggest names, explanations and pin positions
              from the model views.
            </p>
            <button
              onClick={() =>
                setMessage(
                  'Suggest detailed annotations for this model. Preserve existing annotations and identify uncertain parts clearly.',
                )
              }
            >
              Suggest annotations
            </button>
            <button
              disabled={!selectedId}
              onClick={() => {
                setScopeSelected(true);
                setMessage(
                  'Improve the selected annotation explanation and describe its function. Preserve every other annotation and its pin position.',
                );
              }}
            >
              Improve selected annotation
            </button>
            <small>
              Proposals appear on the model for you to edit and review. Nothing is published
              automatically.
            </small>
          </div>
        )}
        {conversation.data?.thread.messages.map((m, index) => (
          <article key={index} className={m.role === 'user' ? 'is-user' : ''}>
            <small>{m.role === 'user' ? 'You' : 'Assistant'}</small>
            <AgentResponse content={m.content} />
          </article>
        ))}
        {task.data && (
          <AgentActivity
            steps={task.data.task.progress ?? []}
            status={task.data.task.status}
            compact
          />
        )}
        {(error || task.data?.task.error || conversation.error || task.error) && (
          <p role="alert">
            {error || task.data?.task.error || conversation.error?.message || task.error?.message}
          </p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="annotation-agent-composer"
      >
        {!aiAllowed && (
          <p>AI use is not permitted for this model. Manual annotation remains available.</p>
        )}
        {dirty && <p>Review and save your draft before the next AI request.</p>}
        <label className="sr-only" htmlFor="annotation-agent-message">
          Ask AI to annotate this model
        </label>
        <textarea
          id="annotation-agent-message"
          ref={input}
          rows={1}
          value={message}
          maxLength={4000}
          disabled={!aiAllowed}
          placeholder="Ask about this model…"
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div>
          <small>{busy ? 'Preparing model context…' : 'Private · review before saving'}</small>
          {running ? (
            <button
              type="button"
              aria-label="Stop annotation generation"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await apiFetch(`/learning/agent/runs/${taskId}/cancel`, { method: 'POST' });
                  await task.refetch();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send annotation request"
              disabled={!aiAllowed || !ready || busy || !message.trim() || dirty}
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
