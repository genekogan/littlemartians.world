# littlemartians.world

The Little Martians site, rebuilt as a small Astro project after moving off
Squarespace. Static output — no server, no database, no runtime dependencies.

## Run it

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static site into dist/
npm run preview  # serve the built site
```

Node 20+ (`.nvmrc` pins it).

## How it is put together

The site is **content-driven**. Every page is a JSON file in
`src/content/pages/`, holding the blocks that make it up — headings, paragraphs,
images, video, buttons, and the 12-column rows that arrange them. Two templates
render all 54 pages:

| File | Role |
|---|---|
| `src/pages/index.astro` | The homepage (`__root.json`) |
| `src/pages/[slug].astro` | Every other page, one per JSON file |
| `src/components/Section.astro` | A page section, with its background image or video |
| `src/components/Blocks.astro` | Renders a block list; recurses for grid rows |
| `src/layouts/Base.astro` | Header, nav, footer, `<head>` metadata |
| `src/lib/content.js` | Loads the JSON, fixes link and image paths |
| `src/styles/global.css` | All styling |

**To change wording or swap an image**, edit the page's JSON — no template
changes needed. **To change how something looks**, edit `global.css`. **To add a
page**, drop a new JSON file into `src/content/pages/`; the route appears
automatically at `/<filename>/`.

### Block types

`heading` · `paragraph` · `list` · `quote` · `divider` · `image` · `gallery` ·
`video` · `button` · `social` · `form` · `embed` · `row` (which holds columns of
other blocks).

## Media

`public/images/` holds every picture, re-encoded for the web: long edge capped
at 2000px, JPEG quality 82. That took the original Squarespace media from
246 MB to 105 MB with no visible loss.

`scripts/optimize-images.mjs` does the conversion. Run it over a folder of
originals if you add new full-size photographs:

```bash
node scripts/optimize-images.mjs <source-folder> public/images
```

Videos stream from YouTube and Vimeo, exactly as before — nothing is hosted here.

## Deploying

The repo carries config for two hosts, so either works with no changes:

- `public/_headers` + `public/_redirects` — Cloudflare Pages and Netlify
- `vercel.json` — Vercel

Build command `npm run build`, output directory `dist`.

Once the repo is connected to a host, every push to `main` builds and deploys
automatically. That is the whole deployment story — there is nothing to run by hand.

## URLs

Page paths match the old Squarespace site exactly (`/about/`, `/verdelis/`,
`/talk-to-a-little-martian/`), so existing links and search results keep working.
Three old URLs that no longer have a page of their own — `/home`, `/home-maple`
(already broken on the old site) and `/search` (a Squarespace feature) — redirect
to the homepage.

## Not finished

1. **Forms do not submit.** The footer newsletter and the form on
   `/contact-maple/` render but do nothing; Squarespace handled these
   server-side. They are marked `data-needs-backend="true"`. Point them at
   Formspree, Buttondown, Mailchimp or similar.
2. **No search.** The old header had a Squarespace search box.
3. **One 15 MB animated GIF** on `/kojii/` is the largest asset by far.
   Converting it to a looping MP4 would cut it by roughly 90%.
4. **`/about1/` looks like a near-duplicate of `/about/`.** Both were live on
   Squarespace and both are kept here; worth consolidating.

## Where the original came from

`../littlemartians-world/_archive/` (outside this repo) holds the raw scrape:
the original Squarespace HTML, its JSON, and a map from every local image back
to its Squarespace CDN URL, in case a full-resolution master is ever needed.
