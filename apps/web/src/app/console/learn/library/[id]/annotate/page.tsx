import { LearningLibrary } from '../../../../../../components/learning-library';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LearningLibrary editorModelId={id} />;
}
