# B21 asynchronous microphone consent

Workspace: `C:\Projects\ArtSoul`, branch `codex/takeover-audit`.
Base: `268808687ef66b41d9b4db5088aa320ee0598a93` (PR #383).
Status: implemented and tested locally; release pending.

## Reproduction and correction

The same async dialog mismatch found in the B12 wallet gate also affected the
active microphone launcher. `window.confirm` returns a Promise, so the old
synchronous check could start browser speech recognition before the answer and
persist consent even after refusal.

The launcher now waits for strictly resolved `true`. Pending dialogs disable
duplicate starts and command submission. Closing, hiding the tab, changing
language/account or logging out invalidate late approval. Refusal and failed
dialogs leave text commands available. Previously stored consent is renewed
once under a versioned key because the earlier value could be premature.

A bounded independent review reproduced another failure using both real source
files: another page alert displaced the consent dialog without settling its
Promise, permanently disabling the composer. The shared modal API now resolves
displaced or explicitly closed confirmations as false. Only its own explicit OK
button resolves true. Alert replacement also settles the old alert. No timer or
implicit acceptance is introduced.

Voice runtime 10 is loaded by all seven consumers; shared modal runtime 2 by all
eight consumers. No dependency, provider key, paid service, contract or economic
change. This is B21 frontend consent/lifecycle work under the existing assistant
review boundary; canon sections 4/9 and their financial rules are unchanged.

## Verification

```text
node --test test/modal-consent.test.cjs test/command-panel.test.cjs test/voice-commands.test.cjs test/cache-version-follows-content.test.cjs test/webmcp-tools.test.cjs test/webmcp-agent-actions.test.cjs test/resale-listing-flow.test.cjs
npm run build
```

- 151 affected checks pass; build, built-route and Tailwind checks pass.
- Browser: eight journeys (Classic/Future x 390/1366 px x EN/RU), 120 checks.
  Actual custom dialog and compiled page; synthetic SpeechRecognition records
  starts/aborts without accessing a microphone. Verify pending/refused/replaced
  consent, explicit retry, remembered consent, close/reopen and viewport bounds.
  Zero page exceptions or API writes. Mobile consent screenshot inspected.
- Independent final review: no remaining concrete defect in this scope; original
  replacement reproduction now releases controls without starting recognition.
- Ignored local artifacts: `output/b31-focused-tests.log`, `output/b31-build.log`,
  `output/b31-browser-final.log`, `output/playwright/b31-audio-consent.js`,
  `output/playwright/b31-audio-mobile.png`.

## Interpretation and limits

Existing consent is renewed rather than trusted. Replacing a pending decision is
cancellation, never acceptance. These are consent correctness decisions; no
protocol amendment is needed. Real microphone/provider recognition quality,
arbitrary-language conversational understanding and signed financial journeys
are not proved by the synthetic transport tests. Paid conversational voice stays
deferred; B12/B21 and Phase B retain their separate acceptance gates.

Inactive legacy deletion/simulated queue handlers also contain old synchronous
confirmation calls; they are not active product actions and were not enabled or
rewritten here. They must be removed or converted before reuse.
