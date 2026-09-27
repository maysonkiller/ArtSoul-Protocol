# A-48 — how to measure the Back repaint, and what counts as a pass

A-48 asks whether browser Back restores the previous page from the back/forward
cache or rebuilds the document. The difference is what the founder reported as a
single full-document repaint: a restored page reappears instantly with its scroll
position and DOM intact, a rebuilt one repaints from nothing.

The cause found on 2026-08-13 was application-owned: leaving the gallery while
full-size card images were still in flight tripped `NetworkExceedsBufferLimit`,
and Chrome refused the cache. PR #203 deferred every shared card image. **That
fix is complete in code** — all three shared card image paths and both gallery
fallbacks carry `loading="lazy"` and `decoding="async"`, verified 2026-09-14.

What is left is measurement, and it has to happen in a real browser.

## Why this cannot be measured from an embedded browser

Embedded browser views commonly disable the back/forward cache entirely, so a
negative result there says nothing about production. A probe run on 2026-09-14
from one such view saw a rebuilt document on every Back, including when the page
was left after 250 ms, before the wallet runtime had even started. That is
consistent with the cache being unavailable in that view rather than with a
defect on the site, and it is exactly why this file exists instead of a verdict.

Run it in the same Chrome a visitor would use.

## The probe

Two navigations and a page-restoration marker. About a minute.

**1.** Open `https://artsoulprotocol.com/gallery` in a normal window, wait for
cards to appear, then open DevTools (F12) and run in the Console:

```js
window.__bfProbe = 'marker-' + Date.now();
window.__bfRestored = false;
window.addEventListener('pageshow', event => {
  window.__bfRestored = event.persisted;
});
```

**2.** Navigate to `https://artsoulprotocol.com/docs-protocol`, wait two seconds,
then press the browser Back button — the button, not a link.

**3.** In the Console on the gallery again, run:

```js
JSON.stringify({
  marker: typeof window.__bfProbe === 'string' ? window.__bfProbe : 'LOST',
  restored: window.__bfRestored === true,
  navType: performance.getEntriesByType('navigation')[0]?.type,
  notRestoredReasons: performance.getEntriesByType('navigation')[0]?.notRestoredReasons
})
```

## Reading the result

| `marker` | `restored` | Meaning |
| --- | --- | --- |
| `marker-…` | `true` | **Restored from cache.** The same document survived and `pageshow.persisted` confirms restoration. |
| `LOST` | `false`, with `navType: back_forward` | **Rebuilt history navigation.** Continue below to record why the cache was not used. |
| Any other combination | Any | **Inconclusive.** Verify that the probe was installed before a full document navigation and that browser Back was used. |

Corrected 2026-09-27: `navType` is diagnostic only. A restored document retains
its original navigation timing entry, so `navigate` can accompany a successful
restoration. It must not be classified as a failed Back action. A null or missing
`notRestoredReasons` also does not prove success. See the browser maintainers'
[restoration/performance guidance](https://web.dev/articles/bfcache#performance_measurement)
and [not-restored diagnostics](https://developer.chrome.com/docs/web-platform/bfcache-notrestoredreasons/).

A pass needs the marker to survive on **desktop, iOS and Android**. The iOS run
matters most: WebKit first reproduced this, and its cache rules differ from
Chrome's.

## If it comes back `LOST`

Chrome names the reason itself, so do not guess:

1. DevTools → **Application** → **Back/forward cache**
2. Press **Test back/forward cache**
3. Chrome navigates away and back, then lists every blocking reason by name

Paste that list. `NetworkExceedsBufferLimit` would mean transfers are still the
cause and the deferral has a path it missed. Anything else — an open socket, an
`unload` handler, a `no-store` document — is a different defect and gets its own
row rather than being folded into this one.

Repository-side checks already done, so they need not be repeated: no `unload`
listener exists anywhere in shipped code; deliberate `beforeunload` warnings
cover unfinished uploads and unsaved collection drafts, and Chrome
does not refuse the cache for `beforeunload` alone; the document responds
`public, max-age=0, must-revalidate`, which is cacheable, not `no-store`.

## Recording the result

Add the outcome per device to the RG-01 acceptance sheet rather than to this
file. This one describes the method; the dated sheet carries the evidence.
