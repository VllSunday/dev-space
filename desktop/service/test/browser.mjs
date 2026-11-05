// The desktop windows use WebView2 (Edge) on Windows and WKWebView (WebKit) on
// macOS; test in the matching engine. MRMAK_TEST_BROWSER overrides
// (msedge, chrome, chromium or webkit).
import { chromium, webkit } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Standalone browser tests receive the same native initialization script as Tauri.
export async function desktopAuth(context, url, language = 'en') {
  const address = new URL(url);
  // Existing UI checks exercise English; localization checks opt into Russian.
  const settings = await fetch(new URL('/api/settings', address), { method: 'POST', headers: { Authorization: `Bearer ${address.searchParams.get('token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ language }) });
  if (!settings.ok) throw new Error('Could not select the fixture UI language');
  await context.addInitScript(value => { if (!localStorage.getItem('mrmak.language')) localStorage.setItem('mrmak.language', value); }, language);
  const script = await readFile(new URL('../../../src-tauri/src/desktop-auth.js', import.meta.url), 'utf8');
  await context.addInitScript({ content: script.replace('__MRMAK_SERVICE_ORIGIN__', JSON.stringify(address.origin)).replace('__MRMAK_SERVICE_TOKEN__', JSON.stringify(address.searchParams.get('token'))) });
}

export const testBrowser = process.env.MRMAK_TEST_BROWSER || (process.platform === 'darwin' ? 'webkit' : 'msedge');

export function launchBrowser(options = {}) {
  if (testBrowser === 'webkit') {
    const { args: _chromiumOnly, ...rest } = options;
    return webkit.launch({ headless: true, ...rest });
  }
  return chromium.launch({ headless: true, ...options, channel: testBrowser === 'chromium' ? undefined : testBrowser });
}

// WebKit knows only 'clipboard-read'; its clipboard writes need no grant.
export const clipboardPermissions = testBrowser === 'webkit' ? ['clipboard-read'] : ['clipboard-read', 'clipboard-write'];
