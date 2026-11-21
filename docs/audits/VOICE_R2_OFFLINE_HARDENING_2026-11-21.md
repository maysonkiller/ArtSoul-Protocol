# ArtSoul Voice R2 — offline hardening & release evidence (2026-11-21)

**Status: SOURCE_ONLY / TEST_ONLY. Production NO_GO.**
PR #519 stays draft; these commits extend its voice branch. No OpenAI API calls, new WAV generation, production deploy, wallet signatures or paid services were performed in this patch.

## What exists

- 18 reviewed original \`marin\` WAVs (9 EN and 9 RU) from PR #496 are in the draft voice branch, with metadata in \`public/audio/assistant/v1/manifest.json\`.
- \`docs/audio/assistant-r2-phrase-bank.json\` has **83 EN+RU pairs / 166 fixed phrases**, all source text only until generated.
- A separately generated \`en-r2Greeting.wav\` was produced on the owner's local Windows PC, but it **is not part of the GitHub branch** until the owner stages and pushes it with the updated manifest and verified index. Do not misrepresent it as deployed to Vercel.
- Vercel domain \`artsoulprotocol.com\` was confirmed to point to production deployment from \`main\` SHA \`9f72dbbd972fc29ad8095c0ca549650bbf2af637\`. The voice PR has preview deployments but is not the production alias.
- API credit balance is zero according to the owner's Credit grants screenshot (\`Inactive\`, USD 0 of 71 remaining); all generation remains disabled until the owner explicitly approves a funded API project.

## Implemented in this hardening pass

1. \`voice-conversation-r2.js\`: fail closed on invalid/multiple artwork IDs instead of falling back to stale last selection; tie in earliest-auction deadline now asks for an artwork ID rather than choosing an arbitrary winner.
2. The contextual layer discards failed/malformed/duplicate auction lists and rejects malformed navigation snapshots rather than partially accepting old references. Only finite numeric hours are admitted; text or null cannot masquerade as a deadline.
3. \`voice-commands.js\`: typed Cyrillic routes to Russian parsing regardless of the EN microphone preference; cross-wallet navigation cannot revive the prior account's dialogue references. UI hint now describes RU+EN verified recordings and honest text fallback.
4. \`test/voice-conversation-r2.test.cjs\` adds negative fixtures for ambiguous/invalid IDs, ties, stale data, failures, duplicate IDs, corrupt snapshots and invalid input types.
5. \`test/voice-r2-audio-integrity.test.cjs\` validates existing manifest WAVs with byte count, SHA256, WAV/PCM header, transcript, sample rate, 83 paired texts and generated index alignment; it also supports later local R2 recordings.
6. \`scripts/plan-assistant-audio.mjs\` creates a deterministic read-only batch plan (10 at a time by default) and verifies any local recorded clips against the manifest. \`test/voice-r2-batch-planner.test.cjs\` proves this planner emits no paid generation commands.
7. \`scripts/backup-assistant-audio.ps1\` backs up only public voice assets, manifest, verified voice index and R2 phrase list to an owner-owned ZIP outside the repo, with a SHA256 digest. PowerShell 5.1 compatible; no credentials or ledger files are copied.

## Offline gate for Windows owner

Run from \`C:\Users\mayso\ArtSoul-Protocol-voice\` **after making an independent backup of any untracked WAV/modified manifest**:

\`\`\`powershell
git status -sb
git pull --ff-only
powershell -NoProfile -File .\scripts\backup-assistant-audio.ps1
node --test test\voice-conversation-r2.test.cjs test\voice-bilingual-bank-r2.test.cjs test\voice-r2-audio-integrity.test.cjs test\voice-r2-batch-planner.test.cjs
node scripts\plan-assistant-audio.mjs 10
git status -sb
\`\`\`

These commands are offline and do not invoke OpenAI. \`git pull\` retrieves code from GitHub but does not publish data; it will fail rather than overwrite conflicting local modifications.

Check \`en-r2Greeting.wav\` independently before any push:

\`\`\`powershell
Get-FileHash .\public\audio\assistant\v1\phrases\en-r2Greeting.wav -Algorithm SHA256
\`\`\`

Owner must confirm audio quality, then explicitly publish **only** the tested WAV, manifest and verified index to the voice branch if desired. No signing, mint, real WebMCP action, production merge or Vercel promotion is authorized.

## Gates still pending

- Current exact-head CI Windows/Linux (do not claim GREEN until run completes).
- Owner-side execution of audio/backup tests on Windows; owner-side WAV listening and checksum reconciliation.
- New Russian greeting and the remaining fixed phrases: NOT_GENERATED because the API returned \`insufficient_quota\`.
- Live browser/device SpeechRecognition and microphone behavior, safe wallet tool review on testnet, accessibility on mobile.
- Arbitrary generative spoken responses with a stable voice: NOT_IMPLEMENTED. A fixed 166-phrase bank is not a live LLM assistant.
- Separate explicit owner release acceptance.

**Exit state:** no API payments, no production mutation, no automatic wallet actions. STOP_FOR_OWNER before any release.
