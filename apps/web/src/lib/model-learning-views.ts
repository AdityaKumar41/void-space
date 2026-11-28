export interface LearningModelView {
  name: string;
  image: string;
  anchors: { x: number; y: number; position: [number, number, number]; meshKey: string }[];
}
export type CaptureLearningViews = () => Promise<LearningModelView[]>;
