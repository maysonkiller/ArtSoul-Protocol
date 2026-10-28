# B21 publication draft review

Date: October 28, 2026. Workspace: `C:\Projects\ArtSoul`, branch
`codex/takeover-audit`. Start HEAD: `5580a430`; production at start: `5fae86aa`.
Status: released in PR #380, candidate `b88f1aa57103e7cc8eadab2c37f76bb986c3d830`,
production merge `26883c59a05f1de524c033667facd7a38e25262b` (identical source tree).

## Reproduction and cause

`prepare_artwork_registration` accepted a title/description but only navigated to
`/upload`, losing the supplied details. On Publish itself that navigation also
reloaded the page and discarded the selected file. Text/voice had no publication
preparation command. Existing search and Donate/Report tools are retained.

## Change

- Reuse the existing registration-preparation tool, with strict title,
  description and optional positive ETH price validation. No extra tool alias,
  provider, dependency or API route.
- Show suggestions separately in Publish. The person applies them with
  **Use these details**. Fill only empty/equal fields atomically; never overwrite
  manual details. Preserve selected file, duration and original-work consent.
- Refuse changes during authorization, AI analysis, submission or an unresolved
  in-memory attempt. A selected file with saved recovery references also remains
  untouched. The draft path never calls publication preparation/recovery APIs.
- Navigate only from other pages, with a five-minute, consume-once tab-local
  transfer and opaque fragment. No draft text in URL queries. Wait for the
  existing wallet restoration event; discard on different settled identity.
- EN/RU title commands and a missing-title clarification. Preserve case, Unicode
  and punctuation as text. Low speech confidence refuses preparation. No
  automatic connection, signature, upload, AI request or publication.
- Static asset pins: WebMCP 9 and voice 8 on all seven command surfaces.

## Validation

- 131 final focused tests passed, including nine new draft tests: schema,
  transfer expiry/replay, blocked storage, in-place review, partial-write
  rejection, selected media, recovery records, account change and actual startup
  binder ordering with delayed wallet restoration.
- Build passed: 11 HTML routes and 173 Tailwind utilities.
- Initial full tracked-unit run: 2,805 passed, four failed. Two stale runtime
  hash/version assertions were updated with their actual new asset versions;
  focused checks now pass. Two disposable PostgreSQL tests failed during startup
  or shutdown under concurrent load; isolated sequential rerun passed all 38
  assertions. No database implementation was changed to hide these failures.
- Built-browser matrix: seven pages in Classic desktop and Future mobile, four
  long-content/narrow/landscape cases, one selected-file/manual-edit/account-change
  case. Local public reads proxied to the actual public apex endpoints; private
  sessions remain unavailable. No wallet ceremonies are claimed from fixtures.
- One bounded read-only reviewer found the delayed-wallet transfer bug; corrected
  and confirmed with actual binder regression coverage. No helpers left running.
- Exact-candidate CI 40711322018 passed: Linux 2,845 passed / two skipped;
  Windows 2,450 passed / 32 skipped; both builds/static checks and 49 contract
  checks per platform. Post-merge CI 40712001912 also passed.
- Preview deployment 7388923586 and production deployment 7389042952 succeeded.
  Verified seven routes and four exact-content command assets on both preview
  and apex. Separate hosted-browser passes covered 14 cases each (seven routes,
  Classic desktop / Future mobile), without response mocks, API writes or page
  exceptions. Local built-browser pass covered 19 cases. No real-device wallet
  or microphone ceremony was performed in these checks.

## Interpretation and remaining boundaries

The founder deferred paid provider setup while asking to prepare the useful
parts. This slice is the existing B21 form/command work, not a conversational
model. No API key, paid request, microphone permission or paid service was added.
The five-minute transfer lifetime and 300-character command-draft title limit
bound transient UI data only; they do not amend protocol economics or the normal
manual publication title rules. Canon sections 2/4 (lifecycle), 13 (presentation)
and 17 (Phase B) remain unchanged.

Natural multilingual conversation, provider privacy/retention and an approved
enforced operating budget remain open. See
`../VOICE_AND_NETWORK_FOLLOWUP_2026-10-25.md`. Phase B is not closed by this slice.

## Integrated public journey addendum, October 28

After the guest-header correction, exercised the existing live public assistant
journey while B29 was staged (apex source `9faffe2d`, unchanged B21 assets):
public search for Rehearsal → artwork 34 → explicit Saved add/remove refused for
the guest → Donate review → Report review → publication draft review/apply →
reload without replay. English/Classic 1366px and Russian/Future 390px both pass
(two journeys, 16 steps); no response mocks, API writes or page errors. Runtime
record: `output/b21-integrated-guest.log`; runner:
`output/playwright/b21-integrated-guest.js`.

This confirms public navigation/form preparation and guest boundaries only.
It does not accept authenticated Saved writes, wallet transactions, real speech,
paid AI or the remaining B12 signed-in journey. Resale tool parity remains to
review against the B23 page controls; historical B12 cancellation limitations
must not be treated as evidence that the current page lacks cancellation.
