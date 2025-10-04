// ==UserScript==
// @name         Amazon Kindle Ebook Scraper
// @namespace    https://github.com/gekkedev/kindle-ebook-scraper
// @updateURL    https://raw.githubusercontent.com/gekkedev/kindle-ebook-scraper/main/kindle-ebook-scraper.user.js
// @downloadURL  https://raw.githubusercontent.com/gekkedev/kindle-ebook-scraper/main/kindle-ebook-scraper.user.js
// @version      1.0
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

  function getImage() {
    return document.querySelector("#kr-renderer img")
  }

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

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
      if (text) {
        return sanitizeFilename(text)
      }
    }
    return sanitizeFilename(document.title || "downloaded_book")
  }

  // Register the menu command to trigger the process
  GM_registerMenuCommand("Start Ebook Scraping", async function () {
    GM_notification("Starting ebook download process...", softwareTitle)
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
    /** shared navigation helper */
    async function navigate({ getBtn, wheelDelta }) {
      const before = getImage()

      const btn = getBtn?.()
      if (btn) {
        enforceClick(btn)
      } else {
        // Fallback to a synthetic wheel event if no button is available
        const wheelEvent = new WheelEvent("wheel", {
          deltaY: wheelDelta, // +1 = forward, -1 = backward
          bubbles: true,
          cancelable: true,
          view: unsafeWindow
        })

        const target = document.querySelector(".loader")
        if (target) {
          target.dispatchEvent(wheelEvent)
        }
      }

      await delay(50)
      return before !== getImage()
    }

    async function goForward() {
      return navigate({ getBtn: forwardButton, wheelDelta: 1 })
    }
    async function goBackward() {
      return navigate({ getBtn: backwardButton, wheelDelta: -1 })
    }

    const pdf = new jspdf.jsPDF() // Default A4 page size (210x297mm)

    // navigate to the first page
    while (backwardButton()) {
      await goBackward()
    } //already at the beginning

    //NOTE: going to the beginning and starting from there isn't the most efficient implementation (not trying to overengineer it)

    await captureImage(true) // first page
    // scroll forward and capture images until we reach the end
    while (await goForward()) {
      await delay(500)
      await captureImage()
    }

    async function captureImage(firstPage = false) {
      while (!getImage()?.complete || getImage()?.naturalWidth === 0) {
        //wait for the page image to load
        await delay(50)
      }

      // draw the image on a canvas and append it to the PDF file
      await new Promise(resolve => {
        const image = getImage()
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d")

        // Set canvas size to the image's original size
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

        // Convert to image data
        const imgData = canvas.toDataURL("image/jpeg")

        // Get PDF page dimensions
        const pdfWidth = pdf.internal.pageSize.getWidth()
        const pdfHeight = pdf.internal.pageSize.getHeight()

        // Calculate image dimensions while preserving aspect ratio
        let imgWidth = pdfWidth
        let imgHeight = (canvas.height / canvas.width) * pdfWidth

        // Ensure it fits within page height
        if (imgHeight > pdfHeight) {
          imgHeight = pdfHeight
          imgWidth = (canvas.width / canvas.height) * pdfHeight
        }

        // Add image to PDF, centering it properly
        if (!firstPage) pdf.addPage()
        const xOffset = (pdfWidth - imgWidth) / 2 // Center horizontally
        const yOffset = (pdfHeight - imgHeight) / 2 // Center vertically

        pdf.addImage(imgData, "JPEG", xOffset, yOffset, imgWidth, imgHeight)
        resolve()
      })
    }

    // Save the PDF with the book title
    pdf.save(`${getBookTitle()}.pdf`)
  })
})()
