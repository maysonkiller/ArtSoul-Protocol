import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ethers } from 'ethers';
import { donationMessageState } from '../src/features/artwork/donation-message.js';
const source=fs.readFileSync('contracts-integration.js','utf8').replace(/^import .*;\r?\n/gm,'');
const CORE=`0x${'11'.repeat(20)}`, SUPPORT=`0x${'22'.repeat(20)}`, CREATOR=`0x${'33'.repeat(20)}`, DONOR=`0x${'44'.repeat(20)}`;
const HASH=`0x${'55'.repeat(32)}`;
const options={expectedWallet:DONOR,expectedChainId:84532};
function setup({paused=false,core=CORE,creator=CREATOR,waitError=null,event=true,signerAddress=DONOR,recoveryReceipt=null,recoveryChain=84532}={}) {
    const writes=[], window={}; let walletChecks=0;
    const recoveryReads=[];
    const iface=new ethers.Interface(['event Donation(address indexed donor,address indexed creator,uint256 indexed artworkId,uint256 amount,string message,bool isAnonymous)']);
    class Contract {
        constructor(address) { assert.equal(address,SUPPORT); this.interface=iface; }
        async core(){return core;} async paused(){return paused;}
        async donate(recipient,id,message,isAnonymous,{value}) {
            writes.push({recipient,id,message,isAnonymous,value});
            const log=iface.encodeEventLog(iface.getEvent('Donation'),[DONOR,recipient,id,value,message,isAnonymous]);
            return {hash:HASH,wait:async()=>{
                if(waitError) throw waitError;
                return {status:1,hash:HASH,logs:event?[{...log,address:SUPPORT}]:[]};
            }};
        }
    }
    class BrowserProvider {
        async getNetwork(){return {chainId:recoveryChain};}
        async getTransactionReceipt(hash){recoveryReads.push(hash);return recoveryReceipt;}
    }
    vm.runInNewContext(source,{window,ethers:{...ethers,Contract,BrowserProvider},donationMessageState,console:{log(){},warn(){},error(){}}});
    const api=window.ArtSoulContracts;
    api.signer={getAddress:async()=>signerAddress};
    api.ensureBaseSepoliaWrite=async()=>{};
    api.assertExpectedWallet=async opts=>{
        assert.deepEqual({expectedWallet:opts.expectedWallet,expectedChainId:opts.expectedChainId},options);
        if(opts.onSubmitted) assert.equal(typeof opts.onSubmitted,'function');
        walletChecks++;
    };
    api.coreContract={getAddress:async()=>CORE}; api.getArtworkStruct=async()=>({creator});
    window.web3Modal={getWalletProvider:async()=>({request:async()=>{}})};
    return {api,writes,walletChecks:()=>walletChecks,recoveryReads};
}
test('support routes exact value to the verified creator and requires matching confirmation',async()=>{
    const {api,writes,walletChecks}=setup();
    assert.equal(await api.donateToArtist(SUPPORT,'28',CREATOR,'0.001','Thank you',true,options),HASH);
    assert.equal(writes.length,1); assert.equal(writes[0].value,1000000000000000n);
    assert.equal(writes[0].recipient,CREATOR); assert.equal(walletChecks(),2);
});
test('recipient mismatch, wrong Core and paused support never prompt payment',async()=>{
    for(const config of [{creator:DONOR},{core:DONOR},{paused:true}]) {
        const {api,writes}=setup(config);
        await assert.rejects(api.donateToArtist(SUPPORT,'28',CREATOR,'0.001','Message',false,options));
        assert.equal(writes.length,0);
    }
});
test('one wei support succeeds with or without a message and has no extra amount requirement',async()=>{
    for (const message of ['', 'Thank you']) {
        const {api,writes}=setup();
        assert.equal(await api.donateToArtist(SUPPORT,'28',CREATOR,'0.000000000000000001',message,false,options),HASH);
        assert.equal(writes[0].value,1n);
        assert.equal(writes[0].message,message);
    }
});
test('zero support never prompts payment with or without a message',async()=>{
    for (const message of ['', 'Thank you']) {
        const {api,writes}=setup();
        await assert.rejects(api.donateToArtist(SUPPORT,'28',CREATOR,'0',message,false,options),/greater than zero/);
        assert.equal(writes.length,0);
    }
});
test('wallet change during chain reads is rechecked before the payment',async()=>{
    const {api,writes}=setup(); let checks=0;
    api.assertExpectedWallet=async()=>{if(++checks===2)throw new Error('Wallet changed');};
    await assert.rejects(api.donateToArtist(SUPPORT,'28',CREATOR,'0.001','',false,options),/Wallet changed/);
    assert.equal(writes.length,0);
});

test('a stale shared signer cannot send from another account despite current provider identity',async()=>{
    const {api,writes}=setup({signerAddress:CREATOR});
    await assert.rejects(api.donateToArtist(SUPPORT,'28',CREATOR,'0.001','',false,options),/signer changed/i);
    assert.equal(writes.length,0);
});
test('unknown broadcast outcome preserves its transaction hash for a non-repeatable UI',async()=>{
    const {api,writes}=setup({waitError:new Error('RPC disconnected')});
    await assert.rejects(api.donateToArtist(SUPPORT,'28',CREATOR,'0.001','',false,options),error=>error.transactionHash===HASH);
    assert.equal(writes.length,1);
});

test('support reports the broadcast hash before waiting and callback failure does not make it unsent',async()=>{
    const {api,writes}=setup({waitError:new Error('RPC disconnected')});
    const submitted=[];
    await assert.rejects(api.donateToArtist(SUPPORT,'28',CREATOR,'0.001','',false,
        {...options,onSubmitted:hash=>{submitted.push(hash);throw new Error('Storage unavailable');}}),
        error=>error.transactionHash===HASH);
    assert.deepEqual(submitted,[HASH]); assert.equal(writes.length,1);
});

test('explicit receipt revert and cancelled replacement can be reviewed again',async()=>{
    for(const waitError of [Object.assign(new Error('Reverted'),{receipt:{status:0,hash:HASH}}),
        Object.assign(new Error('Cancelled'),{code:'TRANSACTION_REPLACED',cancelled:true,reason:'cancelled'})]) {
        const {api,writes}=setup({waitError});
        await assert.rejects(api.donateToArtist(SUPPORT,'28',CREATOR,'0.001','',false,options),
            error=>error.transactionHash===undefined);
        assert.equal(writes.length,1);
    }
});
test('a different-calldata replacement remains locked despite the provider cancelled flag',async()=>{
    const replacementHash=`0x${'66'.repeat(32)}`;
    const waitError=Object.assign(new Error('Transaction replaced'),{
        code:'TRANSACTION_REPLACED',cancelled:true,reason:'replaced',
        receipt:{status:1,hash:replacementHash,logs:[]}
    });
    const {api,writes}=setup({waitError});
    await assert.rejects(api.donateToArtist(SUPPORT,'28',CREATOR,'0.001','',false,options),
        error=>error.transactionHash===replacementHash);
    assert.equal(writes.length,1);
});
test('a successful receipt without the exact donation event is not reported as success',async()=>{
    const {api}=setup({event:false});
    await assert.rejects(api.donateToArtist(SUPPORT,'28',CREATOR,'0.001','',false,options),error=>error.transactionHash===HASH && /could not be verified/.test(error.message));
});
test('unsupported chain, malformed identity and over-limit messages fail before chain access',async()=>{
    const {api,writes}=setup(); api.ensureBaseSepoliaWrite=()=>assert.fail('No chain access expected');
    for(const [id,text,opts] of [['28','',{...options,expectedChainId:1}],['0','',options],['28','a'.repeat(141),options],['28','',{}]]) {
        await assert.rejects(api.donateToArtist(SUPPORT,id,CREATOR,'0.001',text,false,opts));
    }
    assert.equal(writes.length,0);
});

function recoveryReceipt({address=SUPPORT,donor=DONOR,creator=CREATOR,artworkId=28,status=1}={}) {
    const iface=new ethers.Interface(['event Donation(address indexed donor,address indexed creator,uint256 indexed artworkId,uint256 amount,string message,bool isAnonymous)']);
    const log=iface.encodeEventLog(iface.getEvent('Donation'),[donor,creator,artworkId,1000000000000000n,'Thanks',false]);
    return {status,hash:HASH,logs:[{...log,address}]};
}

test('read-only recovery never unlocks a missing or mismatched donation receipt',async()=>{
    for(const receipt of [null,recoveryReceipt({address:CORE}),recoveryReceipt({donor:CREATOR}),
        recoveryReceipt({creator:DONOR}),recoveryReceipt({artworkId:29})]) {
        const {api,writes,recoveryReads}=setup({recoveryReceipt:receipt});
        const outcome=await api.checkArtistDonation(SUPPORT,'28',CREATOR,HASH,options);
        assert.equal(outcome.status,'unverified'); assert.equal(outcome.hash,HASH);
        assert.deepEqual(recoveryReads,[HASH]); assert.equal(writes.length,0);
    }
});

test('recovery distinguishes an exact confirmed event and an explicit revert without sending',async()=>{
    for(const [receipt,status] of [[recoveryReceipt(),'confirmed'],[recoveryReceipt({status:0}),'reverted']]) {
        const {api,writes,walletChecks}=setup({recoveryReceipt:receipt});
        const outcome=await api.checkArtistDonation(SUPPORT,'28',CREATOR,HASH,options);
        assert.equal(outcome.status,status); assert.equal(writes.length,0); assert.equal(walletChecks(),2);
    }
});

test('recovery cannot read the same transaction hash on a different chain or stale wallet',async()=>{
    const wrongChain=setup({recoveryChain:1});
    await assert.rejects(wrongChain.api.checkArtistDonation(SUPPORT,'28',CREATOR,HASH,options),/Base Sepolia/);
    assert.deepEqual(wrongChain.recoveryReads,[]);
    const changedWallet=setup({recoveryReceipt:recoveryReceipt()}); let checks=0;
    changedWallet.api.assertExpectedWallet=async()=>{if(++checks===2)throw new Error('Wallet changed');};
    await assert.rejects(changedWallet.api.checkArtistDonation(SUPPORT,'28',CREATOR,HASH,options),/Wallet changed/);
    assert.equal(changedWallet.writes.length,0);
});
