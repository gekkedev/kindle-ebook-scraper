// ==UserScript==
// @name         Amazon Kindle Ebook Scraper
// @namespace    https://github.com/gekkedev/kindle-ebook-scraper
// @updateURL    https://raw.githubusercontent.com/gekkedev/kindle-ebook-scraper/main/kindle-ebook-scraper.user.js
// @downloadURL  https://raw.githubusercontent.com/gekkedev/kindle-ebook-scraper/main/kindle-ebook-scraper.user.js
// @version      1.0
// @description  Automatically downloads entire ebooks from the Amazon Kindle Cloud Reader as a PDF, triggered by user action.
// @match        https://*ebookcentral-proquest-com.proxy.lirn.net/lib/*/reader.action?docID=*
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @require      https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// ==/UserScript==

(function() {
  'use strict';
  const softwareTitle = "Amazon Kindle Ebook Scraper"

  async function scrollThroughPages() {
    function getCurrentPageNumber() {
      return document.getElementById("tool-current-page-loc").innerText;
    }

    function goForward() {
      document.getElementById("tool-pager-next").click();
    }

    function goBackward() {
      document.getElementById("tool-pager-prev").click();
    }

    let lastPageNumber = null;
    while (true) {
      const currentPage = getCurrentPageNumber();
      if (currentPage == lastPageNumber) {
        // a woraround to address a weird issue where you scroll beyond the first page but the button to go back stays disabled
        goForward(); goBackward();
        // apart from the workaround: Let's give it a second
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (getCurrentPageNumber() == lastPageNumber) { // still unchanged?
          if (confirm("Is " + currentPage + " the first page's number?")) break;
        }
      }
      lastPageNumber = currentPage;
      goBackward();
      //await new Promise(resolve => setTimeout(resolve, 100));
    }

    lastPageNumber = null;
    while (true) {
      const currentPage = getCurrentPageNumber();
      if (currentPage == lastPageNumber) {
        //try going forward once more and wait, because there could be a hiccup
        goForward();
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (getCurrentPageNumber() == lastPageNumber) break; //still unchanged?
      }
      lastPageNumber = currentPage;
      goForward();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  function getImageTags() {
    return document.querySelectorAll("div > img[src*='docImage.action']")
  }

  async function waitForImagesToLoad(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const images = getImageTags();
      let allLoaded = true;
      for (const img of images) {
        if (!img.complete || img.naturalWidth === 0) {
          allLoaded = false;
          break;
        }
      }
      if (allLoaded) return images; // Return images if all are loaded
      await new Promise(resolve => setTimeout(resolve, 500)); // Check every 500ms
    }
    return getImageTags(); // Return whatever is available
  }

  async function convertImagesToPDF(imageTags) {
    const pdf = new jspdf.jsPDF(); // Default A4 page size (210x297mm)

    for (let i = 0; i < imageTags.length; i++) {
      const img = imageTags[i];

      await new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Set canvas size to the image's original size
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Convert to image data
        const imgData = canvas.toDataURL("image/jpeg");

        // Get PDF page dimensions
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();

        // Calculate image dimensions while preserving aspect ratio
        let imgWidth = pdfWidth;
        let imgHeight = (canvas.height / canvas.width) * pdfWidth;

        // Ensure it fits within page height
        if (imgHeight > pdfHeight) {
          imgHeight = pdfHeight;
          imgWidth = (canvas.width / canvas.height) * pdfHeight;
        }

        // Add image to PDF, centering it properly
        if (i > 0) pdf.addPage();
        const xOffset = (pdfWidth - imgWidth) / 2; // Center horizontally
        const yOffset = (pdfHeight - imgHeight) / 2; // Center vertically

        pdf.addImage(imgData, "JPEG", xOffset, yOffset, imgWidth, imgHeight);
        resolve();
      });
    }

    // Save the PDF with the book title
    const title = document.querySelector(".book-title")?.innerText || "downloaded_book";
    pdf.save(`${title}.pdf`);
  }

  // Register the menu command to trigger the process
  GM_registerMenuCommand("Start Ebook Scraping", async function() {
    GM_notification("Starting ebook download process...", softwareTitle);
    await scrollThroughPages();

    //wait for the browser to cache enough iamges to begin
    GM_notification("Waiting for images to load (timeout: 30 seconds)...", softwareTitle);
    const imageTags = await waitForImagesToLoad();
    GM_notification(`Found ${imageTags.length} images to save.`, softwareTitle);
    await convertImagesToPDF(imageTags);
    GM_notification("Download complete!", softwareTitle);
  });
})();
