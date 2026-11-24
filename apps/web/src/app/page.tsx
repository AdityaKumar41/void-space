import Link from 'next/link';
import { ArrowUpRight, BookOpen, Boxes, Sparkles, ArrowUp, Paperclip } from 'lucide-react';
export const metadata = {
  title: 'Void Space — your personal learning agent',
  description:
    'Create interactive lessons with your learning agent. Explore 3D models, study independently or with your institution, and share reviewed lessons.',
};
export default function Page() {
  return (
    <main id="main" className="agent-workspace agent-landing">
      <nav className="agent-landing-nav">
        <Link className="agent-brand" href="/">
          <span className="agent-brand-mark">
            <Sparkles size={20} />
          </span>
          <span>Void Space</span>
        </Link>
        <div>
          <Link href="/learn/discover">Public lessons</Link>
          <Link href="/catalog">Marketplace</Link>
          <Link href="/login?next=/console/learn/agent">Sign in</Link>
        </div>
      </nav>
      <section className="agent-landing-hero">
        <div>
          <p className="agent-landing-kicker">
            For independent minds. And the places that teach them.
          </p>
          <h1>
            Your ideas.
            <br />A world of
            <br />
            <span>understanding.</span>
          </h1>
          <p className="agent-landing-description">
            Meet your personal learning agent. Turn an idea, a document or a 3D model into a lesson
            you can explore, teach and make your own.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link className="agent-pill primary" href="/learn/signup">
              Start your learning workspace
              <ArrowUpRight size={16} />
            </Link>
            <Link className="agent-pill" href="/learn/signup?type=institution">
              For institutions
            </Link>
          </div>
          <p className="mt-5 text-xs text-ink-dim">
            Private by default. Share with your institution or publish for everyone.
          </p>
        </div>
        <div className="agent-landing-preview">
          <div className="agent-preview-bar">
            <Sparkles size={17} />
            <span>Your learning agent</span>
            <span className="ml-auto text-[10px]">Void Space</span>
          </div>
          <div className="agent-preview-body">
            <div className="agent-preview-model">
              <Boxes size={80} strokeWidth={0.7} />
              <span>
                Explore the components.
                <br />
                Understand how they connect.
              </span>
            </div>
            <h2>
              What would you
              <br />
              like to understand?
            </h2>
            <Link href="/console/learn/agent" className="agent-preview-prompt">
              <span>
                <Sparkles size={16} />
                Build a 30-minute lesson around my model…
              </span>
              <div>
                <span>
                  <Paperclip size={13} />
                  Attach sources
                </span>
                <span className="agent-send">
                  <ArrowUp size={16} />
                </span>
              </div>
            </Link>
            <p className="text-center text-[10px] text-ink-dim">
              Your next lesson starts with a conversation.
            </p>
          </div>
        </div>
      </section>
      <section className="agent-landing-features">
        <article>
          <Sparkles size={23} />
          <h2>Plan it together.</h2>
          <p>
            Describe what you want to teach or learn. Your agent drafts the sections, timings,
            examples and quizzes. Review and refine it in conversation.
          </p>
        </article>
        <article>
          <Boxes size={23} />
          <h2>Learn by exploring.</h2>
          <p>
            Bring your own private models. Select components, read explanations and work through
            interactive practice with feedback.
          </p>
        </article>
        <article>
          <BookOpen size={23} />
          <h2>Keep the understanding.</h2>
          <p>
            Resume your lesson, revisit mistakes and save a personal recap. Present your material or
            export a PDF and editable PowerPoint.
          </p>
        </article>
      </section>
      <section className="agent-landing-bottom">
        <div>
          <h2>
            A personal space.
            <br />A shared purpose.
          </h2>
          <p>
            Start independently or create an institution workspace for your educators and students.
            Choose exactly who can study each reviewed lesson.
          </p>
        </div>
        <Link className="agent-pill" href="/learn/discover">
          Explore public lessons
          <ArrowUpRight size={16} />
        </Link>
      </section>
      <footer className="agent-landing-footer">
        <span>Void Space · Learning through exploration</span>
        <div>
          <Link href="/asset-workspace">Asset workspace</Link>
          <Link href="/catalog">Marketplace</Link>
          <Link href="/learn">About learning</Link>
        </div>
      </footer>
    </main>
  );
}
