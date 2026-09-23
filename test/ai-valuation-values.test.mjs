import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAIPrice, readAIValuation, formatAIPrice } from '../src/features/artwork/ai-valuation-values.js';

const valid = { estimated_value_min_eth: 0.00001, estimated_value_max_eth: 0.0001, suggested_start_price_eth: 0.00002 };

test('guidance accepts unambiguous decimal comma and dot without swapping endpoints', () => {
    assert.deepEqual(readAIValuation(valid), valid);
    assert.deepEqual(readAIValuation({
        estimated_value_min_eth: ' 0,00001 ', estimated_value_max_eth: '0.0001', suggested_start_price_eth: '0,00002'
    }), valid);
    assert.equal(readAIValuation({ ...valid, estimated_value_min_eth: 0.0001, estimated_value_max_eth: 0.00001 }), null);
});

test('missing, negative, non-finite and ambiguous model prices never become zero or a fabricated range', () => {
    for (const input of [undefined, null, '', ' ', false, true, [], {}, -1, '-0.001', NaN, Infinity,
        'NaN', 'Infinity', '1,2.3', '1.2.3', '1,2,3', '1 ETH', '0x10', 1000001]) {
        assert.equal(parseAIPrice(input), null, String(input));
        for (const field of Object.keys(valid)) assert.equal(readAIValuation({ ...valid, [field]: input }), null, field);
    }
    for (const value of [undefined, null, [], {}, { range: { low: 1, high: 2 } }]) assert.equal(readAIValuation(value), null);
    assert.equal(parseAIPrice(0), 0);
});

test('small estimates retain their magnitude in dot and comma locales', () => {
    assert.equal(formatAIPrice(0.00001, 'en-US'), '0.00001');
    assert.equal(formatAIPrice(1e-18, 'en-US'), '0.000000000000000001');
    assert.equal(formatAIPrice(0.00000001234567, 'en-US'), '0.0000000123457');
    assert.equal(formatAIPrice(1e-18, 'de-DE'), '0,000000000000000001');
    assert.equal(formatAIPrice(null, 'en-US'), 'Unavailable');
});
