# Local live voice pilot — 2026-11-27

The local pilot is disabled by default. A funded loopback run using a public Russian greeting received 9.75 seconds of Russian audio from Marin. The public site continues to serve prerecorded speech.

## Scope

The pilot adds a separate localhost page at `http://127.0.0.1:4199/__live-voice-pilot`. An explicit button and microphone permission start a short conversation. The browser captures mono PCM16 at 24 kHz through an AudioWorklet. A local Node process owns the OpenAI WebSocket, sends the fixed session configuration and returns PCM replies to Web Audio playback. English and Russian are explicit spoken-reply choices. The configured official API voice is `marin`; the UI identifies it as AI-generated.

The existing deterministic command parser and WebMCP tools remain the source of ArtSoul read/navigation behavior. Each requested site action is displayed and requires a separate review click. Financial, signing, profile-editing, publication and other write tools are not exposed by this pilot. Navigation stops the microphone/provider connection before going to a permitted normal ArtSoul page. The ordinary site assistant retains its existing wallet review path.

This is a deliberately half-duplex developer test: capture pauses during replies/review to avoid feedback and queued requests. It is not ChatGPT Voice, GPT Live, a public realtime service, or an implementation of interruption/barge-in. No user API-key entry or storage is added.

## Resource and access boundaries

| Control | Implementation |
| --- | --- |
| Provider | Fixed `gpt-realtime-2.1-mini`, official `marin`, PCM24k; model/voice/format/token/VAD settings checked against provider acknowledgement before capture is admitted |
| Language | English or Russian, selected before starting; no raw provider instructions accepted from the browser |
| Provisioning | One durable, exclusive attempt marker written before opening the provider socket; failed attempts remain consumed; no retries or reconnects |
| Generation | At most four responses, each at most 1,024 output tokens; tool continuations count toward the same total |
| Audio | At most 60 seconds of input PCM; output PCM separately bounded to 60 seconds; individual frames and socket messages bounded |
| Lifetime | Server terminates its provider socket at 60 seconds; connection timeout 12 seconds; client also stops on expiry, hidden tab, page exit, account/auth change or Stop |
| Tools | At most two reviewed tool requests; matching one-time call IDs; result at most 6,000 UTF-8 bytes; only read/navigation tool allowlist |
| Local server | Binds only `127.0.0.1`; exact Host and WebSocket Origin checks; only the pilot page and five exact public JS/CSS files are served |
| Public data | Five exact read endpoints, no cookies/auth forwarding, no redirects, 20 reads per server process, timeout and response-size bounds |
| Secrets | Provider key exists only in the local server process; verified organization is set with `OpenAI-Organization`; browser receives neither key nor organization/funding file |

The server does not run Vite or serve arbitrary repository paths. `.env.local`, `docs/private`, source directories and filesystem aliases are unavailable over HTTP. The fixed client files reuse public parser/tool code; they do not confer wallet permissions.

These controls bound requests and duration. They are **not a monetary hard cap** and do not prove billing eligibility. A timer, token count, local file or a monthly budget alert cannot guarantee zero cash charges. Current pricing, model coverage, expiry and billing protection must be independently checked before enabling.

## Funding gate and local operation

Disabled preview (does not read the API credential or connect to OpenAI):

```sh
node scripts/serve-live-voice-pilot.mjs
```

Enabling requires `--enable-funded-pilot`, the approved existing server-side credential supplied through the existing secure setup, and a fresh operator-reviewed `docs/private/live-voice-pilot-approval.json`. The implementation does not create that approval or retrieve credentials. The private directory is ignored by Git.

Required approval fields:

- `purpose`: `artsoul-local-live-voice-pilot`; exact `model`; verified `organizationId` (`org-…`); `modelCoverageConfirmed`.
- `reviewedAt`: at most 24 hours old; `expiresAt`: after the bounded session plus a 30-second margin.
- Independently verified `cashOverageDisabled`, `promoBalanceVerified`, sufficient positive `promoAvailableUsd` for `requiredPromoUsd`, and `promoExpiresAt` after the session plus margin. A provider cap may supplement that proof; a cap without verified promotional coverage is not authorized by this grant-only pilot.

The operator must determine `requiredPromoUsd` from verified current pricing and the whole bounded session (input, repeated context, output and tool results), not guess it from a desired spend. An approval file is a record of that review, not proof supplied by the API. The code cannot itself establish that overage is impossible. If promotional coverage and protection from cash overage are not verified, the enabled pilot stays blocked and the free existing recorded assistant remains usable.

`docs/private/live-voice-pilot-attempt.json` prevents another provisioning attempt even after a process restart. Do not remove or reset it automatically. Review actual provider usage and remaining funding before authorizing another attempt. No startup task, daemon, public endpoint or deployment configuration is added.

## Evidence

New files:

- `src/ai/live-voice-session.mjs`: server-owned protocol, funding gate and bounds.
- `src/ai/live-voice-client.js`: explicit controller, reviewed existing tools and pilot UI.
- `src/ai/live-voice-capture.js`: PCM16 AudioWorklet.
- `scripts/serve-live-voice-pilot.mjs`: exact-file localhost server and one-attempt provisioning.
- `test/live-voice-session.test.mjs`, `test/live-voice-client.test.mjs`: offline fake-transport/audio tests.

Validation completed:

```sh
node --check scripts/serve-live-voice-pilot.mjs
node --check src/ai/live-voice-client.js
node --test test/live-voice-session.test.mjs test/live-voice-client.test.mjs
```

All 17 focused tests passed. They cover funding denial/grant-only protection, fixed voice acknowledgement, PCM and response quotas, reviewed tool continuation, replay rejection, stop/expiry/failures, no retries, origin/static-file boundaries, explicit gesture, late microphone permission cleanup, PCM playback, hidden/account cleanup, discarded late tool output and reviewed navigation. A real loopback HTTP/WebSocket smoke with the gate disabled returned the pilot page/client script, returned 404 for private and arbitrary source paths, and ended the socket with `funding_not_verified`; no provider was contacted.

A real provider run returned an incomplete response at the original 384-token limit. The bridge now requests a response after the server commits the input audio, preserves the provider's bounded reason code, and allows 1,024 output tokens per response including reasoning. A separate reviewed run sent the recorded greeting to the localhost bridge in real time. The provider acknowledged the configured voice and returned 468,000 bytes of PCM plus a Russian transcript. The input used a public fixture and the output was counted in memory. Physical microphones, speakers and iOS audio routing still require device acceptance. Public-service access controls and ongoing funding require their own release decision.

## Official references

- [Realtime conversations and server-owned session configuration](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [Realtime server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime)
- [WebRTC integration](https://developers.openai.com/api/docs/guides/realtime-webrtc)

WebRTC is the normal browser transport recommendation. This limited local pilot deliberately uses the existing `ws` dependency and a server-mediated PCM channel so the browser cannot send arbitrary provider configuration or create additional billable responses. No new SDK or dependency was installed.
