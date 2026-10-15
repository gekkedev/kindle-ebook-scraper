// ==UserScript==
// @name         Amazon Kindle Ebook Scraper
// @namespace    https://github.com/gekkedev/kindle-ebook-scraper
// @updateURL    https://raw.githubusercontent.com/gekkedev/kindle-ebook-scraper/main/kindle-ebook-scraper.user.js
// @downloadURL  https://raw.githubusercontent.com/gekkedev/kindle-ebook-scraper/main/kindle-ebook-scraper.user.js
// @version      1.1
// @description  Automatically downloads entire ebooks from the Amazon Kindle Cloud Reader as a PDF, triggered by user action.
// @match        https://lesen.amazon.de/*?asin=*
// @match        https://read.amazon.co.uk/*?asin=*
// @match        https://read.amazon.com/*?asin=*
// @match        https://lire.amazon.fr/*?asin=*
// @match        https://leer.amazon.es/*?asin=*
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @require      https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// ==/UserScript==

;(function () {
  "use strict"
  const softwareTitle = "Amazon Kindle Ebook Scraper"

  // ---------- Settings ----------
  const CONFIG = {
    pageChangeTimeoutMs: 8000, // max wait for a new page to be displayed
    pollIntervalMs: 100,       // polling frequency
    navRetries: 3,             // number of re-clicks before concluding "end of book"
    settleDelayMs: 300,        // pause after a page change (lets rendering finish)
    imageLoadTimeoutMs: 15000, // max wait for the page image to load
    jpegQuality: 0.8,          // 1.0 = huge files, 0.8 = barely visible difference
    maxImageWidth: 1600,       // downscales oversized pages (0 = no downscaling)
    pagesPerPdf: 250,          // splits into several PDFs to avoid exhausting memory
    progressEvery: 25          // logs progress every N pages
  }

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  const log = (...args) => console.log(`[${softwareTitle}]`, ...args)

  function getImage() {
    return document.querySelector("#kr-renderer img")
  }
  /** stable page identity: the image source (the <img> element itself may be reused) */
  function pageKey() {
    const img = getImage()
    return img ? img.currentSrc || img.src : null
  }

  function getBookTitle() {
    function sanitizeFilename(name) {
      return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "downloaded_book"
    }
    const candidates = [
      document.querySelector("ion-title"),
      document.querySelector(".top-chrome__book-title"),
      document.querySelector(".title-default")
    ]
    for (const node of candidates) {
      const text = node?.textContent?.trim()
      if (text) return sanitizeFilename(text)
    }
    return sanitizeFilename(document.title || "downloaded_book")
  }

  /** some buttons don't react to direct programmatic clicks */
  function enforceClick(element) {
    ;["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(type => {
      element.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: unsafeWindow })
      )
    })
  }
  function forwardButton() {
    return document.querySelector("button#kr-chevron-right")
  }
  function backwardButton() {
    return document.querySelector("button#kr-chevron-left")
  }
  function isUsable(btn) {
    return btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true"
  }

  function triggerNavigation(getBtn, wheelDelta) {
    const btn = getBtn?.()
    if (btn) {
      enforceClick(btn)
      return true
    }
    const target = document.querySelector(".loader")
    if (target) {
      target.dispatchEvent(
        new WheelEvent("wheel", { deltaY: wheelDelta, bubbles: true, cancelable: true, view: unsafeWindow })
      )
      return true
    }
    return false
  }

  /** waits until a page different from `before` is displayed (instead of a fixed 50 ms delay) */
  async function waitForPageChange(before, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const now = pageKey()
      if (now && now !== before) return true
      await delay(CONFIG.pollIntervalMs)
    }
    return false
  }

  /** navigation with a real wait + retries; false = no more pages */
  async function navigate({ getBtn, wheelDelta }) {
    const before = pageKey()
    for (let attempt = 1; attempt <= CONFIG.navRetries; attempt++) {
      if (!triggerNavigation(getBtn, wheelDelta)) return false
      if (await waitForPageChange(before, CONFIG.pageChangeTimeoutMs)) return true
      // no change: if the button is disabled, we really are at the end
      if (!isUsable(getBtn?.())) return false
      log(`No page change (attempt ${attempt}/${CONFIG.navRetries}), retrying…`)
    }
    return false
  }
  const goForward = () => navigate({ getBtn: forwardButton, wheelDelta: 1 })
  const goBackward = () => navigate({ getBtn: backwardButton, wheelDelta: -1 })

  async function waitForImageLoaded() {
    const deadline = Date.now() + CONFIG.imageLoadTimeoutMs
    while (Date.now() < deadline) {
      const img = getImage()
      if (img?.complete && img.naturalWidth > 0) return img
      await delay(50)
    }
    throw new Error("Page image did not load within the timeout")
  }

  /** PDF manager: adds pages, splits into parts, saves what was captured if an error occurs */
  class PdfWriter {
    constructor(title) {
      this.title = title
      this.part = 0
      this.pagesInPart = 0
      this.totalPages = 0
      this.pdf = null
    }
    newPdf() {
      this.pdf = new jspdf.jsPDF({ compress: true }) // A4 by default
      this.pagesInPart = 0
      this.part++
    }
    addImage(image) {
      if (!this.pdf) this.newPdf()

      // optional downscaling to limit memory and file size
      let w = image.naturalWidth
      let h = image.naturalHeight
      if (CONFIG.maxImageWidth && w > CONFIG.maxImageWidth) {
        h = Math.round((h * CONFIG.maxImageWidth) / w)
        w = CONFIG.maxImageWidth
      }
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      canvas.getContext("2d").drawImage(image, 0, 0, w, h)
      const imgData = canvas.toDataURL("image/jpeg", CONFIG.jpegQuality)
      canvas.width = canvas.height = 0 // frees the bitmap immediately

      const pdfWidth = this.pdf.internal.pageSize.getWidth()
      const pdfHeight = this.pdf.internal.pageSize.getHeight()
      let imgWidth = pdfWidth
      let imgHeight = (h / w) * pdfWidth
      if (imgHeight > pdfHeight) {
        imgHeight = pdfHeight
        imgWidth = (w / h) * pdfHeight
      }
      if (this.pagesInPart > 0) this.pdf.addPage()
      this.pdf.addImage(imgData, "JPEG", (pdfWidth - imgWidth) / 2, (pdfHeight - imgHeight) / 2, imgWidth, imgHeight, undefined, "FAST")

      this.pagesInPart++
      this.totalPages++
      if (this.pagesInPart >= CONFIG.pagesPerPdf) this.flush()
    }
    flush() {
      if (!this.pdf || this.pagesInPart === 0) return
      const suffix = this.part > 1 || this.pagesInPart >= CONFIG.pagesPerPdf ? ` - part ${this.part}` : ""
      this.pdf.save(`${this.title}${suffix}.pdf`)
      log(`PDF saved (${this.pagesInPart} pages, part ${this.part})`)
      this.pdf = null
    }
  }

  async function scrape({ fromStart }) {
    const title = getBookTitle()
    const writer = new PdfWriter(title)
    GM_notification("Starting capture…", softwareTitle)

    try {
      if (fromStart) {
        while (isUsable(backwardButton()) && (await goBackward())) {}
      }

      writer.addImage(await waitForImageLoaded())
      while (await goForward()) {
        await delay(CONFIG.settleDelayMs)
        writer.addImage(await waitForImageLoaded())
        if (writer.totalPages % CONFIG.progressEvery === 0) log(`${writer.totalPages} pages captured…`)
      }
      log(`End of book reached: ${writer.totalPages} pages.`)
      GM_notification(`Done: ${writer.totalPages} pages.`, softwareTitle)
    } catch (err) {
      console.error(`[${softwareTitle}]`, err)
      GM_notification(`Error after ${writer.totalPages} pages — saving what was captured.`, softwareTitle)
    } finally {
      writer.flush() // always saves what was captured, even if an error occurred
    }
  }

  GM_registerMenuCommand("Start Ebook Scraping (from the beginning)", () => scrape({ fromStart: true }))
  GM_registerMenuCommand("Start Ebook Scraping (from the current page)", () => scrape({ fromStart: false }))
})()
