'use client';
import { useState } from 'react';
import { LessonSources } from '../../../../components/lesson-sources';
import { LearningLayout } from '../../../../components/learning-ui';
export default function Page(){const [ids,setIds]=useState<string[]>([]);return <LearningLayout title="My sources" description="Keep your notes, text PDFs and approved images private. Attach selected sources when you talk to your agent."><LessonSources selected={ids} onChange={setIds}/></LearningLayout>;}
