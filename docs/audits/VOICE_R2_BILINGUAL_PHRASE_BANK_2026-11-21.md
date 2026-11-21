# R2 Bilingual Voice Phrase Bank (source-only)

Voice: OpenAI API `marin`, model `gpt-realtime-2.1-mini` (the same API voice as the existing PR #496 recordings). This is **not** ChatGPT Live 1.1 voice output. The fixed 69 pairs / 138 RU+EN lines contain NO dynamic artwork, price, owner, or transaction facts. These facts must come from actual WebMCP results.

## Generation is NOT yet done
The new library and generator are source-only. The front-end ships an empty `voice-audio-bank-r2.js` map until offline generation and SHA256 verification. All unsupported dynamic answers remain text-only; no switch to browser voice, no live cost.

The reviewed `scripts/generate-assistant-audio.mjs` now reads the bank and validates each `lang-id` path, original-language transcript, WAV header and SHA256. Dry-run default; only `--generate` can incur expense. `--max-new 10` limits each run to 10 newly recorded clips; `--budget-usd 1` defaults to the previous conservative cap and can explicitly increase up to 30. This is an **estimated reservation and local ledger**, NOT a guaranteed billing cap; configure the OpenAI project budget separately.

From a checked-out test copy of this branch, with an owner-managed `.env.local` (never commit the key):

```powershell
node scripts/generate-assistant-audio.mjs
node scripts/generate-assistant-audio.mjs --only ru-r2Greeting,en-r2Greeting
# Only after explicit owner approval and API credit verification:
node scripts/generate-assistant-audio.mjs --generate --only ru-r2Greeting,en-r2Greeting --max-new 2 --budget-usd 1 --sync-bank
```

Regenerate and review WAVs, manifest hashes and the generated `voice-audio-bank-r2.js` before any release. For all future arbitrary dialogue there must be an approved same-voice runtime TTS/local synthesis path; static clips alone cannot narrate changing balances, artwork names or free-form conversation.

No API requests, merge or production changes were performed in this PR. Real audible acceptance and full CI still pending.
