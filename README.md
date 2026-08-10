# Sketchbook Flipbook — setup guide

A self-contained, watermark-free flipbook widget. Point it at a single PDF
of your sketchbook and it renders it as a real book: the **first page opens
as a single cover**, the **last page closes as a single back cover**, and
everything between shows as a **two-page spread**, exactly like flipping
through the physical thing.

## What's in this folder

```
sketchbook-flipbook/
├── index.html              demo page — open via a local server to preview (see below)
├── flipbook.css              styling (Outfit type, paper + gilt-edge theme)
├── flipbook.js                page-turn engine (vanilla JS, ES module, no framework)
├── pdfjs/                      self-hosted PDF renderer (no CDN, no watermark)
│   ├── pdf.min.mjs
│   └── pdf.worker.min.mjs
├── sample-sketchbook.pdf   a 9-page placeholder PDF so the demo works out of the box
└── images/                   placeholder sketch pages, if you'd rather use loose images instead of a PDF
```

## 1. Preview it locally

Because the engine loads as an ES module and fetches the PDF, **double-clicking
`index.html` won't work** — browsers block module scripts and file fetches
over `file://`. You need to serve the folder over `http`, either:

- **VS Code**: install the "Live Server" extension, right-click `index.html` →
  *Open with Live Server*.
- **Terminal** (if you have Python installed): from inside this folder, run
  `python3 -m http.server 8000`, then open `http://localhost:8000` in your browser.

Once it's running, click either side of the open spread (that's the only
way to turn pages now — there are no on-screen arrows), swipe, or use the
← → keys. This local-server requirement goes away once it's uploaded to
your actual site — regular web hosting always serves over `http`/`https`.

## 2. Point it at your own sketchbook

The simplest path: scan your **entire** sketchbook — front cover, every
page in order, back cover — into **one PDF**, in reading order.

1. Export/scan it as a single PDF. Keep the resolution reasonable — around
   150–200 DPI is plenty for on-screen viewing and keeps the file (and load
   time) small. A 24-page sketchbook at that resolution is typically well
   under 10 MB.
2. Upload that PDF next to `flipbook.js` (see step 3).
3. In `index.html`, point `data-pdf` at its filename:

```html
<div
  class="sfb-flipbook"
  data-pdf="my-sketchbook.pdf"
  data-width="380"
  data-ratio="3 / 4"
  data-max-height="420"
></div>
```

- `data-width` — width in pixels of **one page** (the book is roughly
  double this when open, at its natural size).
- `data-ratio` — the aspect ratio of one page, e.g. `"3 / 4"` for portrait,
  `"4 / 3"` for landscape. Doesn't need to be exact — pages that don't
  perfectly match just sit centered on their paper background.
- `data-max-height` — caps how tall the open book is allowed to get, in
  pixels (default `420`). The widget always keeps the page's true aspect
  ratio, so when height is the limiting factor it shrinks the width to
  match rather than distorting the pages. This is the main knob for fitting
  the widget into a shorter embed — lower it for a more compact strip,
  raise it for a larger book. It also re-applies on window resize, so it
  stays correctly sized on rotation/responsive layouts.
- `data-pdf-scale` (optional) — rendering resolution multiplier, default
  `1.6`. Raise it (e.g. `2`) if pages look soft on large screens; lower it
  if you want faster loading on a very long sketchbook.

That's it — the widget opens the PDF, reads the page count, and lays out
the cover/spreads/back-cover automatically. No image cropping or exporting
required.

### Prefer loose images instead of a PDF?

The engine works the same way with a plain image list — the first image
becomes the cover, the last becomes the back cover, the rest become spreads:

```html
<div
  class="sfb-flipbook"
  data-images='["images/01.jpg","images/02.jpg","images/03.jpg"]'
  data-width="380"
  data-ratio="3 / 4"
></div>
```

## 3. Upload via cPanel

1. Log in to cPanel and open **File Manager**.
2. Navigate to `public_html` (or the subfolder for the page you want this on).
3. Create a folder, e.g. `sketchbook`, and upload everything from this
   folder into it:
   - `flipbook.css`
   - `flipbook.js`
   - the `pdfjs/` folder (both files inside it — this is what renders the
     PDF; it must sit next to `flipbook.js`)
   - your PDF (or your `images/` folder, if using image mode)
4. Either upload `index.html` as-is and link to it at
   `yourdomain.com/sketchbook/index.html`, or copy the widget markup (step 2)
   into an existing page on your site, making sure that page also loads:

```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/sketchbook/flipbook.css" />
```

and, just before `</body>`:

```html
<script type="module" src="/sketchbook/flipbook.js"></script>
```

(Note the `type="module"` — it's required now that the engine loads pdf.js
on demand.)

**Same-origin note:** the PDF (or images) must be hosted on the same domain
as the page embedding the widget — which they will be, since you're
uploading everything to your own cPanel together.

## 4. Embedding into an existing page (WordPress, page builders, etc.)

If your site builder doesn't give you easy access to `<head>` tags or
`type="module"` scripts, wrap `index.html` in an iframe instead — the
simplest path when pasting into a "custom HTML" block:

```html
<iframe
  src="/sketchbook/index.html"
  style="width: 100%; max-width: 900px; height: 520px; border: 0; display: block; margin: 0 auto;"
  loading="lazy"
></iframe>
```

## Notes on the design

- **Cover and back cover are always single pages; everything else is a
  spread** — this falls directly out of how the page count is split, so it
  works automatically no matter how many pages your PDF has (including if
  the number of interior pages is odd — in that case one interior spread
  gets a blank facing page, same as a real printed book would).
- **No corner-drag/curl effect on purpose** — it's the heaviest part of any
  flipbook to render well, and skipping it keeps the widget light and the
  motion clean and consistent (a straight page-turn), per your original ask.
- **No background stage, no arrow buttons** — the widget sits directly on
  your page's own background with nothing framing it, and pages turn only
  by clicking/tapping the page itself (left half = back, right half =
  forward), swiping, or the ← → keys.
- **Flips overlap instead of queuing one-at-a-time.** Tapping ahead
  multiple times doesn't wait for each flip to finish before starting the
  next — every flip plays at the same normal speed, and several can be
  mid-turn at once, like riffling through the book quickly. The one thing
  that's still made to finish first is a change of direction: if you're
  flipping forward and then tap backward, the forward flip(s) already in
  motion settle before the book turns the other way (otherwise a page
  could be asked to reverse mid-turn, which never looks right).
- The gold fore-edge and spine crease are pure CSS (no images), so they add
  no extra load time, and each fades out on the side that has no page yet
  (e.g. nothing to the left of the cover).
- Pages render lazily — only the current spread and its immediate neighbors
  are drawn, whether the source is a PDF or a plain image list — so a
  long sketchbook doesn't load or render everything up front.
- Respects `prefers-reduced-motion` and is fully keyboard accessible.
- pdf.js is self-hosted inside `pdfjs/` (about 1.8 MB total, only fetched
  when a `data-pdf` widget is actually used) — no third-party CDN, no
  external branding, nothing that can change or break under you later.

## Customizing the look

Colors are CSS custom properties at the top of `flipbook.css`
(`.sfb-wrap` block) — change `--sfb-paper`, `--sfb-gold`, etc.
if you want a different palette than the current warm-paper / dark-stage /
gilt-edge theme.
