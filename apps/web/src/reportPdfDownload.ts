const digest=/^[a-f0-9]{64}$/,encoder=new TextEncoder();
export const maxReportPdfBytes=33554432;
export async function readReportPdfBytes(response:Response,label='PDF'):Promise<ArrayBuffer>{
 const length=response.headers.get('Content-Length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxReportPdfBytes)){await response.body?.cancel();throw new Error(`${label} download exceeds its size limit.`);}
 if(!response.body)throw new Error(`${label} response has no readable body.`);
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxReportPdfBytes)throw new Error(`${label} download exceeds its size limit.`);chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(length!==null&&size!==Number(length))throw new Error(`${label} download was incomplete.`);
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes.buffer;
}
function fail():never{throw new Error('The PDF rendition does not match its frozen fingerprints.');}
export async function verifyReportPdfDownload(bytes:ArrayBuffer,expectedPdf:string,expectedReport:string,pdfHeader:string|null,reportHeader:string|null){
 if(!digest.test(expectedPdf)||!digest.test(expectedReport)||pdfHeader!==expectedPdf||reportHeader!==expectedReport||bytes.byteLength<100||bytes.byteLength>33554432)return fail();
 const raw=new Uint8Array(bytes),prefix=encoder.encode('%PDF-1.4\n'),suffix=encoder.encode('%%EOF\n');if(!prefix.every((v,i)=>raw[i]===v)||!suffix.every((v,i)=>raw[raw.length-suffix.length+i]===v))return fail();
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(actual!==expectedPdf)return fail();
 const head=new TextDecoder('ascii').decode(raw.slice(0,512));if(!head.includes('%INVEOS-PROFILE inveos_report_pdf_v1\n')||!head.includes(`%INVEOS-SOURCE-SHA256 ${expectedReport}\n`))return fail();
 const text=new TextDecoder('latin1').decode(raw);for(const token of ['/JavaScript','/OpenAction','/EmbeddedFiles','/Filespec'])if(text.includes(token))return fail();
 return {pdfSha256:actual,sourceReportSha256:expectedReport};
}
