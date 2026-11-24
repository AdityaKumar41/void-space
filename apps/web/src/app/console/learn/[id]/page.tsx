import { LearningPlayer } from '../../../../components/learning-player';
export default async function Activity({ params }: { params: Promise<{ id: string }> }) {
  return <LearningPlayer id={(await params).id} />;
}
