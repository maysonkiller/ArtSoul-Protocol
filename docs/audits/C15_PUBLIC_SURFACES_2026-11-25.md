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

## Remaining evidence

- No classified artwork was present in the sampled home, gallery or profile cards. The Guide examples and nine local tests covering verified aura sources and controls supplement the guest check. An actual qualifying minted item rendered from the production projection remains a separate check.
- Real iPhone Safari media playback, route changes and foreground/background recovery require device evidence. Muting in desktop Chrome does not measure audible output or playback recovery.
- Staff-only content and signed wallet operations were outside this guest run. Recheck the affected screens when those workflows reach their final build.

## Public contact and operating checks

The apex served the homepage. The www gallery URL issued a 308 redirect to the same path on the apex. Both /docs and /auction-system issued 308 redirects to /docs-protocol. The homepage footer supplied a working-format mailto link to the published ArtSoul contact address, plus links to the project on X and GitHub. The Guide explained how copyright complaints are handled. No message was sent.

The conventional paths /terms, /privacy and /.well-known/security.txt returned HTTP 404. No privacy or terms link appeared in the sampled homepage, publish form, builder or detail pages, or in the first-party page entry sources inspected. These observations establish public routing only. Operator identification, applicable legal disclosures, contact coverage, cost coverage and incident readiness remain open under RG-09 and RG-10.
