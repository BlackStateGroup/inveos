import type { Workspace } from '@inveos/contracts';
export type { Case, Evidence, Claim, Finding, Activity, Workspace } from '@inveos/contracts';
export const initialWorkspace: Workspace = {
  cases: [
    {id:'northstar',ref:'INV–2026–014',title:'Northstar procurement review',client:'Northstar Holdings (fictional)',category:'Corporate investigation',status:'Active',owner:'Alex Morgan',due:'30 Oct',scope:'Review fictional supplier invoices and commissioning-party records. No external collection authorised.',jurisdiction:'United Kingdom',authority:true},
    {id:'meridian',ref:'INV–2026–013',title:'Meridian asset verification',client:'Meridian Legal (fictional)',category:'Legal support',status:'In review',owner:'Jamie Chen',due:'28 Oct',scope:'Review supplied fictional asset records only.',jurisdiction:'United Kingdom',authority:true},
    {id:'oakfield',ref:'INV–2026–012',title:'Oakfield claim assessment',client:'Oakfield Assurance (fictional)',category:'Insurance',status:'Scope review',owner:'Sam Rivers',due:'02 Nov',scope:'Authority review pending. Collection is blocked.',jurisdiction:'United Kingdom',authority:false},
    {id:'harbour',ref:'INV–2026–011',title:'Harbour vendor due diligence',client:'Harbour Partners (fictional)',category:'Due diligence',status:'Active',owner:'Alex Morgan',due:'05 Nov',scope:'Review fictional supplied vendor documents only.',jurisdiction:'United Kingdom',authority:true}
  ],
  evidence: [
    {id:'EXH-001',caseId:'northstar',filename:'Supplier invoice · NS-0341',kind:'Document',bytes:247000,sourceTime:'2026-10-20T09:15:00Z',receivedTime:'2026-10-24T14:32:00Z',digest:'Illustrative only — no stored original',status:'Demo receipt',method:'Commissioning-party supplied record',text:'FICTIONAL TRAINING DOCUMENT\nNORTHSTAR HOLDINGS\nInvoice NS-0341\nIssued: 20 October 2026\nSupplier: Alder Supply Ltd (fictional)\nPurchase order: PO-2086\nProfessional services: £24,800.00\nPayment terms: 30 days\nApproved by: procurement desk'},
    {id:'EXH-002',caseId:'northstar',filename:'Purchase order · PO-2086',kind:'Document',bytes:183000,sourceTime:'2026-10-18T10:00:00Z',receivedTime:'2026-10-24T14:36:00Z',digest:'Illustrative only — no stored original',status:'Demo receipt',method:'Commissioning-party supplied record',text:'FICTIONAL TRAINING DOCUMENT\nNORTHSTAR HOLDINGS\nPurchase order PO-2086\nIssued: 18 October 2026\nSupplier: Alder Supply Ltd (fictional)\nAuthorised services: £18,500.00\nOwner: procurement desk'},
    {id:'EXH-003',caseId:'northstar',filename:'Interview · procurement lead',kind:'Transcript',bytes:4200,sourceTime:'2026-10-23T11:00:00Z',receivedTime:'2026-10-24T15:10:00Z',digest:'Illustrative only — no stored original',status:'Under review',method:'Synthetic transcript; no audio captured',text:'FICTIONAL INTERVIEW TRANSCRIPT\n00:12 Interviewer: How was the supplier selected?\n00:18 Witness A: The procurement team provided a shortlist.\n00:34 Interviewer: Was the additional work approved?\n00:41 Witness A: I would need to check the approval register.\nSpeaker attribution and transcript require review.'}
  ],
  claims:[
    {id:'CLM-001',caseId:'northstar',evidenceId:'EXH-001',text:'Invoice NS-0341 records professional services of £24,800.',quote:'Professional services: £24,800.00',status:'Under review'},
    {id:'CLM-002',caseId:'northstar',evidenceId:'EXH-002',text:'Purchase order PO-2086 authorises services of £18,500.',quote:'Authorised services: £18,500.00',status:'Accepted'},
    {id:'CLM-003',caseId:'northstar',evidenceId:'',text:'The supplier was selected outside the approved process.',quote:'',status:'Unsupported'}
  ],
  findings:[{id:'FND-001',caseId:'northstar',claimId:'CLM-002',text:'Purchase order PO-2086 authorises services of £18,500.',reviewer:'Jamie Chen (fictional)',reviewedAt:'2026-10-25T10:20:00Z'}],
  activity:[
    {id:'a1',caseId:'northstar',text:'Purchase order claim accepted for draft reporting',actor:'Jamie Chen',at:'25 Oct · 10:20'},
    {id:'a2',caseId:'northstar',text:'Interview transcript added to the review queue',actor:'Alex Morgan',at:'24 Oct · 15:10'},
    {id:'a3',caseId:'northstar',text:'Two supplier records registered for review',actor:'Alex Morgan',at:'24 Oct · 14:36'},
    {id:'a4',caseId:'northstar',text:'Case scope approved for supplied records only',actor:'Jamie Chen',at:'24 Oct · 09:00'}
  ]
};
export const shortDate = (value: string) => new Date(value).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}) + ' UTC';
