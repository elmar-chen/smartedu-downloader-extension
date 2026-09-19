# Privacy Policy for SmartEdu Textbook Downloader

**Last Updated: September 18, 2026**

This Privacy Policy explains how the **SmartEdu Textbook Downloader** (国家中小学智慧教育平台电子教材下载助手) browser extension collects, uses, and safeguards information.

## 1. Information Collection and Storage
- **No Personal Data Collection**: This extension does not collect, record, or track any personally identifiable information (PII), browsing history, or analytics data.
- **Local Session Credentials**: In order to sign authorized download requests for educational textbooks, the extension reads the temporary session tokens (access_token and mac_key) stored in the browser's localStorage solely on basic.smartedu.cn.
- **Local Cache**: Credentials are kept entirely within the browser's local sandbox (chrome.storage.local) and are never transmitted to any third-party servers, remote analytics, or external databases.

## 2. Network Requests
- All network communications initiated by this extension are made directly and exclusively between the user's browser and official educational platform servers (*.smartedu.cn, *.cbern.com.cn).
- No telemetry, third-party trackers, or advertising scripts are bundled or loaded.

## 3. Permissions Justification
- downloads: Required to save the requested textbook PDF files to the user's local disk.
- storage: Required to temporarily store user session tokens within the local extension sandbox.
- host_permissions (basic.smartedu.cn, *.cbern.com.cn): Required to inject download action triggers and retrieve official metadata and resource streams.

## 4. Contact and Feedback
If you have questions, feedback, or concerns regarding this extension, please file an issue on the official GitHub repository:
https://github.com/elmar-chen/smartedu-downloader-extension/issues\n