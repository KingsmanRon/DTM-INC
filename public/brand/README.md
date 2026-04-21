# Brand assets

Per §16 of the spec. This folder holds the final SVG lockups once the designer has recreated them from a 600dpi flatbed scan of the DTM Inc. business card.

## Required files

| File | Use |
|---|---|
| `dtm_mark.svg` | Circle mark + scalpel only. For favicon, small surfaces. |
| `dtm_lockup.svg` | Mark + wordmark. For app header. |
| `dtm_mark_reversed.svg` | White-on-dark version for dark surfaces. |
| `dtm_lockup_reversed.svg` | White-on-dark version for dark surfaces. |

## Colour

The green on `#2E7D32` that currently ships is a **phone-photo-eyedropper placeholder** (§16). It must be replaced after a proper colour reference is obtained from a colorimeter or a 600dpi flatbed scan.

When the final hex is known, update:
- `tailwind.config.ts` → `colors["accent-dtm-green"]`
- `public/manifest.webmanifest` → `theme_color` (if switching from the navy)
- `public/icons/favicon.svg`
- This README
