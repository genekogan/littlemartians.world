// Extract structured content from archived Squarespace HTML pages.
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SITE = process.argv[2];
const HTML_DIR = path.join(SITE, '_archive', 'html');
const OUT_DIR = path.join(SITE, '_archive', 'content');
fs.mkdirSync(OUT_DIR, { recursive: true });

const assets = new Map(); // absolute url -> local path

function localAsset(url) {
  if (!url) return null;
  let clean = url.split('?')[0];
  if (clean.startsWith('//')) clean = 'https:' + clean;
  if (!/^https?:/.test(clean)) return url;
  let name;
  try {
    const u = new URL(clean);
    if (!/squarespace-cdn|squarespace\.com|sqspcdn/.test(u.hostname)) return clean;
    const parts = u.pathname.split('/').filter(Boolean);
    name = parts.slice(-2).join('_') || parts.join('_');
  } catch { return clean; }
  name = decodeURIComponent(name).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!/\.[A-Za-z0-9]{2,5}$/.test(name)) name += '.jpg';
  // de-dupe collisions
  let final = name, n = 1;
  for (const [u2, p2] of assets) {
    if (p2 === 'assets/' + final && u2 !== clean) { final = name.replace(/(\.[^.]+)$/, `-${n++}$1`); }
  }
  assets.set(clean, 'assets/' + final);
  return 'assets/' + final;
}

function cleanText(s) {
  return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

// Convert an inline-rich element into simplified HTML (keep a/strong/em/br)
function inlineHtml($, el) {
  const $el = $(el).clone();
  $el.find('script,style').remove();
  $el.find('*').each((i, n) => {
    const tag = n.tagName ? n.tagName.toLowerCase() : '';
    if (['a', 'strong', 'b', 'em', 'i', 'br', 'u', 's', 'code', 'sup', 'sub', 'span'].includes(tag)) {
      const keep = {};
      if (tag === 'a') {
        let href = $(n).attr('href') || '';
        if (href.startsWith('//')) href = 'https:' + href;
        keep.href = href;
        if (/^https?:/.test(href) && !href.includes('littlemartians.world')) {
          keep.target = '_blank';
          keep.rel = 'noopener';
        }
      }
      n.attribs = keep;
    } else {
      // unwrap unknown inline containers
      $(n).replaceWith($(n).html() || '');
    }
  });
  return $el.html().replace(/\u00a0/g, "&nbsp;").replace(/[ \t]*\n[ \t]*/g, "<br>").replace(/[ \t]+/g, " ").replace(/<br>$/, "").trim();
}

const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'hr', 'pre', 'figure']);

function alignOf($, el) {
  const style = $(el).attr('style') || '';
  const m = style.match(/text-align:\s*([a-z]+)/);
  return m && m[1] !== 'left' ? m[1] : null;
}

function sizeOf($, el) {
  const cls = $(el).attr('class') || '';
  if (/sqsrte-large/.test(cls)) return 'large';
  if (/sqsrte-small/.test(cls)) return 'small';
  return null;
}

function walkText($, node, out) {
  $(node).children().each((i, el) => {
    const tag = (el.tagName || '').toLowerCase();
    if (!BLOCK_TAGS.has(tag)) {
      // wrapper div/section — recurse
      walkText($, el, out);
      return;
    }
    const align = alignOf($, el);
    const size = sizeOf($, el);
    const html = inlineHtml($, el);
    const text = cleanText($(el).text());
    if (tag === 'hr') { out.push({ type: 'divider' }); return; }
    if (!text && !/<img|<iframe/.test(html)) {
      // Blank paragraphs still occupy lines on the live site: one line per
      // explicit break, or a single line for preserve-empty markers.
      const raw = $(el).html() || '';
      const breaks = (raw.match(/<br/gi) || []).length;
      if (breaks > 0 || $(el).attr('data-rte-preserve-empty') === 'true') {
        const lines = Math.max(1, breaks);
        out.push({ type: 'paragraph', html: Array(lines).fill('&nbsp;').join('<br>'), blank: true, align, size });
      }
      return;
    }
    if (/^h[1-6]$/.test(tag)) {
      out.push({ type: 'heading', level: Number(tag[1]), html, align, size });
    } else if (tag === 'ul' || tag === 'ol') {
      const items = [];
      $(el).children('li').each((j, li) => items.push(inlineHtml($, li)));
      out.push({ type: 'list', ordered: tag === 'ol', items, align });
    } else if (tag === 'blockquote') {
      out.push({ type: 'quote', html, align });
    } else {
      out.push({ type: 'paragraph', html, align, size });
    }
  });
}

function parseTextBlock($, blk) {
  const out = [];
  const root = $(blk).find('.sqs-html-content').first();
  walkText($, root.length ? root[0] : $(blk).find('.sqs-block-content')[0], out);
  if (!out.length) return [];
  // dividers split a text run into separate blocks
  const groups = [];
  let run = [];
  for (const b of out) {
    if (b.type === 'divider') { if (run.length) groups.push({ type: 'text', children: run }); groups.push(b); run = []; }
    else run.push(b);
  }
  if (run.length) groups.push({ type: 'text', children: run });
  return groups;
}

// "M0.30,0 H0.7 L1,0.3 ..." in objectBoundingBox coords -> CSS polygon()
function maskToPolygon(d) {
  if (!d) return null;
  if (/A/i.test(d)) return 'ellipse(50% 50% at 50% 50%)';
  const pts = [];
  let x = 0, y = 0;
  const re = /([MLHV])\s*([\d.]+)(?:[ ,]([\d.]+))?/g;
  let m;
  while ((m = re.exec(d))) {
    const [, cmd, a, b] = m;
    if (cmd === 'M' || cmd === 'L') { x = +a; y = +b; }
    else if (cmd === 'H') x = +a;
    else if (cmd === 'V') y = +a;
    pts.push(`${+(x * 100).toFixed(1)}% ${+(y * 100).toFixed(1)}%`);
  }
  return pts.length >= 3 ? `polygon(${pts.join(', ')})` : null;
}

function parseImageBlock($, blk) {
  const $img = $(blk).find('img').first();
  if (!$img.length) return [];
  const figClass = $(blk).find('figure').attr('class') || '';
  const layout = (figClass.match(/design-layout-([a-z]+)/) || [])[1] || 'inline';
  const position = /image-position-right/.test(figClass) ? 'right' : 'left';
  let description = $(blk).find('.image-inset').attr('data-description') || '';
  if (description) {
    const $d = cheerio.load('<div>' + description + '</div>');
    description = cleanText($d('div').text());
  }
  const aspect = $(blk).attr('data-aspect-ratio') || null;
  const mask = maskToPolygon($(blk).find('svg path').attr('d'));
  const src = $img.attr('data-src') || $img.attr('data-image') || $img.attr('src');
  const dims = ($img.attr('data-image-dimensions') || '').split('x');
  const caption = cleanText($(blk).find('.image-caption').text());
  const captionHtml = $(blk).find('.image-caption').length
    ? inlineHtml($, $(blk).find('.image-caption p').first()[0] || $(blk).find('.image-caption')[0])
    : '';
  // Card / overlap layouts put their text in a separate title + subtitle pair.
  const title = cleanText($(blk).find('.image-title').text());
  const subtitle = cleanText($(blk).find('.image-subtitle').text());
  const buttonEl = $(blk).find('.sqs-block-button-element, .image-button a').first();
  const button = buttonEl.length
    ? { text: cleanText(buttonEl.text()), href: buttonEl.attr('href') || '' }
    : null;
  let link = $(blk).find('a.sqs-block-image-link').attr('href') || '';
  if (link.startsWith('//')) link = 'https:' + link;
  return [{
    type: 'image',
    src: localAsset(src),
    alt: $img.attr('alt') || '',
    width: Number(dims[0]) || null,
    height: Number(dims[1]) || null,
    caption: captionHtml || caption,
    title: title || null,
    subtitle: subtitle || null,
    button,
    link: link || null,
    layout,
    position,
    description: description || null,
    aspect: aspect ? Number(aspect) : null,
    mask,
  }];
}

function parseGalleryBlock($, blk) {
  let conf = {};
  try { conf = JSON.parse($(blk).attr('data-block-json') || '{}'); } catch {}
  const images = [];
  $(blk).find('img').each((i, img) => {
    const src = $(img).attr('data-src') || $(img).attr('data-image') || $(img).attr('src');
    if (!src) return;
    const dims = ($(img).attr('data-image-dimensions') || '').split('x');
    const local = localAsset(src);
    if (images.some(im => im.src === local)) return;
    images.push({ src: local, alt: $(img).attr('alt') || '', width: Number(dims[0]) || null, height: Number(dims[1]) || null });
  });
  if (!images.length) return [];
  return [{
    type: 'gallery', images,
    perRow: conf['thumbnails-per-row'] || 4,
    square: conf['square-thumbs'] !== false,
    padding: conf.padding != null ? conf.padding : 20,
  }];
}

function parseVideoBlock($, blk) {
  const maxW = (($(blk).find('.intrinsic').attr('style') || '').match(/max-width:\s*([\d.]+)px/) || [])[1];
  const $w = $(blk).find('.sqs-video-wrapper').first();
  const raw = $w.attr('data-html') || '';
  const m = raw.match(/src="([^"]+)"/) || raw.match(/src='([^']+)'/);
  let url = m ? m[1] : null;
  const titleM = raw.match(/title="([^"]*)"/);
  const provider = $w.attr('data-provider-name') || '';
  // native squarespace-hosted video
  const $native = $(blk).find('video source, video').first();
  if (!url && $native.length) {
    const s = $native.attr('src');
    if (s) return [{ type: 'video', kind: 'file', src: localAsset(s), title: '' }];
  }
  if (!url) {
    // component-based video: look for url in JSON props
    const json = $(blk).attr('data-block-json') || $(blk).html() || '';
    const y = json.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (y) url = 'https://www.youtube.com/embed/' + y[1];
    const v = json.match(/player\.vimeo\.com\/video\/(\d+)/) || json.match(/vimeo\.com\/(\d+)/);
    if (!url && v) url = 'https://player.vimeo.com/video/' + v[1];
  }
  if (!url) return [];
  if (url.startsWith('//')) url = 'https:' + url;
  const ratioM = ($(blk).find('.embed-block-wrapper').attr('style') || '').match(/padding-bottom:\s*([\d.]+)%/);
  const $cap = $(blk).find('.video-caption').first();
  // Custom thumbnail shown before playback.
  const $poster = $(blk).find('.sqs-video-overlay img').first();
  const posterSrc = $poster.attr('data-src') || $poster.attr('data-image') || $poster.attr('src');
  return [{
    type: 'video', kind: 'embed', src: url, provider,
    maxWidth: maxW ? Number(maxW) : null,
    poster: posterSrc ? localAsset(posterSrc) : null,
    title: titleM ? titleM[1].replace(/&amp;/g, '&') : '',
    caption: $cap.length ? inlineHtml($, $cap.find('p').first()[0] || $cap[0]) : '',
    ratio: ratioM ? Number(ratioM[1]) : 56.25,
  }];
}

function parseButtonBlock($, blk) {
  const $a = $(blk).find('a').first();
  if (!$a.length) return [];
  let href = $a.attr('href') || '#';
  if (href.startsWith('//')) href = 'https:' + href;
  const $c = $(blk).find('.sqs-block-button-container').first();
  const size = ($c.attr('data-button-size')) ||
    (($a.attr('class') || '').match(/--(small|medium|large)/) || [])[1] || 'small';
  const align = (($c.attr('class') || '').match(/container--(left|center|right)/) || [])[1] || 'center';
  return [{
    type: 'button',
    text: cleanText($a.text()),
    href,
    size,
    align,
    external: /^https?:/.test(href) && !href.includes('littlemartians.world'),
  }];
}

function parseSocialBlock($, blk) {
  const links = [];
  $(blk).find('a').each((i, a) => {
    let href = $(a).attr('href') || '';
    if (href.startsWith('//')) href = 'https:' + href;
    if (!href || href === '#') return;
    const cls = ($(a).attr('class') || '') + ' ' + ($(a).find('use').attr('xlink:href') || '');
    let name = (cls.match(/([a-z]+)-unauth|#([a-z]+)-icon/i) || [])[1] || '';
    if (!name) { try { name = new URL(href).hostname.replace(/^www\./, '').split('.')[0]; } catch {} }
    if (links.some(l => l.href === href)) return;
    links.push({ href, name });
  });
  // an empty social block still occupies its 34px of padding on the live site
  return links.length ? [{ type: 'social', links }] : [{ type: 'spacer', ar: 0, placeholder: true }];
}

function parseFormBlock($, blk) {
  // Squarespace renders forms client-side; the definition is a JSON blob in the block.
  const text = $(blk).find('.sqs-block-content').text();
  const at = text.indexOf('{"secureUrl"');
  if (at >= 0) {
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let i = at; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = !inStr;
      if (inStr) continue;
      if (c === '{') depth++;
      if (c === '}') { depth--; if (!depth) { end = i + 1; break; } }
    }
    try {
      const j = JSON.parse(text.slice(at, end));
      const fields = (j.formFields || []).map(x => ({
        label: (x.title || x.label || '').trim(),
        type: /textarea|paragraph/i.test(x.type) ? 'textarea'
          : /email/i.test(x.type) ? 'email'
          : /phone/i.test(x.type) ? 'tel'
          : /date/i.test(x.type) ? 'date'
          : /number/i.test(x.type) ? 'number'
          : /name/i.test(x.type) ? 'name'
          : 'text',
        required: !!x.required,
      })).filter(x => x.label);
      if (fields.length) {
        return [{ type: 'form', title: (j.formName || '').trim(), fields, button: j.formSubmitButtonText || 'Submit' }];
      }
    } catch {}
  }
  const fields = [];
  $(blk).find('.form-item').each((i, f) => {
    const label = cleanText($(f).find('.title').first().text());
    const type = $(f).find('textarea').length ? 'textarea' : ($(f).find('input').attr('type') || 'text');
    fields.push({ label, type, required: /required/i.test($(f).attr('class') || '') });
  });
  const button = cleanText($(blk).find('.form-button-wrapper').text()) || 'Submit';
  const title = cleanText($(blk).find('.form-block .field-list').prev('h2').text());
  return [{ type: 'form', title, fields, button }];
}

function parseCodeBlock($, blk) {
  const html = $(blk).find('.sqs-block-content').html() || '';
  const y = html.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (y) return [{ type: 'video', kind: 'embed', src: 'https://www.youtube.com/embed/' + y[1], ratio: 56.25, title: '' }];
  const v = html.match(/player\.vimeo\.com\/video\/(\d+)/);
  if (v) return [{ type: 'video', kind: 'embed', src: 'https://player.vimeo.com/video/' + v[1], ratio: 56.25, title: '' }];
  const iframe = html.match(/<iframe[\s\S]*?<\/iframe>/i);
  if (iframe) return [{ type: 'embed', html: iframe[0] }];
  return [];
}

function parseBlock($, blk) {
  const kind = $(blk).attr('data-sqsp-block') || '';
  const type = $(blk).attr('data-block-type') || '';
  const def = $(blk).attr('data-definition-name') || '';
  if (kind === 'text' || type === '2') return parseTextBlock($, blk);
  if (kind === 'image-classic' || type === '5') return parseImageBlock($, blk);
  if (kind === 'gallery' || type === '8') return parseGalleryBlock($, blk);
  if (kind === 'video' || /components\.video/.test(def)) return parseVideoBlock($, blk);
  if (kind === 'button' || /components\.button/.test(def)) return parseButtonBlock($, blk);
  if (kind === 'line' || /components\.(line|horizontal-?rule)/.test(def)) return [{ type: 'divider' }];
  if (kind === 'social-links' || /socialLinks/.test(def)) return parseSocialBlock($, blk);
  if (kind === 'form') return parseFormBlock($, blk);
  if (type === '23' || /code/.test(kind)) return parseCodeBlock($, blk);
  if (/components\.spacer/.test(def) || /spacer-block/.test($(blk).attr('class') || '')) {
    const ar = $(blk).attr('data-aspect-ratio');
    return [{ type: 'spacer', ar: ar ? Number(Number(ar).toFixed(3)) : null }];
  }
  // Unknown component: try text fallback
  const t = parseTextBlock($, blk);
  if (t.length) return t;
  return [];
}

// Walk a Squarespace layout container, preserving its row/column grid so the
// rebuild keeps the original multi-column arrangement.
function parseContainer($, node, slug) {
  const out = [];
  $(node).children().each((i, el) => {
    const cls = $(el).attr('class') || '';
    if (/\bsqs-block\b/.test(cls)) {
      try {
        for (const b of parseBlock($, el)) out.push(b);
      } catch (e) {
        console.error('block error', slug, e.message);
      }
      return;
    }
    if (/\brow\b/.test(cls) && /sqs-row/.test(cls)) {
      const cols = [];
      $(el).children('.col').each((j, col) => {
        const m = ($(col).attr('class') || '').match(/span-(\d+)/);
        const span = m ? Number(m[1]) : 12;
        const content = parseContainer($, col, slug);
        cols.push({ span, content });
      });
      const filled = cols.filter(c => c.content.length);
      if (!filled.length) return;
      // A single full-width column adds nothing — flatten it away.
      if (filled.length === 1 && filled[0].span >= 12) {
        out.push(...filled[0].content);
        return;
      }
      // Keep empty columns: in the original they act as offsets/gutters.
      out.push({ type: 'row', cols: cols.filter(c => c.span > 0) });
      return;
    }
    // plain wrapper — recurse
    out.push(...parseContainer($, el, slug));
  });
  return out;
}

function parsePage(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const $ = cheerio.load(raw);
  const slug = path.basename(file, '.html');

  const title = cleanText($('meta[property="og:title"]').attr('content')) ||
                cleanText($('title').text());
  const description = cleanText($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content'));
  const ogImage = $('meta[property="og:image"]').attr('content') || null;

  const sections = [];
  const $sections = $('main section.Index-page');
  const pageType = $sections.length ? 'index' : 'standalone';
  const intro = $('.Intro').length > 0;
  const containers = $sections.length ? $sections : $('main');

  containers.each((i, sec) => {
    const id = $(sec).attr('id') || `section-${i + 1}`;
    const classes = $(sec).attr('class') || '';
    let bg = null, bgVideo = null;
    const $fig = $(sec).children('.Index-page-image');
    const $bgImg = $fig.find('img').first();
    if ($bgImg.length) {
      bg = localAsset($bgImg.attr('data-src') || $bgImg.attr('data-image') || $bgImg.attr('src'));
    }
    const cfg = $fig.find('.sqs-video-background').attr('data-config-url');
    if (cfg) {
      const y = cfg.match(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
      const v = cfg.match(/vimeo\.com\/(?:video\/)?(\d+)/);
      if (y) bgVideo = { provider: 'youtube', id: y[1] };
      else if (v) bgVideo = { provider: 'vimeo', id: v[1] };
    }
    const layout = $(sec).find('.sqs-layout').first();
    const blocks = layout.length ? parseContainer($, layout[0], slug) : [];
    if (blocks.length || bg || bgVideo) {
      sections.push({ id, background: bg, backgroundVideo: bgVideo, hasImage: /has-image/.test(classes), blocks });
    }
  });

  return { slug, title, description, pageType, intro, ogImage: ogImage ? localAsset(ogImage) : null, sections };
}

const files = fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'));
const index = [];
for (const f of files) {
  const page = parsePage(path.join(HTML_DIR, f));
  fs.writeFileSync(path.join(OUT_DIR, page.slug + '.json'), JSON.stringify(page, null, 2));
  const nBlocks = page.sections.reduce((a, s) => a + s.blocks.length, 0);
  index.push({ slug: page.slug, title: page.title, sections: page.sections.length, blocks: nBlocks });
}
fs.writeFileSync(path.join(OUT_DIR, '_index.json'), JSON.stringify(index, null, 2));
fs.writeFileSync(path.join(SITE, '_archive', 'assets-map.json'), JSON.stringify(Object.fromEntries(assets), null, 2));
console.log(index.map(p => `${p.slug.padEnd(28)} sections=${String(p.sections).padStart(2)} blocks=${p.blocks}`).join('\n'));
console.log('\nassets:', assets.size);
