# Public interface acceptance, 25 November 2026

## Guest browser checks

Between 19:21:55 and 19:22:41 UTC, Chrome loaded each route once on the production apex, with a guest session and the New Year visitor preview. Each route returned HTTP 200. Checks used Classic and Future at 320×700, 390×844 and 1440×900, plus 390×844 with the browser's reduced-motion preference. There were 64 combinations. The wallet remained disconnected. Additional read-only navigation and media controls were checked through 19:26:16 UTC.

| Route | Guest surface observed |
| --- | --- |
| Home | Heading, six artwork cards and the footer contact links |
| Gallery | 27 Discovery cards. NFTs and Marketplace changed both the pressed category and the URL fragment. Price range opened two inputs and closed again. |
| Artwork | Video on work 7. On work 32 the audio player loaded. Both mute buttons changed and restored the underlying media state. On image work 38, the full-size dialog focused its close button and returned focus after Escape in both themes. The page showed Creator, First Collector, Owner and Provenance. |
| Artist profile | Public artist profile and 28 artwork cards |
| Publish | First file-selection step and navigation to collection authoring |
| Collection builder | Initial collection form |
| Guide | The Safety section opened its copyright reporting explanation. Three example aura frames were present. |
| Admin | Public access screen with the disconnected wallet |

Each of the 64 views had one visible main landmark, one primary heading and one header voice button. The center and four interior points of each voice button hit the intended button. The neighboring search and notification buttons had no geometric overlap. No document-level horizontal overflow or uncaught JavaScript exception was observed. A loaded card image had no visible loading mask at the observation point. Classic and reduced-motion observations had no running CSS or Web Animations. These are observations after rendering, not measurements of media playback or memory over time.

The voice panel also opened by keyboard on all eight routes in both themes at 720×390. Its close button fit the viewport, focus entered the panel, and Escape returned focus to the launcher in all 16 cases. The 320×700 gallery voice panel fitted the portrait viewport. This check exercised the panel controls without requesting microphone access.

## First artwork on narrow phones

On production at 320×700 the first gallery card started at y=757 with the seasonal header. The page heading wrapped, the gallery search occupied two rows, and the artwork was entirely below the viewport. The mobile revision keeps the category, filter and help controls, places the two search controls on one row, and uses a more compact heading and spacing up to 420 CSS pixels wide.

A local Chrome comparison used the same static shell and a single synthetic Discovery artwork for both variants. All external requests were blocked. Classic and Future produced the same positions.

| Viewport | First card top before | First card top after |
| --- | ---: | ---: |
| 320×700 | 757 px | 607 px |
| 390×844 | 704 px | 588 px |
| 430×932 | 704 px | 704 px |
| 1440×900 | 570 px | 570 px |

At 320 pixels the text field measured 158×50 and the Search ArtSoul button measured 111×44, separated by eight pixels. The button forwarded the typed query to site search. The gallery search tests also passed. These figures measure the candidate locally, pending published-build verification.

## Media playback in WebKit

Playwright's WebKit 26.0 for Windows reproduced a video failure on the production page for work 7. The generated `#t=0.1` preview produced media error 4 and the page removed its player. A standalone HTML video using the same public MP4 and fragment also failed. Removing only the fragment loaded the 11.128-second video. Audio work 32 played on the production page.

The [shared preview handler](../../src/ui/components/artwork-card.js) now retries the original media URL once when a generated time fragment fails. Authored fragments and poster-backed videos retain their original behavior. The gallery, profile and homepage cards, gallery preview and artwork detail use the same recovery rule. A final load failure keeps the normal unavailable state.

WebKit loaded the candidate's built assets against the real guest artwork API and both public media files. At 320×700 and 390×844 in Classic and Future, all eight combinations restored their initial mute state, advanced the media timeline after a tap, and held a stable time for 300 ms after pause. Play, Mute and Playback options each received hit testing at their center, with zero document-level horizontal overflow. This desktop WebKit run measured playback state. Physical iPhone Safari, audible output, and foreground recovery remain open.

## Remaining evidence

- No classified artwork was present in the sampled home, gallery or profile cards. The Guide examples and nine local tests covering verified aura sources and controls supplement the guest check. An actual qualifying minted item rendered from the production projection remains a separate check.
- Real iPhone Safari media playback, route changes and foreground/background recovery require device evidence. Muting in desktop Chrome does not measure audible output or playback recovery.
- Staff-only content and signed wallet operations were outside this guest run. Recheck the affected screens when those workflows reach their final build.

At 19:40 UTC the production domain served the gallery fix from commit `1ea57c60`. Chrome found 27 Discovery cards. In both Classic and Future, the first card started at 607 px on a 320×700 viewport and 588 px on a 390×844 viewport. All four views opened search for the entered query and returned on Escape. The search field and button had an 8 px gap, with no horizontal overflow or uncaught JavaScript errors. These are browser viewport measurements.

## Public contact and operating checks

The apex served the homepage. The www gallery URL issued a 308 redirect to the same path on the apex. Both /docs and /auction-system issued 308 redirects to /docs-protocol. The homepage footer supplied a working-format mailto link to the published ArtSoul contact address, plus links to the project on X and GitHub. The Guide explained how copyright complaints are handled. No message was sent.

The conventional paths /terms, /privacy and /.well-known/security.txt returned HTTP 404. No privacy or terms link appeared in the sampled homepage, publish form, builder or detail pages, or in the first-party page entry sources inspected. These observations establish public routing only. Operator identification, applicable legal disclosures, contact coverage, cost coverage and incident readiness remain open under RG-09 and RG-10.

The security contact was subsequently published. On November 25 at 21:26 UTC, the production apex returned HTTP 200 with a plain-text contact, canonical URL and October 31, 2027 expiration. This read did not exercise incident handling.

## Physical iPhone follow-up

The owner used an iPhone 14 Pro Max. On the first attempt MetaMask opened without displaying a connection request. It connected on the second attempt after closing and reopening it. The iOS version was not reported. The owner also reported that play and sound buttons obscured audio and video previews on listing cards. Track wallet pairing separately from the later profile sign-in message and card layout. On the project machine the four mobile-wallet regression suites passed 102 checks. These checks cannot establish why the request did not appear on the phone.

The production gallery served the mobile layout and seasonal controls from `165a4aee`. At a 390 px viewport Chromium and WebKit located the actual video “Rialo VIDEO CAT” and audio “music 3”. Play, sound and save were inside their cards and below the art. Center hit tests and mute toggling passed. The controls measured 36 × 36 px on Chromium's 166 px card and 44 × 44 px on WebKit's 173 px card. Video used contain sizing. In all twelve browser, theme and season combinations the theme indicator matched the search icon, and Enter retained keyboard focus with a visible 2 px outline. Physical iPhone acceptance of the revised controls remains open.

The owner heard short bursts of music while another tab was open. A concurrent local test intentionally started and paused “music 3” on the same machine. A separate guest Chrome session with audio output disabled opened and reloaded the production gallery. After scrolling from top to bottom on both visits, its three preview media elements had zero calls to play, zero play events and no autoplay attributes. The headless run did not generate a native visibility change when the second tab was brought forward. The shared card handler now pauses active previews on page hide or backgrounding and leaves them paused on return. The browser layout suite serves silent PCM and a video-only MP4 for its playback checks.

On “Rialo VIDEO CAT” WebKit rejected the generated preview fragment during the first Play request. The original video then loaded but was paused. With the updated handler, the same first click carried over to the playable original and the timeline reached 3.17 seconds. A paused, hidden or disconnected preview does not request that retry playback.

The next iPhone 14 Pro Max recording shows the profile moving from the Shark Tank and Music row to the beginning of Artworks as the theme changes. In a guest Chromium check of the same production profile, both theme changes replaced the native Music player. Its time reset to zero, it paused and it lost its mute setting. The gallery kept its player and continued advancing silently on the same track. The desktop browser retained its scroll offset in both views.

The profile now uses one stable React component type for all artwork rows. The shared audio preview displays elapsed media time, buffering, pause or a manual retry in the existing badge. A mute toggle only changes sound. In the [profile and gallery regression](../../scripts/qa/profile-theme-position.cjs), Chromium and WebKit kept the selected row within one pixel across eight theme switches at 430 × 932. The same muted media node continued playing. The [card layout suite](../../scripts/qa/media-card-layout.cjs) passed all 192 combinations using silent media. A repeat on the physical iPhone is still needed to establish the result on that device.
