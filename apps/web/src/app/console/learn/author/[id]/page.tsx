import { LearningAuthor } from '../../../../../components/learning-author';
export default async function Author({ params }: { params: Promise<{ id: string }> }) {
  return <LearningAuthor id={(await params).id} />;
}
