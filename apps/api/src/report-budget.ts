import { ApiError } from './errors.js';

export const REPORT_MAX_BYTES = 32 * 1024 * 1024;
export const REPORT_MAX_ITEMS = 1000;

/** Counts exact UTF-8 JSON bytes before adding an item to an assembled report.
 * Base64 uses unescaped ASCII, so its length can be reserved before encoding.
 * This bounds serialised output, not total process RSS or concurrent requests.
 */
export class ReportBudget {
  private used = 0;

  constructor(private readonly maximum = REPORT_MAX_BYTES) {}

  add(value: unknown, extraBytes = 0, comma = false): void {
    if (!Number.isSafeInteger(extraBytes) || extraBytes < 0) throw new Error('Invalid report byte reservation');
    const size = Buffer.byteLength(JSON.stringify(value), 'utf8') + extraBytes + Number(comma);
    if (size > this.maximum - this.used) throw new ApiError(422, 'Report byte limit exceeded.');
    this.used += size;
  }

  get byteLength(): number { return this.used; }
}
