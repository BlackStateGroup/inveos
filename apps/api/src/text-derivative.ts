/** Original INVEOS processor: exact UTF-8 lines, never PDF/OCR or factual extraction. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const textProcessor = 'inveos_utf8_lines_v1';
export const textConfiguration = JSON.stringify({encoding:'UTF-8',preserveBom:true,separators:['CRLF','CR','LF'],maximumLines:4096});
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export type TextDerivative = {
  format: 'inveos_text_lines_v1';
  text: string;
  lines: {line:number;startByte:number;endByte:number;nextByte:number}[];
};
export type DerivativeOutput = {bytes:Buffer;digest:string;processorDigest:string;runtime:string};

export function indexText(bytes: Buffer): TextDerivative {
  if (!bytes.length || bytes.length > 262144) throw new Error('Text size limit');
  // Preserve BOM and reject invalid sequences rather than replacement-decoding.
  const text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  const lines: TextDerivative['lines'] = [];
  let start=0;
  for (let cursor=0;cursor<bytes.length;cursor++) {
    if (bytes[cursor] !== 10 && bytes[cursor] !== 13) continue;
    const end=cursor;
    if (bytes[cursor]===13 && bytes[cursor+1]===10) cursor++;
    lines.push({line:lines.length+1,startByte:start,endByte:end,nextByte:cursor+1});
    start=cursor+1;
    if (lines.length>4096) throw new Error('Line count limit');
  }
  if (start<bytes.length) lines.push({line:lines.length+1,startByte:start,endByte:bytes.length,nextByte:bytes.length});
  if (lines.length>4096) throw new Error('Line count limit');
  return {format:'inveos_text_lines_v1',text,lines};
}
export async function makeTextDerivative(bytes: Buffer): Promise<DerivativeOutput> {
  const output=Buffer.from(JSON.stringify(indexText(bytes)),'utf8');
  if (output.length>1048576) throw new Error('Derivative size limit');
  return {bytes:output,digest:sha256(output),processorDigest:sha256(await readFile(new URL('./text-derivative.ts',import.meta.url))),runtime:`node:${process.versions.node}`};
}
/** Rebuild against the current original; stored digests alone do not validate offsets. */
export function verifyTextDerivative(bytes: Buffer, output: Buffer, digest: string): TextDerivative {
  const expected=indexText(bytes);
  if (sha256(output)!==digest || !output.equals(Buffer.from(JSON.stringify(expected),'utf8'))) throw new Error('Derivative integrity failure');
  return expected;
}
