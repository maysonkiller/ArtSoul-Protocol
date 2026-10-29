# B27: desktop video follow-up

October 29 owner revision: remove the artwork image menu, both Download image
and Open original file actions, and their dead handlers/styles. Do not move an
original link into Artwork details. Keep image/GIF fullscreen viewing and the
separate card Donate/Report actions. This supersedes only the menu decision
below; it does not make stored public media private or change its source URL.
Existing media/layout behavior tests: 20/20 pass; build and route/CSS checks pass.
Rendered verification and release follow in the checkpoint. No new dependencies,
architecture changes or economic interpretation; canon 05/16 UI surface only.

Date: 2026-10-28. Workspace: `C:\Projects\ArtSoul`, branch
`codex/takeover-audit`, starting HEAD `23711dca` (production `8abca461`).
Status: released in [PR #379](https://github.com/maysonkiller/ArtSoul-Protocol/pull/379),
candidate `6ce2a1d6`, production merge `5fae86aa28e5e69f57e4b161347535dd818eb217`.

## Evidence and changes

The founder supplied a second 2:40 desktop recording at 13:59. All 80 sampled
frames, four contact sheets and selected larger frames were inspected. Offline
speech transcription was used as an approximate aid, not a verified quotation.
Raw video-derived material remains local.

| Video interval | Finding and disposition |
| --- | --- |
| 00:00-00:41 | Image actions occupy a text bar unlike compact video controls. Replaced with a fullscreen icon and a native three-dot menu containing Download image and Open original file. Existing full-size dialog, keyboard access, focus return and scroll restoration remain. |
| 00:00-00:28 | The original link exposes a public Storage object URL, not database administration. Downloads use the documented public Storage attachment response; they do not fetch credentials or buffer the file in JavaScript. The image's depicted application is not live ArtSoul UI. |
| 00:41-01:19 | Homepage title, actions, gap and featured cards are oversized. Removed the forced heading break and the exact 200px gallery margin. Discovery-to-explanation spacing is now 24px. Compact desktop spacing applies to tall desktops too; featured cards stay bounded, while tablets retain two columns and phones retain the existing horizontal row. |
| 01:20-01:30 | Possible drill-down links from aggregate protocol metrics are a future navigation idea. No matching historical aggregate list is currently implemented, so counts have not been turned into misleading links to unrelated gallery results. |
| 01:31-01:44 | Header transition blink: pagehide synchronously hid the bell after clearing private state. Preserve only its existing generic shell in the outgoing snapshot; continue clearing the inbox, badge, bound wallet and pending action, and reject late imports. |
| Rendered follow-up | An obsolete roadmap selector in `ui-core.css`, `.future .relative:nth-child(5)`, applied a nine-second translation loop to the entire homepage. Removed the unused positional float rules/keyframes, instead of hiding their movement in a test. The homepage container must have no transform or active animation in either theme. |
| 01:56-02:28 | Profile/publish framing remains heavy on a tall desktop. Extend the existing compact desktop composition and replace the large publication-type panel with two compact links. Collection remains explicitly a local draft. |
| Near 02:37 | Cold card images load after navigation. This patch does not claim to eliminate network/media decoding latency or change lazy-loading policy without a measured regression. |

Download behavior follows the [Supabase public download documentation](https://supabase.com/docs/guides/storage/serving/downloads).
The download query is added only for an already-approved HTTPS public Storage
object. Other approved media origins retain Open original file. Existing media
host validation is not widened.

## Boundaries and interpretation

- Bible sections 5, 16 and 17: presentation, themes and Phase B only. No economics,
  contracts, permissions, roles, schema or publishing lifecycle changes.
- Compact means less framing and whitespace, not reduced browser zoom, tiny
  mobile fields or an unlimited feed forced into one viewport. Inputs remain
  at least 16px in the verified profile editor; image actions remain 44px.
- Both Classic and Future use existing theme variables. No added dependency.
- Menu labels describe real actions. Download is provided only where the Storage
  server supports attachment delivery; Open original remains available.
- Keeping a generic bell while leaving a page must not retain private content.
  Wallet changes, disconnect, BFCache restoration and delayed responses retain
  their existing authorization checks.
- Shared stylesheet pins advance from 57 to 58 across all ten HTML entries.
  Both `ui-core.css` references advance to version 2.

## Validation

- Build passes: 11 HTML entries and 173 Tailwind utilities verified.
- Eight image-control tests pass, including guarded origins, image/GIF handling,
  download URL preservation, outside/Escape menu closure, focus/scroll restoration
  and the actual rapid-click guard.
- Notification/prepaint tests cover private-content cleanup with shell continuity,
  late import fencing, queued intents, wallet switches, disconnect and guest return.
- 80 built-browser cases pass: eight pages, two themes and five viewport sizes
  from 320px to 1920px, including tablet and short desktop. No horizontal overflow,
  page exceptions or API writes. Public apex reads are proxied by the local harness;
  private endpoints are denied. This is not physical-device or wallet acceptance.
- Eight additional image-dialog fixture cases pass, including 740x320 landscape,
  background focus exclusion and keyboard activation. Ten profile-editor fixture
  cases pass at 320/390/1024/1366/1920px, with labels, placeholders, Cancel and
  16px fields. No real profile changes are submitted.
- Six final featured-row cases pass: both themes at 1920/1366/768px. Desktop
  cards are 224px wide; tablet has two columns. The homepage has no active
  container animation or transform. Eight final image cases also verify opening
  the original in a new tab and returning keyboard focus to the menu summary.
- Final layout/cache group: ten passed; whitespace checks pass. CI and deployment
  results follow below. Representative desktop/mobile screenshots inspected.

The initial full tracked run passed 2,835 checks and failed two stale stylesheet
pin assertions. The expected pins were updated to 58; the final affected group
passes all 124 checks. An independent review caught keyboard focus being lost
after selecting an image-menu link; the menu now restores its summary focus
without scrolling, with a behavior test and a real new-tab browser check.

## Release verification

- Exact-candidate CI 40703520760 passes: Linux 2,835 passed / two skipped,
  Windows 2,440 passed / 32 skipped; zero failures. Both builds/static checks
  and 49 contract checks on each platform pass. Skipped tests are not claimed
  executed. The merge tree equals the tested candidate. Post-merge CI40704289448
  also passes all three jobs.
- Preview deployment 7387712040 and production deployment 7387843584 each pass
  the eight-route/40-asset byte verification plus existing guest API boundaries.
- Thirty-two real preview and 32 real apex browser cases pass, without request
  mocks: eight pages, both themes, 1366x700 and 390x844. No page exceptions or API
  writes. Image menu/fullscreen/Escape/focus, homepage gap, stable container and
  horizontal bounds pass; representative screenshots inspected.
- Actual public-image GET returns HTTP 200, `Content-Type: image/png` and
  `Content-Disposition: attachment;` for the menu download URL. HEAD did not
  return the attachment header; the real GET was therefore checked separately.
- Logs: `output/audit/b27-{build,unit,final-focused,final-layout,ci}.log`,
  `b27-{local-browser,home-final,media-browser,profile-browser}.log`,
  `b27-{preview,apex}-{browser,verification}.log`, `b27-download-check.log`.
  Local fixture results do not stand in for real-phone, wallet or signature
  acceptance. No transactions, complaints or profile writes were performed.
- The chat attachment tool rejected the PR attachment because the existing
  thread already has 100 artifact identities. The PR URL is recorded here;
  no earlier attachment was removed.
- Owned browser sessions `b27video`/`b27release` and local servers 4226/4227 are
  closed. The only helper completed its bounded review; none remains active.

## Remaining work

This closes the bounded new-video correction after release; it does not complete
all of Phase B. Metric drill-down navigation, measured cold-media loading and the
remaining Future navigation work stay under B18/B09. B21 publication draft
preparation is the next implementation slice after this release. Beta cohort,
real-user journeys, operations and snapshot gates retain their recorded status.
