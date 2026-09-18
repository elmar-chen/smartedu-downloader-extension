/**
 * content.js - SmartEdu Book Downloader Content Script
 * 
 * Target: basic.smartedu.cn
 * Finds: div[class*="index-module_line_"]
 * Injects: "下载" link directly after the title span inside lineDiv
 */

(function () {
  const TAG = '[SmartEdu Downloader]';
  console.log(`%c${TAG} 插件已加载！监控 index-module_line_* 节点`, 'color: #107c41; font-weight: bold; font-size: 13px;');

  let cachedCredentials = null;

  // --- 1. Credential Extractor (from localStorage directly) ---
  function getCredentialsFromLocalStorage() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.includes('ND_UC_AUTH') || k.includes('ncet-xedu') || k.includes('token')) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          let obj = null;
          try { obj = JSON.parse(raw); } catch (e) { }
          if (!obj) continue;

          let inner = obj;
          if (typeof obj.value === 'string') {
            try { inner = JSON.parse(obj.value); } catch (e) { }
          } else if (typeof obj.value === 'object' && obj.value) {
            inner = obj.value;
          }

          const token = inner.access_token || inner.accessToken;
          const macKey = inner.mac_key || inner.macKey;
          if (token && macKey) {
            return { access_token: token, mac_key: macKey };
          }
        }
      }
    } catch (e) {
      console.warn(`${TAG} 读取 localStorage 出错:`, e);
    }
    return null;
  }

  async function getValidCredentials() {
    if (cachedCredentials) return cachedCredentials;
    const creds = getCredentialsFromLocalStorage();
    if (creds) {
      cachedCredentials = creds;
      try {
        chrome.runtime.sendMessage({ action: 'saveCredentials', credentials: creds });
      } catch (e) { }
    }
    return creds;
  }

  // --- 2. ID Extraction from Cover Image, React Fiber, or Attributes ---
  function resolveBookId(lineDiv, parentLi) {
    // 1. From cover <img> src inside parent <li>
    // Smartedu cover image URLs: https://r3-ndr.ykt.cbern.com.cn/edu_product/esp/assets/{UUID}.t/...
    if (parentLi) {
      const imgs = parentLi.querySelectorAll('img');
      for (const img of imgs) {
        const src = img.getAttribute('src') || img.src || '';
        const m = src.match(/assets\/([0-9a-f-]{36})/i) || src.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (m) return m[1] || m[0];
      }
    }

    // 2. From React Fiber internal key on <li> (key: c)
    if (parentLi) {
      const fiberKey = Object.keys(parentLi).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey && parentLi[fiberKey]) {
        let f = parentLi[fiberKey];
        for (let i = 0; i < 5 && f; i++) {
          if (f.key && typeof f.key === 'string' && /^[0-9a-f-]{36}$/i.test(f.key)) {
            return f.key;
          }
          if (f.memoizedProps && f.memoizedProps.id && /^[0-9a-f-]{36}$/i.test(f.memoizedProps.id)) {
            return f.memoizedProps.id;
          }
          f = f.return;
        }
      }
    }

    // 3. From any <a> tag if exists
    const a = (parentLi || lineDiv).querySelector('a');
    if (a) {
      const href = a.getAttribute('href') || a.href || '';
      const m = href.match(/[?&]contentId=([0-9a-f-]{36})/i) || href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (m) return m[1] || m[0];
    }

    // 4. From outerHTML of parentLi
    if (parentLi) {
      const html = parentLi.outerHTML || '';
      const m = html.match(/[?&]contentId=([0-9a-f-]{36})/i) || html.match(/assets\/([0-9a-f-]{36})/i);
      if (m) return m[1] || m[0];
    }

    return null;
  }

  // --- 3. Cryptographic MAC Signature Algorithm (Web Crypto HMAC-SHA256) ---
  function generateNonce() {
    const ts = Date.now();
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let rand = '';
    for (let i = 0; i < 8; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${ts}:${rand}`;
  }

  function sanitizeUrl(urlStr) {
    const u = new URL(urlStr);
    const safePath = encodeURI(decodeURI(u.pathname));
    const query = u.search || '';
    const authority = u.host;
    return {
      cleanUrl: `${u.protocol}//${authority}${safePath}${query}`,
      relative: `${safePath}${query}`,
      authority: authority
    };
  }

  async function hmacSha256(keyStr, messageStr) {
    const enc = new TextEncoder();
    const keyBuf = enc.encode(keyStr);
    const msgBuf = enc.encode(messageStr);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuf,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBuf);
    const bytes = new Uint8Array(sig);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async function buildAuthHeader(urlStr, method, accessToken, macKey) {
    const { relative, authority } = sanitizeUrl(urlStr);
    const nonce = generateNonce();
    const message = `${nonce}\n${method.toUpperCase()}\n${relative}\n${authority}\n`;
    const mac = await hmacSha256(macKey, message);
    return `MAC id="${accessToken}",nonce="${nonce}",mac="${mac}"`;
  }

  // --- 4. Resource Fetching & PDF Extraction ---
  async function fetchBookPdfInfo(bookId) {
    const hosts = [
      's-file-2.ykt.cbern.com.cn',
      's-file-1.ykt.cbern.com.cn'
    ];

    // Standard detail endpoint
    for (const host of hosts) {
      try {
        const url = `https://${host}/zxx/ndrv2/resources/tch_material/details/${bookId}.json`;
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.json();
          const info = parsePdfDetails(data);
          if (info) return info;
        }
      } catch (e) { }
    }

    // Thematic course endpoint
    for (const host of hosts) {
      try {
        const url = `https://${host}/zxx/ndrs/special_edu/thematic_course/${bookId}/resources/list.json`;
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.json();
          const info = parsePdfDetails(data);
          if (info) return info;
        }
      } catch (e) { }
    }

    return null;
  }

  function parsePdfDetails(json) {
    if (!json) return null;
    const candidates = [];

    // Extract edition (版本, e.g. 统编版, 人教版, 北师大版...)
    let edition = '';
    const findEditionFromTags = (tags) => {
      if (!Array.isArray(tags)) return '';
      const tag = tags.find(t => t && (t.tag_dimension_id === 'zxxbb' || t.tag_dimension_name === '版本'));
      return tag ? (tag.tag_name || '').trim() : '';
    };

    if (json && json.tag_list) {
      edition = findEditionFromTags(json.tag_list);
    }

    // Official book title from details metadata
    let officialTitle = (json && json.global_title && json.global_title['zh-CN']) || (json && json.title) || '';

    function check(it) {
      if (!it) return;
      if (!edition && it.tag_list) {
        edition = findEditionFromTags(it.tag_list);
      }
      if (!officialTitle && (it.global_title || it.title)) {
        officialTitle = (it.global_title && it.global_title['zh-CN']) || it.title || '';
      }
      if (!it.ti_items) return;
      for (const ti of it.ti_items) {
        if (ti.ti_format === 'pdf') {
          let dl = (ti.ti_storages && ti.ti_storages[0]) || '';
          if (!dl && ti.ti_storage && ti.ti_storage.startsWith('cs_path:${ref-path}')) {
            dl = ti.ti_storage.replace('cs_path:${ref-path}', 'https://r2-ndr-private.ykt.cbern.com.cn');
          }
          if (dl) {
            const rawName = dl.split('/').pop();
            candidates.push({
              url: dl,
              filename: decodeURIComponent(rawName),
              size: ti.ti_size || 0,
              isSource: ti.ti_file_flag === 'source'
            });
          }
        }
      }
    }

    if (Array.isArray(json)) {
      json.forEach(check);
    } else if (typeof json === 'object') {
      check(json);
    }

    // Fallback: If edition not found in details JSON, check active filter tag in page DOM
    if (!edition) {
      try {
        const activeElements = document.querySelectorAll('[class*="active"], [class*="selected"], [class*="current"]');
        for (const el of activeElements) {
          const txt = (el.textContent || '').trim();
          // Editions end with "版" and are between 3 and 12 chars (e.g. 统编版, 人教版)
          if (txt.endsWith('版') && txt.length >= 3 && txt.length <= 12 && !txt.includes('出版')) {
            edition = txt;
            break;
          }
        }
      } catch (e) { }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (b.isSource ? 1 : 0) - (a.isSource ? 1 : 0) || b.size - a.size);

    const bestCandidate = candidates[0];
    bestCandidate.edition = edition;
    bestCandidate.officialTitle = officialTitle;
    return bestCandidate;
  }

  // --- 5. Download Execution Handler ---
  async function executeDownload(btn, bookId, bookTitle) {
    btn.classList.add('smartedu-loading');
    btn.innerHTML = '⏳ 解析中...';

    // 1. Get credentials from localStorage
    const creds = await getValidCredentials();
    if (!creds || !creds.access_token || !creds.mac_key) {
      showToast('⚠️ 未检测到有效登录信息，请先在平台中登录账号！');
      btn.classList.remove('smartedu-loading');
      btn.classList.add('smartedu-error');
      btn.innerHTML = '❌ 未登录';
      setTimeout(() => {
        btn.classList.remove('smartedu-error');
        btn.innerHTML = '📥 下载';
      }, 3000);
      return;
    }

    try {
      // 2. Query PDF Details & Edition Information
      const pdfInfo = await fetchBookPdfInfo(bookId);
      if (!pdfInfo || !pdfInfo.url) {
        showToast('⚠️ 平台官方资源库中未找到该教材对应的 PDF 文件！');
        btn.classList.remove('smartedu-loading');
        btn.classList.add('smartedu-error');
        btn.innerHTML = '❌ 无PDF';
        return;
      }

      btn.innerHTML = '⏳ 下载中...';

      // 3. Compute Auth Signature
      const authHeader = await buildAuthHeader(pdfInfo.url, 'GET', creds.access_token, creds.mac_key);

      // Determine book title and prepend [版本] (e.g. [统编版] 义务教育教科书·道德与法治...)
      let baseTitle = (pdfInfo.officialTitle || bookTitle || pdfInfo.filename.replace(/\.pdf$/i, '')).trim();
      const edition = (pdfInfo.edition || '').trim();
      let formattedTitle = baseTitle;

      if (edition && !baseTitle.includes(edition)) {
        formattedTitle = `[${edition}] ${baseTitle}`;
      }

      // Sanitize illegal filename characters for Windows / OS (\\ / : * ? " < > |)
      const cleanFileName = formattedTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
      const finalFileName = `${cleanFileName}.pdf`;

      showToast(`🚀 开始下载：《${cleanFileName}》...`);

      // 4. Primary: Try background download via chrome.downloads
      let chromeDownloadSuccess = false;
      try {
        const bgResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'downloadPdf',
            url: pdfInfo.url,
            filename: finalFileName,
            authHeader: authHeader
          }, (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
              resolve({ success: false, error: chrome.runtime.lastError?.message || response?.error });
            } else {
              resolve({ success: true, downloadId: response.downloadId });
            }
          });
        });
        if (bgResp.success) {
          chromeDownloadSuccess = true;
        }
      } catch (err) {
        console.warn('Chrome downloads API error, falling back to JS blob download:', err);
      }

      // 5. Fallback: In-page JS fetch -> Blob -> <a> tag click
      if (!chromeDownloadSuccess) {
        const fetchResp = await fetch(pdfInfo.url, {
          headers: { 'x-nd-auth': authHeader }
        });

        if (!fetchResp.ok) {
          throw new Error(`网络请求失败 (HTTP ${fetchResp.status})`);
        }

        const blob = await fetchResp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = finalFileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      }

      btn.classList.remove('smartedu-loading');
      btn.classList.add('smartedu-success');
      btn.innerHTML = '✅ 已触发下载';
      showToast(`✅ 《${cleanFileName}》已由浏览器接管下载！`);

      setTimeout(() => {
        btn.classList.remove('smartedu-success');
        btn.innerHTML = '📥 重新下载';
      }, 4000);

    } catch (err) {
      console.error(`${TAG} Download failed:`, err);
      showToast(`❌ 下载失败: ${err.message}`);
      btn.classList.remove('smartedu-loading');
      btn.classList.add('smartedu-error');
      btn.innerHTML = '❌ 失败';
      setTimeout(() => {
        btn.classList.remove('smartedu-error');
        btn.innerHTML = '📥 重试';
      }, 3000);
    }
  }

  // --- 6. ID Resolver for Detail Pages ---
  function resolveDetailBookId(h3) {
    // 1. From URL search parameters (e.g. ?contentId=... or ?id=... or ?resourceId=...)
    try {
      const params = new URLSearchParams(window.location.search);
      const cand = params.get('contentId') || params.get('id') || params.get('resourceId');
      if (cand && /^[0-9a-f-]{36}$/i.test(cand)) return cand;

      const m = window.location.href.match(/[?&](?:contentId|id|resourceId)=([0-9a-f-]{36})/i)
        || window.location.href.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (m) return m[1] || m[0];
    } catch (e) { }

    // 2. From React Fiber on h3 and its ancestor tree
    let el = h3;
    for (let depth = 0; depth < 10 && el; depth++) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey && el[fiberKey]) {
        let f = el[fiberKey];
        for (let i = 0; i < 10 && f; i++) {
          const p = f.memoizedProps;
          if (p) {
            const cand = p.contentId || p.id || p.resourceId || p.detail?.id || p.data?.id;
            if (cand && typeof cand === 'string' && /^[0-9a-f-]{36}$/i.test(cand)) {
              return cand;
            }
          }
          f = f.return;
        }
      }
      el = el.parentElement;
    }

    // 3. From page images (cover thumbnail containing /assets/{UUID})
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.getAttribute('src') || img.src || '';
      const m = src.match(/assets\/([0-9a-f-]{36})/i);
      if (m) return m[1];
    }

    return null;
  }

  // --- 7. List Page Scanner: Matching div[class*="index-module_line_"] ---
  function scanListPage() {
    const lineDivs = document.querySelectorAll('div[class*="index-module_line_"]');
    if (!lineDivs || lineDivs.length === 0) return;

    let injectedCount = 0;

    lineDivs.forEach((lineDiv) => {
      // Avoid double-injecting
      if (lineDiv.querySelector('.smartedu-dl-btn') || lineDiv.getAttribute('data-smartedu-done') === 'true') {
        return;
      }

      // The parent <li> element contains the cover image and React fiber key
      const parentLi = lineDiv.closest('li') || lineDiv.closest('[class*="items"]') || lineDiv.parentElement.parentElement;

      // Resolve bookId from cover image or React fiber key
      const bookId = resolveBookId(lineDiv, parentLi);

      // Title element is the <span> inside lineDiv
      const titleSpan = lineDiv.querySelector('span[title], [class*="title"], span') || lineDiv;
      let title = (titleSpan.getAttribute('title') || titleSpan.textContent || '电子课本').replace(/[\r\n\t]+/g, ' ').trim();

      // Create "下载" link
      const dlLink = document.createElement('a');
      dlLink.className = 'smartedu-dl-btn';
      dlLink.href = 'javascript:void(0);';
      if (bookId) dlLink.setAttribute('data-id', bookId);
      dlLink.title = `点击下载《${title}》PDF课本`;
      dlLink.innerHTML = '下载';

      dlLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        let targetId = dlLink.getAttribute('data-id') || resolveBookId(lineDiv, parentLi);
        if (!targetId) {
          showToast('⚠️ 未能从当前条目解析出教材ID，请点击进入课本详情页下载！');
          return;
        }

        executeDownload(dlLink, targetId, title);
      });

      // Insert directly after the title span inside lineDiv
      if (titleSpan && titleSpan.parentNode === lineDiv) {
        titleSpan.insertAdjacentElement('afterend', dlLink);
      } else {
        lineDiv.appendChild(dlLink);
      }

      lineDiv.setAttribute('data-smartedu-done', 'true');
      injectedCount++;
    });

    if (injectedCount > 0) {
      console.log(`%c${TAG} 成功在 ${injectedCount} 个 index-module_line_* 后方生成“下载”按钮！`, 'color: #107c41; font-weight: bold;');
    }
  }

  // --- 8. Detail Page Scanner: Matching h3.index-module_title_*_xedu ---
  function scanDetailPage() {
    // Selectors specifically matching h3.index-module_title_*_xedu
    const titleSelectors = [
      'h3[class*="index-module_title_"][class*="_xedu"]',
      'h3[class*="index-module_title_"]',
      'h3[class*="title_"][class*="_xedu"]'
    ];

    let h3Elements = document.querySelectorAll(titleSelectors.join(', '));

    // Fallback: If on detail page (URL has /detail), query any h3 inside content areas
    if (h3Elements.length === 0 && window.location.href.includes('/detail')) {
      const candidates = document.querySelectorAll('h3');
      for (const h of candidates) {
        const txt = (h.textContent || '').trim();
        // Check if looks like a textbook title
        if (txt.length >= 4 && !txt.includes('推荐') && !txt.includes('目录') && !txt.includes('相关')) {
          h3Elements = [h];
          break;
        }
      }
    }

    if (!h3Elements || h3Elements.length === 0) return;

    let injectedDetailCount = 0;

    h3Elements.forEach((h3) => {
      // Avoid double-injecting
      if (h3.querySelector('.smartedu-dl-btn') || h3.getAttribute('data-smartedu-detail-done') === 'true') {
        return;
      }
      if (h3.nextElementSibling && h3.nextElementSibling.classList.contains('smartedu-dl-btn')) {
        return;
      }

      // Resolve book ID for detail page
      const bookId = resolveDetailBookId(h3);

      // Title element inside h3 or h3 itself
      const titleSpan = h3.querySelector('span[title], span') || h3;
      let rawTitle = (titleSpan.getAttribute('title') || h3.innerText || h3.textContent || '电子课本')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/📥\s*下载/g, '')
        .replace(/⏳\s*解析中\.\.\./g, '')
        .replace(/⏳\s*下载中\.\.\./g, '')
        .trim();

      // Create "下载" link
      const dlBtn = document.createElement('a');
      dlBtn.className = 'smartedu-dl-btn smartedu-detail-dl-btn';
      dlBtn.href = 'javascript:void(0);';
      if (bookId) dlBtn.setAttribute('data-id', bookId);
      dlBtn.title = `点击下载《${rawTitle}》PDF课本`;
      dlBtn.innerHTML = '下载';

      dlBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        let targetId = dlBtn.getAttribute('data-id') || resolveDetailBookId(h3);
        if (!targetId) {
          showToast('⚠️ 未能从当前详情页解析出教材ID，请刷新后重试！');
          return;
        }

        executeDownload(dlBtn, targetId, rawTitle);
      });

      // Insert just next to title
      if (titleSpan && titleSpan !== h3 && titleSpan.parentNode === h3) {
        titleSpan.insertAdjacentElement('afterend', dlBtn);
      } else {
        h3.appendChild(dlBtn);
      }

      h3.setAttribute('data-smartedu-detail-done', 'true');
      injectedDetailCount++;
    });

    if (injectedDetailCount > 0) {
      console.log(`%c${TAG} 成功在详情页 h3.index-module_title_*_xedu 后方注入“下载”按钮！`, 'color: #107c41; font-weight: bold;');
    }
  }

  // --- 9. Run All Scanners ---
  function runAllScans() {
    scanListPage();
    scanDetailPage();
  }

  // --- 10. Toast Messenger ---
  function showToast(msg) {
    let toast = document.getElementById('smartedu-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'smartedu-toast';
      toast.className = 'smartedu-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.display = 'flex';

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 3500);
  }

  // --- 11. SPA Navigation & Mutation Observer ---
  let observerTimer = null;
  const observer = new MutationObserver(() => {
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(runAllScans, 250);
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Listen to popstate for browser forward/backward
  window.addEventListener('popstate', () => {
    setTimeout(runAllScans, 200);
    setTimeout(runAllScans, 800);
  });

  // Intercept history.pushState & history.replaceState for client-side routing
  ['pushState', 'replaceState'].forEach((method) => {
    const orig = history[method];
    if (orig) {
      history[method] = function () {
        orig.apply(this, arguments);
        setTimeout(runAllScans, 300);
        setTimeout(runAllScans, 1000);
      };
    }
  });

  // Periodic scans on initial load
  setTimeout(runAllScans, 400);
  setTimeout(runAllScans, 1200);
  setTimeout(runAllScans, 2500);
  setTimeout(runAllScans, 5000);

  getValidCredentials();
})();
