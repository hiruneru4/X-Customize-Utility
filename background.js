// 中継用サービスワーカー: JSバンドル取得(CORS回避) / メディア保存
const safe = (s) => String(s).replace(/[\\:*?"<>|]/g, '_');
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'fetchText' && /^https:\/\/abs\.twimg\.com\//.test(msg.url || '')) {
    fetch(msg.url).then((r) => r.text()).then((text) => sendResponse({ ok: true, text })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'openPanel') {
    const tabId = sender.tab && sender.tab.id;
    const winId = sender.tab && sender.tab.windowId;
    const fallback = () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    try {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        const p = chrome.sidePanel.open(winId != null ? { windowId: winId } : { tabId });
        if (p && p.catch) p.catch(fallback);
      } else fallback();
    } catch (e) { fallback(); }
    sendResponse && sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'download') {
    const items = (msg.items || []).filter((i) => /^https:\/\/(pbs|video)\.twimg\.com\//.test(i.url || ''));
    items.forEach((it) => chrome.downloads.download({ url: it.url, filename: it.filename.split('/').map(safe).join('/'), conflictAction: 'uniquify' }, () => void chrome.runtime.lastError));
    sendResponse({ ok: true, count: items.length });
  }
});

// ---- 添付メディアのセンシティブ推定(外部AI)。APIキーは利用者が登録したものだけを使い、このブラウザ内(storage.local)にのみ保存 ----
const LIK = { VERY_UNLIKELY: 2, UNLIKELY: 12, POSSIBLE: 45, LIKELY: 78, VERY_LIKELY: 96 };
const pct = (x) => Math.max(0, Math.min(100, Math.round((Number(x) || 0) * 100)));
async function classify(provider, b64) {
  const st = await chrome.storage.local.get('apiKeys');
  const keys = (st && st.apiKeys) || {};
  if (provider === 'google') {
    if (!keys.google) return { ok: false, error: 'APIキー未設定' };
    const r = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(keys.google), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ image: { content: b64 }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j.error && j.error.message) || 'HTTP ' + r.status };
    const res = j.responses && j.responses[0], a = res && res.safeSearchAnnotation;
    if (!a) return { ok: false, error: (res && res.error && res.error.message) || '結果なし' };
    return { ok: true, adult: Math.max(LIK[a.adult] || 0, Math.round((LIK[a.racy] || 0) * 0.85)), gore: LIK[a.violence] || 0 };
  }
  if (provider === 'openai') {
    if (!keys.openai) return { ok: false, error: 'APIキー未設定' };
    const r = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + keys.openai },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: (j.error && j.error.message) || 'HTTP ' + r.status };
    const c = j.results && j.results[0] && j.results[0].category_scores;
    if (!c) return { ok: false, error: '結果なし' };
    return { ok: true, adult: pct(c.sexual), gore: pct(Math.max(c['violence/graphic'] || 0, (c.violence || 0) * 0.7)) };
  }
  return { ok: false, error: '未対応の提供元' };
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'classify') {
    classify(msg.provider, msg.b64).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
});
