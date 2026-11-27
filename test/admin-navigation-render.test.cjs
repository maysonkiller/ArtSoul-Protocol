const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = fs.readFileSync(process.env.ADMIN_CANDIDATE_PATH || 'src/entries/admin.jsx','utf8').replace(/\r\n/g,'\n');
const WALLET = '0x'+'11'.repeat(20);
let compiled;
test.before(async()=>{
    const { transformWithOxc } = await import('vite');
    compiled = (await transformWithOxc(source.slice(0,source.lastIndexOf('createRoot(')).replace(/^import .*;\n/gm,''),
        'admin-navigation-render.jsx',{jsx:{runtime:'classic'}})).code;
});

function render({state='ready',wallet=WALLET,staff=true,authority=true,role=authority?'team':'moderator',section='queue',dialog=false,frameSourceManager=false,identityReviewer=false}={}) {
    const ready = state==='ready';
    const data = {reports:[],events:[],hidden:[],moderationLog:[],notifications:[]};
    // Use actual page JSX with explicit state fixtures. No network, wallet or
    // native credential operation is executed by a static render.
    const states = [state,staff?{role,dualWallet:true,stepUpActive:ready,frameSourceManager,identityReviewer}:null,
        'pending_review',null,data,section,false,'',null,staff?wallet:'',authority?wallet:'',dialog];
    let index=0;
    const scope={React:{...React,useState:initial=>[index<states.length?states[index++]:initial,()=>{}]},
        window:{artsoulWalletStateSettled:true,getCurrentWalletAddress:()=>wallet},
        AuraAppearance:props=>React.createElement('section',{'data-fixture':'appearance','data-sources':props.frameSourceManager===true},'Frame label controls'),
        IdentityReviews:()=>React.createElement('section',{'data-fixture':'identity'},'Identity reviews'),
        StaffFactorDialog:()=>React.createElement('dialog',{'data-fixture':'factor'},'Factor dialog'),
        StaffPasskeyDialog:()=>React.createElement('dialog',{'data-fixture':'passkey'},'Passkey dialog'),
        StaffAuthority:()=>React.createElement('div',{'data-fixture':'staff'},'Team fixture')};
    vm.runInNewContext(compiled+'\nthis.Component=ProtocolAdminPage;',scope);
    return renderToStaticMarkup(React.createElement(scope.Component));
}

test('sign-in controls remain above staff and complaint content with one verification action',()=>{
    for(const state of ['ready','step_up','setup']) {
        const html=render({state});
        const header=html.match(/<header\b[\s\S]*?<\/header>/)[0];
        const label=state==='ready'?'Account security':'Verify admin access';
        assert.match(header,new RegExp('>'+label+'</button>'));
        assert.equal((html.match(new RegExp('>'+label+'</button>','g'))||[]).length,1);
        assert(html.indexOf('</header>')<html.indexOf('data-fixture="staff"'));
        if(state!=='ready')assert.doesNotMatch(html,/id="reviewQueueTitle"|Protocol Admin sections/);
    }
});

test('each opened section has one selected navigation item and staff state stays mounted',()=>{
    for(const section of ['queue','hidden','audit','notifications','staff']) {
        const html=render({section});
        const nav=html.match(/<nav\b[\s\S]*?<\/nav>/)[0];
        assert.equal((nav.match(/aria-current="page"/g)||[]).length,1);
        assert.match(html,/data-fixture="staff"/);
        assert.equal(/<div hidden=""><div data-fixture="staff"/.test(html),section!=='staff');
        assert.equal(html.includes('id="reviewQueueTitle"'),section==='queue');
    }
    const ordinary=render({authority:false,section:'staff'});
    assert.doesNotMatch(ordinary,/data-fixture="staff"|>Staff access<|>Team directory</);
    assert.match(ordinary,/id="reviewQueueTitle"/);
});

test('disconnected and connected guests receive different actionable guidance',()=>{
    const guest=render({state:'unauthenticated',wallet:'',staff:false,authority:false});
    assert.match(guest,/>Connect staff wallet<|Connect your staff wallet/);
    const connected=render({state:'unauthenticated',staff:false,authority:false});
    assert.match(connected,/>Verify wallet</);
    assert.doesNotMatch(connected,/data-fixture="staff"|id="reviewQueueTitle"/);
});

test('the NFT appearance destination preserves the account and verification gates',()=>{
    const locked=render({section:'appearance',role:'admin',state:'step_up'});
    assert.match(locked,/Verify your authorized staff wallet to open NFT appearance/);
    assert.doesNotMatch(locked,/data-fixture="appearance"/);
    const moderator=render({section:'appearance',role:'moderator'});
    assert.match(moderator,/does not have permission to manage NFT appearance/);
    assert.doesNotMatch(moderator,/data-fixture="appearance"/);
    const administrator=render({section:'appearance',role:'admin'});
    assert.match(administrator,/aria-current="page">NFT appearance/);
    assert.match(administrator,/data-fixture="appearance"/);
    assert.match(render({section:'appearance',role:'team',authority:true}),/data-fixture="appearance"/);
    assert.doesNotMatch(render({section:'appearance',role:'team',authority:false}),/data-fixture="appearance"/);
    assert.doesNotMatch(render({section:'appearance',role:'team',authority:true,state:'step_up'}),/data-fixture="appearance"/);
});

test('source management requires a verified governing Team capability while blue identity review remains independent',()=>{
    const enabled={section:'appearance',frameSourceManager:true,identityReviewer:true};
    assert.match(render({...enabled,role:'team',authority:true}),/data-sources="true"/);
    assert.match(render({...enabled,role:'admin',authority:true}),/data-sources="false"/);
    assert.match(render({...enabled,role:'team',frameSourceManager:false}),/data-sources="false"/);
    for(const overrides of [{authority:false},{state:'step_up'},{role:'moderator'}]) {
        assert.doesNotMatch(render({...enabled,role:'team',...overrides}),/data-sources="true"/);
    }
    assert.match(render({section:'identity',role:'admin',identityReviewer:true,authority:false}),/data-fixture="identity"/);
    assert.match(render({section:'identity',role:'team',identityReviewer:true,authority:true}),/data-fixture="identity"/);
    assert.doesNotMatch(render({section:'identity',role:'team',identityReviewer:false,authority:true,frameSourceManager:true}),/data-fixture="identity"/);
});

test('a factor dialog has one stable location before the protected body',()=>{
    for(const state of ['ready','step_up']) {
        const html=render({state,dialog:true});
        assert.equal((html.match(/data-fixture="factor"/g)||[]).length,1);
        assert(html.indexOf('data-fixture="factor"')<html.indexOf('data-fixture="staff"'));
    }
});

test('the ready workspace groups moderation, history and authority controls without duplicating actions', () => {
    const html = render({state: 'ready', staff: true, authority: true, section: 'queue'});
    const nav = html.match(/<nav\b[\s\S]*?<\/nav>/)?.[0];
    assert.ok(nav);
    for (const group of ['Moderate', 'History', 'Access']) {
        assert.match(nav, new RegExp('aria-label="' + group + '"'), group);
    }
    for (const label of ['Reports', 'Artworks', 'Hidden', 'Audit log', 'Delivery', 'Staff access']) {
        assert.ok(nav.includes('>' + label + '</button>'), label);
    }
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
    assert.match(html, /role="group" aria-label="Current workspace counts"/);
    assert.match(html, /Reports in view/);
    assert.match(html, /Hidden works/);
    assert.match(html, /Delivery records/);
    assert.match(nav, /Workspace section<select/);
    assert.match(nav, /<option value="queue" selected="">Reports<\/option>/);
});

test('an ineligible guest never sees protected navigation or workspace counters', () => {
    const html = render({state: 'ineligible', staff: false, authority: false});
    assert.doesNotMatch(html, /Current workspace counts|Protocol Admin sections|data-fixture="staff"/);
});
