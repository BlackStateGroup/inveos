/** First-party fictional office acceptance fixture; no external data or package dependencies. */
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {buildReportDocx} from '../apps/api/src/report-docx.ts';
const report={status:'draft_not_released',case:{id:'00000000-0000-4000-8000-000000000001',ref:'SYN-OFFICE',title:'Fictional Paperworks — Ελληνικά — 日本語 — café <&>',client:'Fictional Paperworks',scope:'Fictional supplied records only.\tEditor compatibility fixture.',jurisdiction:'England'},findings:[],investigation:{status:'working_context_not_findings',objectives:[],questions:[],hypotheses:[],blockers:[]},limitations:'Fictional fixture. No legal or professional acceptance.'};
const built=buildReportDocx(report,'a'.repeat(64),{},'inveos_report_docx_v2');
await writeFile(fileURLToPath(new URL('../tests/fixtures/fictional-disclosure-report.docx',import.meta.url)),built.bytes);
console.log(JSON.stringify({profile:built.model.profile,sha256:built.digest,bytes:built.bytes.length}));
