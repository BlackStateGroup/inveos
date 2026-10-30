import type {TikaReportFinding} from '@inveos/contracts';
/** Printable source inspection; page-text locations never masquerade as geometry. */
export function TikaReport({findings}:{findings:TikaReportFinding[]}){
 if(!findings.length)return null;
 return <section aria-label="Tika page-text report findings" className="report-document-section"><h2>Reviewed Tika PDF page-text interpretations</h2>{findings.map(f=>{const c=f.reference,r=c.citation.location,review=f.correspondence.at(-1)!;return <article className="report-finding" key={f.id}>
 <h3>{f.source.filename} · extracted page {r.page}</h3><p>{f.text}</p><blockquote>{c.citation.quote}</blockquote>
 <p>{r.path} · normalized derived UTF-8 bytes {r.startByte}–{r.endByte}. No bounding box or original PDF byte offset is asserted.</p>
 <p>Source time: {f.source.sourceTime} · received: {f.source.receivedTime} · processed: {f.extraction.processedAt}.</p>
 <p>Original authority {f.source.authorityId} v{f.source.authorityVersion}; processing authority v{f.extraction.authorityVersion}.</p>
 <p>Correspondence v{review.sequence}: {review.reviewerName} · {review.recordedAt} · {review.reason}</p><p>Interpretation: {f.interpretation.decision.reviewerName} · {f.reviewedAt} · {f.interpretation.decision.reason}</p>
 <dl className="metadata">{[['Finding',f.id],['Original SHA-256',f.source.sha256],['Source authority SHA-256',f.extraction.sourceAuthorityDigest],['Processing authority SHA-256',f.extraction.processingAuthorityDigest],['Processing job',`${f.extraction.jobId}; attempt ${f.extraction.attempt}`],['Profile SHA-256',f.extraction.profileDigest],['Raw SHA-256',f.extraction.rawDigest],['XHTML SHA-256',f.extraction.xhtmlDigest],['Derivative SHA-256',f.extraction.derivativeDigest],['Runtime receipt SHA-256',f.extraction.runtimeDigest],['Page text SHA-256',r.pageTextSha256],['Citation',`${c.id}; ${c.digest}`],['Correspondence',`${review.id}; ${review.digest}`],['Interpretation',`${f.interpretation.claim.id}; ${f.interpretation.claim.digest}`],['Interpretation decision',`${f.interpretation.decision.id}; ${f.interpretation.decision.digest}`]].map(([label,value])=><div key={label}><dt>{label}</dt><dd className="composition-hash">{value}</dd></div>)}</dl>
 <p>{f.limitations}</p></article>;})}</section>;
}
