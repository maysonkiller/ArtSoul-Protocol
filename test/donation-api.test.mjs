import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../src/api/routes/public/donations.js';
import publicConfigHandler from '../src/api/routes/public/config.js';

const address = `0x${'12'.repeat(20)}`, creator = `0x${'34'.repeat(20)}`, donor = `0x${'56'.repeat(20)}`;
const hash = `0x${'78'.repeat(32)}`;
const record = {creator, donor, amount:'500000000000000', anonymous:true, message:'hello',
    transaction_hash:hash, log_index:1, block_number:42, recorded_at:'2026-09-30T00:00:00Z'};
function response() { return {statusCode:200, headers:{},setHeader(k,v){this.headers[k]=v;},
    status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},end(){}}; }
async function request(t, {query={},enabled=true, hidden=false, messages=false, records=[record], failure=false}={}) {
    const oldFetch=globalThis.fetch, before={...process.env}, paths=[];
    Object.assign(process.env,{SUPABASE_URL:'https://database.example',SUPABASE_ANON_KEY:'test-anon-only',SUPABASE_SERVICE_ROLE_KEY:'test-only',
        ARTSOUL_DONATIONS_ENABLED:String(enabled),ARTSOUL_DONATIONS_ADDRESS_BASE_SEPOLIA:address});
    t.after(()=>{globalThis.fetch=oldFetch; for(const k of Object.keys(process.env)) if(!(k in before)) delete process.env[k]; Object.assign(process.env,before);});
    globalThis.fetch=async value=>{
        const url=new URL(value), table=url.pathname.split('/').at(-1); paths.push(url);
        if(failure) throw new Error('unavailable');
        const rows={v41_artworks:[{creator}],artwork_moderation_visibility:hidden?[{hidden:true}]:[],
            artwork_donations:url.searchParams.get('limit')==='1'?records.slice(0,1):records,
            profiles:[{wallet_address:donor,username:'Private donor'}],
            donation_message_visibility:messages?[{transaction_hash:hash,log_index:1,hidden:true}]:[]}[table];
        assert.ok(rows,`Unexpected read ${table}`);
        return {ok:true,status:200,text:async()=>JSON.stringify(rows)};
    };
    const res=response(); await handler({method:'GET',query:{chain_id:'84532',artwork_id:'1',...query}},res);
    return {res,paths};
}

test('disabled donation service performs no database reads',async t=>{
    const {res,paths}=await request(t,{enabled:false}); assert.equal(res.statusCode,503); assert.equal(paths.length,0);
});

test('one-wei donations retain their message and public configuration exposes no amount policy', async t => {
    const {res} = await request(t, {records: [{...record, amount: '1', message: 'Thank you'}]});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.donations[0].amount, '1');
    assert.equal(res.body.donations[0].message, 'Thank you');
    assert.equal(res.body.top.amount, '1');
    const config = response();
    await publicConfigHandler({method: 'GET'}, config);
    assert.equal(config.statusCode, 200);
    assert.deepEqual(config.body.donations, {enabled: true, chainId: 84532, address});
});
test('only exact Base Sepolia artwork queries and bounded orders/pages are accepted',async t=>{
    for(const query of [{chain_id:4663},{artwork_id:'1&select=*'},{offset:-1},{offset:10001},{sort:'random'},{artwork_id:(2n**256n).toString()}]) {
        const {res,paths}=await request(t,{query}); assert.equal(res.statusCode,400); assert.equal(paths.length,0);
    }
});
test('hidden artworks disclose no donation or profile data',async t=>{
    const {res,paths}=await request(t,{hidden:true}); assert.equal(res.statusCode,404);
    assert.equal(paths.length,2); assert.equal(res.headers['Cache-Control'],undefined);
});
test('anonymous donations never request or disclose donor profiles',async t=>{
    const {res,paths}=await request(t); assert.equal(res.statusCode,200);
    assert.equal(res.body.donations[0].donor,null); assert.equal(res.body.top.donor_name,null);
    assert.ok(!JSON.stringify(res.body).includes(donor));
    assert.ok(!paths.some(url=>url.pathname.endsWith('/profiles')));
    assert.equal(res.body.top.creator,creator);
});
test('public donor names use one bounded batch and messages obey independent visibility',async t=>{
    const {res,paths}=await request(t,{records:[{...record,anonymous:false}],messages:true});
    assert.equal(res.body.donations[0].donor_name,'Private donor'); assert.equal(res.body.donations[0].message,null);
    assert.equal(paths.filter(url=>url.pathname.endsWith('/profiles')).length,1);
});
test('largest and newest views keep deterministic ordering and exact deployment scope',async t=>{
    const {res,paths}=await request(t,{query:{sort:'amount'},records:Array.from({length:21},()=>record)});
    assert.equal(res.body.donations.length,20); assert.equal(res.body.next_offset,20);
    for(const url of paths.filter(url=>url.pathname.endsWith('/artwork_donations'))) {
        assert.equal(url.searchParams.get('contract_address'),`eq.${address}`);
        assert.equal(url.searchParams.get('chain_id'),'eq.84532');
        assert.equal(url.searchParams.get('order'),'amount.desc,block_number.desc,log_index.desc');
    }
});
test('database failures do not become an empty successful support history',async t=>{
    const {res}=await request(t,{failure:true}); assert.ok(res.statusCode>=500); assert.equal(res.body.success,undefined);
});

test('the last permitted page does not advertise an unusable next offset',async t=>{
    const {res}=await request(t,{query:{offset:10000},records:Array.from({length:21},()=>record)});
    assert.equal(res.statusCode,200); assert.equal(res.body.next_offset,null);
});
