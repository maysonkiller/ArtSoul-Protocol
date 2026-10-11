import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../src/api/routes/moderation/authority.js';
import {setWalletSession} from '../src/api/backend.js';

const address = n => '0x'+n.toString(16).padStart(40,'0');
const pair = [address(1),address(2)], outsider = address(3);
const response = () => ({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},end(){}});

test('staff roster discloses only bounded role metadata to the authenticated current authority',async t=>{
    const env={ARTSOUL_MODERATION_DUAL_WALLET_ENABLED:'true',ARTSOUL_MODERATION_PASSKEY_ENABLED:'true',
        SESSION_SECRET:crypto.randomBytes(32).toString('hex'),ARTSOUL_MODERATION_SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
        ARTSOUL_WEBAUTHN_RP_ID:'artsoulprotocol.com',ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN:'https://artsoulprotocol.com',ARTSOUL_WEBAUTHN_RP_NAME:'ArtSoul',
        SUPABASE_URL:'https://roster-fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'isolated-fixture-only'};
    const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),originalFetch=global.fetch;
    Object.assign(process.env,env);
    t.after(()=>{global.fetch=originalFetch;for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
    let calls=[],policyReads=0,rotate=false;
    const rows=Array.from({length:53},(_,i)=>({wallet_address:address(i+10),role:['admin','moderator','team'][i%3],active:i%2===0,
        credential_id:'must-not-be-returned',private_note:'must-not-be-returned'}));
    global.fetch=async (url,options)=>{
        const parsed=new URL(url);assert.equal(parsed.origin,env.SUPABASE_URL);assert.equal(options.method,'GET');calls.push(parsed);
        if(parsed.pathname.endsWith('/artsoul_staff_authority_policy')) {
            policyReads++;const changed=rotate&&policyReads>1;
            return Response.json([{version:changed?2:1,origin:env.ARTSOUL_WEBAUTHN_ALLOWED_ORIGIN,chain_id:84532,
                wallet_a:changed?outsider:pair[0],wallet_b:pair[1]}]);
        }
        assert.equal(parsed.pathname,'/rest/v1/artsoul_staff_roles');
        assert.equal(parsed.searchParams.get('select'),'wallet_address,role,active');
        assert.equal(parsed.searchParams.get('order'),'wallet_address.asc');assert.equal(parsed.searchParams.get('limit'),'51');
        const after=parsed.searchParams.get('wallet_address')?.slice(3)||'';
        return Response.json(rows.filter(row=>row.wallet_address>after).slice(0,51));
    };
    async function invoke({wallet=pair[0],expected=wallet,query={}}={}) {
        calls=[];policyReads=0;const session=response(),res=response();
        if(wallet)setWalletSession(session,wallet);
        await handler({method:'GET',query:{view:'staff',expectedWallet:expected,...query},headers:{cookie:session.headers['Set-Cookie']?.split(';')[0]||''}},res);
        assert.equal(res.headers['Cache-Control'],'private, no-store');return res;
    }
    await t.test('guest, stale wallet and ordinary staff cannot read the list',async()=>{
        assert.equal((await invoke({wallet:null,expected:pair[0]})).statusCode,401);assert.equal(calls.length,0);
        assert.equal((await invoke({expected:pair[1]})).statusCode,403);assert.equal(calls.length,0);
        assert.equal((await invoke({wallet:outsider})).statusCode,403);assert.equal(calls.length,1);
    });
    await t.test('either authority sees active and removed roles without holding a staff role',async()=>{
        for(const wallet of pair) {
            const res=await invoke({wallet});assert.equal(res.statusCode,200);assert.equal(res.body.staff.length,50);
            assert.deepEqual(res.body.staff[0],{wallet:address(10),role:'admin',active:true});
            assert.equal(res.body.staff[1].active,false);assert.equal(res.body.nextCursor,address(59));
            assert.doesNotMatch(JSON.stringify(res.body),/credential_id|private_note|must-not-be-returned/);
            assert.equal(calls.length,3,'policy, bounded roster, policy recheck; no role or factor gate');
        }
    });
    await t.test('keyset pages expose all members without repeating the cursor row',async()=>{
        const res=await invoke({query:{after:address(59)}});assert.equal(res.statusCode,200);
        assert.deepEqual(res.body.staff.map(row=>row.wallet),[address(60),address(61),address(62)]);assert.equal(res.body.nextCursor,null);
    });
    await t.test('malformed cursors cannot inject filters or perform a roster query',async()=>{
        for(const after of ['',address(10)+',active.eq.true',['x'],'0x0','x'.repeat(1000)]) {
            assert.equal((await invoke({query:{after}})).statusCode,400);assert.equal(calls.length,1);
        }
    });
    await t.test('a rotation during the read returns no roster',async()=>{
        rotate=true;const res=await invoke();assert.equal(res.statusCode,409);assert.equal(res.body.error,'AUTHORITY_POLICY_CHANGED');
        assert.equal(res.body.staff,undefined);rotate=false;
    });
    await t.test('a disabled rollout does not read storage',async()=>{
        process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED='false';assert.equal((await invoke()).statusCode,404);assert.equal(calls.length,0);
    });
});
