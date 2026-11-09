const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const artwork = fs.readFileSync('src/entries/artwork.jsx', 'utf8').replace(/\r\n/g, '\n');
const support = fs.readFileSync('src/features/artwork/artist-support.jsx', 'utf8');

for (const [state, ref] of [
    ['isReportModalOpen', 'reportDialogRef'],
    ['isResaleModalOpen', 'resaleDialogRef'],
    ['isNewAuctionModalOpen', 'newAuctionDialogRef']
]) test(`${state} opens in the native top layer without changing the page scroll root`, () => {
    const start = artwork.indexOf(`            useEffect(() => {\n                if (!${state})`);
    const end = artwork.indexOf(`}, [${state}]);`, start);
    assert.ok(start > 0 && end > start);
    const effect = artwork.slice(start, end + `}, [${state}]);`.length);
    for (const open of [false, true]) {
        let cleanup, shown = 0, closed = 0;
        const dialog = { open: false, showModal() { this.open = true; shown++; }, close() { this.open = false; closed++; } };
        vm.runInNewContext(effect, {
            [state]: open, [ref]: { current: dialog },
            useEffect: fn => { cleanup = fn(); },
            document: new Proxy({}, {get() { throw new Error('The page scroll root must not be changed'); }})
        });
        assert.equal(shown, open ? 1 : 0);
        cleanup?.();
        assert.equal(closed, open ? 1 : 0);
    }
});

test('auction cancellation aborts guidance and clears setup, but preserves a pending transaction', () => {
    const start = artwork.indexOf('function closeNewAuctionModal()');
    const end = artwork.indexOf('async function handleConfirmNewAuction', start);
    for (const busy of [true, false]) {
        const events = [];
        const controller = {abort: () => events.push('abort')};
        const context = vm.createContext({
            isTransactionActionPending: action => { assert.equal(action, 'create-auction'); return busy; },
            reauctionValuationControllerRef: {current: controller},
            auctionCreationCheckRef: {current: {context: 'approved-wallet'}},
            setAuctionCreationError: value => events.push(value),
            setIsNewAuctionModalOpen: value => events.push(value),
            newAuctionTriggerRef: {current: {focus: options => events.push({...options})}},
            window: {requestAnimationFrame: fn => fn()}
        });
        vm.runInContext(artwork.slice(start, end) + '\ncloseNewAuctionModal();', context);
        assert.deepEqual(events, busy ? [] : ['abort', '', false, {preventScroll: true}]);
        assert.equal(context.reauctionValuationControllerRef.current, busy ? controller : null);
        assert.equal(context.auctionCreationCheckRef.current.context, busy ? 'approved-wallet' : null);
    }
    assert.match(artwork, /ref=\{newAuctionDialogRef\}[\s\S]*?onCancel=\{event => \{ event.preventDefault\(\); closeNewAuctionModal\(\); \}\}/);
});

test('closing a report preserves position and refuses to interrupt submission', () => {
    const start = artwork.indexOf('function closeArtworkReport()');
    const end = artwork.indexOf('async function submitArtworkReport', start);
    for (const busy of [true, false]) {
        const events = [];
        const context = vm.createContext({
            reportSubmissionRef: {current:busy}, setIsReportModalOpen:value=>events.push(value),
            reportReturnFocusRef:{current:{focus: options=>events.push({...options})}}, reportTriggerRef:{current:null},
            window:{requestAnimationFrame:fn=>fn()}
        });
        vm.runInContext(artwork.slice(start,end)+'\ncloseArtworkReport();',context);
        assert.deepEqual(events,busy?[]:[false,{preventScroll:true}]);
    }
});

test('opening report, donation and auction setup focuses close rather than the mobile keyboard', () => {
    assert.match(artwork, /<dialog[\s\S]*?ref=\{reportDialogRef\}/);
    assert.match(artwork, /aria-label=\{reportDonationTarget \? 'Close message report' : 'Close artwork report'\}[\s\S]*?autoFocus/);
    assert.doesNotMatch(artwork, /id="artworkReportCategory"[^>]*autoFocus/);
    assert.match(artwork, /aria-label="Close new auction setup"[^>]*autoFocus/);
    assert.doesNotMatch(artwork, /id="newAuctionPrice"[^>]*autoFocus/);
    assert.match(support, /aria-label="Close donation"[\s\S]*?autoFocus/);
    assert.match(support, /type="text" inputMode="decimal"/);
    assert.match(support, /focus\(\{ preventScroll: true \}\)/);
});

test('action fields retain readable text and dialogs stay within the dynamic viewport', () => {
    const reportCss = fs.readFileSync('src/features/artwork/artwork-dialogs.css', 'utf8');
    const supportCss = fs.readFileSync('src/features/artwork/artist-support.css', 'utf8');
    assert.match(reportCss, /\.report-field[^{}]*\{[^}]*font-size: 16px/);
    assert.match(supportCss, /\.artist-support-dialog input,[^{]*\{[^}]*font-size: 16px/);
    for (const css of [reportCss, supportCss]) {
        assert.match(css, /max-height: calc\(100dvh - 2rem\)/);
        assert.match(css, /calc\(100vw - 2rem\)/);
    }
    const html=fs.readFileSync('artwork.html','utf8');
    assert.doesNotMatch(html,/maximum-scale=1|user-scalable=no/,'manual accessibility zoom remains available');
});
