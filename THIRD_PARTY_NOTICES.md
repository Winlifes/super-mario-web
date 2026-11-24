# Third-party code and assets

## Super Mario Phaser

- Upstream: https://github.com/pablogozalvez/Super-Mario-Phaser
- Imported revision: 6b9918d92b07d9a7ac25aa61b8878879ad1f8072
- Author: Pablo Gozálvez
- Code license: MIT; the upstream license is preserved in `LICENSE`.
- This deployment retains the upstream game assets. The repository does not separately document their provenance or a Nintendo asset license. The MIT notice is not a grant from Nintendo.

## Phaser 3.55.2

- Project: https://github.com/phaserjs/phaser
- Distribution: https://cdn.jsdelivr.net/npm/phaser@3.55.2/dist/phaser.min.js
- License: MIT; see `vendor/PHASER-LICENSE.txt` and the distribution header.

## html2canvas 1.4.1

- Project: https://github.com/niklasvh/html2canvas
- Distribution: https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
- License: MIT; see `vendor/HTML2CANVAS-LICENSE.txt`.

## ws

- Project: https://github.com/websockets/ws
- Version: pinned in `package-lock.json`.
- License: MIT; the package includes `node_modules/ws/LICENSE`.

## FullScreenMario reference data and pixel assets

- Project / preserved mirror: https://github.com/JFOC/FullScreenMario
- Imported revision: dc7db1fdea151684d78425bd1152ff680c7047d6
- Four original-level reconstructions: `Source/settings/maps/1-1.js` through `1-4.js`.
- Palette/RLE sprite data: `Source/settings/sprites.js`; deterministic decoding in `scripts/import-first-world.mjs`.
- Additional audio: Castle, Star, Gain Life, and Bowser Falls from `Source/Sounds/`.
- Code/data license notice: `vendor/fullscreenmario/LICENSE.txt` (MIT).
- Mario characters, graphics, music and trademarks remain associated with Nintendo; the repository's MIT notice does not establish a separate Nintendo asset license.
