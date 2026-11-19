// ページ本体(MAINワールド)で動作。2系統でXの内部データを取得して content.js へ渡します。
//  (1) 公式クライアントが受け取る GraphQL レスポンスの横取り (Response.json/text をフック)
//  (2) 画面に描画されているツイート/ユーザーの React props の読み取り (Shadowban Scanner と同方式)
(() => {
  if (window.__xdtHook) return;
  window.__xdtHook = true;

  const send = (m) => {
    try { window.postMessage(Object.assign({ __xdt: true }, m), location.origin); } catch (e) {}
  };
  const isGql = (u) => typeof u === 'string' && u.indexOf('/i/api/graphql/') !== -1;
  const num = (x) => { const n = Number(x); return x === undefined || x === null || isNaN(n) ? undefined : n; };

  /* ---------------- (1) ネットワーク ---------------- */
  let sentAuth = false;
  const reqBodies = new WeakMap();
  const done = new WeakSet();

  function readHeader(h, name) {
    try {
      if (!h) return null;
      if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get(name);
      if (Array.isArray(h)) { const f = h.find((x) => String(x[0]).toLowerCase() === name); return f ? f[1] : null; }
      for (const k in h) if (k.toLowerCase() === name) return h[k];
    } catch (e) {}
    return null;
  }
  function grabAuth(v) {
    if (sentAuth || !v) return;
    sentAuth = true;
    send({ type: 'auth', bearer: String(v).replace(/^Bearer\s+/i, '') });
  }

  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    let url = '', headers = null, reqBody = null;
    try {
      url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
      headers = (init && init.headers) || (input && input.headers) || null;
      reqBody = init && typeof init.body === 'string' ? init.body : null;
    } catch (e) {}
    const p = _fetch.apply(this, arguments);
    if (isGql(url)) {
      grabAuth(readHeader(headers, 'authorization'));
      p.then((res) => { if (reqBody) reqBodies.set(res, reqBody); }).catch(() => {});
    }
    return p;
  };

  // fetchの参照をXが先に保持していても、レスポンスの読み取り時点で確実に拾える
  function hookBody(name) {
    const orig = Response.prototype[name];
    Response.prototype[name] = function () {
      const p = orig.apply(this, arguments);
      try {
        const url = this.url;
        if (isGql(url) && !done.has(this)) {
          done.add(this);
          const self = this;
          p.then((v) => {
            let body = v;
            if (name === 'text') { try { body = JSON.parse(v); } catch (e) { return; } }
            if (!body || typeof body !== 'object') return;
            let req = null;
            const rb = reqBodies.get(self);
            if (rb) { try { req = JSON.parse(rb); } catch (e) {} }
            send({ type: 'api', url, body, req });
          }).catch(() => {});
        }
      } catch (e) {}
      return p;
    };
  }
  hookBody('json');
  hookBody('text');

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  const _setH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { this.__xdtUrl = String(u); return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (String(k).toLowerCase() === 'authorization' && isGql(this.__xdtUrl)) grabAuth(v); } catch (e) {}
    return _setH.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (b) {
    if (isGql(this.__xdtUrl)) {
      this.addEventListener('load', () => {
        try {
          const t = (this.responseType === '' || this.responseType === 'text') ? this.responseText
            : (this.responseType === 'json' ? JSON.stringify(this.response) : null);
          if (!t) return;
          let req = null;
          if (typeof b === 'string') { try { req = JSON.parse(b); } catch (e) {} }
          send({ type: 'api', url: this.__xdtUrl, body: JSON.parse(t), req });
        } catch (e) {}
      });
    }
    return _send.apply(this, arguments);
  };

  /* ---------------- (2) React props ---------------- */
  let fiberKey = null;
  function fiberOf(el) {
    try {
      if (!fiberKey || !(fiberKey in el)) {
        fiberKey = Object.keys(el).find((k) => k.indexOf('__reactFiber$') === 0) || null;
      }
      return fiberKey ? el[fiberKey] : null;
    } catch (e) { return null; }
  }
  function probe(o, pred, d, b) {
    if (!o || typeof o !== 'object' || d > 3 || b.n++ > 400) return null;
    if (o.nodeType) return null;
    try { if (pred(o)) return o; } catch (e) {}
    let keys;
    try { keys = Object.keys(o); } catch (e) { return null; }
    for (const k of keys) {
      if (k === '_owner' || k === 'ref' || k === 'return' || k === 'stateNode' || k === 'alternate') continue;
      let v;
      try { v = o[k]; } catch (e) { continue; }
      if (v && typeof v === 'object') { const r = probe(v, pred, d + 1, b); if (r) return r; }
    }
    return null;
  }
  function findProps(fiber, pred) {
    let f = fiber, up = 0;
    while (f && up++ < 50) {
      const p = f.memoizedProps;
      if (p && typeof p === 'object') { const r = probe(p, pred, 0, { n: 0 }); if (r) return r; }
      f = f.return;
    }
    return null;
  }
  const isTweet = (o) => o && typeof o === 'object' && (typeof o.id_str === 'string' || typeof o.rest_id === 'string') &&
    o.user && typeof o.user === 'object' && typeof o.user.screen_name === 'string' &&
    ('favorite_count' in o || 'full_text' in o || 'text' in o);
  const isUser = (o) => o && typeof o === 'object' && typeof o.screen_name === 'string' && !o.user &&
    typeof o.id_str === 'string' && ('followers_count' in o || 'profile_interstitial_type' in o || 'possibly_sensitive' in o);

  function slimUser(u) {
    return {
      id: u.id_str, screen_name: u.screen_name, name: u.name,
      profile_image_url_https: u.profile_image_url_https || u.profile_image_url,
      followers_count: num(u.followers_count), friends_count: num(u.friends_count), statuses_count: num(u.statuses_count),
      possibly_sensitive: u.possibly_sensitive, profile_interstitial_type: u.profile_interstitial_type,
      has_graduated_access: u.has_graduated_access, withheld_in_countries: u.withheld_in_countries,
      protected: u.protected !== undefined ? u.protected : (u.privacy && u.privacy.protected), following: u.following,
      followed_by: u.followed_by, blocking: u.blocking, blocked_by: u.blocked_by, muting: u.muting,
    };
  }
  function slimTweet(t) {
    const ee = (t.extended_entities && t.extended_entities.media) || (t.entities && t.entities.media) || [];
    const media = ee.map((m) => ({
      type: m.type, url: m.media_url_https,
      variants: ((m.video_info && m.video_info.variants) || []).map((v) => ({ b: v.bitrate, t: v.content_type, u: v.url })),
      warn: m.sensitive_media_warning || null,
    }));
    const views = t.ext_views ? num(t.ext_views.count) : (t.views ? num(t.views.count) : undefined);
    return {
      id: t.id_str || t.rest_id, user: slimUser(t.user), rt: !!t.retweeted_status,
      counts: { reply: num(t.reply_count), repost: num(t.retweet_count), quote: num(t.quote_count), like: num(t.favorite_count), bookmark: num(t.bookmark_count), view: views },
      possibly_sensitive: t.possibly_sensitive, editable: t.possibly_sensitive_editable,
      ageGate: !!(t.mediaVisibilityResults && t.mediaVisibilityResults.blurred_image_interstitial),
      source: typeof t.source === 'string' ? t.source : undefined, media,
    };
  }

  const sigs = new WeakMap();
  function scan() {
    try {
      document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
        const f = fiberOf(a);
        if (!f) return;
        const t = findProps(f, isTweet);
        if (!t) return;
        const out = [slimTweet(t)];
        if (isTweet(t.retweeted_status)) out.push(slimTweet(t.retweeted_status));
        if (isTweet(t.quoted_status)) out.push(slimTweet(t.quoted_status));
        const sig = JSON.stringify(out);
        if (sigs.get(a) === sig) return;
        sigs.set(a, sig);
        send({ type: 'react', tweets: out });
      });
      document.querySelectorAll('[data-testid="UserName"],[data-testid="HoverCard"],[data-testid="UserCell"]').forEach((el) => {
        const f = fiberOf(el);
        if (!f) return;
        const u = findProps(f, isUser);
        if (!u) return;
        const s = slimUser(u);
        const sig = JSON.stringify(s);
        if (sigs.get(el) === sig) return;
        sigs.set(el, sig);
        send({ type: 'react', users: [s] });
      });
    } catch (e) {}
  }
  let st = 0;
  const sched = () => { if (st) return; st = setTimeout(() => { st = 0; scan(); }, 350); };
  const start = () => {
    new MutationObserver(sched).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scan, 2500);
    sched();
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
