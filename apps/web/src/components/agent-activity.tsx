'use client';
import { Check, ChevronDown, CircleAlert, LoaderCircle, Sparkles } from 'lucide-react';
import { useState } from 'react';
export interface AgentActivityStep {
  id: string;
  label: string;
  status: 'working' | 'complete' | 'failed';
  detail?: string;
  updatedAt?: string;
}
export function AgentActivity({
  steps,
  status,
  compact = false,
}: {
  steps: AgentActivityStep[];
  status: string;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(true),
    working = steps.find((s) => s.status === 'working'),
    complete = status === 'completed',
    failed = status === 'failed';
  const title = failed
    ? 'The agent needs your attention'
    : complete
      ? 'Ready for your review'
      : (working?.label ?? 'Getting started');
  return (
    <section
      className={'agent-activity ' + (compact ? 'is-compact' : '')}
      aria-label="Agent activity"
    >
      <button
        className="agent-activity-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={'agent-activity-symbol ' + (failed ? 'has-error' : '')}>
          {failed ? (
            <CircleAlert size={18} />
          ) : complete ? (
            <Check size={18} />
          ) : (
            <Sparkles size={18} />
          )}
        </span>
        <span>
          <strong>{title}</strong>
          <small>
            {complete
              ? 'Your work is saved'
              : failed
                ? 'Your request and material are saved'
                : 'Working with your request and selected material'}
          </small>
        </span>
        <ChevronDown className={expanded ? 'is-expanded' : ''} size={16} />
      </button>
      {expanded && (
        <ol className="agent-activity-steps" aria-live="polite">
          {(steps.length
            ? steps
            : [
                {
                  id: 'queued',
                  label: failed
                    ? 'Your request could not finish'
                    : complete
                      ? 'Your work is ready'
                      : 'Waiting for the learning agent',
                  status: failed
                    ? ('failed' as const)
                    : complete
                      ? ('complete' as const)
                      : ('working' as const),
                },
              ]
          ).map((raw) => {
            const step = {
              ...raw,
              status: failed && raw.status === 'working' ? 'failed' : raw.status,
            };
            return (
              <li className={step.status} key={step.id}>
                <span>
                  {step.status === 'complete' ? (
                    <Check size={13} />
                  ) : step.status === 'failed' ? (
                    <CircleAlert size={13} />
                  ) : (
                    <LoaderCircle className="animate-spin" size={13} />
                  )}
                </span>
                <div>
                  <p>{step.label}</p>
                  {step.detail && <small>{step.detail}</small>}
                  {'updatedAt' in step && typeof step.updatedAt === 'string' && (
                    <time dateTime={step.updatedAt}>
                      {new Date(step.updatedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
