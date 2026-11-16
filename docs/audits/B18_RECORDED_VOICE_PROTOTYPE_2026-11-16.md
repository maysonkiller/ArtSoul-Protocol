# B18: Recorded command replies and optional live conversation

## Current decision

The founder described a continuous spoken conversation that can answer while
performing permitted work on ArtSoul. Prerecorded command replies do not provide
that capability. In the subsequent November 16 clarification, the founder asked
whether live conversation is worth adding at all, prioritized no additional
operating charges, and reserved existing API credits for development. Live voice
and user-supplied API keys are therefore under assessment, not an approved paid
public rollout or an automatic new Phase B exit requirement. The ordinary
assistant's real-device audible-response acceptance remains open. This recorded
prototype is local and has not been released.

The founder subsequently accepted the bounded plan: complete the ordinary
assistant and remaining Phase B evidence; defer GPT-Live and credential custody.
The fixed recorded replies are approved for the ordinary assistant release,
subject to CI, deployed-asset verification and real-phone audibility acceptance.

The founder approved a new OpenAI API key and its ignored local destination.
Authentication succeeded. No secret is recorded here, shipped to a browser,
or included in Git. Data-sharing enrollment was not enabled. No production
API key or paid public voice endpoint was configured.

## Local prototype

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

- Focused voice, panel and tool tests pass; the panel suite contains 38 tests.
- An independent release review passes all 152 focused tests, the production
  build, all 18 WAV hashes/headers and the seven matching script-version pins.
  No release-blocking defect was identified; HTTP delivery and audible output
  on the owner's iPhone remain release/acceptance checks.
- Build passes: 11 HTML routes and 172 Tailwind utilities verified.
- All 18 recordings passed exact normalized transcript verification. Their total
  duration is 98.15 seconds and total size is 4,711,992 bytes. Conservative cost
  estimated from returned token usage is USD 0.0606218; this is not an invoice.
- In the local in-app browser, a typed Russian help request stayed silent until
  Listen was clicked. The playback control entered Stop and returned to Listen
  without an audio error. This confirms the browser playback lifecycle, not
  audible output on the owner's iPhone. Catalog/API loading on the static local
  Vite server was outside this test.
- Recordings are loaded on demand; no per-play AI call or user audio transmission
  to OpenAI was introduced. No production deployment was made.

## Required next implementation

Prioritize the ordinary assistant's command and audible-response acceptance,
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
a credential vault. Neither optional design is implemented by this prototype.

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
