const digest=/^[a-f0-9]{64}$/,encoder=new TextEncoder();
function fail():never{throw new Error('The PDF rendition does not match its frozen fingerprints.');}
export async function verifyReportPdfDownload(bytes:ArrayBuffer,expectedPdf:string,expectedReport:string,pdfHeader:string|null,reportHeader:string|null){
 if(!digest.test(expectedPdf)||!digest.test(expectedReport)||pdfHeader!==expectedPdf||reportHeader!==expectedReport||bytes.byteLength<100||bytes.byteLength>33554432)return fail();
 const raw=new Uint8Array(bytes),prefix=encoder.encode('%PDF-1.4\n'),suffix=encoder.encode('%%EOF\n');if(!prefix.every((v,i)=>raw[i]===v)||!suffix.every((v,i)=>raw[raw.length-suffix.length+i]===v))return fail();
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(actual!==expectedPdf)return fail();
 const head=new TextDecoder('ascii').decode(raw.slice(0,512));if(!head.includes('%INVEOS-PROFILE inveos_report_pdf_v1\n')||!head.includes(`%INVEOS-SOURCE-SHA256 ${expectedReport}\n`))return fail();
 for(const token of ['/JavaScript','/OpenAction','/EmbeddedFiles','/Filespec'])if(new TextDecoder('latin1').decode(raw).includes(token))return fail();
 return {pdfSha256:actual,sourceReportSha256:expectedReport};
}
