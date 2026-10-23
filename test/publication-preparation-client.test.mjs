import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prepareBrowserPublication } from '../src/features/artwork/publication-preparation.js';

const wallet='0x'+'11'.repeat(20), core='0x'+'aa'.repeat(20), hash='ab'.repeat(32);
const txHash='0x'+'dd'.repeat(32);
function fixture() {
    const data=new Map(), requests=[], writes=[];
    let uuidCount=0, uploaded=false, metadataCalls=0, pending=false, config={success:true,enabled:true,chain_id:84532,core_address:core,can_submit:false};
    let tail=Promise.resolve(), current=true, drop=null, before=null;
    const args={file:{name:'作品.png',type:'image/png',size:3},fileHash:hash,wallet,
        details:{title:'夜 🌆',description:'An original artwork.',creatorValue:'0.001',duration:24,aiGuidance:{estimate:1}},
        assertCurrent(){if(!current) throw Object.assign(Error('Wallet changed'),{code:'AUTHORIZATION_WALLET_CHANGED'});}};
    const dependencies={storage:{getItem:k=>data.get(k)??null,setItem(k,v){writes.push(k);data.set(k,v);}},
        randomUUID(){uuidCount++;return randomUUID();},
        locks:{request(key,options,fn){assert.equal(options.mode,'exclusive');const next=tail.then(fn);tail=next.catch(()=>{});return next;}},
        createMetadata(value){metadataCalls++;return {...value,name:value.title};},
        async upload({blob,signedUpload,signal}){assert.equal(blob,args.file);assert(signal instanceof AbortSignal);assert.match(signedUpload.signed_upload_url,/token=/);uploaded=true;if(drop==='put'){drop=null;throw Error('lost PUT response');}},
        async request(body,owner) {
            requests.push(structuredClone(body));assert.equal(owner,wallet);
            before?.(body);
            if(body.action==='config')return config;
            assert.equal(data.size,1,'durable attempt must precede any issue');
            const draft=JSON.parse([...data.values()][0]);assert.equal(draft.publication_id,body.publication_id);
            let result={publication_id:body.publication_id,can_submit:false};
            if(body.action==='issue') result={...result,chain_id:84532,core_address:core,upload_complete:uploaded,
                upload:uploaded?null:{path:'uploads/original.png',public_url:'https://storage.example/original.png',signed_upload_url:'https://storage.example/put?token=private'},
                media:uploaded?{path:'uploads/original.png',url:'https://storage.example/original.png',sha256:hash}:undefined};
            else if(body.action==='prepare') {
                assert.deepEqual(draft.metadata,body.metadata,'metadata saved before request');assert(uploaded);
                result={...result,metadata_uri:'https://storage.example/meta.json',media_sha256:hash,claim_status:'RESUME'};
            } else if(body.action==='status') result={...result,metadata_uri:'https://storage.example/meta.json',claim_status:'claimed',
                submission_started_at:pending?'2026-10-23T00:00:00Z':null,reported_transaction_hash:null};
            else assert.fail('must not begin, report, recover or send');
            if(drop===body.action){drop=null;throw Error('lost API response');}
            return result;
        }};
    return {args,dependencies,data,requests,writes,run:()=>prepareBrowserPublication(args,dependencies),
        get config(){return config;},
        set config(v){config=v;},set current(v){current=v;},set drop(v){drop=v;},set pending(v){pending=v;},set before(v){before=v;},
        get uuidCount(){return uuidCount;},get metadataCalls(){return metadataCalls;}};
}

test('explicit disabled config alone permits the accepted publishing flow without touching draft storage',async()=>{
    const f=fixture();f.config={success:true,enabled:false};
    f.dependencies.storage={getItem(){assert.fail('disabled path must not need storage');}};
    assert.equal(await f.run(),null);assert.equal(f.uuidCount,0);assert.deepEqual(f.requests,[{action:'config'}]);
});

test('config errors and malformed configuration never fall back to unguarded publishing',async()=>{
    for(const config of [{},null,{enabled:false},{success:true},{success:true,enabled:true,chain_id:1,core_address:core,can_submit:false},
        {success:true,enabled:true,chain_id:84532,core_address:core,can_submit:true}]) {
        const f=fixture();f.config=config;await assert.rejects(f.run(),{code:'MEDIA_PREPARATION_UNAVAILABLE'});assert.equal(f.data.size,0);
    }
    const f=fixture();f.dependencies.request=async()=>{throw Error('network unavailable');};
    await assert.rejects(f.run(),/network unavailable/);assert.equal(f.data.size,0);
});

test('same bytes under a renamed file resume one immutable draft without persisting signed credentials',async()=>{
    const f=fixture();const a=await f.run();const original=[...f.data.values()][0];
    f.args.file={...f.args.file,name:'renamed screenshot.png'};
    const b=await f.run();assert.deepEqual(a,b);assert.equal(f.uuidCount,1);assert.equal(f.metadataCalls,1);
    assert.equal([...f.data.values()][0],original);assert.doesNotMatch(original,/private|signed_upload_url|token/);
    assert.equal(f.requests.filter(r=>r.action==='issue')[1].file_name,'作品.png');
    assert.equal(a.can_submit,false);
});

for(const step of ['issue','prepare','status','put']) test(`lost ${step} response preserves the attempt and exact metadata`,async()=>{
    const f=fixture();f.drop=step;
    if(step==='put') await f.run();else await assert.rejects(f.run(),/lost API response/);
    const prior=JSON.parse([...f.data.values()][0]);const result=await f.run();
    const next=JSON.parse([...f.data.values()][0]);assert.equal(prior.publication_id,next.publication_id);
    if(prior.metadata)assert.deepEqual(prior.metadata,next.metadata);
    assert.equal(f.uuidCount,1);assert.equal(result.can_submit,false);
});

test('unknown no-hash submission stays pending and never requests begin or cancellation',async()=>{
    const f=fixture();f.pending=true;const result=await f.run();
    assert(result.submission_started_at);assert.equal(result.reported_transaction_hash,null);assert.equal(result.can_submit,false);
    assert.deepEqual(f.requests.map(r=>r.action),['config','issue','prepare','status']);
});

test('a pending no-hash attempt requests bounded recovery and only returns a verified string identifier',async()=>{
    for(const state of ['registered','conflict','unresolved','reverted']) {
        const f=fixture();f.pending=true;f.config={...f.config,recovery_enabled:true};
        const request=f.dependencies.request;
        f.dependencies.request=async(body,owner)=>{
            if(body.action!=='recover')return request(body,owner);
            f.requests.push(body);assert.equal(owner,wallet);
            assert.deepEqual(Object.keys(body),['action','publication_id']);
            return {success:true,publication_id:body.publication_id,state,can_submit:false,
                ...(state==='registered'?{registered_artwork_id:'9007199254740993'}:{})};
        };
        const result=await f.run();assert.equal(result.recovery.state,state);assert.equal(result.can_submit,false);
        assert.deepEqual(f.requests.map(r=>r.action),['config','issue','prepare','status','recover']);
        assert.equal(f.uuidCount,1);assert.doesNotMatch([...f.data.values()][0],/9007199254740993/,'recovery is rechecked, not trusted from local storage');
    }
});

test('lost, denied, stale and malformed recovery cannot become a second registration request',async()=>{
    for(const mutation of ['lost','rate','wallet','permission','number','invalid-id','wrong-publication','unknown-state']) {
        const f=fixture();f.pending=true;f.config={...f.config,recovery_enabled:true};
        const request=f.dependencies.request;
        f.dependencies.request=async(body,owner)=>{
            if(body.action!=='recover')return request(body,owner);
            f.requests.push(body);
            if(mutation==='lost'||mutation==='rate')throw Error(mutation);
            if(mutation==='wallet')f.current=false;
            return {success:true,publication_id:mutation==='wrong-publication'?randomUUID():body.publication_id,
                state:mutation==='unknown-state'?'ready':'registered',can_submit:mutation==='permission',
                registered_artwork_id:mutation==='number'?36:mutation==='invalid-id'?'36/../other':'36'};
        };
        await assert.rejects(f.run());assert.equal(f.data.size,1);assert.equal(f.uuidCount,1);
        assert.equal(f.requests.at(-1).action,'recover');
        assert(!f.requests.some(r=>r.action==='begin'));
    }
});

test('details changed after a saved attempt fail before new storage or metadata requests',async()=>{
    const f=fixture();await f.run();const prior=[...f.data.values()][0];f.requests.length=0;f.args.details.title='Changed';
    await assert.rejects(f.run(),{code:'PUBLICATION_DETAILS_LOCKED'});
    assert.equal([...f.data.values()][0],prior);assert.deepEqual(f.requests,[{action:'config'}]);
});

test('fresh AI guidance after reselecting the file reuses the original pinned estimate',async()=>{
    const f=fixture();await f.run();const prior=[...f.data.values()][0];
    f.args.details.aiGuidance={estimate:999,rationale:'Fresh guidance after a page reload'};
    await f.run();assert.equal([...f.data.values()][0],prior);assert.equal(f.uuidCount,1);assert.equal(f.metadataCalls,1);
    const metadata=f.requests.filter(r=>r.action==='prepare').map(r=>r.metadata);
    assert.deepEqual(metadata[0],metadata[1]);assert.equal(metadata[1].aiGuidance.estimate,1);
});

test('two tabs serialize preparation and reuse the same UUID',async()=>{
    const f=fixture();const results=await Promise.all([f.run(),f.run()]);
    assert.deepEqual(results[0],results[1]);assert.equal(f.uuidCount,1);assert.equal(f.metadataCalls,1);
});

test('unreadable or unwritable drafts and absent locks stop before issuance',async()=>{
    for(const broken of ['read','write','corrupt','silent','locks']) {
        const f=fixture();
        if(broken==='read')f.dependencies.storage.getItem=()=>{throw Error('denied');};
        if(broken==='write')f.dependencies.storage.setItem=()=>{throw Error('quota');};
        if(broken==='corrupt')f.dependencies.storage.getItem=()=>'{';
        if(broken==='silent')f.dependencies.storage.setItem=()=>{};
        if(broken==='locks')f.dependencies.locks={};
        await assert.rejects(f.run(),e=>['PUBLICATION_DRAFT_INVALID','PUBLICATION_STORAGE_UNAVAILABLE'].includes(e.code));
        assert.deepEqual(f.requests,[{action:'config'}]);
    }
});

test('wallet change at any API wait stops before the next operation',async()=>{
    for(const step of ['config','issue','prepare','status']) {
        const f=fixture();f.before=body=>{if(body.action===step)f.current=false;};
        await assert.rejects(f.run(),{code:'AUTHORIZATION_WALLET_CHANGED'});
        assert.equal(f.requests.at(-1).action,step);
    }
});

test('request inputs are snapshotted before config returns',async()=>{
    const f=fixture();f.before=body=>{if(body.action==='config')f.args.details.aiGuidance.estimate=999;};
    await f.run();const draft=JSON.parse([...f.data.values()][0]);assert.equal(draft.metadata.aiGuidance.estimate,1);
});

test('malformed status or a wrong server digest cannot authorize publishing',async()=>{
    for(const step of ['issue','prepare','status']) {
        const f=fixture(),request=f.dependencies.request;
        f.dependencies.request=async(...args)=>{const result=await request(...args);return args[0].action===step?{...result,can_submit:true}:result;};
        await assert.rejects(f.run(),{code:'MEDIA_PREPARATION_MISMATCH'});
    }
    const f=fixture(),request=f.dependencies.request;
    f.dependencies.request=async(...args)=>{const result=await request(...args);return args[0].action==='prepare'?{...result,media_sha256:'cd'.repeat(32)}:result;};
    await assert.rejects(f.run(),{code:'MEDIA_PREPARATION_MISMATCH'});
});

function submissionFixture() {
    const f=fixture();f.config={...f.config,recovery_enabled:true,submission_enabled:true};
    const request=f.dependencies.request;let started=null,reported=null,sends=0,drop=null,mutation=null;
    f.dependencies.request=async(body,owner)=>{
        assert.equal(owner,wallet);
        if(!['begin','report-transaction','recover'].includes(body.action)) {
            const result=await request(body,owner);
            return body.action==='status'?{...result,submission_started_at:started,reported_transaction_hash:reported}:result;
        }
        f.requests.push(structuredClone(body));
        let result={success:true,publication_id:body.publication_id,metadata_uri:'https://storage.example/meta.json',
            claim_status:'claimed',can_submit:false,submission_started_at:started,reported_transaction_hash:reported};
        if(body.action==='begin') {
            const created=!started;started||='2026-10-23T01:00:00Z';
            result={...result,chain_id:84532,core_address:core,submission_started_at:started,submission_created:created,can_submit:created,...mutation};
        } else if(body.action==='report-transaction') {
            if(drop!=='report-before')reported=body.transaction_hash;
            result.reported_transaction_hash=reported;
        } else result={...result,state:'unresolved'};
        if(drop===body.action || (body.action==='report-transaction'&&drop==='report-before')){drop=null;throw Error('lost response');}
        return result;
    };
    f.args.register=async ({beforeSubmit,onSubmitted,metadataUri,mediaUrl,coreAddress})=>{
        assert.equal(metadataUri,'https://storage.example/meta.json');assert.equal(mediaUrl,'https://storage.example/original.png');
        assert.equal(coreAddress,core);await beforeSubmit();sends++;
        // The adapter retains the receipt wait even when reporting the hash fails.
        try {await onSubmitted(txHash);}catch{}
        return {artworkId:'36',txHash};
    };
    return {f,get sends(){return sends;},set drop(v){drop=v;},set mutation(v){mutation=v;},get reported(){return reported;}};
}

test('enabled handoff registers once and a repeated click recovers without another wallet request',async()=>{
    const s=submissionFixture(),{f}=s;
    const result=await f.run();assert.equal(result.registration.artworkId,'36');assert.equal(result.can_submit,false);
    assert.equal(s.sends,1);assert.equal(s.reported,txHash);
    assert.equal(JSON.parse([...f.data.values()][0]).reported_transaction_hash,txHash);
    assert.deepEqual(f.requests.map(r=>r.action),['config','issue','prepare','status','begin','report-transaction']);
    const retry=await f.run();assert.equal(retry.recovery.state,'unresolved');assert.equal(s.sends,1);
});

test('concurrent tabs cannot turn one publication into two registration sends',async()=>{
    const s=submissionFixture();const results=await Promise.all([s.f.run(),s.f.run()]);
    assert.equal(s.sends,1);assert.equal(results.filter(r=>r.registration).length,1);
    assert.equal(results.filter(r=>r.recovery).length,1);
});

test('lost begin response and wallet rejection retain the attempt without automatically resending',async()=>{
    for(const failure of ['begin','wallet']) {
        const s=submissionFixture(),{f}=s;
        if(failure==='begin')s.drop='begin';
        else f.args.register=async({beforeSubmit})=>{await beforeSubmit();throw Error('wallet rejected');};
        await assert.rejects(f.run(),{code:'PUBLICATION_ATTEMPT_PENDING'});
        const retry=await f.run();assert.equal(retry.recovery.state,'unresolved');assert.equal(s.sends,0);
        assert.equal(f.requests.filter(r=>r.action==='begin').length,1);
    }
});

test('a locally captured hash is reported on retry if its API response or request was lost',async()=>{
    for(const failure of ['report-transaction','report-before']) {
        const s=submissionFixture();s.drop=failure;
        const first=await s.f.run();assert.equal(first.registration.artworkId,'36');
        assert.equal(JSON.parse([...s.f.data.values()][0]).reported_transaction_hash,txHash);
        await s.f.run();assert.equal(s.reported,txHash);assert.equal(s.sends,1);
    }
});

test('local hash storage failure cannot suppress the available server journal',async()=>{
    const s=submissionFixture(),{f}=s,save=f.dependencies.storage.setItem;
    f.dependencies.storage.setItem=(key,value)=>{
        if(JSON.parse(value).reported_transaction_hash)throw Error('storage full');
        return save(key,value);
    };
    const result=await f.run();assert.equal(result.registration.artworkId,'36');
    assert.equal(s.reported,txHash);assert.equal(s.sends,1);
    await f.run();assert.equal(s.sends,1);
});

test('a wallet switch after broadcast preserves the original scoped hash without reporting as the new account',async()=>{
    const s=submissionFixture(),{f}=s;
    f.args.register=async({beforeSubmit,onSubmitted})=>{
        await beforeSubmit();f.current=false;try{await onSubmitted(txHash);}catch{}
        return {artworkId:'36',txHash};
    };
    await assert.rejects(f.run(),{code:'PUBLICATION_ATTEMPT_PENDING'});
    assert.equal(JSON.parse([...f.data.values()][0]).reported_transaction_hash,txHash);
    assert(!f.requests.some(r=>r.action==='report-transaction'));f.current=true;
    await f.run();assert.equal(s.reported,txHash);assert.equal(f.requests.filter(r=>r.action==='begin').length,1);
});

test('malformed permission and a repeated invocation of its hook never authorize another send',async()=>{
    for(const mutation of [{chain_id:1},{core_address:wallet},{publication_id:randomUUID()},
        {metadata_uri:'https://attacker.example'},{can_submit:false},{submission_created:false},
        {claim_status:'registered'},{reported_transaction_hash:txHash},{submission_started_at:null}]) {
        const s=submissionFixture();s.mutation=mutation;
        await assert.rejects(s.f.run(),{code:'PUBLICATION_ATTEMPT_PENDING'});assert.equal(s.sends,0);
    }
    const s=submissionFixture();s.f.args.register=async({beforeSubmit})=>{await beforeSubmit();await beforeSubmit();assert.fail('must not send');};
    await assert.rejects(s.f.run(),{code:'PUBLICATION_ATTEMPT_PENDING'});
    assert.equal(s.f.requests.filter(r=>r.action==='begin').length,1);
});

test('failure during wallet preflight does not consume an attempt and enabled submission requires recovery',async()=>{
    const s=submissionFixture();s.f.args.register=async()=>{throw Error('preflight failed');};
    await assert.rejects(s.f.run(),/preflight failed/);assert(!s.f.requests.some(r=>r.action==='begin'));
    s.f.config={...s.f.config,recovery_enabled:false};
    await assert.rejects(s.f.run(),{code:'MEDIA_PREPARATION_UNAVAILABLE'});
});
