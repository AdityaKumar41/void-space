import { LessonPlanPlayer } from '../../../../../components/lesson-plan-player';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <LessonPlanPlayer id={id}/>;}
