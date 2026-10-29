import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReportBudget } from '../src/report-budget.js';

test('report budget counts exact Unicode, escaping, array commas and repeated base64 sources', () => {
  const report = {title: 'Fictional á😀', findings: [] as {text: string; contentBase64: string}[], context: [] as string[]};
  const budget = new ReportBudget();
  budget.add(report);
  for (const text of ['"Quoted"\n\u0000', 'Fictional second finding']) {
    const bytes = Buffer.from('Repeated fictional source á😀');
    const item = {text, contentBase64: ''};
    budget.add(item, 4 * Math.ceil(bytes.length / 3), report.findings.length > 0);
    item.contentBase64 = bytes.toString('base64');
    report.findings.push(item);
  }
  for (const item of ['Question\r\n', 'مورد']) {
    budget.add(item, 0, report.context.length > 0);
    report.context.push(item);
  }
  assert.equal(budget.byteLength, Buffer.byteLength(JSON.stringify(report)));
});

test('report budget accepts the exact boundary and rejects before a reserved encoding is allocated', () => {
  const budget = new ReportBudget(20);
  budget.add({b: ''}, 12); // Eight metadata bytes and twelve future base64 bytes.
  assert.equal(budget.byteLength, 20);
  assert.throws(() => budget.add(''), /Report byte limit exceeded/);
  assert.equal(budget.byteLength, 20);
  const tiny = new ReportBudget(8);
  assert.throws(() => tiny.add({b: ''}, 4), /Report byte limit exceeded/);
  assert.equal(tiny.byteLength, 0);
  for (const invalid of [-1, Infinity, 0.5]) assert.throws(() => tiny.add({}, invalid), /Invalid report byte reservation/);
});
