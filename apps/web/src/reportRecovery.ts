const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type RecoveryStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type ReportReceipt = {id: string; caseId: string; status: 'draft_not_released'; sha256: string; createdAt: string};

/** Session token material and report content are never persisted. A one-way CSRF
 * fingerprint separates sign-ins; sessionStorage supplies tab lifetime/scope. */
export async function reportRecoveryScope(csrf: string, caseId: string): Promise<string> {
  if (csrf.length < 16 || !uuid.test(caseId)) throw new Error('Report session is unavailable. Reconnect and check saved revisions.');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csrf));
  const fingerprint = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  return `inveos:report-freeze:v1:${fingerprint}:${caseId}`;
}

export function pendingReportFreeze(store: RecoveryStore, scope: string): string | null {
  let key: string | null;
  try { key = store.getItem(scope); } catch { throw new Error('Report retry storage is unavailable. Check saved revisions and retry when storage is available.'); }
  if (key !== null && !uuid.test(key)) throw new Error('Saved report retry record is invalid. Check saved revisions before clearing this tab’s site data.');
  return key;
}

function reserveFreeze(store: RecoveryStore, scope: string): string {
  const existing = pendingReportFreeze(store, scope);
  if (existing) return existing;
  const key = crypto.randomUUID();
  try {
    store.setItem(scope, key);
    if (store.getItem(scope) !== key) throw new Error('Write was not retained');
  } catch { throw new Error('Cannot save report retry storage. No new freeze request was sent.'); }
  return key;
}

function receiptForCase(value: unknown, caseId: string): ReportReceipt {
  const row = value as Partial<ReportReceipt> | null;
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !uuid.test(row.id)
    || row.caseId !== caseId || row.status !== 'draft_not_released' || typeof row.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(row.sha256) || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) {
    throw new Error('Report receipt could not be confirmed. Retry to recover the same request.');
  }
  return row as ReportReceipt;
}

/** Reserve before sending; retain the key on transport/receipt failure. The server
 * remains responsible for actor/case-scoped idempotency and authorisation. */
export async function recoverableReportFreeze(store: RecoveryStore, scope: string, caseId: string,
  send: (key: string) => Promise<unknown>): Promise<ReportReceipt> {
  const key = reserveFreeze(store, scope);
  const receipt = receiptForCase(await send(key), caseId);
  try {
    // A delayed response must not remove a newer pending request.
    if (store.getItem(scope) === key) {
      store.removeItem(scope);
      if (store.getItem(scope) === key) throw new Error('Removal was not retained');
    }
  } catch { throw new Error('Report saved, but its retry record could not be cleared. Retry safely to recover its receipt.'); }
  return receipt;
}
