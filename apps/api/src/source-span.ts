import { ApiError } from './errors.js';

export function exactSpan(bytes: Buffer, quote: string, start: number, end: number): boolean {
  const encoded=Buffer.from(quote,'utf8');
  return Number.isInteger(start) && Number.isInteger(end) && start>=0 && end>start && end<=bytes.length
    && encoded.toString('utf8')===quote && bytes.subarray(start,end).equals(encoded);
}

/** Resolve a unique quotation or verify the explicit original-byte occurrence. */
export function selectSourceSpan(bytes: Buffer, quote: string, start?: number, end?: number) {
  const text=bytes.toString('utf8');
  if (!Buffer.from(text,'utf8').equals(bytes)) throw new ApiError(409,'The cited original is not valid UTF-8 text.');
  if (!quote.trim() || Buffer.from(quote,'utf8').toString('utf8')!==quote) throw new ApiError(422,'A valid Unicode source quote is required.');
  if (start!==undefined || end!==undefined) {
    if (start===undefined || end===undefined || !exactSpan(bytes,quote,start,end)) throw new ApiError(422,'The selected byte range does not exactly match the original quotation.');
    return {startByte:start,endByte:end};
  }
  const offset=text.indexOf(quote);
  if (offset<0) throw new ApiError(422,'The quoted source text is not an exact substring of the original.');
  if (text.indexOf(quote,offset+1)>=0) throw new ApiError(422,'This quotation occurs more than once. Supply sourceStartByte and sourceEndByte to select the intended passage.');
  const startByte=Buffer.byteLength(text.slice(0,offset),'utf8');
  return {startByte,endByte:startByte+Buffer.byteLength(quote,'utf8')};
}
