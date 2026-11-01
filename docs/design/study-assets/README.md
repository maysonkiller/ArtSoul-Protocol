# Independent interface study assets

These files support the separate design study only. They are not wired into
production pages, wallet configuration or chain selection. The demo makes no
remote image or media requests. Retrieved November 1, 2026 (Europe/Warsaw).

| File | Origin | Use |
| --- | --- | --- |
| `base.svg` | `1_Base Brand Assets/The Square/Base_square_blue.svg` in [official Base download](https://brand.base.org/base-brand.zip) | Unmodified network identifier; [current guidance](https://brand.base.org/core-identifiers) |
| `eth.png` | [ethereum.org asset](https://ethereum.org/_next/static/media/eth-diamond-black.31u_5ih2w7osr.png), referenced by [Ethereum assets](https://ethereum.org/assets) | Unmodified token identifier; the surrounding label says test ETH on Base Sepolia |
| `rabby.png` | [Rabby site favicon](https://rabby.io/assets/images/favicon.png), referenced by [rabby.io](https://rabby.io/) | Unmodified example wallet provider, explicitly not connected |
| `motion-poster.svg` | Original geometric illustration for this study | Neutral poster, no creator asset copied |
| `motion-demo.mp4` | Original four-second synthetic monochrome ring generated locally with FFmpeg | H.264/yuv420p, no audio, 480px, requested only on play |
| `tone-demo.wav` | Original four-second low-volume sine tone generated locally with FFmpeg | Mono16kHz PCM, requested only on play |

Marks identify their respective projects; their inclusion does not imply a
partnership or endorsement. Brand colors are not ArtSoul theme tokens. The demo
uses the existing Classic/Future color definitions from `unified-styles.css`;
it does not replace those palettes. Sample media colors are artwork content.

The synthetic samples are fixtures, not submitted art, registered NFTs or data
from a user wallet. No new dependency is installed to display them.
