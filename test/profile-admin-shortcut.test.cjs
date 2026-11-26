const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const profile = fs.readFileSync('src/entries/profile.jsx', 'utf8');
const menu = fs.readFileSync('avatar-dropdown.js', 'utf8');
const css = fs.readFileSync('unified-styles.css', 'utf8');
const vm = require('node:vm');
const { staffEntryHint } = require('../src/features/admin/staff-entry.js');

test('the owner profile and wallet menu both reach server-checked staff access', () => {
    assert.match(profile, /function ProfileAdminShortcut\(\{ walletAddress \}\)/);
    assert.match(profile, /\{isOwnProfile && \([\s\S]*?<ProfileAdminShortcut walletAddress=\{connectedWalletAddress\}/);
    assert.match(profile, /href="\/admin" className="profile-admin-shortcut"/);
    assert.match(menu, /protocolAdminWallet === wallet/);
    assert.match(menu, /current && this.protocolAdminEligible \? 'Admin panel' : 'Staff sign-in'/);
    assert.match(css, /\.profile-admin-shortcut \{[\s\S]*?min-height: 44px/);
});

test('Profile Admin confirmation uses existing server-owned decision and fail-closed account identity', () => {
    const segment = profile.slice(profile.indexOf('function ProfileAdminShortcut'), profile.indexOf('function ProfilePage'));
    assert.match(segment, /AvatarDropdown\?\.requestProtocolAdminAccessOnce\?\.\(\)/);
    assert.match(segment, /AvatarDropdown\?\.protocolAdminEligible === true/);
    assert.match(segment, /getAuthenticatedWallet\?\.\(\)/);
    assert.match(segment, /artsoulWalletStateSettled === true/);
    assert.match(segment, /artsoulSettledWalletState\?\.isConnected === true/);
    assert.match(segment, /entry\?\.wallet !== expected \|\| live !== expected/);
    assert.match(segment, /signedIn === expected && !entry.signIn \? 'Admin panel' : 'Staff sign-in'/);
    assert.match(segment, /generation\+\+/);
    assert.match(segment, /window\.addEventListener\('artsoul:wallet-state-changed', refresh\)/);
    assert.match(segment, /window\.addEventListener\('artsoul:auth-state-changed', refresh\)/);
    assert.match(segment, /window\.addEventListener\('storage', onStorage\)/);
    assert.doesNotMatch(segment, /localStorage|adminWallets|hardcodedAddresses|role === 'admin'/);
});

test('tap-to-copy account controls retain full wallet payload with stale-account guards', () => {
    assert.match(menu, /control.dataset.copyValue = value/);
    assert.match(menu, /control.dataset.walletAddress = wallet/);
    assert.match(menu, /wallet !== currentWallet\(\)/);
    assert.match(menu, /generation === this.identityGeneration/);
    assert.match(menu, /commitToken === this.identityCommitToken/);
    assert.doesNotMatch(menu, />Copy address<|>Admin panel</);
});

test('returning staff can reach sign-in on A to B to A without exposing the link to B or starting a signature', async () => {
    const {transformWithOxc} = await import('vite');
    const component = profile.slice(profile.indexOf('function ProfileAdminShortcut'), profile.indexOf('function ProfilePage'));
    const {code} = await transformWithOxc(component, 'profile-staff-entry.jsx', {jsx:{runtime:'classic'}});
    const A = '0x' + '1'.repeat(40), B = '0x' + '2'.repeat(40);
    const listeners = new Map(), hints = new Map();
    let live = A, signed = A, pendingRead, reads = 0, entry, cleanup, runEffect, mounted;
    let permitted = true, confirmed = true;
    const window = {
        get currentWalletAddress() { return live; },
        get artsoulSettledWalletState() { return {isConnected:Boolean(live), address:live}; },
        artsoulWalletStateSettled:true, SupabaseAuth:{getAuthenticatedWallet:()=>signed},
        sessionStorage:{getItem:key=>hints.get(key),setItem:(key,v)=>hints.set(key,v),removeItem:key=>hints.delete(key)},
        addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),
        AvatarDropdown:{
            requestProtocolAdminAccessOnce:async()=>{reads++;return pendingRead || permitted;},
            get protocolAdminWallet(){return live;},get protocolAdminRoleChecked(){return confirmed;},
            get protocolAdminEligible(){return permitted;}
        }
    };
    const render = vm.runInNewContext(code+'\nProfileAdminShortcut;', {
        window, staffEntryHint, React:{createElement:(_type,props,child)=>({href:props.href,label:child})},
        useState:()=>[entry,v=>{entry=v;}],useEffect:fn=>{if(mounted!==live) runEffect=fn;}
    });
    function paint() {
        if(mounted!==live) { cleanup?.(); runEffect=null; }
        const result=render({walletAddress:live});
        if(mounted!==live) {mounted=live;cleanup=runEffect();}
        return result;
    }
    const tick=()=>new Promise(resolve=>setImmediate(resolve));
    paint();await tick();assert.equal(paint().label,'Admin panel');
    let release;pendingRead=new Promise(resolve=>{release=resolve;});
    listeners.get('artsoul:auth-state-changed')();
    live=B;signed='';assert.equal(paint(),null);await tick();assert.equal(paint(),null);
    live=A;assert.equal(paint(),null);await tick();
    assert.equal(paint().href,'/admin');assert.equal(paint().label,'Staff sign-in');
    release(true);await tick();assert.equal(paint().label,'Staff sign-in');
    assert.equal(reads,2,'signed-out profile never requests eligibility or a wallet signature');
    pendingRead=null;signed=A;permitted=false;confirmed=false;
    listeners.get('artsoul:auth-state-changed')();await tick();assert.equal(paint().label,'Staff sign-in','expired cookie');
    confirmed=true;listeners.get('artsoul:auth-state-changed')();await tick();assert.equal(paint(),null,'role removed');
    signed='';listeners.get('artsoul:auth-state-changed')();await tick();assert.equal(paint(),null);
});
