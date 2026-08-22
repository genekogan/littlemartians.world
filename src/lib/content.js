// Page content lives as JSON in src/content/pages — one file per page, holding
// the blocks (headings, text, images, video, grid rows) that make it up.
// Edit those files to change the site; the templates render whatever is there.

const files = import.meta.glob('../content/pages/*.json', { eager: true });

const HOME = '__root';

// Links that 404'd on the old Squarespace site, or were Squarespace-internal.
const LINK_FIXUPS = {
  '/home-maple': '/',
  '/home': '/',
  '/search': '/',
};

export function fixHref(href) {
  if (!href) return '#';
  if (LINK_FIXUPS[href]) return LINK_FIXUPS[href];
  if (/^(https?:|mailto:|tel:|#)/.test(href)) return href;
  if (href.startsWith('/')) return href.replace(/\/+$/, '') + '/';
  return href;
}

export const isExternal = href => /^https?:/.test(href) && !href.includes('littlemartians.world');

// Scraped content refers to media as "assets/name.jpg"; it lives at /images/.
const fixSrc = src => (src && src.startsWith('assets/') ? '/' + src.replace(/^assets\//, 'images/') : src);

function normalise(block) {
  const b = { ...block };
  if (b.src) b.src = fixSrc(b.src);
  if (b.poster) b.poster = fixSrc(b.poster);
  if (b.images) b.images = b.images.map(i => ({ ...i, src: fixSrc(i.src) }));
  if (b.cols) b.cols = b.cols.map(c => ({ ...c, content: c.content.map(normalise) }));
  if (b.html) b.html = b.html.replace(/href="([^"]*)"/g, (m, h) => `href="${fixHref(h)}"`);
  if (b.items) b.items = b.items.map(i => i.replace(/href="([^"]*)"/g, (m, h) => `href="${fixHref(h)}"`));
  return b;
}

function load(mod) {
  const page = mod.default ?? mod;
  return {
    ...page,
    slug: page.slug,
    pageType: page.pageType || 'standalone',
    intro: !!page.intro,
    path: page.slug === HOME ? '/' : `/${page.slug}/`,
    ogImage: fixSrc(page.ogImage),
    sections: page.sections.map(s => ({
      ...s,
      background: fixSrc(s.background),
      blocks: s.blocks.map(normalise),
    })),
  };
}

export const pages = Object.values(files).map(load);
export const homepage = pages.find(p => p.slug === HOME);
export const subpages = pages.filter(p => p.slug !== HOME);
export const getPage = slug => pages.find(p => p.slug === slug);
