# B18/B21: Page commands and answer playback

## Confirmed defect and scope

On November 16 the owner tested the assistant on a real iPhone and reported
that "открой галерею" reached the unsupported-command response. The native
recognizer supplied the requested phrase; the missing page grammar and tool
were the confirmed application defect. This report does not establish a
microphone failure, general speech accuracy or successful navigation after the
repair. Desktop and mobile share the same command handler.

The owner also asked whether spoken answers were available. Native automatic
speech synthesis already existed for microphone-originated commands. Typed
commands intentionally stayed silent, and there was no manual playback control
when native automatic speech did not start.

## Implemented correction

- `voice-commands.js` recognizes bounded English and Russian page requests and
  updates the help/examples. Malformed or compound navigation requests cannot
  fall through into a financial action.
- `webmcp-tools.js` exposes `open_page` with exactly five destinations: Home
  (`/`), Explore (`/gallery#discover`), Profile (`/profile`), Create (`/upload`)
  and How it works (`/docs-protocol`). Unknown pages, arbitrary URLs and extra
  arguments are rejected. Navigation does not connect a wallet or perform an
  upload, signature or transaction.
- Typed answers remain silent. The explicit Listen to answer control speaks the
  existing safe answer summary without executing its tool again. Microphone
  answers retain the existing automatic synthesis attempt. The control changes
  to Stop audio only after the native engine reports playback started; a silent
  rejected start remains manually retryable.
- Unsupported or failed synthesis leaves the written answer and composer
  available. Current-utterance identity guards ignore stale callbacks. Closing
  the panel, hiding the document or changing its lifecycle cancels playback;
  account, authentication and language changes make the previous answer
  unavailable to replay.

This uses existing browser capabilities, with no new dependency, paid service,
database request, fee, spending authority or automatic signing. The existing
microphone-consent boundary remains in force. It adds a bounded command, not
general conversational understanding.

## Native audio evidence and limitation

[WebKit's SpeechSynthesis implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechSynthesis.cpp)
conditionally requires a user gesture on iOS-family platforms and can return
before queuing an utterance when that restriction remains active. The related
[WebKit issue](https://bugs.webkit.org/show_bug.cgi?id=223473) documents the
audio-playback user-gesture setting. This supports providing a direct playback
button even when no error callback arrives. It is an implementation-based
explanation of a possible restriction, not proof that it caused a failure on
the owner's phone. Native voices and audible playback remain device-dependent
and unverified for this repair.

## Verification and remaining acceptance

The focused parser, tool, command-panel, search, Saved, draft, action and cache suite passes **220 tests**, including
seven new audio behavior tests. Coverage includes exact page selection and
input rejection, typed silence, safe summary playback, no repeated wallet
action, selected speech language, native start/end/error callbacks, a silent
start retry, stale callbacks, missing/throwing synthesis, and account/document
lifecycle cancellation.

On the actual local Chrome page, a temporary native-call trace confirmed that
clicking Listen to answer invokes `speechSynthesis.speak` with the correct
Russian summary. Chrome emitted `end` without `start` for both short and long
text; selecting an available local voice did not change that result. This
establishes handler dispatch, not audible playback or a verified native-engine
cause. It does not reproduce a capture-phase click lock in current source.

The focused suite is local automated evidence. Broader build and browser verification,
release/production verification, and the repaired navigation plus audible
answer on a physical iPhone are pending at this checkpoint. No full Phase B
closure or all-device acceptance is claimed. Previously accepted wallet
transactions do not need repeating for this correction.
