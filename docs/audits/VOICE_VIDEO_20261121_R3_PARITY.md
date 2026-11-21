# ArtSoul Protocol Voice — R3 bilingual parity after owner screen recording
**Date:** 2026-11-21 | **Evidence:** owner screen recording "Запись экрана 2026-11-21 190023.mp4" (02:44.93, 1920×1080, 30 fps; AAC 48 kHz stereo).
**Scope:** SOURCE_ONLY / TEST_ONLY | **Release gate:** NO_GO; no merge/deploy/API charges.
**Public PR:** https://github.com/maysonkiller/ArtSoul-Protocol/pull/519

## Evidence caveat
The video has an audio track. The wording below is **what the ArtSoul browser displayed as the recognized transcript**, not a certified word-for-word transcription of the speaker's raw audio. The browser's speech recognition may mishear NFT terminology, names and mixed-language words; do not label those screenshots as ground-truth spoken utterances. No paid speech-to-text service was used. Never upload the owner's raw video or personal audio to the public repository.

## Timestamped observations (approximate)

| Time | Browser-recognized phrase | On-screen behavior / failure |
|---|---|---|
| 00:00–00:04 | "nft open nft" | Low recognition confidence; refused as intended |
| 00:05 | "hello" | Previously fell back to "Try open NFTs..." instead of greeting |
| 00:10–00:25 | "open NFC" | Misheard NFT acronym; clarification, not a destination |
| 00:30 | "open artworks" | Unknown request despite existing gallery navigation |
| 00:35 | "open profile" | Opened Profile (working positive control) |
| 00:40 | "connect to wallet" | Unknown request |
| 00:45–00:50 | "open Explorer" | Unknown request instead of Gallery / Explore |
| 00:55–01:00 | "open discovery" | Opened Gallery/Discovery (working positive control) |
| ~01:05 | No recognizable speech | "Nothing was heard"; audio fallback may be unavailable |
| 01:10–01:15 | "open Discovery test black" | No title-based catalog search |
| 01:20–01:30 | "open test" | No title-based catalog search |
| ~01:35 | "открой Т-34" | Generic clarification rather than safe work-title search |
| ~01:40 | "почему ты говоришь на английском" | Generic clarification instead of RU language explanation |
| ~01:50 | "это сделал" | Generic clarification instead of asking which action to verify |
| ~01:55–02:10 | "помощь" | Help worked (positive control) |
| ~02:15 | "Подключи кошелёк" | Unknown request |
| ~02:20 | "Покажи какая сеть подключена" | Unknown request |
| ~02:25–02:35 | "уведомление" | Unknown request |
| ~02:40 | "режим" | Unknown request; should clarify Classic/Future/voice chat |

## Root causes and corrections

1. **Navigation vocabulary too narrow.** Existing \`parseNavigationTurn\` recognizes Gallery/Explore/Discovery and Profile, but not "Explorer" / "artworks". Exact RU and EN aliases now route to the *existing* read-only \`open_page\` tool. No new arbitrary URL capability.
2. **No work-by-title route.** Existing code only accepted numeric artwork IDs; "open test" and "открой Т-34" dropped to generic help. They now call the *existing* \`search_catalog\` tool with \`category:'artworks'\`. They do **not** open a guessed ID. Follow-up "open first result" / "открой первый результат" opens only a verified ID and canonical \`/artwork/<id>\` URL returned by ArtSoul, after explicit selection.
3. **Missing nonfinancial UI intents.** Dedicated RU/EN intents open only the existing account menu, show existing notifications, switch Classic/Future through \`ThemeManager\`, or read verified wallet-network state. Voice never calls \`safeConnectWallet\`, never signs, never submits a bid, and cannot grant wallet permissions.
4. **Language routed incorrectly when mic preference and recognized script differed.** English text with RU selected previously reached the RU parser. The recognized text's Cyrillic/Latin script now selects the parser; the EN/RU toggle remains the browser SpeechRecognition language, since that browser API has no guaranteed simultaneous bilingual STT.
5. **Greeting and ordinary meta-questions lacked replies.** RU/EN greeting, "why English", "did you do it", "notifications", "network", and "mode" are now bounded text replies with no fabricated facts. "hello" matches the existing English \`marin\` WAV exactly.
6. **Unreliable speech recognition is not an intent.** Misheard "open NFC"/"nft open nft", unknown titles and low-confidence wallet/UI requests fail closed with clarification. We do not map NFC guesses directly to wallet or NFT actions.
7. **Audio availability differs from command availability.** The original fixed bank had 166 scripts, not 166 recordings. One newly generated English \`en-r2Greeting.wav\` was validated and pushed in commit \`8ff78b8\`; the Russian greeting and many other new phrases are still NOT_RECORDED because the API grant is exhausted. An additional 22 exact RU/EN response scripts are now queued in \`docs/audio/assistant-video-r3-phrase-bank.json\`, bringing the planned source-script total to **188**. The planner and offline generator remain dry-run by default.

## Bilingual acceptance contract

| RU | EN | Safe outcome |
|---|---|---|
| «Привет» | "Hello" | Matching greeting text (EN recording exists) |
| «Открой работы» / «Открой каталог работ» | "Open artworks" / "Open Explorer" | \`open_page(gallery)\` |
| «Открой Т-34» / «Открой тест» | "Open T-34" / "Open test" | \`search_catalog(artworks)\`, not an invented ID |
| «Открой первый результат» | "Open first result" | \`open_artwork\` only for verified canonical result |
| «Подключи кошелёк» | "Connect to wallet" | Account menu only; person selects Connect |
| «Уведомления» | "Notifications" | Existing notifications panel; no notification edits |
| «Покажи какая сеть подключена» | "Show my network" | Verified read-only chain state; otherwise "cannot verify" |
| «Режим» | "Mode" | Asks Classic/Future/voice mode |
| «Выбери режим Future» | "Switch to Future mode" | Existing \`ThemeManager\` only |
| «Почему ты говоришь на английском?» | "Why are you speaking English?" | Explains separate mic language and missing RU recordings |
| «Помощь» | "Help" | Existing bilingual help |
| «Какие аукционы открыты?» | "What auctions are open?" | Existing read-only WebMCP auctions |

**Do not** map vague "Open NFT" or "open NFC" to a wallet action. Ask where to open NFTs; do not guess.

## How to verify without API credits

From the checked-out feature branch:
\`\`\`powershell
git status -sb
git pull --ff-only
node --test test\voice-video-bilingual-r3.test.cjs test\voice-conversation-r2.test.cjs test\voice-commands.test.cjs test\voice-navigation-dialogue.test.cjs test\voice-bilingual-bank-r2.test.cjs test\voice-r2-audio-integrity.test.cjs test\voice-r2-batch-planner.test.cjs
node scripts\plan-assistant-audio.mjs 10
git status -sb
\`\`\`
These unit/fixture checks require no OpenAI credit and never connect or sign a real wallet. A GitHub CI success must be attributed to the **exact HEAD**, not a previous run.

## Outstanding gates

- Full Windows + Linux CI exact-head tests and any failures, plus real Preview browser replay in both languages.
- Direct listening acceptance for Russian and English, especially mobile Safari/Chrome, permission handoff, navigation and text-only fallback.
- Confirm real search backend returns canonical items, that button clicks open the expected UI, that wallet state is *settled* and chain ID available.
- No new API-funded Russian WAV generation until credit availability and explicit approval. No real-wallet actions, production merge or promotion.
- Dependency advisory remediation remains in separate draft PR #520; it must be reviewed before production acceptance.

**Status:** corrected source candidate; real user-playback and release not accepted. SOURCE_ONLY / TEST_ONLY.
