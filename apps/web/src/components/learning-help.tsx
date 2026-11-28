import Link from 'next/link';
import { LearningLayout } from './learning-ui';
import { ArrowUpRight, BookOpen, Box, MessageCircle, Share2 } from 'lucide-react';
const steps = [
  {
    title: 'Start with your agent',
    icon: MessageCircle,
    href: '/console/learn/agent',
    text: 'Describe what you want to learn or teach. Add a model or your notes when useful. The agent creates a private draft and shows its work as it goes.',
  },
  {
    title: 'Make the lesson yours',
    icon: BookOpen,
    href: '/console/learn',
    text: 'Open a lesson to explore its sections and questions. Ask the agent for a change, review the proposal, then apply it. Manual editing is always available.',
  },
  {
    title: 'Bring a model',
    icon: Box,
    href: '/console/learn/library',
    text: 'Upload a model to your private learning library. Review component labels before using them in a lesson. Marketplace models remain subject to their licence.',
  },
  {
    title: 'Choose who can learn',
    icon: Share2,
    href: '/console/learn',
    text: 'Study privately, invite selected people, share with your institution, or publish for everyone. Review facts, answers, visuals and rights before publishing. Finish a lesson for a recap and export options.',
  },
];
export default function HelpPage() {
  return (
    <LearningLayout
      title="Help and support"
      description="Start with an idea, build an interactive lesson and choose who can learn from it."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {steps.map(({ title, icon: Icon, href, text }, i) => (
          <Link
            key={title}
            href={href}
            className="group rounded-2xl border border-hairline p-6 hover:bg-veil-6"
          >
            <div className="flex items-center justify-between">
              <Icon size={23} />
              <span className="text-sm text-ink-dim">0{i + 1}</span>
            </div>
            <h2 className="mt-7 flex items-center justify-between text-lg font-medium">
              {title}
              <ArrowUpRight size={18} />
            </h2>
            <p className="mt-3 text-sm leading-7 text-ink-dim">{text}</p>
          </Link>
        ))}
      </div>
      <p className="text-sm text-ink-dim">
        Models and source documents start private. Switching workspace changes which institution’s
        content you can access.{' '}
        <Link href="/console/learn/settings" className="underline">
          Manage your account
        </Link>
        .
      </p>
    </LearningLayout>
  );
}
