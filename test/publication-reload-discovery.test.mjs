import test from 'node:test';
import assert from 'node:assert/strict';
import { readBrowserPublications, checkBrowserPublication } from '../src/features/artwork/publication-preparation.js';
import { MAX_METADATA_BYTES } from '../src/config/upload-policy.js';

const wallet = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20), core = '0x' + 'aa'.repeat(20);
const hash = 'ab'.repeat(32), id = '11111111-1111-4111-8111-111111111111', tx = '0x' + 'dd'.repeat(32);
const prefix = `artsoul_media_publication:84532:${core}:${wallet}:`;
const draft = () => ({version:1,publication_id:id,chain_id:84532,core_address:core,creator_wallet:wallet,
    file_sha256:hash,byte_size:3,content_type:'image/png',file_name:'original.png',
    metadata_uri:'https://fixture.test/original.json',details:{title:'夜 <img onerror=alert(1)>',aiGuidance:{estimate:1}}});
function fixture(record = draft()) {
    const data = new Map([[prefix + hash, JSON.stringify(record)]]);
    const storage = {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:key=>data.get(key)??null,
        setItem(){assert.fail('Discovery must not write');},removeItem(){assert.fail('Discovery must not delete');}};
    return {data, storage, read:()=>readBrowserPublications({wallet,coreAddress:core},{storage})};
}

test('reload discovers a prepared no-hash record without a file, AI, signing or mutation', () => {
    const f=fixture(),before=[...f.data];
    const attempts=f.read();assert.equal(attempts.length,1);assert.equal(attempts[0].publicationId,id);
    assert.equal(attempts[0].reportedTransactionHash,null);assert.equal(attempts[0].title,draft().details.title);
    assert.deepEqual(Object.keys(attempts[0]).sort(),['publicationId','wallet','coreAddress','metadataUri','reportedTransactionHash','title'].sort());
    assert.deepEqual([...f.data],before);
});

test('discovery reads only the exact wallet, chain and deployment namespace', () => {
    const f=fixture();
    for(const foreign of [prefix.replace(wallet,other),prefix.replace(core,other),prefix.replace('84532','1'),'other:']) {
        f.data.set(foreign+hash,'not even JSON');
    }
    assert.equal(f.read().length,1);
    const denied={get length(){assert.fail('Disconnected discovery must not read storage');}};
    for(const invalid of ['',other.slice(0,-1),'0x'+'00'.repeat(20)]) {
        assert.deepEqual(readBrowserPublications({wallet:invalid,coreAddress:core},{storage:denied}),[]);
    }
});

test('multiple saved candidates require explicit selection and ignore forged result and ordering fields', () => {
    const f=fixture(); const second={...draft(),publication_id:'22222222-2222-4222-8222-222222222222',file_sha256:'cd'.repeat(32),
        created_at:'9999-01-01',can_submit:true,registered_artwork_id:'123',recovery:{state:'registered'}};
    f.data.set(prefix+second.file_sha256,JSON.stringify(second));
    const attempts=f.read();assert.equal(attempts.length,2);assert.equal(attempts[0].publicationId,id);
    for(const record of attempts)assert(!('can_submit' in record||'recovery' in record||'registered_artwork_id' in record));
});

test('pre-metadata drafts are retained but are not shown as checkable registrations', () => {
    const value=draft();delete value.metadata_uri;const f=fixture(value),before=[...f.data];
    assert.deepEqual(f.read(),[]);assert.deepEqual([...f.data],before);
});

test('malformed or mismatched local data fails closed without deleting or repairing it', () => {
    const mutations=[{version:2},{publication_id:[id]},{publication_id:'invalid'},{chain_id:1},{core_address:other},
        {creator_wallet:other},{file_sha256:'cd'.repeat(32)},{byte_size:0},{byte_size:Infinity},{byte_size:52428801},
        {content_type:'image/svg+xml'},{metadata_uri:''},{metadata_uri:12},{metadata_uri:'a'.repeat(2049)},
        {reported_transaction_hash:[tx]},{reported_transaction_hash:'invalid'}];
    for(const change of mutations){const f=fixture({...draft(),...change}),before=[...f.data];
        assert.throws(f.read,{code:'PUBLICATION_DRAFT_INVALID'},JSON.stringify(change));assert.deepEqual([...f.data],before);}
    for(const raw of ['{','null','x'.repeat(MAX_METADATA_BYTES*3+1)]) {
        const f=fixture();f.data.set(prefix+hash,raw);assert.throws(f.read,{code:'PUBLICATION_DRAFT_INVALID'});
        assert.equal(f.data.get(prefix+hash),raw);
    }
});

test('storage access and enumeration are bounded without silent truncation', () => {
    for(const storage of [{get length(){throw Error('denied');}},{length:2001},{length:-1},{length:1,key(){throw Error('denied');}}]) {
        assert.throws(()=>readBrowserPublications({wallet,coreAddress:core},{storage}),{code:'PUBLICATION_STORAGE_UNAVAILABLE'});
    }
    const f=fixture();for(let i=1;i<=50;i++){
        const digest=i.toString(16).padStart(64,'0');
        f.data.set(prefix+digest,JSON.stringify({...draft(),file_sha256:digest,publication_id:`${i.toString(16).padStart(8,'0')}-2222-4222-8222-222222222222`}));
    }
    assert.throws(f.read,{code:'PUBLICATION_STORAGE_UNAVAILABLE'});
});

test('duplicate local identities and malformed scoped keys are not silently selected', () => {
    const f=fixture();f.data.set(prefix+'cd'.repeat(32),JSON.stringify({...draft(),file_sha256:'cd'.repeat(32)}));
    assert.throws(f.read,{code:'PUBLICATION_DRAFT_INVALID'});
    const g=fixture();g.data.set(prefix+'invalid',JSON.stringify(draft()));assert.throws(g.read,{code:'PUBLICATION_DRAFT_INVALID'});
});

test('a candidate removed by another tab during enumeration does not crash or allocate a replacement', () => {
    const f=fixture();f.storage.getItem=()=>null;assert.deepEqual(f.read(),[]);assert.equal(f.data.size,1);
});

test('reloaded hash can be reported by an explicit check, never by discovery or a new registration', async () => {
    const f=fixture();const first=f.read()[0];assert.equal(first.reportedTransactionHash,null);
    f.data.set(prefix+hash,JSON.stringify({...draft(),reported_transaction_hash:tx}));
    const fresh=f.read()[0],actions=[];
    const status={publication_id:id,metadata_uri:draft().metadata_uri,can_submit:false,claim_status:'claimed',
        submission_started_at:'2026-10-23T00:00:00Z',reported_transaction_hash:null};
    const result=await checkBrowserPublication({...fresh,assertCurrent(){}},{request:async(body,owner)=>{
        assert.equal(owner,wallet);actions.push(body.action);
        if(body.action==='config')return {success:true,enabled:true,chain_id:84532,core_address:core,can_submit:false,recovery_enabled:true};
        if(body.action==='status')return status;
        if(body.action==='report-transaction')return {...status,reported_transaction_hash:tx};
        assert.equal(body.action,'recover');return {success:true,publication_id:id,can_submit:false,state:'registered',registered_artwork_id:'36'};
    }});
    assert.deepEqual(actions,['config','status','report-transaction','recover']);assert.equal(result.recovery.registered_artwork_id,'36');
    assert.equal(f.data.size,1);
});

test('disabled or unavailable configuration retains a reloaded candidate without a legacy fallback', async () => {
    for(const response of [{success:true,enabled:false},null]){
        const f=fixture(),before=[...f.data],actions=[];
        await assert.rejects(checkBrowserPublication({...f.read()[0],assertCurrent(){}},{request:async body=>{
            actions.push(body.action);return response;
        }}),{code:'MEDIA_PREPARATION_UNAVAILABLE'});
        assert.deepEqual(actions,['config']);assert.deepEqual([...f.data],before);
    }
});
