# B18: Recorded command replies and optional live conversation

## Current decision

The founder described a continuous spoken conversation that can answer while
performing permitted work on ArtSoul. Prerecorded command replies do not provide
that capability. In the subsequent November 16 clarification, the founder asked
whether live conversation is worth adding at all, prioritized no additional
operating charges, and reserved existing API credits for development. Live voice
and user-supplied API keys are therefore under assessment, not an approved paid
public rollout or an automatic new Phase B exit requirement. Recorded command
replies are released; the owner subsequently confirmed audible Russian help
playback on the physical iPhone in the tested scenario.

The founder subsequently accepted the bounded plan: complete the ordinary
assistant and remaining Phase B evidence; defer GPT-Live and credential custody.
The fixed replies passed CI and deployed-asset verification. Real-phone
audibility has separate owner evidence and is not inferred from release.

The founder approved a new OpenAI API key and its ignored local destination.
Authentication succeeded. No secret is recorded here, shipped to a browser,
or included in Git. Data-sharing enrollment was not enabled. No production
API key or paid public voice endpoint was configured.

## Released implementation

- Eighteen fixed English/Russian replies have exact-text audio mappings. These
  cover help, missing inputs, missing wallet, submission and confirmed settlement.
- Submission and confirmed settlement use different clips. Dynamic answers,
  including amounts and artwork data, are not replaced with generic success audio.
- Existing native speech remains for unmatched text; an end event without a
  start event now reports unavailable audio instead of silently reporting success.
- Manual replay does not execute commands again. Typed replies stay silent.
  Closing, hiding, account/authentication/language changes and page navigation
  cancel playback and invalidate late promises/events.
- AI voice disclosure is visible for prerecorded answers. Browser autoplay
  rejection leaves explicit manual playback available.
- The offline generator is manual-only, uses existing dependencies, validates
  returned transcripts, and records hashes and conservative usage estimates.
  It locks concurrent generation, reserves a bounded budget before each attempt,
  skips verified existing clips, and does not automatically retry failures.

## Evidence

- [PR #496](https://github.com/maysonkiller/ArtSoul-Protocol/pull/496) merged as
  `2ddb7e0fff32af918b6f7ef45dda35d4cb938f0d`. Exact-head CI
  `43921630762` passed every job, including contract checks, for
  `0d54812a5dccff07820f944ac98ff07654e254f4`.
- An independent review passed all 152 focused voice/panel/tool tests, all 18
  WAV hashes/headers and the seven matching script-version pins. The panel suite
  contains 38 tests. The initial stale v13 cache guard was corrected to v14 and
  its actual content hash before the successful CI run.
- The local full-suite run was not green: it encountered the stale cache guard
  and disposable PostgreSQL readiness/time-out failures under concurrent load.
  Separate sequential reruns passed artwork-media-reorg-rpc (37 tests) and
  indexer-log-order-rpc (8 tests), with no failures, cancellations or skips.
  Those reruns do not reclassify the original full local run as passing.
- Build passes: 11 HTML routes and 172 Tailwind utilities verified.
- All 18 recordings passed exact normalized transcript verification. Their total
  duration is 98.15 seconds and total size is 4,711,992 bytes. Conservative cost
  estimated from returned token usage is USD 0.0606218; this is not an invoice.
- On the deployed preview in Chrome, typed Russian help stayed silent until
  Listen was clicked; the control changed to Stop and returned to Listen without
  an audio error. Evidence: `output/b18-recorded-voice-preview.png`. This verifies
  playback lifecycle, not audible output on the owner's iPhone.
- Production deployment `dpl_FizWTCZevZfMahFUryLZRQYpkmja` is READY. At
  `2026-11-16T17:50:25Z`, the apex homepage returned HTTP 200 with script v14;
  the script matched the expected content and all 18 WAVs passed hash and audio
  MIME checks. Evidence: `output/b18-recorded-voice-production.json`.
- Recordings are loaded on demand; no per-play AI call or user audio transmission
  to OpenAI was introduced. After release, the owner reported no audible output
  from manual Russian help playback on the physical iPhone. On the subsequent
  direct-file and assistant retest, the owner confirmed audible output from both,
  including the assistant response on iPhone and the playback button changing
  state. No runtime code or recording changed between these reports. The tested
  Russian help/fixed-reply playback scenario passes; the initial silence's cause
  is unconfirmed, and this does not establish every native dynamic reply or
  uninterrupted playback across all device states.
- Offline PCM inspection confirms the Russian help file contains 11.75 seconds
  of non-silent audio (99.42% nonzero samples, RMS -22.94 dBFS, peak 0.5315,
  no clipped samples). All 18 files have nonzero audio and no clipping. These
  measurements exclude an empty recording but do not identify the initial
  silence's cause. No device or browser cause is claimed as established.

## Remaining acceptance and deferred options

Retain the bounded ordinary-assistant command and audible-response evidence,
without a model call for every replay. Do not enable publicly funded live voice,
automatic credit recharge, or provider migration as part of this assessment.
Existing credits are for development, not public conversation subsidies.

The inspected active Gemini route provides artwork value guidance; it does not
generate artwork images. Its process-local rate limiter does not establish a
global cost ceiling. Actual production billing tier and quotas require separate
verification; no unlimited-free or zero-overage claim is established by code.

If live voice is subsequently selected, connect only permission-checked tools,
with explicit microphone/data-processing disclosure, bounded session duration,
server-enforced spending controls, cancellation and recovery. Preserve wallet
review/signature gates and report only verified outcomes. Opening a page must
not strand a paid session. User-supplied credentials require a separate secure
storage and revocation design; a wallet profile or browser localStorage is not
a credential vault. Neither optional design is part of this release.

An additional option under assessment is a permission-scoped ArtSoul connector
used from the visitor's own ChatGPT account. This could avoid custody of visitor
API keys and platform-funded model inference, while still requiring connector
hosting, authentication and client availability checks. It is distinct from
embedding GPT-Live on the website; no public connector is claimed as deployed.

References: [voice architectures](https://developers.openai.com/api/docs/guides/voice-agents),
[GPT-Live](https://developers.openai.com/api/docs/guides/live),
[API pricing](https://developers.openai.com/api/docs/pricing),
[ChatGPT voice and connected apps](https://help.openai.com/en/articles/20001274-chatgpt-voice),
[custom MCP connections](https://developers.openai.com/api/docs/guides/custom-mcp-server).
