import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs, requestBody, projectedCu, verifyFreeHeadroom, main } from '../scripts/b36-alchemy-usage-probe.mjs';

const wallet = '0x' + '1'.repeat(40);
const key = 'test-key-only-dummy';
const admin = 'test-admin-only-dummy';
const usage = (remaining='29500000',dataThrough='2026-11-06T00:00:00Z') =>
  ({data:{usageLimit:{limit:'30000000',used:'500000',remaining},freshness:{dataThrough}}});

test('dry run makes no external requests', async()=>{
  const result=await main(['--dry-run','--network=base-mainnet'],{},()=>{throw Error('No request permitted');});
  assert.equal(result.publishedMethodCU,1000);
  assert.equal(result.mode,'dry-run');
});
test('one network only and method-specific request shapes',()=>{
  assert.throws(()=>parseArgs(['--probe','--network=eth-mainnet','--network=base-mainnet']));
  assert.throws(()=>parseArgs(['--probe','--network=all']));
  assert.throws(()=>parseArgs(['--probe','--network=made-up']));
  assert.deepEqual(requestBody(wallet,'base-mainnet','nfts'),{
    addresses:[{address:wallet,networks:['base-mainnet']}],pageSize:12,withMetadata:true,excludeFilters:['SPAM']});
  const token=requestBody(wallet,'base-mainnet','tokens');
  assert.equal(token.pageSize,undefined);
  assert.equal(token.withPrices,true);
  assert.equal(projectedCu('tokens'),360);
});
test('free limit must be confirmed BEFORE making the live request',async()=>{
  assert.throws(()=>verifyFreeHeadroom(usage('99999')));
  assert.throws(()=>verifyFreeHeadroom({data:{usageLimit:{limit:'50000000',remaining:'3000000'}}}));
  let calls=0;
  await assert.rejects(main(['--probe'],{
    ALCHEMY_ADMIN_USAGE_READ_KEY:admin,ARTSOUL_PROBE_FREE_NO_BILLING_CONFIRMED:'YES',
    ARTSOUL_PROBE_ONE_REQUEST_ACK:'YES',ARTSOUL_PROBE_WALLET:wallet,
    ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY:key
  },async()=>{calls++;return Response.json(usage('99999'));}));
  assert.equal(calls,1,'only preflight Admin Usage read, no Portfolio read');
});
test('canary sends exactly one Portfolio request and account delta is labelled with freshness',async()=>{
  let calls=0,portfolio=0,usageCalls=0;
  const result=await main(['--probe','--network=eth-mainnet','--nfts'],{
    ALCHEMY_ADMIN_USAGE_READ_KEY:admin,ARTSOUL_PROBE_FREE_NO_BILLING_CONFIRMED:'YES',
    ARTSOUL_PROBE_ONE_REQUEST_ACK:'YES',ARTSOUL_PROBE_WALLET:wallet,
    ARTSOUL_EXTERNAL_BASE_NFTS_ALCHEMY_API_KEY:key
  },async (url,opt)=>{
    calls++;
    if(String(url).includes('/usage/summary')){
      usageCalls++;
      return Response.json(usage('29500000','2026-11-06T00:00:00Z'));
    }
    portfolio++;
    assert.match(String(url),/assets\/nfts\/by-address$/);
    assert.deepEqual(JSON.parse(opt.body).addresses[0].networks,['eth-mainnet']);
    return Response.json({data:{ownedNfts:[],totalCount:0}});
  });
  assert.equal(calls,3);assert.equal(usageCalls,2);assert.equal(portfolio,1);
  assert.equal(result.measuredAccountDeltaCU,null,'meter freshness not advanced');
  assert.equal(result.response.count,0);
});
test('no admin credential refuses to contact provider',async()=>{
  let calls=0;
  await assert.rejects(main(['--probe'],{},async()=>{calls++;return Response.json({});}));
  assert.equal(calls,0);
});
