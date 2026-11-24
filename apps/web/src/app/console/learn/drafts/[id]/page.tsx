import { LessonEditor } from '../../../../../components/lesson-editor';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <LessonEditor id={id}/>;}
