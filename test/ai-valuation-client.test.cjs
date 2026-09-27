const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'features', 'artwork', 'ai-valuation-client.js'),
    'utf8'
).replace(/^import[^\n]*\n/gm, '');
const valuesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'artwork', 'ai-valuation-values.js'), 'utf8').replace(/^export /gm, '');

function loadClient(overrides = {}, valuationOverrides = {}, responseOverrides = {}) {
    const window = {
        SupabaseAuth: { isAuthenticated: async () => true },
        getCurrentWalletAddress: () => '0xcreator',
        getCurrentChainId: () => 84532,
        ...overrides
    };
    const requests = [];
    const fetch = async (url, options) => {
        requests.push({ url, options });
        return {
            ok: true, status: 200, ...responseOverrides,
            json: async () => ({
                model: 'gemini-2.5-flash-lite',
                valuation_logged: true,
                valuation: { estimated_value_min_eth: 0.1, estimated_value_max_eth: 0.3, suggested_start_price_eth: 0.2, ...valuationOverrides }
            })
        };
    };
    vm.runInNewContext(valuesSource + '\n' + source, { window, fetch });
    return { client: window.ArtSoulAIValuation, requests };
}

test('uses the existing authenticated AI endpoint and preserves valuation metadata', async () => {
    const { client, requests } = loadClient();
    const result = await client.request({ title: 'Fresh estimate' });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/ai/analyze');
    assert.equal(requests[0].options.credentials, 'include');
    assert.equal(JSON.parse(requests[0].options.body).creator, '0xcreator');
    assert.equal(result.valuation.guidance_only, true);
    assert.equal(result.logged, true);
});

test('a malformed response is unavailable rather than a successful estimate', async () => {
    for (const valuation of [
        { estimated_value_min_eth: 0.3, estimated_value_max_eth: 0.1 },
        { estimated_value_min_eth: null }, { estimated_value_max_eth: '' },
        { suggested_start_price_eth: -0.1 }
    ]) {
        const { client } = loadClient({}, valuation);
        await assert.rejects(client.request({ title: 'Invalid estimate' }), error => error.code === 'GEMINI_RESPONSE_INVALID');
    }
});

test('failed HTTP response preserves status for error and retry presentation', async () => {
    const { client } = loadClient({}, {}, { ok: false, status: 429 });
    await assert.rejects(client.request({ title: 'Busy model' }), error => error.status === 429);
});

test('can fail gracefully without prompting for an authentication signature', async () => {
    let promptCount = 0;
    const { client, requests } = loadClient({
        SupabaseAuth: { isAuthenticated: async () => false },
        ensureAuthenticated: async () => { promptCount += 1; return true; }
    });

    await assert.rejects(
        client.request({ title: 'Re-auction' }, { promptAuthentication: false }),
        /wallet authorization is not active/
    );
    assert.equal(promptCount, 0);
    assert.equal(requests.length, 0);
});
