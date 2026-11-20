const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const urlScript = fs.readFileSync('src/ui/artwork-url.js', 'utf8');
const origin = 'https://artsoulprotocol.com';

function openArtwork(path) {
    const elements = new Set();
    const social = { removeAttribute(name) { delete this[name]; } };
    const document = {
        getElementById: () => social,
        createElement: () => ({
            setAttribute(name, value) { this[name] = value; },
            remove() { elements.delete(this); }
        }),
        head: { appendChild: element => elements.add(element) },
        querySelector: selector => [...elements].find(element =>
            selector.startsWith('link') ? element.rel === 'canonical' : element.name === 'robots')
    };
    const window = { location: new URL(path, origin) };
    vm.runInNewContext(urlScript, { window, document, URLSearchParams });
    return {
        canonical: () => document.querySelector('link')?.href,
        robots: () => document.querySelector('meta')?.content,
        social,
        elements,
        update: window.ArtSoulArtworkUrl.updateArtworkIndexing
    };
}

test('distinct works and legacy query or path aliases have one stable public identity', () => {
    for (const [path, expectedPath] of [
        ['/artwork/7', '/artwork/7'],
        ['/artwork/38?id=7&utm_source=gallery', '/artwork/38'],
        ['/artwork?id=38&action=buy', '/artwork/38'],
        ['/artwork?v=2&id=v41%3A84532%3A38', '/artwork/38'],
        ['/artwork/v41%3A84532%3A38', '/artwork/38'],
        ['/artwork/v41:11155111:38', '/artwork?id=v41%3A11155111%3A38'],
        ['/artwork?id=v41%3A11155111%3A38&utm_source=x', '/artwork?id=v41%3A11155111%3A38']
    ]) {
        const page = openArtwork(path);
        page.update(true);
        assert.equal(page.canonical(), origin + expectedPath, path);
        assert.equal(page.social.content, page.canonical());
        assert.equal(page.robots(), undefined);
        assert.equal(page.elements.size, 1);
    }
});

test('an invalid identity or a confirmed absent/hidden record is not indexable; a recovered record is', () => {
    for (const path of ['/artwork', '/artwork?id=abc', '/artwork/0', '/artwork/38.json?id=38', '/artwork?id=v41%3A8453%3A38']) {
        const page = openArtwork(path);
        assert.equal(page.canonical(), undefined, path);
        assert.equal(page.social.content, undefined);
        assert.equal(page.robots(), 'noindex');
    }
    const page = openArtwork('/artwork/38');
    page.update(false);
    page.update(false);
    assert.equal(page.canonical(), undefined);
    assert.equal(page.robots(), 'noindex');
    assert.equal(page.elements.size, 1);
    page.update(true);
    assert.equal(page.canonical(), origin + '/artwork/38');
    assert.equal(page.robots(), undefined);
    assert.equal(page.elements.size, 1);
});

test('browser and Googlebot use the same static artwork shell; malformed path segments fall through to 404', () => {
    const human = config.rewrites.find(route => route.destination === '/artwork?id=:id');
    const social = config.rewrites.find(route => route.destination === '/api/artwork-preview?id=:id');
    function pathPattern(source) {
        assert.ok(source.startsWith('/artwork/:id('));
        return new RegExp('^/artwork/' + source.slice('/artwork/:id'.length) + '$');
    }
    assert.equal(human.has, undefined);
    assert.equal(human.source, social.source);
    assert.ok(!new RegExp(social.has[0].value).test('Googlebot/2.1'));
    const accepted = pathPattern(human.source);
    for (const path of ['38','7','v41:84532:38','v41:11155111:38','v41%3A84532%3A38']) {
        assert.ok(accepted.test('/artwork/' + path), path);
    }
    for (const suffix of ['0','38.json','38/image','38.html','v41:8453:38','7'.repeat(79)]) {
        assert.ok(!accepted.test('/artwork/' + suffix), suffix);
    }
    const edge = config.headers.find(rule => rule.headers.some(({key}) => key === 'Link'));
    const edgeMatch = pathPattern(edge.source);
    for (const path of ['/artwork/7','/artwork/38']) {
        const [, id] = edgeMatch.exec(path);
        assert.equal(edge.headers[0].value.replace(':id', id), '<' + origin + path + '>; rel="canonical"');
    }
    assert.ok(!edgeMatch.test('/artwork/38.json'));
});

test('robots permits rendering the public artwork and finding gallery links, while API responses stay out of the index', () => {
    const robots = fs.readFileSync('public/robots.txt', 'utf8');
    for (const request of [
        '/api/public/artworks?limit=100$', '/api/public/artworks?limit=200$',
        '/api/public/artworks?id=v41%3A84532%3A*&limit=1$', '/api/public/artworks?id=v41%3A11155111%3A*&limit=1$'
    ]) assert.ok(robots.includes('Allow: ' + request));
    assert.ok(robots.includes('Disallow: /api/'));
    assert.ok(config.headers.some(rule => rule.source === '/api/public/artworks' &&
        rule.headers.some(({key,value}) => key === 'X-Robots-Tag' && value === 'noindex')));
});
