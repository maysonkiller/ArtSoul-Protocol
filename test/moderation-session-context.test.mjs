import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {setModerationSession, readModerationSession, MODERATION_SESSION_TTL_SECONDS,
  ENROLLMENT_GRANT_TTL_MS} from '../src/api/moderation-passkey.js';
import logout from '../src/api/routes/auth/logout.js';

const WALLET = '0x'+'1'.repeat(40);
const SECRET = 'local-context-test-only';
const original = {...process.env};
process.env.NODE_ENV='test';
process.env.ARTSOUL_MODERATION_SESSION_SECRET=SECRET;
process.env.ARTSOUL_MODERATION_DUAL_WALLET_ENABLED='true';
delete process.env.VERCEL;
test.after(()=>{ for (const name of ['NODE_ENV','ARTSOUL_MODERATION_SESSION_SECRET','ARTSOUL_MODERATION_DUAL_WALLET_ENABLED','VERCEL']) {
  if (original[name]===undefined) delete process.env[name]; else process.env[name]=original[name];
}});
const req=(ip='192.0.2.1',agent='LocalBrowser/1')=>({headers:{'user-agent':agent},socket:{remoteAddress:ip}});
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},end(){}});
function issue(request=req(),factor='passkey') {
  const response=res();setModerationSession(response,WALLET,'local-factor',7,factor,request);
  return response.headers['Set-Cookie'];
}
function withCookie(request,cookie) {return {...request,headers:{...request.headers,cookie:cookie.split(';')[0]}};}
function decode(cookie) {return JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[0],'base64url').toString());}
function signed(payload) {
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `artsoul_mod_session=${encoded}.${crypto.createHmac('sha256',SECRET).update(encoded).digest('base64url')}`;
}

test('verified access lasts exactly 24 hours without extending the setup permission',t=>{
  let now=1_790_000_000_000;t.mock.method(Date,'now',()=>now);
  const cookie=issue();const payload=decode(cookie);
  assert.equal(MODERATION_SESSION_TTL_SECONDS,86400);assert.equal(ENROLLMENT_GRANT_TTL_MS,900000);
  assert.equal(payload.exp-payload.iat,86400);
  assert.equal(readModerationSession(withCookie(req(),cookie)).expiresAt,payload.exp*1000);
  assert.match(cookie,/Max-Age=86400; Path=\/; HttpOnly; SameSite=Lax/);
  now+=16*60*1000;assert.equal(readModerationSession(withCookie(req(),cookie)).wallet,WALLET);
  assert.equal(readModerationSession(withCookie(req(),cookie)).expiresAt,payload.exp*1000);
  now=payload.exp*1000-1000;assert(readModerationSession(withCookie(req(),cookie)));
  now+=1000;assert.equal(readModerationSession(withCookie(req(),cookie)),null);
  assert.equal(decode(cookie).exp,payload.exp,'reads do not renew expiry');
});

test('a new browser, changed user agent or changed direct IP requires fresh verification',()=>{
  const cookie=issue();
  assert.equal(readModerationSession(req()),null);
  assert.equal(readModerationSession(withCookie(req('192.0.2.2'),cookie)),null);
  assert.equal(readModerationSession(withCookie(req('192.0.2.1','OtherBrowser/1'),cookie)),null);
  assert.equal(readModerationSession(withCookie(req(),cookie)).authorizationVersion,7);
  assert.equal(JSON.stringify(decode(cookie)).includes('192.0.2.1'),false);
  assert.equal(JSON.stringify(decode(cookie)).includes('LocalBrowser'),false);
});

test('direct hosts ignore caller-provided proxy headers',()=>{
  const cookie=issue();const same=req();same.headers['x-vercel-forwarded-for']='203.0.113.7';same.headers['x-forwarded-for']='203.0.113.8';
  assert(readModerationSession(withCookie(same,cookie)));
  const changed=req('192.0.2.2');changed.headers['x-vercel-forwarded-for']='192.0.2.1';
  assert.equal(readModerationSession(withCookie(changed,cookie)),null);
});

test('Vercel uses only its single validated edge IP and rejects missing or malformed context',()=>{
  process.env.VERCEL='1';
  try {
    const first=req();first.headers['x-vercel-forwarded-for']='203.0.113.9';
    const cookie=issue(first);const same=req('192.0.2.2');same.headers['x-vercel-forwarded-for']='203.0.113.9';
    same.headers['x-forwarded-for']='198.51.100.7';assert(readModerationSession(withCookie(same,cookie)));
    for (const address of [undefined,'','203.0.113.9, 203.0.113.10',['203.0.113.9'],'unknown','203.0.113.10']) {
      const changed=req();changed.headers['x-vercel-forwarded-for']=address;
      assert.equal(readModerationSession(withCookie(changed,cookie)),null);
    }
    assert.throws(()=>issue(req()),error=>error.code==='MODERATION_PASSKEY_MISCONFIGURED');
  } finally {delete process.env.VERCEL;}
});

test('equivalent IPv6 spellings match, but a different IPv6 address does not',()=>{
  const cookie=issue(req('2001:db8:0:0::1'));
  assert(readModerationSession(withCookie(req('2001:db8::1'),cookie)));
  assert.equal(readModerationSession(withCookie(req('2001:db8::2'),cookie)),null);
});

test('session issuance and reads fail closed without actual browser/network context',()=>{
  const cookie=issue();
  for (const request of [undefined,{},req('', 'LocalBrowser/1'),req('127.0.0.1',''),req('127.0.0.1',['one','two']),req('127.0.0.1','x'.repeat(1025))]) {
    const response=res();assert.throws(()=>setModerationSession(response,WALLET,'local-factor',7,'passkey',request));
    assert.equal(response.headers['Set-Cookie'],undefined);
    assert.equal(readModerationSession(withCookie(request||{},cookie)),null);
  }
});

test('old unbound sessions, malformed timestamps and tampered cookies cannot extend access',()=>{
  const cookie=issue();const data=decode(cookie);
  for (const payload of [
    {wallet:WALLET,credential_id:'old',exp:data.iat+900,authorization_version:7},
    {...data,context_version:2},{...data,request_context:'a'},
    {...data,iat:data.iat+1},{...data,iat:String(data.iat)},
    {...data,exp:data.exp+1},{...data,exp:String(data.exp)}
  ]) assert.equal(readModerationSession(withCookie(req(),signed(payload))),null);
  assert.equal(readModerationSession(withCookie(req(),cookie.split(';')[0]+'.extra')),null);
  const altered=Buffer.from(JSON.stringify({...data,wallet:'0x'+'2'.repeat(40)})).toString('base64url');
  assert.equal(readModerationSession(withCookie(req(),`artsoul_mod_session=${altered}.${cookie.split('.')[1].split(';')[0]}`)),null);
});

test('authenticator sessions receive the same context and expiry policy',()=>{
  const cookie=issue(req(),'totp');
  assert.equal(readModerationSession(withCookie(req(),cookie)).factorType,'totp');
  assert.equal(readModerationSession(withCookie(req(),cookie)).expiresAt,decode(cookie).exp*1000);
  assert.equal(decode(cookie).exp-decode(cookie).iat,86400);
  assert.equal(readModerationSession(withCookie(req('192.0.2.3'),cookie)),null);
});

test('production cookies remain secure and logout clears wallet and staff access together',async()=>{
  process.env.NODE_ENV='production';
  try {
    assert.match(issue(),/HttpOnly; Secure; SameSite=Lax/);
    const response=res();await logout({method:'POST',headers:{}},response);
    assert.equal(response.statusCode,200);assert.equal(response.headers['Set-Cookie'].length,2);
    assert(response.headers['Set-Cookie'].some(value=>value.startsWith('artsoul_mod_session=;')));
    for (const value of response.headers['Set-Cookie']) {assert.match(value,/Max-Age=0/);assert.match(value,/HttpOnly; Secure; SameSite=Lax/);}
  } finally {process.env.NODE_ENV='test';}
});
