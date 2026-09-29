import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPlan, validatePlan, assertPriorTransactionsSettled } from '../scripts/testnet-transaction.mjs';
const a='0x0000000000000000000000000000000000000001';
const core='0x0000000000000000000000000000000000000002';
const nft='0x0000000000000000000000000000000000000003';
const excluded='0x0000000000000000000000000000000000000004';
const digest=hashPlan('approved-test-plan');
const policy={version:1,chainId:84532,excludedAddresses:[excluded],approvedPlanHashes:[digest],
    contracts:{core:{address:core,codeHash:'0x'+'a'.repeat(64)},nft:{address:nft,codeHash:'0x'+'b'.repeat(64)}},
    limits:{maxValueWei:'20000000000000000',maxGasLimit:'1500000',maxGasPriceWei:'5000000000',maxTotalReservedWei:'100000000000000000',l1ReserveWei:'1000000000000000'}};
const base={version:1,id:'policy-test',chainId:84532,role:'creator',from:a,target:'core',method:'endAuction',args:['63'],artworkId:'28',valueWei:'0',expiresAt:'2099-01-01T00:00:00Z'};
test('an approved explicit testnet operation passes structural validation',()=>{assert.equal(validatePlan(base,policy,a,digest),base);});
test('wrong chain, unapproved or expired plans and protected accounts fail closed',()=>{
    assert.throws(()=>validatePlan({...base,chainId:8453},policy,a,digest),/WRONG_CHAIN/);
    assert.throws(()=>validatePlan(base,policy,a,hashPlan('changed')),/PLAN_NOT_APPROVED/);
    assert.throws(()=>validatePlan({...base,expiresAt:'2000-01-01'},policy,a,digest),/PLAN_EXPIRED/);
    assert.throws(()=>validatePlan({...base,from:excluded},policy,excluded,digest),/PROTECTED_SIGNER/);
});
test('arbitrary/admin calls, broad approvals and path traversal are rejected',()=>{
    for(const method of ['transferOwnership','mintProjectNFT','setApprovalForAll','constructor','__proto__']) assert.throws(()=>validatePlan({...base,method},policy,a,digest),/METHOD_NOT_ALLOWED/);
    assert.throws(()=>validatePlan({...base,id:'../overwrite'},policy,a,digest),/INVALID_PLAN_ID/);
    assert.throws(()=>validatePlan({...base,target:'nft',method:'approve',args:[excluded,'1']},policy,a,digest),/INVALID_APPROVAL/);
});
test('value, duration, identifiers and strict decimal integers are bounded',()=>{
    assert.throws(()=>validatePlan({...base,valueWei:'1'},policy,a,digest),/UNEXPECTED_VALUE/);
    assert.throws(()=>validatePlan({...base,method:'placeBid',args:['63','1'],valueWei:'30000000000000000'},policy,a,digest),/VALUE_LIMIT/);
    assert.throws(()=>validatePlan({...base,artworkId:undefined},policy,a,digest),/MISSING_ARTWORK_NAMESPACE/);
    assert.throws(()=>validatePlan({...base,args:['1e3']},policy,a,digest),/INVALID_ARGUMENTS/);
    assert.throws(()=>validatePlan({...base,method:'createAuction',args:['28','1','60']},policy,a,digest),/INVALID_DURATION/);
});
test('an uncertain prior broadcast blocks different plans from reusing its nonce',async()=>{
    const record={chainId:84532,sender:a,to:core,valueWei:'0',reservedWei:'1000',nonce:4,hash:'0x'+'c'.repeat(64)};
    const missing=async()=>null;
    await assert.rejects(assertPriorTransactionsSettled([record],a,[missing,missing]),/PRIOR_TRANSACTION_UNRESOLVED/);
});
test('receipt disagreement or an unconsumed mined nonce blocks further signing',async()=>{
    const record={chainId:84532,sender:a,to:core,valueWei:'0',reservedWei:'1000',nonce:4,hash:'0x'+'c'.repeat(64)};
    const receipt={from:a,to:core,transactionHash:record.hash,blockHash:'0x'+'d'.repeat(64),blockNumber:'0x20',transactionIndex:'0x0',
        status:'0x1',gasUsed:'0x1',effectiveGasPrice:'0x2',l1Fee:'0x3',logs:[]};
    const confirmed=async method=>method==='eth_getTransactionReceipt'?receipt:method==='eth_getBlockByNumber'?{hash:receipt.blockHash,number:receipt.blockNumber}:'0x5';
    const divergent=async()=>({...receipt,blockHash:'0x'+'e'.repeat(64)});
    await assert.rejects(assertPriorTransactionsSettled([record],a,[confirmed,divergent]),/PRIOR_TRANSACTION_UNRESOLVED/);
    const stale=async method=>method==='eth_getTransactionCount'?'0x4':confirmed(method);
    await assert.rejects(assertPriorTransactionsSettled([record],a,[confirmed,stale]),/PRIOR_NONCE_UNRESOLVED/);
    assert.equal(await assertPriorTransactionsSettled([record],a,[confirmed,confirmed]),5n);
});
