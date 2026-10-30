import type {CaseCurrency,CaseTimeEntry,CaseExpense,CaseBudgetVersion,SpendingBudget} from './index.js';

export type BillingDeclarationFields={
 currency:CaseCurrency;recipientId:string;billTo:string;billingBasis:string;
 hourlyRateMinor:number;expenseTreatment:'at_cost';
 taxTreatment:'explicit_zero'|'exclusive_rate';taxBasisPoints:number;taxLabel:string;
 rounding:'per_line_half_up';fictional:true;
};
export type BillingDeclaration=BillingDeclarationFields&{
 id:string;caseId:string;version:number;action:'declared'|'revised'|'withdrawn';
 recipientName:string;authorityVersion:number;reason:string;actorId:string;actorName:string;recordedAt:string;
};
export type InvoiceSelection={kind:'time'|'expense';id:string;version:number};
export type InvoiceLine={
 position:number;kind:'time'|'expense';sourceId:string;sourceVersion:number;description:string;
 quantity:number;unit:'minute'|'expense';rateMinor:number;netMinor:number;taxMinor:number;totalMinor:number;
 source:CaseTimeEntry|CaseExpense;
};
export type InvoiceSnapshot={
 format:'inveos_internal_invoice_v1';tenantId:string;caseId:string;caseRef:string;invoiceId:string;version:number;
 previousSha256:string|null;action:'compiled'|'corrected'|'withdrawn';reference:string;reason:string;
 declaration:BillingDeclaration;authorityVersion:number;preparedBy:{id:string;name:string};frozenAt:string;
 budget:{time:CaseBudgetVersion|null;spending:SpendingBudget|null;recordedMinutes:number;declaredExpenseMinor:number;observedAt:string};
 lines:InvoiceLine[];totals:{currency:CaseCurrency;netMinor:number;taxMinor:number;totalMinor:number};
 limitations:string;
};
export type InvoiceReview={id:string;version:number;sha256:string;accepted:boolean;reason:string;actorId:string;actorName:string;recordedAt:string};
export type InvoiceRevision={snapshot:InvoiceSnapshot;sha256:string;review:InvoiceReview|null;currentVersion:number;
 state:'awaiting_review'|'accepted_internal'|'rejected'|'withdrawn'|'superseded';
 currentIssues:string[];canReview:boolean;canRevise:boolean};
export type InvoiceSummary={id:string;version:number;reference:string;currency:CaseCurrency;recipientName:string;totalMinor:number;
 action:InvoiceSnapshot['action'];review:InvoiceReview|null;recordedAt:string;sha256:string};
export type InvoicePage={items:InvoiceSummary[];next:string|null};
export type InvoiceCandidate={kind:'time'|'expense';id:string;version:number;description:string;sourceTime:string;recordedAt:string;
 authorName:string;minutes:number|null;amountMinor:number|null;receiptId:string|null;receiptSha256:string|null};
export type InvoiceEligibility={currency:CaseCurrency;kind:'time'|'expense';items:InvoiceCandidate[];next:string|null;
 declaration:BillingDeclaration|null;observedAt:string;limitations:string};
export type InvoiceExport={format:'inveos_internal_invoice_export_v1';sha256:string;snapshotBase64:string;
 review:InvoiceReview|null;currentVersion:number;state:InvoiceRevision['state'];currentIssues:string[];
 exportedAt:string;limitations:string};
