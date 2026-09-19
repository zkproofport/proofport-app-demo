# Demo brand assets

## ZKProofport

- The product name is **ZKProofport**: the `p` in `port` is lowercase.
- `zkproofport-social-20260919.png` is the unmodified 1200 × 630 share image
  from `https://zkproofport.com/og-image.png`, retrieved on 2026-09-19.
  It uses the official navy/gold identity, shield logo and approved wordmark.
- `public/og-image.png` retains the same corrected image for old direct links.
  Open Graph and Twitter metadata use the dated URL to avoid reusing the old
  purple image. Messaging apps may still cache previews of previously sent URLs.
- `public/logo.png` was checked against the official site's logo and is identical.
- Official site palette: midnight `#071827`, deep `#06131f`, gold `#cba65e`,
  paper `#f2f3ee`, muted `#9bafc1`.

## Madang (legacy demo assets)

- `madang-mark.svg`: original vector mark created for this demo. Twin open
  entrances form an M around a shared courtyard; the central dot represents a
  member. The interface combines it with a lowercase Geist wordmark.
- `upbit-logo.png`: original PNG bytes downloaded from the Upbit website's
  declared favicon at https://upbit.com/favicon.jpg on 2026-09-05. Only the local
  extension was corrected; the artwork is unchanged.
- GIWA uses the existing `/giwa-logo.jpg` from this project.
- ZKProofport uses the existing `/logo.png` from this project.

Third-party marks identify credential source, network and proof provider.
They are not presented as endorsements of the fictional Madang service.
All assets are served locally; no third-party logo requests occur at runtime.

## Gotgan

Gotgan is the institutional KRW vault demo on GIWA. Its original architectural
G mark combines a square storage chamber with a brass-colored entry. It is
not the GIWA network logo or the ZKProofport proof-provider logo.

- `gotgan-mark.svg`: navy/brass mark on transparent background.
- `gotgan-mark-inverse.svg`: ivory/brass mark for dark backgrounds.
- `gotgan-wordmark.svg`: standalone lockup with a Georgia fallback wordmark.
- `gotgan-app-icon.svg`, `gotgan-app-icon.png`: square icon and 512px PNG for
  the browser and mobile proof-request presentation.
- `app/components/GotganLogo.tsx`: theme-aware inline SVG with the interface's
  existing DM Serif Display wordmark.

Palette: navy `#142d4e`, pearl `#f3f5f8`, brass `#b99a61`.
The product descriptor is “A KYC-gated vault on GIWA.”
