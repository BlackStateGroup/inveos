/** Deterministic, first-party PDF profile for frozen internal reports.
 *
 * The profile deliberately uses only the PDF standard Helvetica font with
 * WinAnsiEncoding. Text outside the explicitly mapped repertoire is rejected;
 * it is never replaced or transliterated. A later Unicode profile needs a
 * separately reviewed embedded-font artifact.
 */
import {createHash} from 'node:crypto';
import type {ReportDraft} from '@inveos/contracts';

const sha256=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const digestPattern=/^[a-f0-9]{64}$/;
const profile='inveos_report_pdf_v1';
export const reportPdfProfile={format:profile,pdfVersion:'1.4',page:[612,792],font:'Helvetica',encoding:'WinAnsiEncoding',fontSize:10,leading:12,margin:[48,32],maxVisibleLines:48000};
export const reportPdfProfileDigest=sha256(JSON.stringify(reportPdfProfile));

export type ReportRedactionPlan={format:'inveos_report_redaction_v1';findingIds:string[];reason:string};
export type ReportPdfModel={
  format:'inveos_report_pdf_model_v1';profile:string;profileDigest:string;sourceReportSha256:string;
  redaction:{digest:string;count:number;reason:string};visibleLines:string[];pageCount:number;
};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cp1252=new Map<number,number>([[0x20ac,0x80],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],[0x2039,0x8b],[0x0152,0x8c],[0x017d,0x8e],[0x2018,0x91],[0x2019,0x92],[0x201c,0x93],[0x201d,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02dc,0x98],[0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],[0x0153,0x9c],[0x017e,0x9e],[0x0178,0x9f]]);

function winAnsi(text:string){
  const bytes:number[]=[];
  for(const character of text){
    const point=character.codePointAt(0)!;
    if(point===9){bytes.push(0x20);continue;}
    if(point>=0x20&&point<=0x7e||point>=0xa0&&point<=0xff){bytes.push(point);continue;}
    const mapped=cp1252.get(point);if(mapped!==undefined){bytes.push(mapped);continue;}
    throw new Error(`The PDF v1 profile cannot represent U+${point.toString(16).toUpperCase().padStart(4,'0')}.`);
  }
  return Buffer.from(bytes);
}

function clean(value:unknown){
  const text=String(value??'').normalize('NFC').replace(/\r\n?/g,'\n');
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))throw new Error('Report text contains unsupported control characters.');
  return text;
}

function wrap(label:string,value:unknown,width=88){
  const prefix=label?`${label}: `:'';
  const logical=clean(value).split('\n');const lines:string[]=[];
  for(const [index,part] of logical.entries()){
    let remaining=(index===0?prefix:' '.repeat(prefix.length))+part;
    if(!remaining){lines.push('');continue;}
    while(remaining.length>width){let cut=remaining.lastIndexOf(' ',width);if(cut<prefix.length+8)cut=width;lines.push(remaining.slice(0,cut));remaining='  '+remaining.slice(cut).trimStart();}
    lines.push(remaining);
  }
  return lines;
}

export function reportLines(report:ReportDraft,redacted:Set<string>,reason:string,format=wrap){
  const lines:string[]=['INVEOS INTERNAL REPORT','',...format('Case',`${report.case.ref} — ${report.case.title}`),...format('Client',report.case.client),...format('Jurisdiction',report.case.jurisdiction),...format('Scope',report.case.scope),''];
  let number=0;
  for(const finding of report.findings){
    number++;if(redacted.has(finding.id)){lines.push(`FINDING ${number}: [REDACTED]`,...format('Redaction reason',reason),'');continue;}
    lines.push(`FINDING ${number}`,...format('Finding',finding.text),...format('Reviewed by',`${finding.reviewer} at ${finding.reviewedAt}`),...format('Source',finding.source.filename),...format('Source SHA-256',finding.source.sha256),...format('Citation',`${finding.source.startByte}-${finding.source.endByte}: ${finding.source.quote}`),...format('Authority',`${finding.source.policy.authorityId} v${finding.source.policy.authorityVersion}; ${finding.source.policy.lawfulBasis}`),'');
    const collection=report.sourceUse?.find(p=>p.record.original.id===finding.source.id&&p.collection)?.collection;
    if(collection){const c=collection.payload,r=c.receipt;lines.push(...format('Collection',`${r.captureMode==='fictional_fixture'?'Fictional fixture; provider not contacted':'Provider response'}; ${r.url}`),...format('Collection receipt',`${r.jobId}; SHA-256 ${c.receiptSha256}`),...format('Collection permission',`${r.authorisationId}; case authority v${r.authorityVersion}; source policy v${r.policyVersion}`),...format('Collection time',`response ${r.sourceTime} (not record creation); received ${r.receivedAt}`),'');}

  }
  for(const finding of report.documentFindings??[]){
    number++;if(redacted.has(finding.id)){lines.push(`DOCUMENT FINDING ${number}: [REDACTED]`,...format('Redaction reason',reason),'');continue;}
    lines.push(`DOCUMENT FINDING ${number}`,...format('Finding',finding.text),...format('Reviewed by',`${finding.reviewer} at ${finding.reviewedAt}`),...format('Original',`${finding.source.filename}; SHA-256 ${finding.source.sha256}`),...format('Page/region',`page ${finding.reference.page}; ${finding.reference.bbox.origin} [${finding.reference.bbox.l}, ${finding.reference.bbox.t}, ${finding.reference.bbox.r}, ${finding.reference.bbox.b}]`),...format('Reviewed passage',finding.reference.quote),...format('Citation SHA-256',finding.reference.citationDigest),...format('Derivative SHA-256',finding.extraction.derivativeDigest),...format('Finding limitation',finding.limitations),'');
  }
  for(const finding of report.transcriptFindings??[]){
    number++;if(redacted.has(finding.id)){lines.push(`TRANSCRIPT FINDING ${number}: [REDACTED]`,...format('Redaction reason',reason),'');continue;}
    const c=finding.claim;lines.push(`TRANSCRIPT FINDING ${number}`,...format('Finding',finding.text),...format('Reviewed by',`${finding.reviewer} at ${finding.reviewedAt}`),...format('Original',`${c.source.filename}; SHA-256 ${c.source.sha256}`),...format('Transcript version',`${c.transcript.id} ${c.transcript.sourcePointer} v${c.transcript.version}`),...format('Transcript citation',`${c.reference.startByte}-${c.reference.endByte}: ${c.reference.quote}`),...format('Declared time',`${c.reference.startMs}-${c.reference.endMs} ms; audio alignment unverified`),...format('Declared speaker',`${c.reference.speakerLabel}; ${c.reference.speakerUncertain?'uncertain':'attributed in supplied record'}`),...format('Finding limitation',c.limitations),'');
  }
  for(const finding of report.speechFindings??[]){
    number++;if(redacted.has(finding.id)){lines.push(`SPEECH FINDING ${number}: [REDACTED]`,...format('Redaction reason',reason),'');continue;}
    const c=finding.claim,r=c.reference,p=c.context.payload;
    lines.push(`SPEECH FINDING ${number}`,...format('Finding',finding.text),...format('Reviewed by',`${finding.reviewer} at ${finding.reviewedAt}`),...format('Original audio',`${c.source.filename}; SHA-256 ${c.source.sha256}`),...format('Recognition',`${r.jobId}; profile ${p.profileDigest}; raw ${p.rawDigest}`),...format('Speech account',`segment ${r.segmentIndex+1}, correction v${r.version}; correspondence decision ${r.correspondenceDigest}`),...format('Account citation',`${r.startByte}-${r.endByte} UTF-8: ${r.quote}`),...format('Reviewed range',`${r.account.startMs}-${r.account.endMs} ms; declared speaker ${r.account.speakerLabel}; ${r.account.speakerUncertain?'uncertain attribution':'human attribution, identity unverified'}`),...format('Finding limitation',c.limitations),'');
  }
  const context=report.investigation;
  if(context){lines.push('WORKING CONTEXT — NOT FINDINGS');for(const [heading,items] of [['Objectives',context.objectives],['Questions',context.questions],['Hypotheses',context.hypotheses],['Blocked tasks',context.blockers]] as const){lines.push(heading);for(const item of items)lines.push(...format('-',JSON.stringify(item)));}lines.push('');}
  if(context?.transcriptLinks?.length){
    lines.push('TRANSCRIPT REASONING LINKS — WORKING CONTEXT');
    for(const link of context.transcriptLinks){
      if(redacted.has(link.findingId)){lines.push('[TRANSCRIPT SOURCE LINK WITHHELD]');continue;}
      if(!report.transcriptFindings?.some(f=>f.id===link.findingId))throw new Error('Transcript reasoning source is missing.');
      lines.push(...format('Work item',link.itemId),...format('Relation',link.relation),...format('Reason',link.reason),...format('Transcript finding',link.findingId),...format('Link recorded',link.createdAt),'');
    }
  }
  if(context?.chronology?.length){
    lines.push('ALLEGED EVENTS — RECORDED ACCOUNTS, NOT FINDINGS','Recorded order does not establish event sequence.');
    for(const event of context.chronology){
      if(redacted.has(event.source.findingId)){lines.push('[CHRONOLOGY ENTRY WITHHELD]');continue;}
      const finding=event.source.kind==='text_finding'?report.findings.find(f=>f.id===event.source.findingId):event.source.kind==='document_finding'?report.documentFindings?.find(f=>f.id===event.source.findingId):report.transcriptFindings?.find(f=>f.id===event.source.findingId);
      if(!finding)throw new Error('Chronology source is missing.');
      const original='kind' in finding&&finding.kind==='reviewed_transcript'?finding.claim.source:finding.source;
      lines.push(...format('Account',event.title),...format('Status',event.status),...format('Alleged date',`${event.time.precision}: ${event.time.start??'unknown'}${event.time.end?' to '+event.time.end:''}`),...format('Stated timezone',event.time.timezone||'Not specified'),...format('Uncertainty',event.time.note),...format('Account detail',event.account),...format('Source finding',event.source.findingId),...format('Source-recorded time',original.sourceTime),...format('Received time',original.receivedTime),...format('Account recorded',`${event.recordedAt}; version ${event.version}`),'');
    }
  }
  lines.push('REPORT LIMITATIONS',...format('',report.limitations));
  return lines;
}

function pdfHex(value:string){return winAnsi(value).toString('hex').toUpperCase();}
function object(body:Buffer|string){return Buffer.concat([Buffer.from(typeof body==='string'?body:''),typeof body==='string'?Buffer.alloc(0):body]);}

export function buildReportPdf(report:ReportDraft,sourceReportSha256:string,input:{findingIds?:string[];reason?:string}){
  const {plan,redactionDigest}=reportRedaction(report,sourceReportSha256,input),findingIds=plan.findingIds,reason=plan.reason;
  const visibleLines=reportLines(report,new Set(findingIds),reason);if(visibleLines.length>reportPdfProfile.maxVisibleLines)throw new Error('The report exceeds the PDF profile line limit.');
  for(const line of visibleLines)winAnsi(line);
  const pages:string[][]=[];for(let i=0;i<visibleLines.length;i+=58)pages.push(visibleLines.slice(i,i+58));if(!pages.length)pages.push([]);
  const model:ReportPdfModel={format:'inveos_report_pdf_model_v1',profile,profileDigest:reportPdfProfileDigest,sourceReportSha256,redaction:{digest:redactionDigest,count:findingIds.length,reason},visibleLines,pageCount:pages.length};
  const modelBytes=Buffer.from(JSON.stringify(model),'utf8'),contentDigest=sha256(modelBytes);
  const fontNumber=3+2*pages.length,modelNumber=fontNumber+1;
  const objects:Buffer[]=[Buffer.from(`<< /Type /Catalog /Pages 2 0 R /INVEOSModel ${modelNumber} 0 R >>`),Buffer.from(`<< /Type /Pages /Kids [${pages.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`)];
  for(const [index,page] of pages.entries()){
    const pageObject=3+index*2,contentObject=pageObject+1;
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontNumber} 0 R >> >> /Contents ${contentObject} 0 R >>`));
    const commands=`BT /F1 10 Tf 48 760 Td 12 TL\n${page.map(line=>`<${pdfHex(line)}> Tj T*`).join('\n')}\nET\n`,stream=Buffer.from(commands,'ascii');
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),stream,Buffer.from('endstream')]));
  }
  objects.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  const encodedModel=Buffer.from(modelBytes.toString('hex').toUpperCase()+'>','ascii');objects.push(Buffer.concat([Buffer.from(`<< /Length ${encodedModel.length} /Filter /ASCIIHexDecode >>\nstream\n`),encodedModel,Buffer.from('\nendstream')]));
  const header=Buffer.from(`%PDF-1.4\n%INVEOS-PROFILE ${profile}\n%INVEOS-SOURCE-SHA256 ${sourceReportSha256}\n%INVEOS-REDACTION-SHA256 ${redactionDigest}\n%INVEOS-MODEL-SHA256 ${contentDigest}\n`,'ascii'),chunks=[header],offsets:number[]=[];let length=header.length;
  objects.forEach((body,index)=>{offsets.push(length);const chunk=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),object(body),Buffer.from('\nendobj\n')]);chunks.push(chunk);length+=chunk.length;});
  const xref=length;chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const bytes=Buffer.concat(chunks);return {bytes,digest:sha256(bytes),model,modelBytes,contentDigest,plan,redactionDigest,profileDigest:reportPdfProfileDigest};
}

export function reportRedaction(report:ReportDraft,sourceReportSha256:string,input:{findingIds?:string[];reason?:string}){
  if(!digestPattern.test(sourceReportSha256))throw new Error('A valid source report fingerprint is required.');
  const all=[...report.findings,...(report.documentFindings??[]),...(report.transcriptFindings??[]),...(report.speechFindings??[])],findingIds=input.findingIds??[];
  if(findingIds.length>all.length||findingIds.some(id=>!uuid.test(id))||new Set(findingIds).size!==findingIds.length)throw new Error('The redaction finding list is invalid.');
  const known=new Set(all.map(f=>f.id));if(findingIds.some(id=>!known.has(id)))throw new Error('The redaction plan references a finding outside the frozen report.');
  const reason=clean(input.reason??'').trim();if(findingIds.length&&(reason.length<10||reason.length>500))throw new Error('A redaction reason between 10 and 500 characters is required.');
  if(!findingIds.length&&reason)throw new Error('An unredacted rendition cannot carry a redaction reason.');
  const plan:ReportRedactionPlan={format:'inveos_report_redaction_v1',findingIds:[...findingIds].sort(),reason},redactionDigest=sha256(JSON.stringify(plan));
  return {plan,redactionDigest};
}
