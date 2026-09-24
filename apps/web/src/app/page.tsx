/**
 * The product landing page — the root URL.
 *
 * This answers "what is this and why would I buy it". It is not a catalogue.
 *
 * The root used to *be* the catalogue: a hero with a live customer model above a grid of every
 * published asset. That is wrong in two directions at once. Commercially, a vendor's front page must
 * not publish the licensed work of its customers — a buyer arriving at the root should learn what the
 * platform does, not browse someone else's assets. And rhetorically, answering "what is this?" with a
 * grid of whales tells a visitor nothing about the product; the objects are the *output* of the
 * system, not the system.
 *
 * So the catalogue moved to `/catalog` — a feature you navigate to, linked from here — and this page
 * does the work a landing page does: the problem, who it is for, the pipeline, the capabilities, and a
 * clear next step.
 *
 * It renders statically. It states no live fact about any tenant, so there is nothing to revalidate:
 * a marketing page that re-queries per request pays for freshness it does not use.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { MarketFooter, MarketHeader } from '../components/market-shell';

export const metadata: Metadata = {
  title: 'VOID·SPACE — 3D asset lifecycle platform',
  description:
    'Ingest, review, license and deliver 3D content with provenance that can be checked. Streamed uploads, geometry inspection, human review, ERC-721 licences and XR-ready delivery.',
};

/* ------------------------------------------------------------------ content */

/** The three failures this platform exists to remove. */
const PROBLEMS: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: 'Files live in a folder, not a system',
    body: 'Versions arrive as attachments. Nobody knows which export is current, what changed between them, or whether the last fix was applied to the file that shipped.',
  },
  {
    title: 'Approval is a message thread',
    body: 'A sign-off happens in chat and disappears into it. When a model is later found to breach a budget or misstate its attribution, there is no record of who approved it or on what basis.',
  },
  {
    title: 'A licence is a PDF you have to trust',
    body: 'Terms are asserted rather than verifiable. Proving which exact bytes were licensed, and under what terms, means trusting a document that anyone can edit.',
  },
];

/** What happens to an asset, in order. */
const PIPELINE: readonly { readonly step: string; readonly title: string; readonly body: string }[] = [
  {
    step: '01',
    title: 'Ingest',
    body: 'A streamed upload takes files up to 200 MB without buffering them in memory. Geometry is measured on the way in — triangles, vertices, materials, textures, extents — and the file is pinned to IPFS, so what was received is provable.',
  },
  {
    step: '02',
    title: 'Review',
    body: 'A real person approves, sends back for revision, or rejects. Decisions need a comment, cannot be self-approved, and are written to an append-only ledger that no role can edit afterwards.',
  },
  {
    step: '03',
    title: 'License',
    body: 'Publishing mints an ERC-721 licence carrying the content hash and the terms. The token id, contract address and transaction are part of the asset record, so the terms travel with the file.',
  },
  {
    step: '04',
    title: 'Deliver',
    body: 'Licensed assets are served from the same bytes the hash commits to, at the polycount budget your target device can actually run — and the numbers are printed where a buyer can check them.',
  },
];

/** Capabilities, grouped by who cares about them. */
const CAPABILITIES: readonly {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
}[] = [
  {
    tag: 'Ingest',
    title: 'Streamed 200 MB uploads',
    body: 'Files stage to disk and pin to IPFS without ever being held whole in memory, so one large scan does not decide whether uploads work at all.',
  },
  {
    tag: 'Ingest',
    title: 'Geometry read on the way in',
    body: 'Triangle count, vertex count, material and texture inventory, and true extents are measured from the file itself — not from what an export claimed.',
  },
  {
    tag: 'Review',
    title: 'Classification with a confidence figure',
    body: 'Suggested tags and descriptions arrive with a model version, a prompt version and a confidence score. Low confidence escalates to a human instead of guessing.',
  },
  {
    tag: 'Review',
    title: 'A queue that respects seniority',
    body: 'Oldest submission first, carrying the AI signal and the waiting time on each row. Rejections require a reason and cannot be self-approved.',
  },
  {
    tag: 'Trust',
    title: 'Content addressing throughout',
    body: 'Every version is addressed by hash. The viewer decodes the geometry and compares it against the record, so a mismatch is visible rather than silent.',
  },
  {
    tag: 'Trust',
    title: 'Append-only audit ledger',
    body: 'Who did what, to which entity, and when — including the transaction hash for on-chain actions. Write access is removed at the database level, not by convention.',
  },
  {
    tag: 'Licensing',
    title: 'ERC-721 licence registry',
    body: 'Mint, attach terms, revoke. Revocation flags the licence and removes it from distribution; the token is never burned, so provenance survives a takedown.',
  },
  {
    tag: 'Licensing',
    title: 'Entitlements for builders',
    body: 'Scoped API keys and a documented REST surface, so a game, a training tool or a storefront can query what it is entitled to serve.',
  },
  {
    tag: 'Operations',
    title: 'Multi-workspace tenancy',
    body: 'Organisations, roles and per-tenant policy. Isolation is enforced by row-level security in the database, so it holds even when an application query is wrong.',
  },
  {
    tag: 'Operations',
    title: 'XR delivery budgets',
    body: 'Flag assets that exceed what a standalone headset can render, generate an XR module per version, and publish it alongside the source.',
  },
];

/** Who this is for. Named plainly, because a page that addresses everyone addresses nobody. */
const AUDIENCES: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: 'Studios licensing their library',
    body: 'You have built assets worth selling and no way to license them that a buyer can verify. This gives the library a catalogue, terms that travel with the file, and a paper trail.',
  },
  {
    title: 'XR and training teams',
    body: 'You commission models against a polycount and a delivery date, and you need to know which version was approved, at what complexity, before it reaches a device.',
  },
  {
    title: 'Brands and institutions',
    body: 'You publish 3D content under terms that have to be defensible, with a review record that survives a reorganisation or an audit.',
  },
];

/* ------------------------------------------------------------------- layout */

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mk-shell py-20">
      <span className="mk-eyebrow">{eyebrow}</span>
      <h2 className="mk-h2 mt-4 max-w-3xl">{title}</h2>
      <div className="mt-10">{children}</div>
    </section>
  );
}

export default function ProductPage() {
  return (
    <div className="mk-page">
      <MarketHeader current="product" />

      <main id="main" className="flex-1">
        {/* ----------------------------------------------------------------------------- hero */}
        <section className="mk-hero">
          <div className="mk-shell">
            <div className="mk-hero-product">
              <div>
                <span className="mk-eyebrow">3D asset lifecycle platform</span>

                <h1 className="mk-h1 mt-5">
                  Publish 3D content you can <em>license</em>, trace and revoke.
                </h1>

                <p className="mk-lead mt-6">
                  VOID·SPACE is the pipeline between a 3D file and the people who pay to use it. Ingest
                  with streamed uploads, review with a record, license on chain, and deliver to a
                  target device — with provenance a buyer can verify instead of taking on trust.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link href="/catalog" className="vs-btn vs-btn-primary">
                    Browse the licensed catalogue
                  </Link>
                  <Link href="/login" className="vs-btn">
                    Open the console
                  </Link>
                </div>

                <dl className="mk-figures-strip mt-10">
                  <div>
                    <dt>upload ceiling</dt>
                    <dd>200 MB</dd>
                  </div>
                  <div>
                    <dt>licence standard</dt>
                    <dd>ERC-721</dd>
                  </div>
                  <div>
                    <dt>storage</dt>
                    <dd>IPFS</dd>
                  </div>
                  <div>
                    <dt>isolation</dt>
                    <dd>Row-level</dd>
                  </div>
                </dl>
              </div>

              {/*
                A specimen of the record, not a customer's asset.

                It shows the fields the platform actually produces — hash, token, transaction —
                which is what a buyer is being sold, and which a screenshot of somebody's whale could
                never demonstrate. The values are deliberately synthetic: an earlier version of this
                card carried a real content hash and a real transaction hash copied from a live
                listing, and a vendor's marketing page has no business publishing a customer's
                identifiers — especially ones a reader can look up. The shape is the claim; the
                values are placeholders. `aria-hidden` because it is an illustration of output, not
                content to be read as fact.
              */}
              <div className="mk-record-card" aria-hidden>
                <div className="mk-record-head">
                  <span className="mk-record-dot" />
                  <span>Asset record</span>
                  <span className="mk-record-state">Specimen</span>
                </div>

                <dl className="mk-record-body">
                  <div>
                    <dt>Content hash</dt>
                    <dd className="mk-record-placeholder">bafy…content digest</dd>
                  </div>
                  <div>
                    <dt>Licence token</dt>
                    <dd>#1247 · CC-BY · active</dd>
                  </div>
                  <div>
                    <dt>Transaction</dt>
                    <dd className="mk-record-placeholder">0x…mint transaction</dd>
                  </div>
                  <div>
                    <dt>Geometry</dt>
                    <dd>184,300 tris · 6 materials</dd>
                  </div>
                  <div>
                    <dt>Reviewed by</dt>
                    <dd>assessor · approved</dd>
                  </div>
                </dl>

                <div className="mk-record-foot">
                  Every field on this card is produced by the pipeline and checkable by the buyer.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------------------- problem */}
        <section className="mk-band">
          <Section eyebrow="Why it exists" title="Three things break when 3D content leaves the studio.">
            <div className="mk-three">
              {PROBLEMS.map((item) => (
                <div key={item.title}>
                  <h3 className="text-[16px] font-semibold">{item.title}</h3>
                  <p className="mt-3 text-[13.5px] leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          </Section>
        </section>

        {/* ------------------------------------------------------------------------- pipeline */}
        <Section eyebrow="How it works" title="Every asset passes the same four gates.">
          <div className="mk-pipeline">
            {PIPELINE.map((item) => (
              <div key={item.step}>
                <div className="mk-step-index">{item.step}</div>
                <h3 className="mt-4 text-[16px] font-semibold">{item.title}</h3>
                <p className="mt-3 text-[13.5px] leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* --------------------------------------------------------------------- capabilities */}
        <section className="mk-band">
          <Section eyebrow="Capabilities" title="What the platform actually does.">
            <div className="mk-caps">
              {CAPABILITIES.map((item) => (
                <article key={item.title} className="mk-cap">
                  <span className="mk-cap-tag">{item.tag}</span>
                  <h3 className="mt-3 text-[14.5px] font-semibold">{item.title}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed">{item.body}</p>
                </article>
              ))}
            </div>
          </Section>
        </section>

        {/* ------------------------------------------------------------------------ audience */}
        <Section eyebrow="Who it is for" title="Built for the people who have to answer for it.">
          <div className="mk-three">
            {AUDIENCES.map((item) => (
              <div key={item.title}>
                <h3 className="text-[16px] font-semibold">{item.title}</h3>
                <p className="mt-3 text-[13.5px] leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ----------------------------------------------------------------------------- cta */}
        <section className="mk-band">
          <div className="mk-shell py-16">
            <div className="mk-cta">
              <div>
                <h2 className="mk-h2 max-w-2xl">See a real licence before you talk to anyone.</h2>
                <p className="mk-lead mt-4 max-w-2xl text-[14.5px]">
                  The catalogue is public: open an asset, orbit it, and read the token id, the contract
                  address and the transaction that minted it. Nothing there asks you to sign in.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link href="/catalog" className="vs-btn vs-btn-primary">
                  Open the catalogue
                </Link>
                <a href="/api/v1/docs" target="_blank" rel="noreferrer" className="vs-btn">
                  Read the API
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketFooter />
    </div>
  );
}
