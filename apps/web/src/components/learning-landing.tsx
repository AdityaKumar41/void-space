'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowUp, ArrowUpRight, Plus, Sparkles } from 'lucide-react';
import { MarketHeader, MarketFooter } from './market-shell';
export function LearningLanding() {
  const [prompt, setPrompt] = useState('');
  function start(attach = false) {
    if (attach) sessionStorage.setItem('void-start-attachments', 'true');
    if (prompt.trim()) sessionStorage.setItem('void-start-prompt', prompt.trim());
    location.assign(`/console/learn/agent${attach ? '?attach=true' : ''}`);
  }
  return (
    <main id="main" className="learning-site">
      <div className="learning-site-sheet">
        <MarketHeader current="product" />
        <section className="learning-site-intro" id="platform">
          <h1>
            Ask.
            <br />
            Explore.
            <br />
            Understand.
          </h1>
          <div className="learning-site-promise">
            <span aria-hidden>/</span>
            <p>
              Turn a question into
              <br />
              <strong>a lesson you can explore.</strong>
            </p>
            <Link href="/learn/signup" className="learning-black-button">
              Start learning
              <ArrowUpRight size={18} />
            </Link>
          </div>
        </section>
        <section
          className="learning-hero-scene"
          aria-label="Start learning with your personal agent"
        >
          <img
            src="/illustrations/learning-world.svg"
            alt="A learner exploring a floating 3D model in a colourful world of shapes"
            width="1440"
            height="520"
          />
          <form
            className="learning-site-composer"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <label htmlFor="landing-question">
              <Sparkles size={22} />
              <span>Your next lesson starts with a question.</span>
            </label>
            <textarea
              id="landing-question"
              aria-label="What would you like to learn?"
              maxLength={4000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Create a lesson about the human heart…"
              rows={2}
            />
            <div>
              <button type="button" onClick={() => start(true)} className="learning-attach">
                <span>
                  <Plus size={21} />
                </span>
                Add a model or notes
              </button>
              <button type="submit" className="learning-submit" aria-label="Start a lesson with AI">
                <ArrowUp size={23} />
              </button>
            </div>
          </form>
          <p className="learning-scene-caption">
            Your ideas. Your models. <strong>Your own way to understand.</strong>
          </p>
        </section>
        <section className="learning-audiences" aria-label="Who Void Space is for">
          <span>Made for curious minds</span>
          <span>Independent learners</span>
          <span>Educators</span>
          <span>Institutions</span>
        </section>
        <section className="learning-how" id="how-it-works">
          <header>
            <p>A conversation. A lesson. A little more understanding.</p>
            <h2>
              Less setting up.
              <br />
              More figuring it out.
            </h2>
          </header>
          <div className="learning-how-steps">
            <article>
              <span>01</span>
              <h3>Tell your agent what you need.</h3>
              <p>
                A topic, a document, a model—or just a question. Ask for a 30-minute lesson, an
                explanation or a way to practise.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>Explore it, together.</h3>
              <p>
                See the lesson take shape. Click model components, try the questions and ask the
                agent to explain or change a section.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>Keep what you learn.</h3>
              <p>
                Pick up where you stopped. Revisit mistakes, save a recap or export your lesson as a
                PDF or editable PowerPoint.
              </p>
            </article>
          </div>
        </section>
        <section className="learning-site-choice">
          <div>
            <h2>
              A space for you.
              <br />
              Room for your institution.
            </h2>
            <p>
              Your models and drafts start private. Share a reviewed lesson with your institution,
              selected people, or everyone.
            </p>
          </div>
          <div>
            <Link href="/learn/signup" className="learning-black-button">
              For myself
              <ArrowUpRight size={17} />
            </Link>
            <Link href="/learn/signup?type=institution" className="learning-outline">
              For my institution
              <ArrowUpRight size={17} />
            </Link>
          </div>
        </section>
        <MarketFooter />
      </div>
    </main>
  );
}
