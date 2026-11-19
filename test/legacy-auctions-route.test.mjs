import assert from 'node:assert/strict';
import test from 'node:test';
import route from '../api/[...route].js';

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() {}
  };
}

test('legacy auction aliases check for one active record and never publish archival rows', async t => {
  // node:test isolates this file from other suites. No remote connection is made.
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
  let records = [];
  let status = 200;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push([url, options.method]);
    return Response.json(records, {status});
  });
  for (const url of ['/api/auctions', '/api/functions/auctions']) {
    const res = response();
    await route({method: 'GET', url}, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, []);
    assert.match(res.headers.Link, /\/api\/public\/artworks\?view=auctions&chain_id=84532/);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  }
  records = [{id: 'legacy-uuid', artworks: {description: 'archived record'}}];
  const retired = response();
  await route({method: 'GET', url: '/api/auctions'}, retired);
  assert.equal(retired.code, 410);
  assert.equal(retired.body.replacement, '/api/public/artworks?view=auctions&chain_id=84532');
  assert.doesNotMatch(JSON.stringify(retired.body), /legacy-uuid|archived record/);

  for (const upstreamStatus of [200, 503]) {
    status = upstreamStatus;
    records = {message: 'fixture upstream failure'};
    const failed = response();
    await route({method: 'GET', url: '/api/auctions'}, failed);
    assert.equal(failed.code, 500);
    assert.doesNotMatch(JSON.stringify(failed.body), /fixture upstream failure/);
  }
  for (const [method, code] of [['OPTIONS', 204], ['POST', 405]]) {
    const res = response();
    await route({method, url: '/api/auctions'}, res);
    assert.equal(res.code, code);
    assert.equal(res.headers.Allow, 'GET');
  }
  assert.deepEqual(requests, Array(5).fill(['https://db.example/rest/v1/auctions?select=id&status=eq.active&limit=1', 'GET']));
});
