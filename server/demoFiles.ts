import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hasCode } from './filesystem.ts';

export function createSamplePdf() {
  const pages = ['Learning Workspace sample - page 1', 'Learning Workspace sample - page 2'];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    ...[6, 7].map((id) => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 320] /Resources << /Font << /F1 5 0 R >> >> /Contents ' + id + ' 0 R >>'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pages.map((line) => {
      const commands = 'BT /F1 18 Tf 30 260 Td (' + line + ') Tj ET\n';
      return '<< /Length ' + commands.length + ' >>\nstream\n' + commands + 'endstream';
    }),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = pdf.length;
  pdf += 'xref\n0 ' + (offsets.length + 1) + '\n0000000000 65535 f \n';
  for (const offset of offsets) pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size ' + (offsets.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(pdf, 'ascii');
}

export const sampleNote = '---\ntitle: 线性代数示例\n---\n\n# 向量与矩阵\n\n保留原文中的 [[向量空间]] 与 ![[图例.png]]。\n\n- [ ] 复习线性变换\n\n$Ax=b$\n';

export async function generateExamples(directory: string) {
  for (const [name, bytes] of [['线性代数.md', sampleNote], ['教材示例.pdf', createSamplePdf()]] as const) {
    try {
      await writeFile(join(directory, name), bytes, { flag: 'wx' });
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
  }
}
