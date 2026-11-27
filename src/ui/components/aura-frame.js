/**
 * Presentation only. The caller must supply one already-authorized aura kind.
 * This helper never derives eligibility from artwork metadata or profile claims.
 * Use the same class string on a preview or contained detail-media wrapper.
 */
export function auraFrameClassName(kind = 'none') {
    switch (kind) {
        case 'platform':
        case 'genesis':
        case 'partner':
            return `artsoul-aura-frame artsoul-aura-frame--${kind}`;
        default:
            return '';
    }
}

export const auraFrameLabels = Object.freeze({
    platform: 'ArtSoul platform NFT',
    genesis: 'Genesis aura',
    partner: 'Partner collection NFT'
});

export const auraWords = Object.freeze({platform: 'ArtSoul', genesis: 'Genesis', partner: 'ArtSoul Partner'});

// Both text paths share a start at the middle of the upper-left corner.
// Reversing the lower half keeps the title readable after the corner.
function roundedPerimeter(width, height, inset, radius, backwards) {
    const l = inset, t = inset, r = width - inset, b = height - inset;
    const k = radius, halfArc = k * (1 - Math.SQRT1_2);
    const seam = [l + halfArc, t + halfArc];
    const points = [seam, [l+k,t], [r-k,t], [r,t+k], [r,b-k], [r-k,b],
        [l+k,b], [l,b-k], [l,t+k], seam];
    const edges = points.slice(1).map((end, i) => ({from: points[i], end, arc: i % 2 === 0}));
    if (backwards) edges.reverse();
    const loop = edges.map(edge => {
        const point = backwards ? edge.from : edge.end;
        return (edge.arc ? `A${k},${k} 0 0 ${backwards ? 0 : 1} ` : 'L') + point.join(',');
    }).join(' ');
    // A centered word can straddle the start or end without losing letters.
    return 'M' + seam.join(',') + ' ' + (loop + ' ').repeat(3);
}

let trackId = 0;
function svgNode(name, attributes = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
}

if (globalThis.customElements && globalThis.ResizeObserver && !customElements.get('artsoul-aura-track')) {
    const tracks = new Set();
    const resize = new ResizeObserver(entries => {
        for (const {target, contentRect} of entries) {
            if (!tracks.has(target)) continue;
            target.size = contentRect;
            target.updatePlayback();
        }
    });
    const viewport = globalThis.IntersectionObserver && new IntersectionObserver(entries => {
        for (const {target, isIntersecting} of entries) {
            if (!tracks.has(target)) continue;
            target.inView = isIntersecting;
            target.updatePlayback();
        }
    });
    const syncPage = () => { for (const track of tracks) track.updatePlayback(); };
    customElements.define('artsoul-aura-track', class extends HTMLElement {
        connectedCallback() {
            if (!tracks.size) document.addEventListener('visibilitychange', syncPage);
            tracks.add(this);
            this.inView = !viewport;
            resize.observe(this);
            viewport?.observe(this);
        }
        disconnectedCallback() {
            tracks.delete(this);
            resize.unobserve(this);
            viewport?.unobserve(this);
            if (!tracks.size) document.removeEventListener('visibilitychange', syncPage);
            this.firstElementChild?.pauseAnimations();
            this.removeAttribute('data-running');
            this.size = null;
        }
        updatePlayback() {
            const {width, height} = this.size || {};
            if (!width || !height || !this.inView || document.hidden) {
                this.firstElementChild?.pauseAnimations();
                this.removeAttribute('data-running');
                return;
            }
            if (!this.firstElementChild || this.drawnWidth !== width || this.drawnHeight !== height) {
                this.draw(this.size);
            }
            if (this.firstElementChild) {
                this.firstElementChild.unpauseAnimations();
                this.setAttribute('data-running', '');
            }
        }
        draw({width, height}) {
            const word = this.getAttribute('data-word');
            if (!width || !height || !Object.values(auraWords).includes(word)) {
                this.replaceChildren();
                return;
            }
            const inset = (parseFloat(getComputedStyle(this).fontSize) + 3) / 2;
            const radius = Math.max(1, Math.min(width/2, height/2, parseFloat(getComputedStyle(this.parentElement).borderTopLeftRadius)) - inset);
            const length = 2 * (width + height - 4 * inset - 4 * radius) + 2 * Math.PI * radius;
            const dur = `${length / 48}s`;
            const fraction = this.firstElementChild ? (this.firstElementChild.getCurrentTime() % this.lap) / this.lap : 0;
            const svg = svgNode('svg', {width:'100%', height:'100%', 'aria-hidden':'true'});
            const defs = svgNode('defs');
            svg.append(defs);
            const id = ++trackId;
            for (const backwards of [false, true]) {
                const pathId = `artsoul-track-${id}-${Number(backwards)}`;
                defs.append(svgNode('path', {id:pathId, d:roundedPerimeter(width, height, inset, radius, backwards)}));
                const label = svgNode('text', {'text-anchor':'middle', dy:'.34em'});
                const textPath = svgNode('textPath', {href:'#'+pathId, startOffset:backwards?'66.666667%':'33.333333%'});
                textPath.textContent = word;
                const repeat = {dur, repeatCount:'indefinite'};
                textPath.append(svgNode('animate', {...repeat, attributeName:'startOffset',
                    values:backwards?'66.666667%;33.333333%':'33.333333%;66.666667%'}));
                label.append(textPath, svgNode('animate', {...repeat, attributeName:'opacity',
                    keyTimes:'0;.006;.494;.506;.994;1', values:backwards?'.5;0;0;1;1;.5':'.5;1;1;0;0;.5'}));
                svg.append(label);
            }
            this.replaceChildren(svg);
            this.drawnWidth = width;
            this.drawnHeight = height;
            this.lap = length / 48;
            svg.setCurrentTime(fraction * this.lap);
        }
    });
}

// The caption stays decorative. Its parent exposes the full provenance label.
export function auraCaption(h, word) {
    if (!Object.values(auraWords).includes(word)) return null;
    return h('span', {className: 'artsoul-aura-caption', 'aria-hidden': 'true'},
        h('span', {className: 'aura-word'}, word),
        word === auraWords.genesis ? null : h('artsoul-aura-track', {'data-word': word}));
}

export function projectedArtworkAura(artwork) {
    if (artwork?.source === 'v41_projection' && artwork.chain_id === 84532 &&
        artwork.minted === false && artwork.platform_publication_verified === true) {
        return {className:'artsoul-aura-frame artsoul-publisher-frame', label:'Published by ArtSoul'};
    }
    if (artwork?.source !== 'v41_projection' || artwork.minted !== true ||
        (artwork.ownership_status !== 'verified' &&
            !(artwork.aura_kind === 'platform' && artwork.chain_id === 84532 && artwork.platform_origin_verified === true))) return null;
    const kind = artwork.aura_kind;
    const chain = artwork.chain_id;
    if (![8453, 84532, '8453', '84532'].includes(chain) ||
        (kind === 'genesis' && Number(chain) !== 8453)) return null;
    const className = auraFrameClassName(kind);
    return className ? { className, label: auraFrameLabels[kind],
        ...(artwork.aura_border_text === true ? { borderLabel: auraWords[kind] } : {}) } : null;
}
