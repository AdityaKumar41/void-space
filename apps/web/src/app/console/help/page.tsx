'use client';
import Link from 'next/link';
import type { Permission } from '@void-space/types';
import { useSession } from '../../../lib/session';
import { Card } from '../../../components/ui/card';

const workflows: {
  title: string;
  href: string;
  permission: Permission;
  steps: string;
  note?: string;
}[] = [
  {
    title: 'Programs',
    href: '/console/campus',
    permission: 'catalog:view',
    steps:
      'Enroll in a released program, then open each lesson. Passing evidence from completed lessons contributes to your program progress.',
  },
  {
    title: 'Lessons',
    href: '/console/lessons',
    permission: 'catalog:view',
    steps:
      'Open a published lesson, explore its reviewed 3D model, read the guide and complete the assessment. Your lesson position is saved automatically. Mentor answers may use the configured AI service or the local lesson guide.',
  },
  {
    title: 'Practice',
    href: '/console/simulations',
    permission: 'catalog:view',
    steps:
      'Enter a released experience and choose practice or assessment. Follow each instruction using the model targets and controls. You can resume saved runs and replay assessment evidence.',
  },
  {
    title: 'Shared spaces',
    href: '/console/spaces',
    permission: 'spatial:join',
    steps:
      'Join a live space. Follow facilitator lesson steps or switch follow off to explore independently. Your assessments stay individual. Use Leave space when you finish.',
    note: 'If the live connection drops, periodic updates continue while reconnection is attempted.',
  },
  {
    title: 'Field guides',
    href: '/console/field-guides',
    permission: 'catalog:view',
    steps:
      'Open a released guide or scan its QR link. Read each instruction and safety note, acknowledge the steps and finish to save the completion record. A QR link still requires a workspace sign-in.',
  },
  {
    title: 'Career and credentials',
    href: '/console/career',
    permission: 'catalog:view',
    steps:
      'Review skills earned from passing assessments and completed field guides. Open a lesson verification record to inspect its evidence. Repeated passes remain records; the skill list groups the same outcome.',
    note: 'Application verification works without a wallet. On-chain anchoring additionally requires a linked wallet and configured issuer/contract.',
  },
  {
    title: 'Venture plans',
    href: '/console/ventures',
    permission: 'catalog:view',
    steps:
      'Describe a customer problem, solution and measurable milestone. Your team can read the full saved plan. Use Edit plan to update a plan you created.',
  },
  {
    title: 'Asset library',
    href: '/console/library',
    permission: 'asset:upload-own',
    steps:
      'Upload a supported 3D file, complete its metadata and submit it for review. Open an asset to inspect processing jobs, versions and reviewer feedback.',
    note: 'External import sources, Blender optimization and chain publishing depend on deployment configuration. Unavailable integrations cannot produce a real published output.',
  },
  {
    title: 'Review queue',
    href: '/console/review',
    permission: 'review:view-queue',
    steps:
      'Inspect the submitted model, metadata and provenance. Record an approval, rejection or requested revision. Publishing a licence requires the configured chain integration.',
  },
  {
    title: 'Digital twins',
    href: '/console/twins',
    permission: 'iot:manage',
    steps:
      'Register equipment and save its one-time credentials. Create a twin and optionally link an approved model. Follow the connection instructions to submit authenticated readings; the twin state and history update automatically.',
  },
  {
    title: 'Learning analytics',
    href: '/console/analytics',
    permission: 'audit:view',
    steps:
      'Inspect real assessment attempts, pass rates, program enrollment and credential counts for your workspace. An empty report means no evidence has been recorded yet.',
  },
  {
    title: 'Operations',
    href: '/console/operations',
    permission: 'catalog:view',
    steps:
      'Inspect asset processing, recent activity and publication status. Open the relevant asset to see individual job results and failures.',
  },
  {
    title: 'Team and API access',
    href: '/console/admin',
    permission: 'tenant:manage-users',
    steps:
      'Invite people, assign the appropriate role and manage API access. Equipment clients exchange a workspace API key for a short-lived access token before sending readings.',
  },
  {
    title: 'Audit history',
    href: '/console/audit',
    permission: 'audit:view',
    steps: 'Filter the workspace activity log by action and inspect recorded changes.',
  },
];
export default function HelpPage() {
  const { can } = useSession();
  return (
    <div className="space-y-7">
      <header>
        <p className="eyebrow">Using Void Space</p>
        <h1 className="mt-2 text-ink">Find your next step</h1>
        <p className="mt-3 max-w-[65ch] text-ink-dim">
          These workflows match your current workspace permissions. If a tool is missing, ask your
          workspace administrator about your role.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        {workflows
          .filter((item) => can(item.permission))
          .map((item) => (
            <Card key={item.href} className="space-y-3 p-5">
              <h2 className="text-lg font-semibold text-ink">
                <Link href={item.href} className="hover:underline">
                  {item.title} →
                </Link>
              </h2>
              <p className="text-sm leading-7 text-ink-dim">{item.steps}</p>
              {item.note ? <p className="text-xs leading-6 text-ink-faint">{item.note}</p> : null}
            </Card>
          ))}
      </div>
      <Card className="space-y-3 p-5">
        <h2 className="text-lg font-semibold text-ink">Account and access</h2>
        <p className="text-sm text-ink-dim">
          Shared links return you to the requested lesson, room or guide after sign-in. Switch
          workspaces from the header to access another team’s content. A link for a different
          workspace does not grant access.
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link className="text-brand underline" href="/console/account">
            Account and wallets
          </Link>
          <Link className="text-brand underline" href="/console/notifications">
            Notifications
          </Link>
          <Link className="text-brand underline" href="/catalog">
            Public catalogue
          </Link>
        </div>
      </Card>
    </div>
  );
}
