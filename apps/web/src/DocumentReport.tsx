import type {DocumentReportFinding} from '@inveos/contracts';

/** Deliberately distinct from original-byte passages in legacy reports. */
export function DocumentReport({findings}:{findings:DocumentReportFinding[]}){
  if(!findings.length)return null;
  return <section aria-label="Document-backed report findings" className="report-document-section">
    <h2>Reviewed document interpretations</h2>
    {findings.map(f=><div className="report-finding" key={f.id}>
      <h3>{f.source.filename} · page {f.reference.page}</h3><p>{f.text}</p><blockquote>{f.reference.quote}</blockquote>
      <p>Extracted UTF-8 bytes {f.reference.startByte}–{f.reference.endByte}; item {f.reference.itemRef}. These are not original PDF byte offsets.</p>
      <p>Region ({f.reference.bbox.l}, {f.reference.bbox.t}) to ({f.reference.bbox.r}, {f.reference.bbox.b}); origin {f.reference.bbox.origin}.</p>
      <p>Correspondence review: {f.correspondence.reason}</p><p>Interpretation review: {f.interpretation.reason}</p>
      <small>Reviewed by {f.reviewer} · {f.reviewedAt}. Source time: {f.source.sourceTime}; received: {f.source.receivedTime}; processed: {f.extraction.processedAt}.</small>
      <p className="small report-digest">Original SHA-256: {f.source.sha256}<br/>Extraction SHA-256: {f.extraction.derivativeDigest}<br/>Citation SHA-256: {f.reference.citationDigest}</p>
      <p>{f.limitations}</p>
    </div>)}
  </section>;
}
