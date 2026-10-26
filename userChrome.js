(() => {
  const MESSAGE = "UCPageScroll:State";
  const frameScript = `data:application/javascript,${encodeURIComponent(`
    let scrolled = null;
    // A fixed/sticky header at the top would end up unreadable under the toolbar.
    const hasPinnedHeader = () => {
      const win = content;
      const x = win.innerWidth / 2;
      for (const y of [1, 20]) {
        for (let el of win.document.elementsFromPoint(x, y)) {
          for (; el && el !== win.document.documentElement; el = el.parentElement) {
            const position = win.getComputedStyle(el).position;
            if (position === "fixed" || position === "sticky") return true;
          }
        }
      }
      return false;
    };
    const report = event => {
      if (event && event.type === "scroll" && event.target !== content.document) return;
      const isNewTab = ["about:newtab", "about:home"].includes(content.location.href) || isBonjourr();
      const now = isNewTab || (content.scrollY > 0 && !hasPinnedHeader());
      if (now !== scrolled || event?.type !== "scroll") {
        scrolled = now;
        sendAsyncMessage("${MESSAGE}", { scrolled: now });
      }
    };
    addEventListener("scroll", report, true);
    addEventListener("pageshow", report, true);
    addEventListener("DOMContentLoaded", report, true);

    // Bonjourr declares the wallpaper's accent as theme-color; replace it with the rendered top edge.
    const SAMPLE_HOST = "online.bonjourr.fr";
    const SAMPLE_ADDON_ID = "{4f391a9e-8717-4ba6-a5b1-488a34931fcb}";
    const SAMPLE_ROWS = 4;
    let sampleTimer = null;
    const isBonjourr = () =>
      content.location.host === SAMPLE_HOST ||
      content.document.nodePrincipal.addonId === SAMPLE_ADDON_ID;
    const sampleTopColor = () => {
      const win = content;
      const doc = win.document;
      if (!isBonjourr() || !doc.head) return;
      const fullWidth = Math.max(2, Math.floor(win.innerWidth));
      // Sample the centre-to-right half: the tab strip sits over it.
      const left = Math.floor(fullWidth / 2);
      const width = fullWidth - left;
      const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = width;
      canvas.height = SAMPLE_ROWS;
      const ctx = canvas.getContext("2d");
      ctx.drawWindow(win, win.scrollX + left, win.scrollY, width, SAMPLE_ROWS, "rgb(0,0,0)");
      const pixels = ctx.getImageData(0, 0, width, SAMPLE_ROWS).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        r += pixels[i];
        g += pixels[i + 1];
        b += pixels[i + 2];
      }
      const count = pixels.length / 4;
      const hex = "#" + [r, g, b].map(v => Math.round(v / count).toString(16).padStart(2, "0")).join("");
      let meta = doc.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = doc.createElement("meta");
        meta.name = "theme-color";
        doc.head.append(meta);
      }
      if (meta.content !== hex) {
        meta.content = hex;
        sendAsyncMessage("UCPageScroll:Log", "bonjourr theme-color " + hex);
      }
      // Adaptive Tab Bar Colour can't read other add-ons' pages, so chrome applies it too.
      sendAsyncMessage("UCPageScroll:Color", hex);
    };
    // Frame-script globals have no timers; borrow the page's.
    // Throttle, not debounce: Bonjourr's constant mutations would otherwise postpone sampling.
    const scheduleSample = (delay = 100) => {
      if (sampleTimer) return;
      sampleTimer = content.setTimeout(() => {
        sampleTimer = null;
        try {
          sampleTopColor();
        } catch (error) {
          sendAsyncMessage("UCPageScroll:Log", "bonjourr sample failed: " + error);
        }
      }, delay);
    };
    addEventListener("DOMContentLoaded", event => {
      if (event.target === content.document && !isBonjourr()) sendAsyncMessage("UCPageScroll:Color", null);
    }, true);
    addEventListener("load", event => {
      if (event.target !== content.document || !isBonjourr()) return;
      sendAsyncMessage("UCPageScroll:Log", "bonjourr loaded");
      scheduleSample(0);
      content.setTimeout(() => scheduleSample(0), 400);
      // New tab pages may be preloaded hidden; resample once shown.
      content.document.addEventListener("visibilitychange", () => {
        if (!content.document.hidden) scheduleSample(0);
      });
      // Wallpaper swaps and Bonjourr rewriting theme-color both show up as DOM mutations.
      new content.MutationObserver(() => scheduleSample()).observe(content.document, {
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "src", "content"],
      });
    }, true);
  `)}`;

  const isNewTabPage = browser => {
    const spec = browser.currentURI?.spec || "";
    return spec === "about:newtab" || spec === "about:home" ||
      (typeof BROWSER_NEW_TAB_URL === "string" && spec === BROWSER_NEW_TAB_URL);
  };

  const syncRoot = () => {
    const root = document.documentElement;
    const browser = gBrowser.selectedBrowser;
    root.toggleAttribute("uc-page-scrolled", browser.hasAttribute("uc-page-scrolled") || isNewTabPage(browser));
    root.toggleAttribute("uc-newtab", isNewTabPage(browser));
    if (browser.ucPageColor) {
      root.style.setProperty("--uc-page-color", browser.ucPageColor);
      root.setAttribute("uc-page-color", "");
    } else {
      root.style.removeProperty("--uc-page-color");
      root.removeAttribute("uc-page-color");
    }
  };

  const onColor = ({ target: browser, data }) => {
    browser.ucPageColor = /^#[0-9a-f]{6}$/.test(data) ? data : null;
    if (browser === gBrowser.selectedBrowser) syncRoot();
  };

  const onMessage = ({ target: browser, data }) => {
    console.log("[uc] scroll state", data.scrolled);
    browser.toggleAttribute("uc-page-scrolled", data.scrolled === true);
    if (browser === gBrowser.selectedBrowser) syncRoot();
  };

  const onLog = ({ data }) => console.log("[uc]", data);

  window.messageManager.addMessageListener(MESSAGE, onMessage);
  window.messageManager.addMessageListener("UCPageScroll:Log", onLog);
  window.messageManager.addMessageListener("UCPageScroll:Color", onColor);
  window.messageManager.loadFrameScript(frameScript, true);
  gBrowser.tabContainer.addEventListener("TabSelect", syncRoot);
  const progressListener = { onLocationChange: () => syncRoot() };
  gBrowser.addProgressListener(progressListener);
  syncRoot();
  console.log("[uc] userChrome.js loaded");

  window.addEventListener("unload", () => {
    window.messageManager.removeDelayedFrameScript(frameScript);
    window.messageManager.removeMessageListener(MESSAGE, onMessage);
    window.messageManager.removeMessageListener("UCPageScroll:Log", onLog);
    window.messageManager.removeMessageListener("UCPageScroll:Color", onColor);
    gBrowser.tabContainer.removeEventListener("TabSelect", syncRoot);
    gBrowser.removeProgressListener(progressListener);
  }, { once: true });
})();
