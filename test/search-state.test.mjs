import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchState, canSearch, normalizeSearchQuery, readSearchHistory, writeSearchHistory} from '../src/features/search/search-state.js';

const card = id => ({chain_id:84532,artwork_id:String(id),title:'Work '+id});
const body = (query, category='all', items=[], nextCursor=null) => ({query, category, groups:{
    artworks:{items,hasMore:!!nextCursor},auctions:{items:[],hasMore:false},artists:{items:[],hasMore:false}},nextCursor});
const response = value => ({ok:true,json:async()=>value});
function pending(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('global search bounds input without rejecting a single-digit artwork ID or Unicode',()=>{
    assert.equal(canSearch(''),false);assert.equal(canSearch('a'),false);assert.equal(canSearch('7'),true);
    assert.equal(canSearch('Цветы'),true);assert.equal(canSearch('x'.repeat(101)),false);
    assert.equal(canSearch('🌙'),false);assert.equal(canSearch('🌙'.repeat(50)),true);assert.equal(canSearch('ab\u0000cd'),false);
    assert.equal(normalizeSearchQuery('  Blue\n sky  '),'Blue sky');
});
test('a late success cannot overwrite a newer query even if the transport ignores abort',async()=>{
    const first=pending();let call=0;const store=createSearchState({request:()=>++call===1?first.promise:Promise.resolve(response(body('new','all',[card(2)])))});
    const old=store.search('old');await store.search('new');first.resolve(response(body('old','all',[card(1)])));await old;
    assert.equal(store.getState().query,'new');assert.deepEqual(store.getState().groups.artworks.items,[card(2)]);
});
test('late errors and a closed dialog cannot restore old search state',async()=>{
    const first=pending();let call=0;const store=createSearchState({request:()=>++call===1?first.promise:Promise.resolve(response(body('new')))});
    const old=store.search('old');await store.search('new');first.reject(new Error('old failure'));await old;
    assert.equal(store.getState().status,'ready');assert.equal(store.getState().error,'');
    const later=pending();const closed=createSearchState({request:()=>later.promise});const task=closed.search('old');closed.reset();
    later.resolve(response(body('old','all',[card(1)])));await task;assert.equal(closed.getState().status,'idle');assert.deepEqual(closed.getState().groups.artworks.items,[]);
});
test('public search omits wallet credentials and encodes operator characters as query data',async()=>{
    let request;const q='moon & category=artists';const store=createSearchState({request:async(url,options)=>{request={url,options};return response(body(q));}});
    await store.search(q);const parsed=new URL(request.url,'https://artsoul.test');assert.equal(parsed.searchParams.get('q'),q);
    assert.equal(parsed.searchParams.get('category'),'all');assert.equal(request.options.credentials,'omit');assert.equal(request.options.cache,'no-store');
});
test('pagination preserves exact IDs, deduplicates overlap and stops concurrent loads',async()=>{
    let calls=0;const more=pending();const large='115792089237316195423570985008687907853269984665640564039457584007913129639935';
    const store=createSearchState({request:async()=>++calls===1?response(body('work','artworks',[card(large)],'opaque')):more.promise});
    await store.search('work','artworks');const task=store.search('work','artworks',true);await store.search('work','artworks',true);assert.equal(calls,2);
    more.resolve(response(body('work','artworks',[card(large),card(1)])));await task;
    assert.deepEqual(store.getState().groups.artworks.items.map(v=>v.artwork_id),[large,'1']);assert.equal(store.getState().nextCursor,null);
});
test('mismatched response identity and malformed groups fail visibly without fake matches',async()=>{
    for(const data of [body('other'),{...body('work'),groups:{}},{...body('work'),nextCursor:42}]){
        const store=createSearchState({request:async()=>response(data)});await store.search('work');assert.equal(store.getState().status,'error');assert.deepEqual(store.getState().groups.artworks.items,[]);
    }
});
test('temporary backend failure is retryable and does not look like no results',async()=>{
    let call=0;const store=createSearchState({request:async()=>++call===1?{ok:false,status:503}:response(body('work','all',[card(1)]))});
    await store.search('work');assert.equal(store.getState().status,'error');assert.match(store.getState().error,/unavailable/);
    await store.search('work');assert.equal(store.getState().status,'ready');assert.equal(store.getState().groups.artworks.items.length,1);
});
test('recent history is bounded, storage-optional and cannot supply arbitrary navigation URLs',()=>{
    const history=readSearchHistory({getItem:()=>JSON.stringify({queries:Array(20).fill('sun'),views:[
        {kind:'artwork',id:'javascript:alert(1)'},{kind:'artist',id:'0x'+'a'.repeat(40)},{kind:'artwork',id:'34'}]})});
    assert.equal(history.queries.length,6);assert.equal(history.views.length,2);
    assert.deepEqual(readSearchHistory({getItem(){throw Error('denied');}}),{queries:[],views:[]});
    assert.doesNotThrow(()=>writeSearchHistory({setItem(){throw Error('quota');}},history));
});
