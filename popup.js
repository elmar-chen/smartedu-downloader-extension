/**
 * popup.js - Handles status display and quick links in the extension popup
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusContainer = document.getElementById('statusContainer');
  const tokenBox = document.getElementById('tokenBox');

  // Check stored credentials
  chrome.runtime.sendMessage({ action: 'getCredentials' }, (res) => {
    const creds = res?.credentials;
    if (creds && creds.access_token && creds.mac_key) {
      statusContainer.innerHTML = `
        <div class="status-badge status-ok">
          <span>🟢</span> 已成功获取平台登录凭证
        </div>
      `;
      const maskedToken = creds.access_token.slice(0, 8) + '...' + creds.access_token.slice(-8);
      const maskedKey = creds.mac_key.slice(0, 2) + '****' + creds.mac_key.slice(-2);
      tokenBox.style.display = 'block';
      tokenBox.innerText = `Token: ${maskedToken}\nMacKey: ${maskedKey}`;
    } else {
      statusContainer.innerHTML = `
        <div class="status-badge status-warn">
          <span>⚠️</span> 暂未缓存凭证 (请在平台页面中登录并刷新)
        </div>
      `;
      tokenBox.style.display = 'none';
    }
  });

  // Action Buttons
  document.getElementById('btnOpenMirror')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:8787/table.html' });
  });

  document.getElementById('btnOpenOfficial')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://basic.smartedu.cn/elecEdu' });
  });
});
