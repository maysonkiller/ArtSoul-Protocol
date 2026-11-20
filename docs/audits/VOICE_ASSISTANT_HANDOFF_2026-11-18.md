# ArtSoul voice assistant feasibility review

## What visitors hear

At revision `1382df01`, speech and typing feed the same Russian/English command parser. The microphone uses the browser's speech recognition for one utterance. Browser support and audio processing depend on the device and vendor. The parser calls the same ArtSoul tools as the website assistant. This explains why a familiar command can work on an iPhone while a paraphrase can fail. [Command implementation](../../voice-commands.js) · [Browser speech recognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)

All 18 fixed reply files matched their manifest hashes. They were rendered ahead of release with `gpt-realtime-2.1-mini` and the API voice `marin`. Playing a file incurs no per-reply AI charge. Variable answers, including artwork-specific amounts, use the browser's speech synthesizer and can sound different across devices. The founder previously confirmed audible Russian help on a physical iPhone. That observation covers the help clip. [Audio manifest](../../public/audio/assistant/v1/manifest.json) · [Recording evidence](B18_RECORDED_VOICE_PROTOTYPE_2026-11-16.md)

## What the handoff establishes

| Item inspected locally | Result |
| --- | --- |
| Full handoff ZIP | Five entries: the report, analysis JSON, two WAV excerpts and the nested source archive. The report and source ZIP match the separately supplied files byte for byte. |
| Reference excerpts | 1,512,000 and 403,200 PCM frames at 48,000 Hz, mono, 24-bit. These correspond to 31.5 s and 8.4 s. Both SHA-256 values match the supplied analysis. |
| Full conversation | The JSON describes 70.442667 s of AAC audio. The package contains the excerpts only, so the full recording's codec and measured level were not independently verified. |
| Source-only experiment | Six entries, including the reference transcript, target text, Python code and Windows launcher. All five entries listed in its checksum manifest match. The launcher installs unpinned Python dependencies and calls a generation path which downloads a model. The package contains no model weights, generated speech, voice profile or completed comparison. |

The supplied scripts and instructions were inspected as source material. Archive checks establish integrity and audio format. They cannot authenticate the speaker. Producing or publishing a Juniper likeness requires separate rights evidence.

## Juniper for ArtSoul

OpenAI lists Juniper in ChatGPT Voice. The published voice catalogs for the speech, Realtime and GPT-Live APIs provide no Juniper identifier. GPT-Live's `juni` entry is a German voice. The review found no supported export of the original model or documented selection of Juniper for a third-party site. [ChatGPT Voice](https://help.openai.com/en/articles/20001274-chatgpt-voice) · [Speech API voices](https://developers.openai.com/api/docs/guides/text-to-speech) · [Realtime voices](https://developers.openai.com/api/reference/resources/realtime/subresources/sessions/methods/create) · [GPT-Live voice catalog](https://developers.openai.com/api/docs/guides/live-conversations#voice-options)

Section 8 of the OpenAI Service Terms limits ChatGPT Voice Output to noncommercial use and restricts redistribution as an audio file. The custom voice service for eligible customers requires a separate consent recording from the same voice actor as the sample. Neither attachment supplies that consent or a grant for public product use. Qwen's Apache-2.0 license covers its model. Permission to use a particular recorded voice is a separate matter. Keep the supplied audio private. Revisit Juniper if a documented licensing and delivery route becomes available. [OpenAI Service Terms](https://openai.com/policies/service-terms/) · [OpenAI custom voice requirements](https://developers.openai.com/api/docs/guides/custom-voices) · [Qwen model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base)

## Local acceptance sequence

| Stage | Use the existing implementation | Observable acceptance |
| --- | --- | --- |
| 1. Conversation turns | Extend the microphone panel with an explicit conversation start and stop. Keep the recognizer idle during playback, wait briefly after each turn, and stop on close, hidden page, language or wallet change. Keep typed input and manual replay. | Two consecutive safe commands after one activation. Playback cannot trigger another command. Silence, denied permission, unavailable recognition or blocked playback leaves manual controls usable. Cover real iPhone and desktop. The branded circle can pulse in Future. Classic and reduced-motion modes show static labeled states. |
| 2. Page and draft context | Route voice and text through the same allowlisted tools. “My gallery” opens Explore. “My collection” opens the profile's Collected tab. Keep the current route, active field and pending edit scoped to the session. Reuse the publication draft validator and the form's review/apply flow. | The person chooses the file and can cancel. A title can be dictated and corrected. Read the form back after applying it. Check the destination and tab after navigation. |
| 3. Auction preparation | Read the current form or the contract's allowed durations. Selecting a duration edits the draft only. Keep preparing a draft, submitting to the wallet and confirming on-chain as distinct outcomes. | Given 24/36/48 options, “48 hours” selects only 48. Unsupported values prompt clarification. Cancelled signature or missing receipt never produces a completed-sale reply. Payment, publication and signing require the person's existing confirmations. |
| 4. Voice identity | Evaluate identity independently of dialogue and tool behavior. Any future audition for the requested voice requires a licensed source and an actual newly synthesized phrase. | Compare Russian names, numbers, amount and duration on two devices. Clearly identify the actual engine and voice. The founder can assess listening quality. A user preference or similarity score cannot establish voice provenance. |

These stages describe acceptance of the expanded assistant. The existing Phase B help playback and its physical-device result have separate evidence. The site can develop and test the dialogue and draft flows without a paid voice session. [WebMCP tool registry](../../webmcp-tools.js) · [Publication draft validator](../../src/features/artwork/command-draft.js) · [Theme and motion rules](../canon/16_VISUAL_STATUS_AND_THEME_CANON.md)

## November 18 local candidate

The local implementation adds an explicit conversation control to the existing
panel. Successful playback schedules the next utterance. A stalled player or
microphone ends the session. A protected utterance pauses for review. Closing
the panel, navigating away, changing accounts, typing, or hiding the page stops
continuous listening in this first candidate. The follow-up below changes
assistant-initiated navigation. Only the one-shot mode has previously been heard on the
founder's iPhone.

The founder's gallery phrase opens Explore. The collection phrase opens the
profile's Collected tab for ArtSoul NFTs. The creation phrase opens Publish.
On that form a visitor can dictate a title and description, ask for the title
back, correct the draft and choose an existing duration. The visitor selects
the file and explicitly applies the reviewed suggestions. The draft refuses
to overwrite a field that changed after review.

Chromium played the shipped Russian help WAV and rearmed one simulated
microphone turn after the audio ended. The panel fitted 320, 375, 768 and
1440 CSS px in both themes, also with reduced motion enabled. A separate
built-page test submitted Russian text through the real command panel on
Publish. It checked a title correction, an intervening manual edit, a selected
image, manual application and the 48-hour selection. Publication remained
disabled in the guest fixture. Browser checks used local fixtures and made
no external speech request. Physical microphone quality, cross-device playback
of variable text and licensed Juniper audio remain unverified.

## Local Publish result

On November 18, the built Upload page passed a guest walkthrough in Chromium 157. The test used a local public-config fixture, blocked external HTTP requests and WebSockets, and typed Russian commands in the actual assistant panel. Both Russian and English examples were visible. A title, its correction, a description and 48 hours appeared in the review panel. Editing the form by hand before applying the suggestions blocked the entire update. A second review applied the corrected values and selected only 48 hours. The fixture PNG stayed selected, the originality box stayed clear, and Publish stayed disabled. A final title check read the actual form value. This exercise covered the page and its tools. Physical microphone recognition and a continuous multi-page conversation require separate device checks.

## Navigation and spoken follow-ups

A later November 18 Chromium walkthrough used the shared assistant, actual page
shells and routing, with simulated speech recognition and variable speech output.
One explicit start carried the conversation from Home to Gallery and Profile.
“Open NFT” prompted for a destination. “Marketplace” selected the visible
Marketplace tab. Switching between Discovery and Marketplace in the same document
kept the microphone ready, and “show my collection” selected Collected in Profile.
Stop, reload and Back ended listening. Physical microphone and iPhone gesture
behavior for this version remain unverified.

The transfer uses one short-lived same-tab record, consumed for the requested
destination and matching wallet. It contains no audio or transcript. If the
browser requires a gesture, the assistant stays open with a restart control.
Search and title prompts accept a value in the next turn. Search terms and
dictated titles stay data even if they contain a financial command.

Six English/Russian short prompts use the first sentence of the existing
Marin help, search and publication recordings. Local checks matched their PCM
bytes to the shipped sources and located each cut within a pause. No synthesis
or model download was performed. Open-ended text still uses device speech.
The private ChatGPT Juniper excerpts were not used in these public assets.

The local build passed its HTML and CSS checks and the focused voice, tools,
draft, gallery and profile suites passed 290 tests. The local preview serves
numeric artwork paths through the same artwork shell as the hosted site.
The preview only serves the frontend. Live data depends on a configured API.
