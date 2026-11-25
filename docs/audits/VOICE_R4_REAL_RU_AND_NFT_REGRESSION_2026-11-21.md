# ArtSoul Voice R4 — real RU microphone and NFT navigation remediation

The November 25 review supersedes this draft's Russian reply and interface selection. Multilingual recognition continues with English product copy and English recorded responses. [Current voice QA](VOICE_R2_QA_2026-11-25.md)

**Date:** 2026-11-21 | **Scope:** SOURCE_ONLY / TEST_ONLY | **PR:** #519 (Draft)
**Owner symptom:** Despite earlier passing tests, the RU language toggle still felt English and spoken "открой NFT" failed to open the desired section.

## Reproduced defects from actual branch R3

1. **Wrong intent priority.** The contextual "open artwork by title" fallback intercepted "открой нфт", "show my NFTs", "open NFT gallery", etc., and called \`search_catalog(category:'artworks',query:'nft')\` rather than \`open_page\`. A plain "открой NFT" triggered an English follow-up question. This is a logic defect, not user pronunciation.
2. **Inconsistent RU UI.** The command dialog always set \`lang='en'\` and used English for heading, mic states, status text, help, \`Nothing was heard\`, and replay controls even with RU chosen.
3. **Mixed script != desired reply language.** A RU microphone sometimes produced Latin STT text (e.g. "open NFC"). The handler automatically chose English for both parsing and its response. The real need is to parse whichever language the browser recognized but answer in the language selected by the speaker.
4. **Dead clarification.** The NFC/NFG misrecognition message invited the owner to specify a section but never stored the \`pendingPrompt='nft'\` state; "галерея" therefore could not finish the clarification.
5. **English UI results despite RU voice selection.** \`localizeResult\` updated \`say\` while retaining English \`show\`, so even successfully handled RU commands appeared to reply in English.

## Corrective source changes

- Direct read-only NFT commands (RU/EN and common spellings) now use the existing \`open_page\` enum:
  - "открой NFT", "открой нфт", "открой эн-эф-ти", "show me NFTs" → \`nfts\` → \`/gallery#nft\`.
  - "открой мои NFT"/"show my NFTs" → \`collected\` → \`/profile#collected\`.
  - "открой NFT в кошельке" → \`walletNfts\` (existing WebMCP wallet availability and connection checks remain enforced).
  - "открой NFT на маркетплейсе" → \`marketplace\`.
  - "открой NFT номер 38" and "open NFT 38" remain under the verified artwork-number parser, never the generic search-by-title branch.
- Recognized "open NFC" is **not** treated as a certain NFT command. It asks a question and retains bounded follow-up intent so that "галерея" can open the safe NFT tab.
- RU microphone selects RU user-facing language even if the STT output contains English words. The parser independently uses the recognized script to accept valid RU or EN input.
- The RU panel displays Russian labels and unambiguous status for text-only replies; it does not suggest that a missing \`marin\` recording exists.
- UI responses on successful public tool commands show Russian summaries while preserving the original data details as text, without changing the wallet authority boundary.
- Added \`test/voice-nft-r4.test.cjs\` and integrated test cases in \`test/command-panel.test.cjs\`, plus refreshed the HTML cache keys and content hashes.

## Important limit: RU speech output is still mostly NOT_RECORDED

**Speech recognition, text command interpretation, and synthesized audio are three different layers.**
The RU setting activates browser SpeechRecognition with \`ru-RU\`. The website's verified \`marin\` audio playback is based on prerecorded WAVs only. The original 9 RU WAV clips are available, including RU \`helpSpeech\`. The newly authored RU greeting and other new phrase WAVs are **NOT_GENERATED** while the OpenAI API credit balance is exhausted; no browser/male TTS or another voice may silently replace \`marin\`.

Owner can distinguish layers: say "помощь" in RU (known prerecorded \`ru-helpSpeech.wav\`) versus "открой NFT" (navigation should occur; its dynamically described response may be text-only).

## Bounded release checks

Run from a clean copy of \`feature/voice-marin-ru-en-no-random-voice-20261121\`:

\`\`\`powershell
git status -sb
git pull --ff-only
node --test test/voice-nft-r4.test.cjs test/command-panel.test.cjs test/voice-navigation-dialogue.test.cjs test/voice-video-bilingual-r3.test.cjs test/voice-conversation-r2.test.cjs test/voice-r2-audio-integrity.test.cjs
node scripts/plan-assistant-audio.mjs 10
\`\`\`

Do not merge/deploy to production, do not call paid APIs, do not request wallet signatures. Full exact-head CI Windows/Linux and a real Preview browser test (RU and EN microphone) must be confirmed separately. Static tests cannot certify the browser STT service or guarantee one \`marin\` recording for each possible reply.

**Acceptance:** code and tests only pending full CI and owner browser validation. **Release:** NO_GO.
