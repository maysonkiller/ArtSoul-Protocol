// Run after the site build. Playwright needs Chromium and WebKit installed.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright-core');
const dist = path.resolve(process.env.ARTSOUL_QA_DIST || 'dist');
const origin = 'https://fixture.artsoul.test';
const image = 'https://bexigvqrunomwtjsxlej.supabase.co/storage/v1/object/public/artworks/track.png';
const artist = '0x' + '1'.repeat(40);
const artwork = {
    id:'v41:84532:13', chain_id:84532, artwork_id:'13', blockchain_id:'13', source:'v41_projection',
    minted:true, status:'sold', token_id:'1', aura_kind:'platform', aura_border_text:true, ownership_status:'verified',
    title:'Track study', creator:artist, creator_id:artist, current_owner_address:artist, creator_name:'Test artist',
    media_type:'image', file_type:'image', image, media_url:image, file_url:image, floor_price:'0.001'
};
const mime = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png'};

async function serveBuild(route) {
    const url = new URL(route.request().url());
    if (route.request().resourceType() === 'media') return route.abort();
    if (url.host === new URL(image).host && route.request().resourceType() === 'image') {
        return route.fulfill({path:path.resolve('public/brand/artsoul-audio-cover-384.webp'),contentType:'image/webp'});
    }
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:url.pathname === '/api/public/artworks'
        ? {success:true, data:[artwork], count:1, warnings:[]} : {}});
    const file = path.resolve(dist, '.' + url.pathname);
    if (!file.startsWith(dist + path.sep)) return route.abort();
    const ext = path.extname(file);
    // Vercel serves the unbundled public scripts alongside Vite assets.
    const relative = path.relative(dist,file);
    for (const source of [file,...(['.js','.css'].includes(ext)?[path.resolve(relative)]:[])]) {
        try {
            const body = await fs.readFile(source);
            return route.fulfill({body,contentType:mime[ext] || 'application/octet-stream'});
        } catch {}
    }
    return route.abort();
}

// Sample the browser's actual glyph geometry. Decoding path coordinates alone
// would miss dropped letters and WebKit layout errors at a path boundary.
function measure(track) {
    const svg = track.querySelector('svg');
    svg.pauseAnimations();
    const path = svg.querySelector('path'), labels = [...svg.querySelectorAll('text')];
    const length = path.getTotalLength() / 3, seconds = parseFloat(svg.querySelector('animate').getAttribute('dur'));
    const bounds = svg.getBoundingClientRect(), w = bounds.width, h = bounds.height;
    function sample(fraction) {
        svg.setCurrentTime(((fraction + 1) % 1) * seconds);
        const word = labels.reduce((a,b) => +getComputedStyle(a).opacity > +getComputedStyle(b).opacity ? a : b);
        const i = Math.floor(word.getNumberOfChars()/2);
        const start = word.getStartPositionOfChar(i), end = word.getEndPositionOfChar(i);
        return {x:(start.x+end.x)/2, y:(start.y+end.y)/2, angle:word.getRotationOfChar(i),
            opacity:+getComputedStyle(word).opacity, wordLength:word.getComputedTextLength(), chars:word.getNumberOfChars()};
    }
    function nearest(x,y) {
        let best = 0, minimum = Infinity;
        for (let at=0; at<length; at+=2) {
            const p = path.getPointAtLength(at), d = Math.hypot(x-p.x,y-p.y);
            if (d<minimum) {minimum=d;best=at;}
        }
        return best / length;
    }
    const sides = [[w/2,0],[w,h/2],[w/2,h],[0,h/2]].map(([x,y]) => {
        const t = nearest(x,y), a = sample(t), b = sample(t+0.25/seconds);
        return {angle:a.angle, speed:Math.hypot(a.x-b.x,a.y-b.y)*4};
    });
    let maxCornerStep = 0, minOpacity = 1;
    for (const [x,y] of [[0,0],[w,0],[w,h],[0,h]]) {
        const t = nearest(x,y);
        let previous;
        for (let i=-12; i<=12; i++) {
            const p = sample(t+i/24/seconds);
            if (p.chars !== 7 || p.wordLength < 15) throw Error('Letters lost at corner');
            if (previous) maxCornerStep = Math.max(maxCornerStep, Math.hypot(p.x-previous.x,p.y-previous.y));
            minOpacity = Math.min(minOpacity,p.opacity);
            previous=p;
        }
    }
    const top = nearest(w/2,0);
    const middle = sample(top);
    return {sides,maxCornerStep,minOpacity, speed:length/seconds,top,
        clear:!track.contains(document.elementFromPoint(bounds.left+middle.x,bounds.top+middle.y)),w,h};
}

async function sampleInk(page, track) {
    const style=await page.addStyleTag({content:'.future .artsoul-aura-frame::after { animation: none !important; }'});
    const frame=track.locator('xpath=../..');
    const shot=async()=> (await frame.screenshot({scale:'css'})).toString('base64');
    const ink=await shot();
    await track.evaluate(el=>el.style.visibility='hidden');
    const strip=await shot();
    await track.evaluate(el=>el.parentElement.style.visibility='hidden');
    const original=await shot();
    await track.evaluate(el=>{el.style.visibility='';el.parentElement.style.visibility='';});
    await style.evaluate(el=>el.remove());
    const matched=await page.evaluate(async buffers=>{
        const pixels=await Promise.all(buffers.map(async buffer=>{
            const img=new Image();img.src='data:image/png;base64,'+buffer;await img.decode();
            const canvas=document.createElement('canvas'); canvas.width=120;canvas.height=26;
            const ctx=canvas.getContext('2d');
            ctx.drawImage(img,-Math.round(img.width/2)+60,0);
            return ctx.getImageData(0,0,120,26).data;
        }));
        const [ink,strip,original]=pixels;
        let matches=0;
        for(let i=0; i<ink.length;i+=4) {
            const delta=(a,b)=>Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])));
            if(delta(ink,strip)>40 && delta(ink,original)<12) matches++;
        }
        return matches;
    },[ink,strip,original]);
    assert(matched>=4,`Expected solid glyph pixels matching the underlying gradient; got ${matched}`);
    return matched;
}

async function run(engine) {
    const name = engine.name();
    const opts = name === 'chromium' ? {channel:process.env.CHROMIUM_CHANNEL,args:['--mute-audio']}
        : {executablePath:process.env.WEBKIT_EXECUTABLE_PATH};
    const browser = await engine.launch(opts);
    try {
        const mobile = name === 'webkit';
        const context = await browser.newContext({viewport:mobile?{width:430,height:932}:{width:1440,height:960},isMobile:mobile,hasTouch:mobile});
        await context.addInitScript(()=>localStorage.setItem('artsoul_theme','future'));
        await context.route('**/*', serveBuild);
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        for (const [route,selector] of [
            ['/index.html','.home-showcase-slide'],['/gallery.html#nft','.artsoul-artwork-card'],['/artwork.html?id=13','.artwork-detail-frame']
        ]) {
            await page.goto(origin+route, {waitUntil:'domcontentloaded'});
            const track = page.locator(selector + ' > .artsoul-aura-caption > artsoul-aura-track').first();
            await track.scrollIntoViewIfNeeded();
            await track.locator('svg').waitFor({state:'visible'});
            const r = await track.evaluate(measure);
            console.log(name,selector,JSON.stringify(r));
            assert(Math.abs(r.speed-48)<0.25 && r.sides.every(s=>Math.abs(s.speed-48)<2), 'Uniform speed');
            assert(r.sides.every((s,i)=>Math.abs((s.angle-(i%2?90:0)+540)%360-180)<2), 'Reading direction');
            assert(r.minOpacity>=.48 && r.maxCornerStep<22 && r.clear,'Continuous, click-through corners');
            if (process.env.ARTSOUL_QA_SHOTS) await page.screenshot({path:path.join(process.env.ARTSOUL_QA_SHOTS,name+'-'+selector.slice(1)+'.png')});
            if(selector==='.artwork-detail-frame') console.log(name,'matching ink pixels', await sampleInk(page,track));
        }
        const track = page.locator('.artwork-detail-frame artsoul-aura-track').first();
        await track.evaluate(el=>{document.body.style.paddingBottom='300vh';window.scrollTo(0,document.body.scrollHeight);});
        await page.waitForFunction(()=>!document.querySelector('.artwork-detail-frame artsoul-aura-track').hasAttribute('data-running'));
        assert(await track.evaluate(el=>el.firstElementChild.animationsPaused()));
        await track.scrollIntoViewIfNeeded();
        await page.waitForFunction(()=>document.querySelector('.artwork-detail-frame artsoul-aura-track').hasAttribute('data-running'));
        assert(!await track.evaluate(el=>el.firstElementChild.animationsPaused()));
        await page.emulateMedia({reducedMotion:'reduce'});
        assert(await page.locator('.artwork-detail-frame .aura-word').isVisible());
        assert(!await track.isVisible());
        await page.emulateMedia({reducedMotion:'no-preference'});
        const staticGenesis = await page.evaluate(()=>{
            const frame=document.querySelector('.artwork-detail-frame');
            const label=window.ArtSoulArtworkCard.createAuraCaption('Genesis');
            frame.replaceChildren(label);
            const staticWord=label.querySelector('.aura-word');
            const genesis=staticWord.checkVisibility() && !label.querySelector('svg,artsoul-aura-track') && !staticWord.getAnimations().length;
            document.body.classList.replace('future','classic');
            document.documentElement.classList.replace('future','classic');
            return genesis && getComputedStyle(label).display==='none';
        });
        assert(staticGenesis,'Genesis and Classic static');
    } finally { await browser.close(); }
}
(async()=>{await run(chromium);await run(webkit);})().catch(error=>{console.error(error);process.exitCode=1;});
