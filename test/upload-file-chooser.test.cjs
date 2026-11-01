const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('upload.html', 'utf8');
const zone = html.match(/<div\b[^>]*class="upload-zone[^>]*>/)?.[0];
const picker = html.match(/<button\b[^>]*class="[^"]*upload-file-picker[^"]*"[^>]*>Choose file<\/button>/)?.[0];
assert.ok(zone && picker, 'the existing file region contains a native chooser button');
const activate = new Function('document', 'event', zone.match(/onclick="([^"]*)"/)[1]);

function chooser() {
    let opens = 0;
    const input = {
        id: 'fileInput',
        click() {
            opens++;
            assert.ok(opens < 2, 'the input click must not reopen its own picker');
            activate(document, { target: input });
        }
    };
    const document = { getElementById: id => {
        assert.equal(id, 'fileInput');
        return input;
    } };
    return { input, click: target => activate(document, { target }), opens: () => opens };
}

test('the chooser uses native button activation without submitting or duplicating key handlers', () => {
    assert.match(picker, /type="button"/);
    assert.doesNotMatch(picker, /\b(?:disabled|hidden|tabindex|onclick|onkeydown|onkeyup|onkeypress)\b/i);
    for (const id of picker.match(/aria-describedby="([^"]*)"/)[1].split(' ')) {
        assert.ok(html.includes(`id="${id}"`), `chooser description ${id} exists`);
    }
    const h = chooser();
    h.click({ tagName: 'BUTTON' });
    assert.equal(h.opens(), 1, 'the click produced by native pointer/keyboard activation opens once');
});

test('clicking the surrounding prompt or selected preview still opens the existing picker once', () => {
    for (const target of [{ id: 'uploadPrompt' }, { id: 'previewImage' }, { id: 'fileName' }]) {
        const h = chooser();
        h.click(target);
        assert.equal(h.opens(), 1);
    }
});

test('a bubbled file-input click is not treated as a new picker request', () => {
    const h = chooser();
    h.click(h.input);
    assert.equal(h.opens(), 0);
});

test('the picker stays available after the prompt is hidden and retains the file-change handler', () => {
    const promptStart = html.indexOf('<div id="uploadPrompt">');
    const selectedStart = html.indexOf('<div id="fileInfo"');
    const pickerStart = html.indexOf(picker);
    const guidanceStart = html.indexOf('<section id="aiValuationPanel"');
    assert.ok(promptStart < selectedStart && selectedStart < pickerStart && pickerStart < guidanceStart);
    assert.match(html.slice(selectedStart, pickerStart), /<\/div>\s*<\/div>\s*$/,
        'the chooser is outside the hidden selected-file container');
    const input = html.match(/<input\b[^>]*id="fileInput"[^>]*>/)[0];
    assert.match(input, /type="file"/);
    assert.match(input, /accept="image\/\*,video\/\*,audio\/\*,\.gif"/);
    assert.match(input, /onchange="handleFileSelect\(event\)"/);
});
