export type InspectionJob={id:string;caseId:string;evidenceId:string;sourceDigest:string;authorityVersion:number;kind:string;status:string};
type Line={line:number;startByte:number;endByte:number;nextByte:number};
export type InspectedDerivative={jobId:string;evidenceId:string;sourceDigest:string;derivativeDigest:string;processor:string;processorDigest:string;runtime:string;processedAt:string;authorityVersion:number;lines:(Line&{text:string})[]};
const hex=/^[a-f0-9]{64}$/;
async function sha(bytes:Uint8Array){const digest=await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>);return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
const fail=():never=>{throw new Error('Derivative identity, bytes or line ranges could not be verified. Refresh processing history and retry.');};
/** First-party UTF-8 contract only. Reconstruct offsets; hashes alone do not prove a citation. */
export async function inspectTextDerivative(value:unknown,job:InspectionJob):Promise<InspectedDerivative>{
  if(!value || typeof value!=='object')return fail();
  const row=value as Record<string,unknown>;
  if(job.kind!=='utf8_line_index_v1'||job.status!=='succeeded'||row.status!=='unreviewed_derivative'
    ||row.jobId!==job.id||row.caseId!==job.caseId||row.evidenceId!==job.evidenceId||row.sourceDigest!==job.sourceDigest
    ||row.authorityVersion!==job.authorityVersion||!hex.test(job.sourceDigest))return fail();
  if(row.processor!=='inveos_utf8_lines_v1'||typeof row.processorDigest!=='string'||!hex.test(row.processorDigest)
    ||typeof row.derivativeDigest!=='string'||!hex.test(row.derivativeDigest)||typeof row.runtime!=='string'
    ||typeof row.processedAt!=='string'||!Number.isFinite(Date.parse(row.processedAt)))return fail();
  const d=row.derivative as {format?:unknown;text?:unknown;lines?:unknown}|null;
  if(!d || d.format!=='inveos_text_lines_v1'||typeof d.text!=='string'||!d.text.length||d.text.length>262144
    ||!Array.isArray(d.lines)||d.lines.length>4096)return fail();
  const encoder=new TextEncoder(),bytes=encoder.encode(d.text),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  if(bytes.length>262144 || decoder.decode(bytes)!==d.text || await sha(bytes)!==job.sourceDigest)return fail();
  const lines:Line[]=[];let start=0;
  for(let cursor=0;cursor<bytes.length;cursor++){
    if(bytes[cursor]!==10&&bytes[cursor]!==13)continue;
    const end=cursor;if(bytes[cursor]===13&&bytes[cursor+1]===10)cursor++;
    lines.push({line:lines.length+1,startByte:start,endByte:end,nextByte:cursor+1});start=cursor+1;
    if(lines.length>4096)return fail();
  }
  if(start<bytes.length)lines.push({line:lines.length+1,startByte:start,endByte:bytes.length,nextByte:bytes.length});
  const canonical={format:'inveos_text_lines_v1',text:d.text,lines};
  // Compare exact supported shape as well as digest, rejecting invented/extra ranges.
  if(JSON.stringify(d)!==JSON.stringify(canonical)||await sha(encoder.encode(JSON.stringify(canonical)))!==row.derivativeDigest)return fail();
  const configuration=JSON.stringify({encoding:'UTF-8',preserveBom:true,separators:['CRLF','CR','LF'],maximumLines:4096});
  if(JSON.stringify(row.configuration)!==configuration||await sha(encoder.encode(configuration))!==row.configurationDigest)return fail();
  return {jobId:job.id,evidenceId:job.evidenceId,sourceDigest:job.sourceDigest,derivativeDigest:row.derivativeDigest,
    processor:row.processor,processorDigest:row.processorDigest,runtime:row.runtime,processedAt:row.processedAt,authorityVersion:job.authorityVersion,
    lines:lines.map(line=>({...line,text:decoder.decode(bytes.subarray(line.startByte,line.endByte))}))};
}
