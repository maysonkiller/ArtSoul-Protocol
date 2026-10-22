const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const test = require('node:test');

const read = path => fs.readFileSync(path, 'utf8');
const withoutImports = source => source.replace(/^import[\s\S]*?;\r?\n/gm, '');
const policy = read('src/config/upload-policy.js').replace(/^export /gm, '');
const amounts = read('src/features/auction/eth-amount.js').replace(/^export /gm, '');
const upload = withoutImports(read('src/entries/upload.js')).replace(/^\s*bindUploadFlow\(\);\s*$/m, '');

function client() {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            value: '', checked: false, style: {}, dataset: {}, offsetParent: {}, disabled: false,
            classList: { add() {}, remove() {} }, setAttribute(name, value) { this[name] = value; },
            removeAttribute(name) { delete this[name]; }, scrollIntoView() {}, focus() { this.focused = true; }
        });
        return elements.get(id);
    };
    const context = vm.createContext({ console, window: { setTimeout() {} },
        document: { getElementById: element, querySelectorAll: () => [] } });
    vm.runInContext(`${policy}\n${amounts}\n${upload}`, context);
    return { context, element };
}

test('ordinary short, Unicode, numeric and formerly blacklisted artwork titles are accepted', () => {
    const { context } = client();
    for (const title of ['A', '夜', '🎨', '123', 'Untitled', 'Photo of the sea', 'Screenshot', 'test', 'Image.png']) {
        assert.equal(context.validateArtworkDetails({ title, description: 'An original work.', price: '0.001' }), null, title);
    }
    assert.equal(context.validateArtworkDetails({ title: ' \n ', description: 'An original work.', price: '0.001' }).fieldId, 'artTitle');
    assert.equal(context.validateArtworkDetails({ title: 'A', description: 'x'.repeat(1000), price: '0.001' }), null);
    assert.equal(context.validateArtworkDetails({ title: 'A', description: 'x'.repeat(1001), price: '0.001' }).fieldId, 'artDescription');
});

test('camera and screenshot names do not change client MIME or size validation', () => {
    const { context } = client();
    for (const name of ['IMG_1234.png', 'Screenshot 2026-10-22.png', 'Снимок экрана.png', 'photo_2026-10-22_17-20-00.jpg', '1234567890123.mov', '夜 🎨.png']) {
        assert.equal(context.validateArtworkFile({ name, type: 'image/png', size: 100 }), null, name);
    }
    for (const [type, size, code] of [['image/svg+xml', 100, 'UNSUPPORTED_FILE_TYPE'], ['image/png', 0, 'EMPTY_FILE'], ['image/png', 50 * 1024 * 1024 + 1, 'FILE_TOO_LARGE']]) {
        assert.equal(context.validateArtworkFile({ name: 'IMG_1234.png', type, size }).code, code);
    }
});

test('description and price failures focus their own fields and clear after correction', async () => {
    const { context, element } = client();
    vm.runInContext("selectedFile = { name: 'original.png', type: 'image/png', size: 100 }; selectedAuctionDuration = 24;", context);
    element('originalWorkConfirm').checked = true;
    element('artTitle').value = 'A';
    element('artPrice').value = '0.001';
    element('artDescription').value = 'Short';
    await context.handleUpload();
    assert.equal(element('artDescription').focused, true);
    assert.equal(element('artTitle').focused, undefined);
    assert.match(element('artDescriptionError').textContent, /12 characters/);
    assert.equal(element('artDescription')['aria-invalid'], 'true');
    context.clearBlockingStep();
    assert.equal(element('artDescriptionError').style.display, 'none');
    assert.equal(element('artDescription')['aria-invalid'], undefined);
    element('artDescription').value = 'An original work.';
    element('artPrice').value = '0';
    await context.handleUpload();
    assert.equal(element('artPrice').focused, true);
    assert.match(element('artPriceError').textContent, /greater than 0/);
});

test('upload prices use the existing exact decimal parser, including comma and one wei', () => {
    const { context, element } = client();
    for (const [input, expected] of [['0,0001', '0.0001'], ['0.000000000000000001', '0.000000000000000001']]) {
        element('artPrice').value = input;
        assert.equal(context.getUploadFormValues().price, expected);
        assert.equal(context.validateArtworkDetails({ title: 'A', description: 'An original work.', price: input }), null);
    }
    for (const price of ['0', '-1', '1e3', '0.01junk', '0.0000000000000000001', '1,2.3']) {
        assert.equal(context.validateArtworkDetails({ title: 'A', description: 'An original work.', price }).fieldId, 'artPrice', price);
    }
});

test('blurring a field preserves the pressed analysis or retry button text node', () => {
    const { context, element } = client();
    vm.runInContext("selectedFile = { name: 'IMG_1234.png', type: 'image/png', size: 100 }; selectedAuctionDuration = 24;", context);
    element('artTitle').value = 'A';
    element('artPrice').value = '0,0001';
    element('artDescription').value = 'An original work.';
    element('originalWorkConfirm').checked = true;
    context.window.getCurrentWalletAddress = () => '0xcreator';
    for (const [id, update] of [['prePublishAction', 'updatePrePublishAction'], ['aiValuationRetry', 'updateAIValuationRetryState']]) {
        let text = '', node;
        Object.defineProperty(element(id), 'textContent', {
            get: () => text,
            set: value => { text = value; node = {}; }
        });
        if (id === 'aiValuationRetry') vm.runInContext('aiValuationAttemptCount = 1;', context);
        context[update]();
        const pressedNode = node;
        context.handleUploadFormChange();
        assert.equal(node, pressedNode, `${id}: unchanged text must survive pointer-down / field-blur / pointer-up`);
    }
});

function server(authenticated = true) {
    const signed = [];
    const context = vm.createContext({ crypto, URL, console,
        allowMethods: () => true,
        requireWallet: () => { if (!authenticated) throw Object.assign(new Error('Please authenticate.'), { statusCode: 401, code: 'UNAUTHENTICATED' }); return '0x1111111111111111111111111111111111111111'; },
        readJson: async req => req.body,
        getSupabaseServiceKeyInfo: () => ({ isServiceRole: true }),
        getSupabaseStorageBaseUrl: () => 'https://storage.example.test',
        getPublicStorageUrl: (bucket, path) => `https://storage.example.test/${bucket}/${path}`,
        supabaseStorageRest: async path => { signed.push(path); return { url: '/upload?token=fixture' }; }
    });
    vm.runInContext(`${policy}\n${withoutImports(read('src/api/routes/upload/file.js')).replace('export default ', '')}`, context);
    return { signed, call: async body => {
        const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
        await context.handler({ method: 'POST', body }, response);
        return response;
    } };
}

test('signed uploads accept device filenames while keeping wallet paths safe and unique', async () => {
    const { call } = server();
    const paths = [];
    for (const file_name of ['IMG_1234.png', 'Screenshot 2026-10-22.png', 'Снимок экрана.png', '../outside/../../IMG_1234.png', '夜 🎨.png', 'IMG_1234.png']) {
        const response = await call({ file_name, content_type: 'image/png', size: 100 });
        assert.equal(response.code, 200, file_name);
        assert.match(response.body.path, /^uploads\/0x1{40}\/[\w.-]+$/);
        assert.equal(response.body.path.includes('..'), false);
        paths.push(response.body.path);
    }
    assert.equal(new Set(paths).size, paths.length);
});

test('signed uploads still enforce wallet authorization, format, size and metadata boundaries', async () => {
    const guest = server(false);
    assert.equal((await guest.call({ file_name: 'IMG_1234.png', content_type: 'image/png', size: 100 })).code, 401);
    assert.equal(guest.signed.length, 0);
    const { call, signed } = server();
    for (const body of [
        { content_type: 'image/svg+xml', size: 100 }, { content_type: 'image/png', size: 0 },
        { content_type: 'image/png', size: 50 * 1024 * 1024 + 1 },
        { kind: 'metadata', content_type: 'image/png', size: 100 },
        { kind: 'metadata', content_type: 'application/json', size: 256 * 1024 + 1 }
    ]) assert.equal((await call({ file_name: 'IMG_1234.png', ...body })).code, 400);
    assert.equal(signed.length, 0);
    assert.equal((await call({ file_name: 'IMG_1234.json', kind: 'metadata', content_type: 'application/json', size: 100 })).code, 200);
});
