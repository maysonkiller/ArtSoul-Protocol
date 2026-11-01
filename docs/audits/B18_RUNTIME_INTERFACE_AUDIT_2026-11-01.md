# Runtime and interface audit — November 1, 2026

Scope: founder-requested B18 runtime/interface review, eight product routes,
Classic/Future and responsive controls. Workspace `C:\Projects\ArtSoul`, branch
`codex/runtime-interface-audit`, base `b0317f2e6ce2c91ebec3593ece6fec20b46ead37`.
Recovery snapshot: private `b18-full-review-before.patch`. Existing B27,
checkpoint, infrastructure, authority-policy and output work is preserved.

## Findings and corrections

| Priority | Reproduction / cause | Correction / regression evidence |
|---|---|---|
| P1 | A public Profile artwork-source failure became a successful empty array; missing works could appear as zero items. A rejected configuration promise also remained permanently cached. | Strict projection reads; separate retryable error; retain only the same wallet/tab's successful cards on refresh failure. Failed config promises retire without removing concurrent/successful request reuse. Behavioral failure/race tests and eight actual rendered failure→retry→refresh-failure→retry cases pass. |
| P1 | The global capture-phase click handler disabled arbitrary buttons and re-enabled them after 500ms, independent of the real action. An empty `data-allow-rapid` attribute was treated as false. | Remove global mutation. Action-owned pending guards remain authoritative, including wallet/auth/publish/Saved/clipboard controls. Regression checks exercise synchronous handlers and asynchronous completion. |
| P2 | Personal notifications remained loading until the optional staff access/queue request finished. | Publish personal readiness independently; bounded 15s reads; abort/generation checks reject late responses; late 401 still clears private state. State regressions and rendered unread-message interaction with an unresolved staff request pass. |
| P2 | Live Home cold-load CLS measured 0.24728 when the card row displaced following sections. | Reserve only the initial real row geometry. Eight delayed-feed layouts record zero layout-shift entries, with no horizontal overflow. Empty/error states release the reservation; Retry returns six fixture cards. No fabricated cards or animated loading grid. |
| P2 | Five ordinary routes loaded disabled diagnostics, including a console-wrapping singleton and unused developer panels. | Remove 21 script tags and nine startup blocks. Developer modules remain available in source; real Admin/header/theme/auth hooks remain. Eight product entry-point guards pass. |
| P3 | The account network row displayed both the network icon and a redundant ETH icon. | One network icon and network name; balance uses ETH or test ETH text. Provider identity stays separate. Base/Ethereum and balance-refresh tests pass. |

No financial, contract, trust, role, lifecycle, billing, live-data or network
support rule changed. Canon sections 05/07/16/17 are touched only through
presentation, privacy-preserving loading and backlog evidence. User palettes
and static Classic behavior remain. No dependency was added or removed.

## Rendered acceptance

Built-page fixtures use the actual product HTML/CSS/JavaScript and synthetic
API/wallet state. They neither sign transactions nor mutate live data. Baseline
live sampling used public Home, Gallery, artwork13 and public Profile only.

| Surface | Passed assertions | Coverage |
|---|---:|---|
| Shared cards: Home, Gallery, Profile | 251 | 30 layouts; menus, long names/prices/statuses, targets, focus and overflow |
| Profile | 50 | Eight layouts; identity, five tabs, editor bounds, 16px inputs, cancel and unchanged outer geometry |
| Artwork | 566 | 14 layouts plus dialog cases; Creator/First Collector/Owner, payment, provenance, media, Donate/history and Report |
| Publish | 90 | Eight layouts; image/video/audio selection and validation; no actual publication |
| Collection draft | 266 | 24 step/layout states; save, import rejection, undo, ordering and storage failure |
| Admin | 58 | Eight layouts; protected state clears after synthetic logout |
| Guide | 70 | Eight layouts; 14 topics, anchors, disclosure and narrow-screen navigation |
| Total | 1,351 | Zero page exceptions or unexpected writes in this fixture set |

Core widths: 320, 390, 768 and 1366 CSS pixels, both themes; cards/detail also
cover additional boundaries. Separate new checks cover eight Profile outage
recoveries, eight delayed Home loads, Home empty/error/retry, and personal inbox
readiness/read interaction before the staff response. These are not native
iPhone, Phantom-extension, server-role, real-mail or on-chain acceptance claims.

Private reproducible scripts/results: `b18-runtime-qa-inventory.md`,
`b18-shared-*-check.mjs`, `b18-runtime-*-browser.json`,
`b18-runtime-recovery-browser.mjs`, `b18-runtime-home-loading-check.mjs`.
Visual review includes mobile Future Profile, desktop Classic Artwork and
desktop Publish; screenshots remain under ignored `output/playwright`.

Validation commands: `npm run build`, `npm run test:unit`; focused suites include
`product-diagnostics-loading`, `performance-control-state`,
`avatar-network-identity`, `data-prefetch`, `profile-load-race`,
`profile-tab-viewport`, `profile-organization`, `moderation-staff-inbox` and
existing wallet/card/header regressions. Build verifies 11 routes and 172
Tailwind utilities. Initial full run: 3,712 pass, seven failures, one skip;
six failures were stale source/VM test expectations for the new Profile state,
one was disposable PostgreSQL startup under load. Updated expectations and an
isolated rerun pass all 53 checks, including the database fence. The next full
local run has 3,716 passes, three failed assertions/parent results and one skip:
the remaining failures are in the two disposable-PostgreSQL suites (startup
and an HTTP timing failure under parallel load), not the changed UI fixtures.
Their serial rerun and clean Linux/Windows CI are required before release.
Initial failure evidence is retained. Exact final CI/release evidence belongs
in the checkpoint.

## Open findings and release boundaries

1. **Wallet SDK cold-start cost (P2):** live Home requested 189 resources,
   approximately 95 SDK-related. Known transfer sizes total about 2.94MB;
   cross-origin timing restrictions exclude some bytes. This is not billed
   egress. The unconditional after-paint startup is still present. A missing
   `artsoul_wallet` does not prove no persisted mobile WalletConnect session.
   Header identity can also exist without that hint. A dedicated startup slice
   must prove guest settlement, explicit Connect/Disconnect, hidden tabs,
   storage failure and mobile restoration before changing autoload.
2. **Server/data work:** B30 usage-slope evidence and B35 complete outer
   Saved/search boundaries, coordinated polling/cache/API cost checks,
   independent durable encrypted backup and existing-worker activation remain.
   The server worker is still the B30 version; no new server is requested.
   Data/UI latency cannot be guaranteed by CSS or client caching alone.
3. **Device acceptance:** no new native iPhone redesign/Phantom-switching pass
   is claimed. Android coverage was explicitly declined by the founder.
4. **Actual journeys:** B02 real-user cohort, B11 current-page expired-settlement
   acceptance and remaining B12 signed assistant paths are open. No completed
   transaction is replayed to improve test counts.
5. **Product limits:** Collection remains a local planning draft; premium
   conversational AI remains unconfigured/off; official-release broadcast
   awaits the dedicated project address. New contracts, multichain payment
   routing and Genesis launch are future architecture work, not silently
   enabled by redesign. Snapshot remains tied to the agreed public-testnet end.

## Interpretation decisions

- Network identity uses its own mark; the current payment asset is an explicit
  ETH/test ETH label. This avoids duplicate Ethereum marks without suggesting
  that Base has a separate native token.
- Loading reservation is temporary layout space, not a fake catalogue or a new
  permanent content block. Failure gets an actionable message.
- Diagnostics are removed from ordinary page execution, not deleted as a claim
  that every developer helper or package is unused.
- User-requested architecture flexibility is recorded; this slice introduces
  no amendment to frozen economics, role authority or settlement semantics.

Status: locally corrected, built and browser-checked. Hosted publication and
exact final tests must be recorded separately. This slice does not close B18,
B35 or Phase B as a whole.
