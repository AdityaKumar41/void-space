import { LearningProgram } from '../../../../../components/learning-program';
export default async function Program({ params }: { params: Promise<{ id: string }> }) {
  return <LearningProgram id={(await params).id} />;
}
