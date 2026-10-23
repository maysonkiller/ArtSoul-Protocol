const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'entries', 'upload.js'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${name}`);
  let signatureDepth = 0;
  let signatureEnd = source.indexOf('(', start);
  for (; signatureEnd < source.length; signatureEnd++) {
    if (source[signatureEnd] === '(') signatureDepth++;
    if (source[signatureEnd] === ')') {
      signatureDepth--;
      if (signatureDepth === 0) break;
    }
  }
  let index = source.indexOf('{', signatureEnd);
  let depth = 0;
  for (; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const prefix = source.slice(Math.max(0, start - 6), start) === 'async ' ? 'async ' : '';
  return prefix + source.slice(start, index + 1);
}

function loadWaiter() {
  const sandbox = vm.createContext({
    console: { warn: () => {} },
    window: {},
    exported: {}
  });
  vm.runInContext([
    extractFunction('createUploadError'),
    extractFunction('isProjectedAuctionReady'),
    extractFunction('waitForAuctionConfirmation'),
    'exported.waitForAuctionConfirmation = waitForAuctionConfirmation;',
    'exported.isProjectedAuctionReady = isProjectedAuctionReady;'
  ].join('\n'), sandbox, { filename: 'upload.js (extracted finalization helpers)' });
  return sandbox.exported;
}

test('auction projection proof is exact and requires an auction id', () => {
  const { isProjectedAuctionReady } = loadWaiter();
  assert.equal(isProjectedAuctionReady({ artwork_id: '7', active_auction_id: '4' }, '7'), true);
  assert.equal(isProjectedAuctionReady({ blockchain_id: '7', auction_id: '4' }, '7'), true);
  assert.equal(isProjectedAuctionReady({ artwork_id: '8', active_auction_id: '4' }, '7'), false);
  assert.equal(isProjectedAuctionReady({ artwork_id: '7', active_auction_id: '' }, '7'), false);
  assert.equal(isProjectedAuctionReady(null, '7'), false);
});

test('normal wallet receipt resolution finishes without waiting for the indexer', async () => {
  const { waitForAuctionConfirmation } = loadWaiter();
  const hash = await waitForAuctionConfirmation({
    transactionPromise: Promise.resolve('0xconfirmed'),
    chainId: 84532,
    artworkId: '7',
    txHash: '0xsubmitted',
    timeoutMs: 50,
    pollIntervalMs: 10,
    readProjection: async () => null,
    now: () => 0,
    sleep: async () => {}
  });
  assert.equal(hash, '0xconfirmed');
});

test('an indexed auction completes the flow when the wallet receipt promise stays frozen', async () => {
  const { waitForAuctionConfirmation } = loadWaiter();
  let clock = 0;
  let reads = 0;
  const hash = await waitForAuctionConfirmation({
    transactionPromise: new Promise(() => {}),
    chainId: 84532,
    artworkId: '7',
    txHash: '0xsubmitted',
    timeoutMs: 50,
    pollIntervalMs: 10,
    readProjection: async () => (++reads >= 2 ? { artwork_id: '7', active_auction_id: '4' } : null),
    now: () => clock,
    sleep: async ms => { clock += ms; }
  });
  assert.equal(hash, '0xsubmitted');
  assert.equal(reads, 2);
});

test('indexer proof wins over a wallet-provider wait rejection after submission', async () => {
  const { waitForAuctionConfirmation } = loadWaiter();
  const hash = await waitForAuctionConfirmation({
    transactionPromise: Promise.reject(new Error('provider transport closed')),
    chainId: 84532,
    artworkId: '7',
    txHash: '0xsubmitted',
    timeoutMs: 50,
    pollIntervalMs: 10,
    readProjection: async () => ({ artwork_id: '7', auction_id: '4' }),
    now: () => 0,
    sleep: async () => {}
  });
  assert.equal(hash, '0xsubmitted');
});

test('bounded settlement ends with a non-destructive pending result', async () => {
  const { waitForAuctionConfirmation } = loadWaiter();
  let clock = 0;
  await assert.rejects(
    waitForAuctionConfirmation({
      transactionPromise: new Promise(() => {}),
      chainId: 84532,
      artworkId: '7',
      txHash: '0xsubmitted',
      timeoutMs: 30,
      pollIntervalMs: 10,
      readProjection: async () => null,
      now: () => clock,
      sleep: async ms => { clock += ms; }
    }),
    error => error.code === 'AUCTION_CONFIRMATION_PENDING' && error.txHash === '0xsubmitted'
  );
  assert.equal(clock, 30);
});

test('publish submits one auction transaction and never prompts a duplicate on timeout', () => {
  const uploadHandler = extractFunction('handleUpload');
  assert.equal((uploadHandler.match(/ArtSoulContracts\.createAuction\(/g) || []).length, 1);
  assert.match(uploadHandler, /Promise\.race\(\[/);
  assert.match(uploadHandler, /waitForAuctionConfirmation\(\{/);
  assert.match(uploadHandler, /mappedAuctionError\.code === 'AUCTION_CONFIRMATION_PENDING'/);
  assert.match(uploadHandler, /stage: 'auction_submitted'/);
  assert.match(uploadHandler, /Do not submit the auction again while it is finalizing/);

  const pendingStart = uploadHandler.indexOf("mappedAuctionError.code === 'AUCTION_CONFIRMATION_PENDING'");
  const pendingEnd = uploadHandler.indexOf('return;', pendingStart);
  assert.ok(pendingEnd > pendingStart, 'pending auction exits without another submission');
  const pendingBranch = uploadHandler.slice(pendingStart, pendingEnd);
  assert.doesNotMatch(pendingBranch, /auction_failed|createAuction\(/);
});

test('internal redirects release the native beforeunload guard first', () => {
  const navigate = extractFunction('navigateAfterPublish');
  assert.ok(
    navigate.indexOf('publishNavigationLocked = false') < navigate.indexOf('window.location.assign('),
    'the navigation lock must clear before an internal redirect'
  );
  assert.match(source, /window\.addEventListener\('beforeunload'/);
  // The destination is built by the shared helper now, but it must still go
  // through navigateAfterPublish so the unload guard is released first.
  assert.match(source, /navigateAfterPublish\(window\.ArtSoulArtworkUrl\.artworkPath\(/);
  // It also marks the destination, which is the only way the artwork page can
  // tell a publish from an ordinary visit and name the wait it is showing.
  assert.match(navigate, /published=1/);
});

test('Publish stays clickable and explains what is blocking it', () => {
  // A disabled submit swallows the click, so the person gets no answer at all.
  assert.match(source, /button\.disabled = uploading;/);
  assert.doesNotMatch(source, /button\.disabled = !ready;/);
  assert.match(source, /setAttribute\('aria-disabled'/);

  const reveal = extractFunction('revealBlockingStep');
  assert.match(reveal, /scrollIntoView/);
  assert.match(reveal, /\.focus\(/);
  // Requesting AI guidance costs a wallet signature: never trigger it for them.
  assert.doesNotMatch(reveal, /\.click\(\)/);

  const handler = extractFunction('handleUpload');
  assert.match(handler, /revealBlockingStep\(validationError\.message, validationError\.fieldId\)/);
  // Only the form steps are covered: a wrong network is an environment problem,
  // not a control on this page, and keeps its own modal warning.
  const formSteps = handler.slice(0, handler.indexOf('const walletAddress ='));
  assert.doesNotMatch(formSteps, /alert\(/);
});

test('the artwork description has a bounded length', () => {
  assert.match(source, /const MAX_ARTWORK_DESCRIPTION_LENGTH = 1000;/);
  assert.match(source, /Keep the description within \$\{MAX_ARTWORK_DESCRIPTION_LENGTH\} characters/);

  const html = fs.readFileSync(path.join(__dirname, '..', 'upload.html'), 'utf8');
  assert.match(html, /id="artDescription"[^>]*maxlength="1000"/);
  assert.match(html, /id="artDescriptionCount"/);
  assert.match(html, /id="publishBlockedNote"[^>]*role="alert"/);
});

function loadPublicationCheck(check) {
  const wallet = '0x' + '11'.repeat(20);
  const button = { innerHTML: 'Publish Artwork', textContent: 'Publish Artwork', dataset: {},
    setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; } };
  const hint = { textContent: '' };
  const file = {};
  const attempt = { publicationId: '11111111-1111-4111-8111-111111111111', wallet,
    coreAddress: '0x' + 'aa'.repeat(20), metadataUri: 'https://fixture.test/original.json',
    file, message: 'A publication attempt is saved.' };
  const sandbox = vm.createContext({
    console, selectedFile: file, pendingPublicationAttempt: attempt, uploading: false, wallet,
    latestAIValuation: null, latestAIValuationFormKey: '', authorizedWalletAddress: '',
    aiValuationController: null, authorizationInProgress: false, BASE_SEPOLIA_CHAIN_ID: 84532,
    document: { getElementById: id => ({ publishBtn: button, publishReadinessHint: hint })[id] },
    window: { getCurrentWalletAddress: () => sandbox.wallet, ensureAuthenticated: async () => true,
      ArtSoulArtworkUrl: { artworkPath: id => '/artwork/' + id } },
    checkBrowserPublication: check, clearBlockingStep() {}, updatePrePublishAction() {},
    getFormCompletionError: () => 'Enter a title for your artwork.', getAIValuationFormKey: () => 'changed',
    // A check must exit the submit handler before reading or validating the new form.
    getUploadFormValues() { assert.fail('Check attempted to read the publish form'); },
    prepareBrowserPublication() { assert.fail('Check attempted new preparation'); },
    navigateAfterPublish: url => { sandbox.destination = url; }
  });
  for (const name of ['createUploadError', 'currentPublicationAttempt', 'publicationCheckMessage',
    'setTransactionButtonProcessing', 'restoreTransactionButton', 'updatePublishReadiness',
    'checkSavedPublication', 'handleUpload']) {
    vm.runInContext(extractFunction(name), sandbox);
  }
  return { sandbox, button, hint, attempt, wallet };
}

function loadSavedPublicationPanel(check) {
  const f = loadPublicationCheck(check);
  const {sandbox, attempt} = f;
  function element() {
    return {children:[], listeners:{}, style:{}, dataset:{}, innerHTML:'Check publication', textContent:'',
      append(...nodes){this.children.push(...nodes);}, replaceChildren(){this.children=[];},
      addEventListener(name,fn){this.listeners[name]=fn;},
      setAttribute(name,value){this[name]=value;}, removeAttribute(name){delete this[name];}};
  }
  const panel=element(), list=element(), error=element();
  const get=sandbox.document.getElementById;
  sandbox.document.getElementById=id=>({savedPublications:panel,savedPublicationsList:list,savedPublicationsError:error})[id]||get(id);
  sandbox.document.createElement=element;
  sandbox.savedPublicationScope='';sandbox.savedPublicationSnapshot='';sandbox.savedPublicationGeneration=0;
  sandbox.pendingPublicationAttempt=null;sandbox.selectedFile=null;
  sandbox.window.ARTSOUL_CONTRACTS={baseSepolia:{core:attempt.coreAddress}};
  let candidates=[{...attempt,title:'Original saved artwork',file:undefined}];
  sandbox.readBrowserPublications=({wallet})=>wallet===attempt.wallet?candidates.map(row=>({...row})):[];
  vm.runInContext(extractFunction('refreshSavedPublications'),sandbox);
  return {...f,panel,list,error,set candidates(value){candidates=value;},
    refresh:()=>sandbox.refreshSavedPublications(true), click:i=>list.children[i].children[2].listeners.click()};
}

test('reloaded candidates need no file and require explicit selection before authentication or checking', async () => {
  const seen=[];const f=loadSavedPublicationPanel(async args=>{seen.push(args.publicationId);return {recovery:{state:'unresolved'}};});
  let auth=0;f.sandbox.window.ensureAuthenticated=async()=>{auth++;return true;};
  const second={...f.attempt,publicationId:'22222222-2222-4222-8222-222222222222',title:'<img onerror=alert(1)>'};
  f.candidates=[{...f.attempt,title:'First'},second];f.refresh();
  assert.equal(f.panel.hidden,false);assert.equal(f.list.children.length,2);assert.equal(auth,0);assert.deepEqual(seen,[]);
  assert.equal(f.list.children[1].children[0].textContent,second.title);
  assert.match(f.list.children[0].children[1].textContent,/status has not been checked/);
  await f.click(1);assert.deepEqual(seen,[second.publicationId]);assert.equal(auth,1);
  assert.match(f.list.children[1].children[1].textContent,/not been confirmed/);
  assert.equal(f.sandbox.selectedFile,null);
});

test('a saved row reads the latest hash before an explicit check and fences a changed record', async () => {
  const seen=[];const f=loadSavedPublicationPanel(async args=>{seen.push(args.reportedTransactionHash);return {recovery:{state:'unresolved'}};});
  f.refresh();const hash='0x'+'dd'.repeat(32);f.candidates=[{...f.attempt,reportedTransactionHash:hash}];
  await f.click(0);assert.deepEqual(seen,[hash]);
  f.candidates=[{...f.attempt,metadataUri:'https://fixture.test/changed.json'}];
  await f.click(0);assert.deepEqual(seen,[hash]);assert.match(f.list.children[0].children[1].textContent,/changed or could not be read/);
});

test('wallet switch and return during a saved check cannot revive the old response', async () => {
  let resolve,started;const ready=new Promise(done=>{started=done;});
  const f=loadSavedPublicationPanel(()=>new Promise(done=>{resolve=done;started();}));
  f.refresh();const running=f.click(0);await ready;
  f.sandbox.wallet='0x'+'22'.repeat(20);f.refresh();assert.equal(f.panel.hidden,true);assert.equal(f.list.children.length,0);
  f.sandbox.wallet=f.wallet;f.refresh();
  resolve({recovery:{state:'registered',registered_artwork_id:'36'}});await running;
  assert.equal(f.sandbox.destination,undefined);assert.match(f.list.children[0].children[1].textContent,/status has not been checked/);
});

test('unchanged pageshow or unrelated storage refresh preserves an in-flight check and its button', async () => {
  let resolve,started;const ready=new Promise(done=>{started=done;});
  const f=loadSavedPublicationPanel(()=>new Promise(done=>{resolve=done;started();}));
  f.refresh();const row=f.list.children[0],generation=f.sandbox.savedPublicationGeneration;
  const running=f.click(0);await ready;f.refresh();f.refresh();
  assert.equal(f.sandbox.savedPublicationGeneration,generation);assert.equal(f.list.children[0],row);
  resolve({recovery:{state:'registered',registered_artwork_id:'36'}});await running;
  assert.equal(f.sandbox.destination,'/artwork/v41:84532:36');
});

test('a removed saved candidate invalidates its pending response', async () => {
  let resolve,started;const ready=new Promise(done=>{started=done;});
  const f=loadSavedPublicationPanel(()=>new Promise(done=>{resolve=done;started();}));
  f.refresh();const running=f.click(0);await ready;f.candidates=[];f.refresh();
  resolve({recovery:{state:'registered',registered_artwork_id:'36'}});await running;
  assert.equal(f.sandbox.destination,undefined);assert.equal(f.panel.hidden,true);
});

test('unreadable storage displays a bounded warning and cannot start a check', () => {
  const f=loadSavedPublicationPanel(()=>assert.fail('No check'));f.refresh();
  f.sandbox.readBrowserPublications=()=>{throw Error('unreadable');};f.refresh();
  assert.equal(f.panel.hidden,false);assert.equal(f.error.hidden,false);assert.equal(f.list.children.length,0);
  assert.match(f.error.textContent,/Keep this browser data/);
});

test('saved preparation without a recorded send is not described as a broadcast transaction', async () => {
  const f=loadSavedPublicationPanel(async()=>({claim_status:'claimed',submission_started_at:null,recovery:{state:'unresolved'}}));
  f.refresh();await f.click(0);
  assert.match(f.list.children[0].children[1].textContent,/no registration request is recorded yet/);
  assert.equal(f.sandbox.destination,undefined);
});

test('a pending attempt is checkable without a valid form, authorization stamp or current AI', async () => {
  let checks = 0;
  const { sandbox, button, hint, attempt } = loadPublicationCheck(async args => {
    checks++;
    args.assertCurrent();
    assert.equal(args.publicationId, attempt.publicationId);
    assert.equal(args.metadataUri, attempt.metadataUri);
    assert.equal(args.wallet, attempt.wallet);
    assert.equal(args.coreAddress, attempt.coreAddress);
    return { recovery: { state: 'unresolved' } };
  });
  sandbox.updatePublishReadiness('Ready to publish.');
  assert.equal(button.textContent, 'Check publication');
  assert.equal(button.disabled, false);
  assert.equal(button['aria-disabled'], 'false');
  assert.doesNotMatch(hint.textContent, /Ready to publish/);
  await sandbox.handleUpload();
  await sandbox.handleUpload();
  assert.equal(checks, 2);
  assert.match(hint.textContent, /not been confirmed/);
  assert.equal(button.textContent, 'Check publication');
  assert.equal(sandbox.pendingPublicationAttempt, attempt);
  assert.equal(sandbox.destination, undefined);
});

test('blur and repeated readiness updates preserve the check button text node for the first tap', () => {
  const { sandbox, button } = loadPublicationCheck(async () => {});
  let writes = 0, label = 'Publish Artwork';
  Object.defineProperty(button, 'textContent', {
    get: () => label, set(value) { writes++; label = value; }
  });
  sandbox.updatePublishReadiness();
  sandbox.updatePublishReadiness();
  sandbox.updatePublishReadiness();
  assert.equal(label, 'Check publication');
  assert.equal(writes, 1);
});

test('unresolved, reverted and conflict results have distinct persistent explanations', async () => {
  for (const [state, expected] of [['unresolved', /not been confirmed/], ['reverted', /transaction reverted/],
    ['conflict', /conflicting publication records/]]) {
    const { sandbox, hint, button } = loadPublicationCheck(async () => ({ recovery: { state } }));
    await sandbox.handleUpload();
    assert.match(hint.textContent, expected);
    sandbox.updatePublishReadiness();
    assert.match(hint.textContent, expected);
    assert.equal(button.textContent, 'Check publication');
    assert.equal(sandbox.destination, undefined);
  }
});

test('failed checks retain the attempt and never fall through to publishing', async () => {
  for (const code of ['RATE_LIMITED', 'UNAUTHENTICATED', 'MEDIA_PREPARATION_UNAVAILABLE', 'MEDIA_PREPARATION_MISMATCH']) {
    const { sandbox, hint, button, attempt } = loadPublicationCheck(async () => { throw { code }; });
    await sandbox.handleUpload();
    assert.equal(sandbox.pendingPublicationAttempt, attempt);
    assert.match(hint.textContent, /retained; no new transaction was sent/);
    if (code === 'UNAUTHENTICATED') assert.match(hint.textContent, /sign in with the creator wallet/);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Check publication');
    assert.equal(sandbox.destination, undefined);
  }
});

test('check context is isolated to the original wallet and selected file', () => {
  const { sandbox, button, hint, wallet, attempt } = loadPublicationCheck(async () => {});
  sandbox.updatePublishReadiness();
  sandbox.wallet = '0x' + '22'.repeat(20);
  sandbox.updatePublishReadiness();
  assert.equal(button.textContent, 'Publish Artwork');
  assert.doesNotMatch(hint.textContent, /attempt is saved/);
  sandbox.wallet = wallet;
  sandbox.selectedFile = {};
  sandbox.updatePublishReadiness();
  assert.equal(button.textContent, 'Publish Artwork');
  sandbox.selectedFile = attempt.file;
  sandbox.updatePublishReadiness();
  assert.equal(button.textContent, 'Check publication');
});

test('an old check cannot redirect or render its state after a wallet or file change', async () => {
  for (const change of ['wallet', 'file']) {
    let resolve, started;
    const didStart = new Promise(done => { started = done; });
    const { sandbox, hint, button } = loadPublicationCheck(() => new Promise(done => { resolve = done; started(); }));
    const running = sandbox.handleUpload();
    await didStart;
    assert.equal(button.disabled, true);
    if (change === 'wallet') sandbox.wallet = '0x' + '22'.repeat(20);
    else sandbox.selectedFile = {};
    resolve({ recovery: { state: 'registered', registered_artwork_id: '36' } });
    await running;
    assert.equal(sandbox.destination, undefined);
    assert.equal(button.disabled, false);
    assert.doesNotMatch(hint.textContent, /attempt is saved|registered/);
  }
});

test('repeated clicks during a pending check make only one request', async () => {
  let checks = 0, resolve;
  const { sandbox } = loadPublicationCheck(() => { checks++; return new Promise(done => { resolve = done; }); });
  const running = sandbox.handleUpload();
  await sandbox.handleUpload();
  assert.equal(checks, 1);
  resolve({ recovery: { state: 'unresolved' } });
  await running;
});

test('verified recovery opens the exact artwork without submitting an auction', async () => {
  const id = '9007199254740993';
  const { sandbox } = loadPublicationCheck(async () => ({ recovery: { state: 'registered', registered_artwork_id: id } }));
  await sandbox.handleUpload();
  assert.equal(sandbox.destination, '/artwork/v41:84532:' + id);
});

test('an explicit check renews wallet authentication before reading the saved attempt', async () => {
  const calls = [];
  const { sandbox } = loadPublicationCheck(async () => { calls.push('check'); return { recovery: { state: 'unresolved' } }; });
  sandbox.window.ensureAuthenticated = async () => { calls.push('authenticate'); return true; };
  await sandbox.handleUpload();
  assert.deepEqual(calls, ['authenticate', 'check']);
});

test('declined sign-in retains a retry action without a publication request', async () => {
  const { sandbox, hint, button, attempt } = loadPublicationCheck(async () => assert.fail('Unauthenticated check'));
  sandbox.window.ensureAuthenticated = async () => false;
  await sandbox.handleUpload();
  assert.equal(button.textContent, 'Check publication');
  assert.match(hint.textContent, /approve sign-in in your wallet/);
  assert.equal(sandbox.pendingPublicationAttempt, attempt);
});

test('a wallet change during sign-in never checks or opens the original wallet publication', async () => {
  const { sandbox } = loadPublicationCheck(async () => assert.fail('Wrong-wallet check'));
  sandbox.window.ensureAuthenticated = async () => { sandbox.wallet = '0x' + '22'.repeat(20); return true; };
  await sandbox.handleUpload();
  assert.equal(sandbox.destination, undefined);
});
