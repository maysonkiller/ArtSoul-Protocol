import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('the configured wallet theme uses system fonts without external font preloads', async () => {
    const source = readFileSync(new URL('../appkit-init.js', import.meta.url), 'utf8');
    const match = source.match(/themeVariables:\s*(\{[^}]+\})/);
    assert.ok(match, 'AppKit must supply theme variables before initialization');
    const variables = vm.runInNewContext(`(${match[1]})`, {
        getThemeValue: (_name, fallback) => fallback,
        fallbackAccent: 'currentColor',
        fallbackAccentMix: 'currentColor'
    });
    assert.match(variables['--w3m-font-family'], /system-ui/);

    // Exercise the installed SDK, including its conditional preload behavior.
    const { initializeTheming } = await import('../node_modules/@reown/appkit-ui/dist/esm/src/utils/ThemeUtil.js');
    const elements = [];
    const previousDocument = globalThis.document;
    globalThis.document = {
        createElement: tagName => ({ tagName, removeAttribute() {} }),
        head: {
            appendChild: element => elements.push(element),
            removeChild: element => {
                const index = elements.indexOf(element);
                if (index >= 0) elements.splice(index, 1);
            }
        }
    };
    try {
        initializeTheming({});
        assert.ok(elements.some(element => element.rel === 'preload' && element.as === 'font'),
            'the default SDK theme reproduces the external preload behavior');
        elements.length = 0;
        initializeTheming(variables);
        assert.equal(elements.some(element => element.rel === 'preload' && element.as === 'font'), false);
        assert.equal(elements.some(element => element.textContent?.includes('fonts.reown.com')), false);
        assert.ok(elements.some(element => element.textContent?.includes('system-ui')));
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});
