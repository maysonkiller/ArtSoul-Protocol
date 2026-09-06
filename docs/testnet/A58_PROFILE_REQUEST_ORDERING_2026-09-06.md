# A-58 profile request ordering — 2026-09-06

Status: local repair; mobile acceptance remains open.

## Reproduction

The initial profile request and subsequent tab requests both write the gallery list. Only tab requests checked the gallery request generation. Delaying the initial Created response, clicking Auctions after identity appeared, and then releasing Created replaced the visible Auctions cards with Created cards while the heading still said Auctions. The actual built page reproduced this in Chrome without page errors. This is a controlled timing reproduction, not a claim about every transition in the founder's videos.

Three behavioral tests execute the actual profile loader functions and failed before the change: initial response replacing a newer tab, previous-profile tab replacing the next profile's list, and the first list failing to seed its settled state/cache.

## Minimum repair

- Initial/profile loads and tab loads share the existing gallery request generation.
- A different viewed identity invalidates prior results, clears its visit cache and starts on Created. No old profile's cards remain under the new identity.
- A successful initial list commits its tab, settled state and cache together, just like subsequent tab loads.
- The existing compact loading label is also visible during the first gallery read. No synthetic card grid, overlay, timer or new loading component is added.

The actual-browser delayed-response scenario now retains the correct Auction fixture after Created arrives, with no page errors. Unit tests also cover the identity-change race. Card media, preview behavior, avatar URLs, theme styles and contract actions are unchanged.

Final local verification: 881 unit tests, 874 passed, 7 skipped, 0 failed. Production build and `git diff --check` passed. The browser smoke pass rechecked video artworks 7/19, GIF 10, image 31, audio 8, role avatars at 390/768/1440 widths, and shared cards on home/gallery/profile, with no page errors or document horizontal overflow in those cases.

## Remaining scope

A-58 is not closed without real iOS/Android acceptance. This request-ordering repair is separate from A-79's first-frame performance decision. Today the list API builds its shared snapshot before applying creator/limit filters; changing a profile query from 200 to 12 alone would not bound cold server work. No such cosmetic limit change, response cache change or silent truncation is included. Do not treat the local race fixture's timings as a production speed benchmark.

Canon interpretation: frontend state ordering only. A tab result belongs to both its requested profile and gallery; no new ownership, lifecycle, network or economic state is inferred.
