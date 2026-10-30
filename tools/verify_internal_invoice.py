#!/usr/bin/env python3
"""Inspect an internal invoice export using an independently retained snapshot digest.

This verifies the frozen representation and declared integer arithmetic. It does
not contact the service, assert present access/authority, verify original receipt
files, establish tax treatment, or approve delivery/payment.
"""
import argparse
import base64
import hashlib
import json
import re
from pathlib import Path

MAX_BYTES = 3 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, lower=0, upper=5_000_000_000_000):
    require(type(value) is int and lower <= value <= upper, 'Invalid bounded integer amount/version')
    return value


def half_up(numerator, denominator):
    return (numerator + denominator // 2) // denominator


def verify(data, expected_sha256):
    require(re.fullmatch('[a-f0-9]{64}', expected_sha256) is not None, 'Retained SHA-256 required')
    require(data['format'] == 'inveos_internal_invoice_export_v1', 'Unsupported export format')
    raw = base64.b64decode(data['snapshotBase64'], validate=True)
    require(len(raw) <= 2 * 1024 * 1024, 'Snapshot size limit exceeded')
    digest = hashlib.sha256(raw).hexdigest()
    require(digest == expected_sha256 == data['sha256'], 'Frozen snapshot fingerprint mismatch')
    snapshot = json.loads(raw)
    require(snapshot['format'] == 'inveos_internal_invoice_v1', 'Unsupported snapshot format')
    version = integer(snapshot['version'], 1, 100)
    require(snapshot['action'] in ('compiled', 'corrected', 'withdrawn'), 'Unknown invoice action')
    require((snapshot['action'] == 'compiled') == (version == 1), 'Invalid compilation version')
    require((snapshot['previousSha256'] is None) == (version == 1), 'Missing or invalid previous revision link')
    if version > 1:
        require(re.fullmatch('[a-f0-9]{64}', snapshot['previousSha256']) is not None, 'Invalid previous digest')
    declaration = snapshot['declaration']
    currency = declaration['currency']
    require(currency in ('GBP', 'EUR', 'USD'), 'Unsupported currency')
    require(declaration['caseId'] == snapshot['caseId'], 'Declaration case mismatch')
    require(declaration['authorityVersion'] == snapshot['authorityVersion'], 'Declaration authority mismatch')
    require(declaration['action'] in ('declared', 'revised'), 'Withdrawn declaration cannot compile a draft')
    require(declaration['fictional'] is True and declaration['expenseTreatment'] == 'at_cost', 'Unexpected billing declaration')
    require(declaration['rounding'] == 'per_line_half_up', 'Unexpected rounding declaration')
    rate = integer(declaration['hourlyRateMinor'], 0, 1_000_000_000)
    tax = integer(declaration['taxBasisPoints'], 0, 10_000)
    require((declaration['taxTreatment'] == 'explicit_zero' and tax == 0) or
            (declaration['taxTreatment'] == 'exclusive_rate' and tax > 0), 'Inconsistent tax declaration')
    lines = snapshot['lines']
    require(isinstance(lines, list) and 1 <= len(lines) <= 100, 'Invalid invoice line count')
    identities = set()
    net_sum = tax_sum = 0
    for position, line in enumerate(lines, 1):
        require(line['position'] == position, 'Line ordering mismatch')
        source = line['source']
        require(source['id'] == line['sourceId'] and source['version'] == line['sourceVersion'], 'Source revision mismatch')
        integer(source['version'], 1, 100)
        require(source['description'] == line['description'], 'Source description mismatch')
        identity = (line['kind'], line['sourceId'])
        require(identity not in identities, 'Repeated logical source in invoice')
        identities.add(identity)
        if line['kind'] == 'time':
            require(source['status'] == 'active' and source['billable'] is True, 'Time is not chargeable')
            minutes = integer(source['minutes'], 1, 1440)
            require(line['quantity'] == minutes and line['unit'] == 'minute' and line['rateMinor'] == rate, 'Time rate/quantity mismatch')
            net = half_up(minutes * rate, 60)
        elif line['kind'] == 'expense':
            require(source['currency'] == currency and source['action'] != 'withdrawn', 'Expense currency/action mismatch')
            require(source['review']['accepted'] is True and source['review']['actorId'] != source['authorId'], 'Expense lacks independent acceptance')
            require(source['receiptId'] == source['receipt']['id'], 'Expense receipt identity mismatch')
            require(source['receipt']['authorityVersion'] == snapshot['authorityVersion'], 'Expense receipt authority mismatch')
            require(re.fullmatch('[a-f0-9]{64}', source['receipt']['sha256']) is not None, 'Invalid original receipt digest')
            net = integer(source['amountMinor'], 1, 1_000_000_000)
            require(line['quantity'] == 1 and line['unit'] == 'expense' and line['rateMinor'] == net, 'Expense cost mismatch')
        else:
            raise ValueError('Unsupported source kind')
        tax_amount = half_up(net * tax, 10_000)
        require(line['netMinor'] == net and line['taxMinor'] == tax_amount and line['totalMinor'] == net + tax_amount, 'Incorrect declared line arithmetic')
        net_sum += net
        tax_sum += tax_amount
    require(snapshot['totals'] == dict(currency=currency, netMinor=net_sum, taxMinor=tax_sum, totalMinor=net_sum + tax_sum), 'Invoice totals mismatch')
    review = data['review']
    if review:
        require(review['version'] == version and review['sha256'] == digest, 'Review names another snapshot')
        require(review['actorId'] != snapshot['preparedBy']['id'] and
                all(review['actorId'] != line['source']['authorId'] for line in lines), 'Review is not independent of this snapshot')
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export', type=Path)
    parser.add_argument('--expected-sha256', required=True, help='Fingerprint retained independently from the inspected API draft')
    args = parser.parse_args()
    try:
        with args.export.open('rb') as handle:
            raw = handle.read(MAX_BYTES + 1)
        require(len(raw) <= MAX_BYTES, 'Export size limit exceeded')
        snapshot = verify(json.loads(raw), args.expected_sha256)
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f'Internal invoice verification failed: {error}\n')
    print(f"Frozen internal snapshot verified: {snapshot['reference']} v{snapshot['version']}")
    print(f"{snapshot['totals']['currency']} total minor units: {snapshot['totals']['totalMinor']}")
    print('Declared arithmetic only. Current eligibility, original receipt bytes, prior author history, tax/legal approval, delivery and payment are NOT verified.')


if __name__ == '__main__':
    main()
