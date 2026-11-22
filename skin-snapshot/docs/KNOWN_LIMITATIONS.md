# Known limitations

1. **Real devices and skin tones are untested.** The camera logic was run in desktop Chromium with a simulated camera fed by a public-domain portrait and brightness-scaled versions of it. Android Chrome, iPhone Safari, a low-end phone, real webcams and real darker skin tones still need a human with the device. Use `/en/test/camera` and `docs/TESTING.md`.
2. **Camera thresholds are unvalidated.** They were set from first principles and tuned on synthetic fixtures. Expect to adjust them after real-device runs.
3. **Left and right 45-degree angle checks were verified with synthetic landmarks** and a frontal real face, not with a real head turned 45 degrees.
4. **Beauty-filter detection is a heuristic.** It can miss a filter and can wrongly flag very smooth skin. The visitor can confirm "I am not using a filter".
5. **No live AI model was called.** The Anthropic and OpenAI-compatible adapters, the prompt and the JSON schema were not exercised against a real model. Tests use the mock provider and fuzzed outputs. Accuracy, calibration of the confidence labels and the 60-second target are unmeasured.
6. **Staff sign-in with Supabase Auth and authenticator enrolment was not exercised** (no Supabase project was available). Database rules were tested with simulated claims.
7. **Deployed without a database:** the public pages are live; the flow, booking and console need the steps in `docs/DEPLOYMENT_STATUS.md`.
8. **The database-backed photo store** is for Phase 1 volumes. The S3 adapter is untested against a live bucket.
9. **WhatsApp:** click-to-chat only. The cosmetologist's number must be entered (variable or Console > Settings); until then visitors are shown the message to copy.
10. **Hindi is a careful draft** and needs a native reviewer. Fonts render through a Devanagari stack; mixed Latin and Devanagari text was checked visually only in Chromium.
11. **Analytics are first-party and per browser session.** Visitor counts are distinct random per-visit ids, not people.
12. **No search-engine indexing** on staging by design.
13. **Image red-flag detection cannot be proven** to a percentage without the dermatologist's test set. The "zero missed flags" measure is only provable for answer-based flags.
14. **Accessibility was checked with axe (automated) and a keyboard test.** A manual screen-reader pass (VoiceOver, TalkBack, NVDA) has not been done.
15. **Performance was measured under emulated throttling in Chromium** (1.6 Mbit/s, 150 ms, 4x CPU slowdown), not on a physical low-end phone. The face model and WASM runtime are about 36 MB on disk (3.7 MB model, the browser downloads one of three WASM variants of about 11 MB) and load only on the camera step, in the background during the questionnaire.
