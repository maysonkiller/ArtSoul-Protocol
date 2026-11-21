# Voice R2 — bilingual cached marin clips (SOURCE_ONLY)

Baseline: 9f72dbbd972fc29ad8095c0ca549650bbf2af637. The nine English and nine restored Russian files all originate from the same OpenAI API voice `marin` under PR #496. No new speech API calls are made by this change. Browser speechSynthesis fallback is intentionally removed: when a recorded answer is unavailable, the answer remains readable as text rather than changing to a male/browser voice.

All existing WebMCP permissions, financial confirmations and wallet signatures remain intact. The legacy asset generator now accepts RU+EN clips but is DRY RUN by default and retains its historical USD 1 budget safeguard. This is not a general-purpose conversation synthesizer: dynamic artwork data needs a licensed single-voice TTS backend or accepted local generator. The user's reported additional local female voice is not present in the checked repository and is not represented as verified.

Real iPhone audition, full existing test suite, source-to-build integration, and site release are NOT_RUN. No merge, deployment, real wallet actions, or paid API usage occurred.
