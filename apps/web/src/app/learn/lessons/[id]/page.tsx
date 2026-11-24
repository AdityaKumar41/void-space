import { PublicLearningLesson } from '../../../../components/public-learning-lesson';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicLearningLesson id={id} />;
}
