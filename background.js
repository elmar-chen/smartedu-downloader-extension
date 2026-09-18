/**
 * background.js - Service Worker for SmartEdu Textbook Downloader Extension
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadPdf') {
    handleDownload(message)
      .then(result => sendResponse({ success: true, downloadId: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (message.action === 'saveCredentials') {
    chrome.storage.local.set({ authCredentials: message.credentials }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'getCredentials') {
    chrome.storage.local.get(['authCredentials'], (res) => {
      sendResponse({ credentials: res.authCredentials || null });
    });
    return true;
  }
});

async function handleDownload(data) {
  const { url, filename, authHeader } = data;
  
  // Sanitize filename for local saving
  const safeName = (filename || '教材.pdf')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  const options = {
    url: url,
    filename: `SmartEdu教材/${safeName}`,
    saveAs: false,
    conflictAction: 'uniquify'
  };

  if (authHeader) {
    options.headers = [
      { name: 'x-nd-auth', value: authHeader }
    ];
  }

  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}
