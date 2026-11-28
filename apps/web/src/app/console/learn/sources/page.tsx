'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Sparkles, ArrowUpRight, LockKeyhole } from 'lucide-react';
import { LessonSources } from '../../../../components/lesson-sources';
import { LearningLayout } from '../../../../components/learning-ui';
export default function Page() {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <LearningLayout
      title="My sources"
      description="The material behind your lessons. Keep your notes, documents and references together in one private place."
    >
      <div className="source-workspace-toolbar">
        <span>
          <LockKeyhole size={16} /> Only you can access your originals
        </span>
        {ids.length > 0 && (
          <Link className="learning-primary" href={`/console/learn/agent?sources=${ids.join(',')}`}>
            <Sparkles size={15} /> Use {ids.length} selected{' '}
            {ids.length === 1 ? 'source' : 'sources'} with AI <ArrowUpRight size={15} />
          </Link>
        )}
      </div>
      <LessonSources standalone selected={ids} onChange={setIds} />
    </LearningLayout>
  );
}
