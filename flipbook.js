/*!
 * Sketchbook Flipbook — vanilla JS ES module, no framework, no watermark.
 *
 * Behavior: the first page renders alone (cover), the last page renders
 * alone (back cover), and everything in between renders as a two-page
 * spread — like an open physical book. Turned by clicking/tapping either
 * half of the open pages (no on-screen arrows), swiping, or ← / → keys.
 *
 * Flips all animate at the same speed. Tapping ahead while a flip is
 * still animating does NOT wait for it to finish — the next flip starts
 * immediately and the two overlap, like riffling through pages quickly.
 * The only time a flip is made to finish first is when the direction
 * reverses (going forward, then back, or vice versa) — that always
 * settles the in-progress page(s) before turning the other way.
 *
 * Source can be either a flat list of images, or a single PDF file: the
 * widget will render each PDF page on demand using a self-hosted copy of
 * pdf.js (no CDN dependency, no external branding).
 *
 * Usage (auto-init from markup):
 *   <div class="sfb-flipbook" data-pdf="my-sketchbook.pdf"></div>
 *   <script type="module" src="flipbook.js"></script>
 *
 *   <div class="sfb-flipbook" data-images='["images/01.jpg","images/02.jpg"]'></div>
 *
 * Usage (manual):
 *   const book = new SketchFlipbook(document.getElementById('myBook'), {
 *     pdf: 'my-sketchbook.pdf',   // OR images: ['a.jpg', 'b.jpg', ...]
 *     ratio: '3 / 4',              // aspect ratio of ONE page
 *     width: 380,                   // preferred width of ONE page, in px
 *     maxHeight: 420,                // cap on the open book's height, in px
 *     pdfScale: 1.6                  // render resolution multiplier for PDF pages
 *   });
 */
(function (global) {
  "use strict";

  const UNTURNED_BASE = 1000;
  const FLIP_MS = 700; // same speed for every flip, overlapping or not

  // Resolve the folder this script lives in, so the bundled pdf.js build
  // can be found regardless of what page includes flipbook.js.
  const SCRIPT_BASE = new URL(".", import.meta.url).href;

  let pdfjsPromise = null;
  function loadPdfJs(pdfjsPath) {
    if (!pdfjsPromise) {
      const base = pdfjsPath || SCRIPT_BASE + "pdfjs/";
      pdfjsPromise = import(/* webpackIgnore: true */ base + "pdf.min.mjs").then((mod) => {
        mod.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
        return mod;
      });
    }
    return pdfjsPromise;
  }

  /* ---------------- page sources ---------------- */

  class ImageSource {
    constructor(urls) {
      this.urls = urls;
      this.count = urls.length;
      this._cache = new Map();
    }
    async ready() {}
    getEl(index) {
      if (index == null || index < 0 || index >= this.count) return Promise.resolve(null);
      if (this._cache.has(index)) return this._cache.get(index);
      const p = new Promise((resolve) => {
        const img = document.createElement("img");
        img.alt = "Page " + (index + 1);
        img.draggable = false;
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
        img.src = this.urls[index];
      });
      this._cache.set(index, p);
      return p;
    }
  }

  class PdfSource {
    constructor(url, opts) {
      this.url = url;
      this.count = 0;
      this.scale = (opts && opts.pdfScale) || 1.6;
      this.pdfjsPath = opts && opts.pdfjsPath;
      this._doc = null;
      this._cache = new Map();
    }
    async ready() {
      const pdfjsLib = await loadPdfJs(this.pdfjsPath);
      this._doc = await pdfjsLib.getDocument(this.url).promise;
      this.count = this._doc.numPages;
    }
    getEl(index) {
      if (index == null || index < 0 || index >= this.count) return Promise.resolve(null);
      if (this._cache.has(index)) return this._cache.get(index);
      const p = (async () => {
        const page = await this._doc.getPage(index + 1); // pdf.js pages are 1-based
        const dpr = Math.min(global.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: this.scale * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        return canvas;
      })();
      this._cache.set(index, p);
      return p;
    }
  }

  /* ---------------- main widget ---------------- */

  class SketchFlipbook {
    constructor(container, options) {
      if (!container) throw new Error("SketchFlipbook: container element is required");
      this.container = container;
      const opts = options || {};

      this.ratio = opts.ratio || "3 / 4";
      this.width = opts.width || 380;
      this.maxHeight = opts.maxHeight || 420;
      this.pdfScale = opts.pdfScale;
      this.pdfjsPath = opts.pdfjsPath;

      this.current = 0; // index that's been committed to (a flip toward it has started)
      this.lastDirection = null; // 1 = forward, -1 = back — direction of the most recent fire
      this.inFlight = new Set(); // leaf indices currently mid-animation
      this.pending = []; // directions waiting on a direction change to resolve
      this.zCounter = UNTURNED_BASE * 2; // ever-increasing, so newer flips sit above older ones

      this.views = [];
      this.leaves = []; // DOM leaf elements, index-aligned with leafModel
      this.leafModel = []; // [{frontIndex, backIndex}]

      if (opts.pdf) {
        this.source = new PdfSource(opts.pdf, { pdfScale: this.pdfScale, pdfjsPath: this.pdfjsPath });
      } else if (opts.images && opts.images.length) {
        this.source = new ImageSource(opts.images);
      } else {
        console.warn("SketchFlipbook: no `pdf` or `images` source provided for", container);
        return;
      }

      this._renderShell();
      this._init();
    }

    /* ---------------- setup ---------------- */

    _renderShell() {
      this.container.classList.add("sfb-wrap");
      this.container.innerHTML = `
        <div class="sfb-stage">
          <div class="sfb-book-outer">
            <div class="sfb-book"><div class="sfb-loading">Opening sketchbook…</div></div>
          </div>
        </div>
        <div class="sfb-indicator" style="visibility:hidden">
          <div class="sfb-indicator-track"><div class="sfb-indicator-fill"></div></div>
          <div class="sfb-indicator-label">
            <span class="sfb-current"></span><span>/</span><span class="sfb-total"></span>
          </div>
        </div>
      `;
      this.bookOuter = this.container.querySelector(".sfb-book-outer");
      this.bookEl = this.container.querySelector(".sfb-book");
      this.indicatorEl = this.container.querySelector(".sfb-indicator");
      this.fillEl = this.container.querySelector(".sfb-indicator-fill");
      this.currentLabel = this.container.querySelector(".sfb-current");
      this.totalLabel = this.container.querySelector(".sfb-total");

      const [rw, rh] = this._parseRatio(this.ratio);
      this.aspect = (rw * 2) / rh; // width / height of the OPEN spread

      this._applySize();
      this._resizeHandler = () => this._applySize();
      global.addEventListener("resize", this._resizeHandler);
    }

    _parseRatio(str) {
      const parts = String(str).split("/").map((n) => parseFloat(n.trim()));
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return parts;
      return [3, 4];
    }

    // Sizes the book to fit the container's width while never exceeding
    // `maxHeight` — shrinking width to match when height is the tighter
    // constraint, so the aspect ratio is always preserved exactly.
    _applySize() {
      const parentW = this.container.clientWidth || this.width * 2;
      let w = Math.min(this.width * 2, parentW);
      let h = w / this.aspect;
      if (h > this.maxHeight) {
        h = this.maxHeight;
        w = h * this.aspect;
      }
      this.bookOuter.style.width = Math.round(w) + "px";
      this.bookOuter.style.height = Math.round(h) + "px";
    }

    async _init() {
      try {
        await this.source.ready();
      } catch (err) {
        console.error("SketchFlipbook: failed to load source", err);
        this.bookEl.innerHTML = `<div class="sfb-error">Couldn't load this sketchbook. Check that the file path is correct and, if it's a PDF, that it's on the same domain as this page.</div>`;
        return;
      }
      const n = this.source.count;
      if (!n) {
        this.bookEl.innerHTML = `<div class="sfb-error">This sketchbook has no pages to show.</div>`;
        return;
      }
      this._buildViews(n);
      this._buildDom();
      this.indicatorEl.style.visibility = "visible";
      this._layoutInitial();
    }

    /* ---------------- view / leaf model ----------------
     * views[i] = { left: pageIndex|null, right: pageIndex|null }
     * views[0] is always the cover alone (right only).
     * views[last] is always the back cover alone (left only).
     * everything between is a two-page spread.
     * leafModel[i] describes the physical leaf that, when turned,
     * carries the reader from views[i] to views[i+1].
     */
    _buildViews(n) {
      const views = [];
      if (n === 1) {
        views.push({ left: null, right: 0 });
        this.views = views;
        this.leafModel = [];
        return;
      }

      views.push({ left: null, right: 0 }); // cover

      let interior = [];
      for (let i = 1; i <= n - 2; i++) interior.push(i);
      if (interior.length % 2 === 1) interior.push(null); // pad so pairs are even

      for (let i = 0; i < interior.length; i += 2) {
        views.push({ left: interior[i], right: interior[i + 1] });
      }

      views.push({ left: n - 1, right: null }); // back cover

      const leafModel = [];
      for (let i = 0; i < views.length - 1; i++) {
        leafModel.push({ frontIndex: views[i].right, backIndex: views[i + 1].left });
      }

      this.views = views;
      this.leafModel = leafModel;
    }

    _buildDom() {
      this.bookEl.innerHTML = "";

      this.spineEl = document.createElement("div");
      this.spineEl.className = "sfb-spine";
      this.bookEl.appendChild(this.spineEl);

      this.giltLeft = document.createElement("div");
      this.giltLeft.className = "sfb-gilt sfb-gilt-left";
      this.giltRight = document.createElement("div");
      this.giltRight.className = "sfb-gilt sfb-gilt-right";
      this.bookEl.appendChild(this.giltLeft);
      this.bookEl.appendChild(this.giltRight);

      this.leaves = this.leafModel.map((leaf, i) => {
        const el = document.createElement("div");
        el.className = "sfb-page";
        el.dataset.index = String(i);
        el.innerHTML = `
          <div class="sfb-face sfb-face-front"></div>
          <div class="sfb-face sfb-face-back"></div>
        `;
        this.bookEl.appendChild(el);
        return el;
      });

      this.zonePrev = document.createElement("div");
      this.zonePrev.className = "sfb-zone sfb-zone-prev";
      this.zonePrev.setAttribute("aria-label", "Previous page");
      this.zoneNext = document.createElement("div");
      this.zoneNext.className = "sfb-zone sfb-zone-next";
      this.zoneNext.setAttribute("aria-label", "Next page");
      this.bookOuter.appendChild(this.zonePrev);
      this.bookOuter.appendChild(this.zoneNext);

      this.container.setAttribute("tabindex", "0");
      this.container.setAttribute("role", "group");

      this._bindEvents();
      this.totalLabel.textContent = String(this.views.length);
    }

    /* ---------------- fill a face with content (lazy) ---------------- */

    async _fillFace(leafEl, faceClass, pageIndex) {
      const face = leafEl.querySelector("." + faceClass);
      if (!face || face.dataset.filled === String(pageIndex)) return;
      face.dataset.filled = String(pageIndex);
      if (pageIndex == null) {
        face.classList.add("sfb-face-blank");
        face.innerHTML = "";
        return;
      }
      const el = await this.source.getEl(pageIndex);
      if (face.dataset.filled !== String(pageIndex)) return; // moved on while loading
      face.classList.remove("sfb-face-blank");
      face.innerHTML = "";
      if (el) face.appendChild(el);
      else face.classList.add("sfb-face-blank");
    }

    _loadNear() {
      const pendingReach = this.current + this.pending.reduce((a, b) => a + b, 0);
      const lo = Math.max(0, Math.min(this.current, pendingReach) - 1);
      const hi = Math.min(this.leaves.length - 1, Math.max(this.current, pendingReach) + 1);
      for (let i = lo; i <= hi; i++) {
        const model = this.leafModel[i];
        const el = this.leaves[i];
        this._fillFace(el, "sfb-face-front", model.frontIndex);
        this._fillFace(el, "sfb-face-back", model.backIndex);
      }
    }

    /* ---------------- initial (non-animated) render ---------------- */

    _layoutInitial() {
      const N = this.leaves.length;
      this.leaves.forEach((el, i) => {
        const turned = i < this.current;
        el.style.transform = turned ? "rotateY(-180deg)" : "rotateY(0deg)";
        el.style.zIndex = turned ? String(i) : String(UNTURNED_BASE + (N - i));
      });
      this._loadNear();
      this._updateChrome();
    }

    _updateChrome() {
      const total = this.views.length;
      const view = this.views[this.current];
      this.giltLeft.classList.toggle("sfb-hidden", view.left == null);
      this.giltRight.classList.toggle("sfb-hidden", view.right == null);
      this.currentLabel.textContent = String(this.current + 1).padStart(2, "0");
      const pct = total > 1 ? (this.current / (total - 1)) * 100 : 100;
      this.fillEl.style.width = pct + "%";
      this.container.setAttribute("aria-label", "Sketchbook flipbook, page " + (this.current + 1) + " of " + total);
    }

    /* ---------------- turning ----------------
     * next()/prev() enqueue a direction. `_drain()` fires as many of them
     * as it safely can: same-direction taps fire immediately and overlap
     * freely (no waiting for the previous flip's animation to finish); a
     * tap that reverses direction only fires once every leaf currently
     * in flight has fully settled.
     */

    next() { this._request(1); }
    prev() { this._request(-1); }

    _request(dir) {
      const projected = this.current + this.pending.reduce((a, b) => a + b, 0);
      if (dir > 0 && projected >= this.views.length - 1) return;
      if (dir < 0 && projected <= 0) return;
      this.pending.push(dir);
      this._loadNear();
      this._drain();
    }

    _drain() {
      while (this.pending.length) {
        const dir = this.pending[0];
        if (this.inFlight.size > 0 && dir !== this.lastDirection) break; // wait for reversal
        this.pending.shift();
        this._fire(dir);
      }
    }

    _fire(dir) {
      const leafIndex = dir > 0 ? this.current : this.current - 1;
      const el = this.leaves[leafIndex];
      if (!el) return;

      this.current += dir;
      this.lastDirection = dir;
      this.inFlight.add(leafIndex);

      el.style.zIndex = String(++this.zCounter);
      el.classList.add("sfb-flipping");
      void el.offsetWidth;
      el.style.transform = dir > 0 ? "rotateY(-180deg)" : "rotateY(0deg)";

      this._updateChrome();
      this._loadNear();

      this._afterTransition(el, () => {
        this.inFlight.delete(leafIndex);
        el.classList.remove("sfb-flipping");
        this._settleLeaf(leafIndex);
        this._drain(); // a queued reversal may now be free to start
      });
    }

    _settleLeaf(leafIndex) {
      const N = this.leaves.length;
      const el = this.leaves[leafIndex];
      const turned = leafIndex < this.current;
      el.style.zIndex = turned ? String(leafIndex) : String(UNTURNED_BASE + (N - leafIndex));
    }

    /* ---------------- events ---------------- */

    _afterTransition(el, cb) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener("transitionend", onEnd);
        cb();
      };
      const onEnd = (e) => {
        if (e.target === el && e.propertyName === "transform") finish();
      };
      el.addEventListener("transitionend", onEnd);
      setTimeout(finish, FLIP_MS + 200); // fallback if transitionend doesn't fire
    }

    _bindEvents() {
      this.zoneNext.addEventListener("click", () => this.next());
      this.zonePrev.addEventListener("click", () => this.prev());

      this.container.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); this.next(); }
        if (e.key === "ArrowLeft") { e.preventDefault(); this.prev(); }
      });

      let startX = null;
      this.bookOuter.addEventListener("pointerdown", (e) => { startX = e.clientX; });
      this.bookOuter.addEventListener("pointerup", (e) => {
        if (startX === null) return;
        const dx = e.clientX - startX;
        startX = null;
        if (Math.abs(dx) < 40) return;
        if (dx < 0) this.next(); else this.prev();
      });
    }
  }

  global.SketchFlipbook = SketchFlipbook;

  function autoInit() {
    document.querySelectorAll("[data-images], [data-pdf]").forEach((el) => {
      if (el._sfbInited) return;
      el._sfbInited = true;
      const opts = {
        ratio: el.getAttribute("data-ratio") || undefined,
        width: el.getAttribute("data-width") ? parseInt(el.getAttribute("data-width"), 10) : undefined,
        maxHeight: el.getAttribute("data-max-height") ? parseInt(el.getAttribute("data-max-height"), 10) : undefined,
        pdfScale: el.getAttribute("data-pdf-scale") ? parseFloat(el.getAttribute("data-pdf-scale")) : undefined,
      };
      const pdf = el.getAttribute("data-pdf");
      if (pdf) {
        opts.pdf = pdf;
      } else {
        try {
          opts.images = JSON.parse(el.getAttribute("data-images"));
        } catch (err) {
          console.error("SketchFlipbook: data-images must be a JSON array", err);
          return;
        }
      }
      new SketchFlipbook(el, opts);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }
})(window);
