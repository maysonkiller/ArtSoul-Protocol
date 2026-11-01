# Shared card reconciliation — November 2, 2026

Scope: B18, the founder's November 2 screenshot and the accepted October 31
design study. Work remains in `C:\Projects\ArtSoul`. The two supplied chat
histories were treated as evidence of prior decisions, not as new worker
instructions. Base: `b9fddcf216949180c0892afff6fbe589f9099a2e`; existing PR #441
is continued rather than replaced by another checkout or competing PR.

## Findings and changes

| Finding | Correction |
| --- | --- |
| The draft card could say NFT twice alongside its old Sold status. Its extra network/mint row did not match the accepted study. | One lifecycle badge over the media, title, creator, and one contextual summary. The same renderer policy serves Home, Gallery and Profile, including Saved. |
| A cancelled listing retained `sale_price` and could advertise it as a current price. | A minted, unlisted work says Not for sale. Live bids, final bids, starting prices and asking prices have explicit labels. Testnet amounts say test ETH. Tooltip and accessible link text use that same summary. |
| The DOM renderer placed the token mark after the amount while React placed it before. The bundled black mark was nearly invisible on a dark card. | One existing bundled ETH asset before the amount, with a backing from the current theme's text token. Availability text has no currency mark. No duplicated network/token chips or external icon requests. |
| Older container selectors overrode the new layout, moving a countdown onto Saved on a narrow card. Video/audio labels also touched Play. | Remove the conflicting countdown placement; keep timer/state upper-left, actions upper-right, and raise the media label above playback controls only on narrow cards. Touch targets stay at least 44px. |
| The draft added overlapping responsive rules and a five-column Home grid unlike the study. | Consolidate the new card rules; four columns on wide screens, three on intermediate tablets, two on ordinary phones and one below 360px. Home is limited to two visible rows; Gallery/Profile retain their complete lists. |
| Shared product startup still imported unused AI demonstration modules. | Remove only those two imports. The authenticated Gemini guidance client on Publish and Artwork remains. No new dependency or substitute AI feature. |

The approved Home promise remains. The gallery section again uses the study's
Find your next connection heading. Recent useful work from PR434–440 remains:
the real-art showcase, primary navigation, theme control, compact account,
clipboard fallback, protected Admin entry and Guide. This slice does not
replace real works with demo artwork or restore the discarded decorative ring.

## Interpretation and compatibility

- Canon 05/16/17 are touched through presentation and evidence only. No contract,
  floor, fee, role, mint rule, network write scope or auth rule changes.
- NFT is a display category only when mint evidence exists; it is never inferred
  from an ended auction. The existing lifecycle resolver still decides state.
- Showing Not for sale instead of an obsolete asking price is a display
  correction, not a change to canonical floor or stored listing history.
- Four wide-screen columns and the compact summary follow the accepted study;
  long titles retain full accessible descriptions. Whole-page swipe capture is
  not introduced.
- Classic/Future palettes are unchanged. Classic remains static; reduced motion
  remains effective. Artwork playback is user-controlled content.
- Original accumulated checkpoint/B27 notes and untracked work remain outside
  this patch. Recovery snapshots and the named Git stash were retained.

## Verification

- Focused card/countdown/cache/layout coverage: 150 passed; another 37 control,
  media and product-startup checks passed.
- Full local unit suite: 3,382 passed, 35 environment-dependent skips, no failures.
- Build: 11 route contracts and 172 required style utilities verified.
- Shared cards: 2,370 rendered assertions across seven widths (320–1920px), both
  themes and Home/Gallery/Profile. Actual local MP4/WAV playback, pause and mute
  are exercised. Home's intentionally hidden rows are recorded separately.
- Profile: 50 assertions; artwork detail/actions: 566; account menus: 313 across
  40 viewport/theme/account-state combinations. No browser exceptions or writes.
- Final independent scoped review found no remaining substantive defect.

Browser fixtures use the actual built routes and local synthetic API/media
data; they block external writes and do not substitute for native wallet,
iPhone or real-user beta acceptance. Screenshots were inspected in both themes.
Release acceptance also requires the current PR's Linux/Windows CI and exact
remote route/asset comparison. The release result belongs to
[PR441](https://github.com/maysonkiller/ArtSoul-Protocol/pull/441), not the old
draft's check statuses.

Initial visual review caught the countdown/Saved and media-label/Play collisions;
both were corrected rather than accepted as screenshot noise. Initial focused
test failures were stale cache pins/copy expectations and a test calling a
private helper; the corrected tests exercise the rendered link description.
Initial evidence is retained privately.
One wide-screen fixture sampled the React pause label before the queued media
event committed it; the paused media and subsequent Play label were confirmed.
The fixture now waits for that event-driven label, without changing playback.

## Social preview reconciliation

Read-only November 2 checks of Home, Gallery and Profile with browser and
Telegram crawler user agents return the current glass-sculpture social banner.
Legacy image URLs redirect to the same asset. Its SHA-256 is
`e9b79a3f14cfdd417a0bcd3765264ca2629644620b7764293b27cc2839787fc2`.
The supplied chat history records the owner's successful Telegram cache
refresh. No claim is made that previously sent messages on all platforms can
be remotely invalidated by an application deployment.

## Phase B boundary

The reported duplicate-card presentation defect is corrected and locally
verified; shipping is tracked by PR441. This does not declare the entire beta
complete. See the current status note for the
remaining device, signed-journey, operational and data-recovery evidence.
