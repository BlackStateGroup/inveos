/** First-party bounded OOXML export. No macros, links, hidden source report or compression. */
import {createHash} from 'node:crypto';
import type {ReportDraft} from '@inveos/contracts';
import {reportLines,reportRedaction} from './report-pdf.js';
const sha256=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export const reportDocxProfile={format:'inveos_report_docx_v1',encoding:'UTF-8',zip:'store',maxParagraphs:48000,maxBytes:33554432};
export const reportDocxProfileDigest=sha256(JSON.stringify(reportDocxProfile));
const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const contentTypes=declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const relationships=declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const documentRelationships=declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>';
function xml(value:string){
 for(const c of value){const p=c.codePointAt(0)!;if(p<32&&p!==9||p>=0xd800&&p<=0xdfff||p===0xfffe||p===0xffff)throw new Error('DOCX text contains an unsupported XML character.');}
 return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
}
const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let n=0;n<8;n++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes:Buffer){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]!^(c>>>8);return (c^0xffffffff)>>>0;}
function zip(parts:Array<[string,string]>){
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const [path,body] of parts){const name=Buffer.from(path),bytes=Buffer.from(body),crc=crc32(bytes),header=Buffer.alloc(30),directory=Buffer.alloc(46);
  header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
  directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(33,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(bytes.length,20);directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
  local.push(header,name,bytes);central.push(directory,name);offset+=header.length+name.length+bytes.length;
 }
 const centre=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(parts.length,8);end.writeUInt16LE(parts.length,10);end.writeUInt32LE(centre.length,12);end.writeUInt32LE(offset,16);
 if(offset+centre.length+end.length>reportDocxProfile.maxBytes)throw new Error('The report exceeds the DOCX byte limit.');return Buffer.concat([...local,centre,end]);
}
function paragraphsFor(label:string,value:unknown){return String(value??'').normalize('NFC').replace(/\r\n?/g,'\n').split('\n').map((part,i)=>(i===0&&label?label+': ':'')+part);}
export function buildReportDocx(report:ReportDraft,sourceReportSha256:string,input:{findingIds?:string[];reason?:string}){
 const {plan,redactionDigest}=reportRedaction(report,sourceReportSha256,input),redacted=new Set(plan.findingIds);
 const paragraphs=['EDITABLE INTERNAL COPY — NOT A CLIENT RELEASE','Editing changes the file fingerprint. No review or release approval transfers to an edited copy.',`Frozen report SHA-256: ${sourceReportSha256}`,...reportLines(report,redacted,plan.reason,paragraphsFor)];
 if(report.investigation?.documentLinks?.length){const links=['DOCUMENT REASONING LINKS — WORKING CONTEXT'];for(const link of report.investigation.documentLinks){if(redacted.has(link.findingId)){links.push('[DOCUMENT SOURCE LINK WITHHELD]');continue;}if(!report.documentFindings?.some(f=>f.id===link.findingId))throw new Error('Document reasoning source is missing.');links.push(...paragraphsFor('Work item',link.itemId),...paragraphsFor('Relation',link.relation),...paragraphsFor('Reason',link.reason),...paragraphsFor('Document finding',link.findingId),...paragraphsFor('Link recorded',link.createdAt),'');}paragraphs.splice(paragraphs.lastIndexOf('REPORT LIMITATIONS'),0,...links);}
 for(const f of [...report.findings,...(report.documentFindings??[]),...(report.transcriptFindings??[])]){if(redacted.has(f.id))continue;const source='kind' in f&&f.kind==='reviewed_transcript'?f.claim.source:f.source;paragraphs.push(`Source times for finding ${f.id}`,`Source-recorded: ${source.sourceTime}`,`Received: ${source.receivedTime}`);}
 if(paragraphs.length>reportDocxProfile.maxParagraphs)throw new Error('The report exceeds the DOCX paragraph limit.');
 if(plan.findingIds.length>1000)throw new Error('The report exceeds the DOCX redaction limit.');
 const model={format:'inveos_report_docx_model_v1',profile:reportDocxProfile.format,profileDigest:reportDocxProfileDigest,sourceReportSha256,redaction:{digest:redactionDigest,count:plan.findingIds.length,reason:plan.reason},paragraphs};
 const modelBytes=Buffer.from(JSON.stringify(model)),contentDigest=sha256(modelBytes);if(modelBytes.length>8*1024*1024)throw new Error('The report exceeds the DOCX model limit.');
 const document=declaration+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+paragraphs.map(p=>'<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/>'+(/^(INVEOS INTERNAL REPORT|EDITABLE INTERNAL COPY|FINDING \d|DOCUMENT FINDING \d|TRANSCRIPT FINDING \d|WORKING CONTEXT|REPORT LIMITATIONS|ALLEGED EVENTS|TRANSCRIPT REASONING LINKS|DOCUMENT REASONING LINKS)/.test(p)?'<w:b/>':'')+'</w:rPr><w:t xml:space="preserve">'+xml(p).replaceAll('\t','</w:t><w:tab/><w:t xml:space="preserve">')+'</w:t></w:r></w:p>').join('')+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>';
 const metadata=declaration+'<inveos:model xmlns:inveos="urn:inveos:report-docx:v1" encoding="base64">'+modelBytes.toString('base64')+'</inveos:model>';
 const bytes=zip([['[Content_Types].xml',contentTypes],['_rels/.rels',relationships],['word/document.xml',document],['word/_rels/document.xml.rels',documentRelationships],['customXml/item1.xml',metadata]]);
 return {bytes,digest:sha256(bytes),model,modelBytes,contentDigest,plan,redactionDigest,profileDigest:reportDocxProfileDigest};
}
