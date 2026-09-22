# Runtime artwork

The game uses WebP artwork generated from the retained PNG originals:

- Portraits: 512 × 512, WebP quality 85.
- Upgrade icons: 256 × 256, WebP quality 85, alpha preserved.
- Menu background: original 1672 × 941, WebP quality 82.

Converted with Pillow, Lanczos resizing, WebP method 6. The 20 images total
463,598 bytes, down from 21,853,195 bytes of PNG source artwork.

Release assets need the WebP images, `assets/squad.glb`, `assets/squad.json`,
and `assets/ball.glb`, alongside `index.html`, `style.css`, and `js/`.
Exclude PNG originals, the unused `assets/striker.glb` / `striker.json`,
generation records, `references/`, `tools/`, captures, and `node_modules/`.
Three.js and its loaders are fetched separately using the CDN import map.

Original PNGs remain available for future resizing and re-encoding; none were deleted.
