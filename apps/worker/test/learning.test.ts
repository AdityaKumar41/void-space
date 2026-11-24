import {describe,it,expect} from 'vitest';
import {extractLearningPdf} from '../src/processors/learning';
function pdf(text:string){const stream=text?`BT /F1 12 Tf 50 700 Td (${text}) Tj ET`:'';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];let data='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(data.length);data+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=data.length;data+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return new Uint8Array(Buffer.from(data));}
describe('private source PDF extraction',()=>{
 it('extracts text with stable page references',async()=>{const passages=await extractLearningPdf(pdf('A supply provides electrical energy. A switch opens a path.'));expect(passages[0]).toMatchObject({id:'page1_1',page:1});expect(passages[0]!.text).toContain('supply provides electrical energy');});
 it('gives a recovery path for image-only PDFs',async()=>{await expect(extractLearningPdf(pdf(''))).rejects.toThrow('no usable text layer');});
 it('rejects unsupported input without fabricating source content',async()=>{await expect(extractLearningPdf(new Uint8Array(Buffer.from('This is not a PDF')))).rejects.toThrow();});
});
