# Demo brand assets

## ZKProofport

- The product name is **ZKProofport**: the `p` in `port` is lowercase.
- `zkproofport-social-20260919.png` is the unmodified 1200 × 630 share image
  from `https://zkproofport.com/og-image.png`, retrieved on 2026-09-19.
  It uses the official navy/gold identity, shield logo and approved wordmark.
- `public/og-image.png` retains the same corrected image for old direct links.
  Open Graph and Twitter metadata use the dated URL to avoid reusing the old
  purple image. Messaging apps may still cache previews of previously sent URLs.
- `zkproofport/` holds the marks from the brand kit (version 2026-10-13), copied
  unchanged from the parent repository's `docs/design/zkproofport-brand-kit/`:
  `zkproofport-symbol.png` (the shield, formerly `public/logo.png`, byte-identical)
  and `zkproofport-wordmark-dark.svg` / `-light.svg` (for dark / light backgrounds).
  Code takes them from `lib/brand.ts`; the header wordmark is
  `app/components/ZKProofportWordmark.tsx`. Keep the kit's minimums: wordmark
  160 px wide, shield 32 px tall.
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
- ZKProofport uses `zkproofport/zkproofport-symbol.png`.

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

## Ssiat

Ssiat (씨앗, "seed") is the fictional seed-drop demo for GIWA Sepolia
Playground faucet participants. Its original mark is a seed in the soil with
its first two leaves. It is not the GIWA, Upbit, Dojang or ZKProofport logo,
and the tab shows no third-party logo at all, so it cannot be read as an
official GIWA airdrop.

- `ssiat-app-icon.svg`: square icon, forest background.
- `ssiat-app-icon.png`: the same icon at 512 px, rendered from the SVG with
  macOS `sips -s format png`; used as the mobile proof request's `dappIcon`.
- `app/components/SsiatLogo.tsx`: theme-aware inline SVG mark and wordmark.

Palette: forest `#1f3a2a`, hanji paper `#f6f1e6`, sprout `#5f9b4c`, seed ochre `#c8923a`.

### CU × KProof (2026-10-29)

- `cu-symbol.svg`: original vector geometry extracted from page 4 of
  `B_Brand_ColorGuide.pdf`, in the official CU BI archive:
  https://cu.bgfretail.com/brand_info/data/CU_BI.zip.
  Three original logo paths and their official colors are preserved. The logo
  is not a traced bitmap or a typeset imitation. Rendered and checked against
  the original PDF. CU marks belong to BGF Retail.
- `../demo-assets/cu/cass-fresh.png`: unchanged official Cass Fresh product
  photograph from https://www.cass.co.kr/_nuxt/kv_target.DUAbvSPF.png,
  referenced by https://www.cass.co.kr/product_fresh. Rights belong to OB/Cass.
- `kproof-wordmark.svg`: from `kproof/demo/public/brand/wordmark-color.svg`
  (KProof brand kit v1.0). Original branding rights are retained.
- `PretendardVariable.woff2`: from the KProof demo, licensed under SIL OFL;
  see `Pretendard-OFL.txt`.
