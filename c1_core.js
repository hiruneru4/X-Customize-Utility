(() => {
  'use strict';
  if (window.XDT) return;
  const isFrame = window.top !== window;
  const qs = new URLSearchParams(location.search);
  const isHelper = isFrame && qs.get('xdt') === '1';
  if (isFrame && !isHelper) return; // 他のiframeでは何もしない
  const XDT = (window.XDT = { isHelper, ready: false });

  // 拡張機能が更新/再読み込みされると、古いコンテンツスクリプトの context は無効になる。
  // その状態で chrome.* を呼ぶと "Extension context invalidated" が出続けるので、呼ぶ前に確認し、
  // 無効になったら各タイマーを止める。
  const CTX = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  XDT.CTX = CTX;
  function safeInterval(fn, ms) {
    const id = setInterval(() => {
      if (!CTX()) { clearInterval(id); return; }
      try { fn(); } catch (e) { if (/context invalidated|Extension context|invalidated/i.test(String(e && e.message))) clearInterval(id); }
    }, ms);
    return id;
  }
  XDT.safeInterval = safeInterval;
  const lset = (o, cb) => { try { if (CTX()) chrome.storage.local.set(o, cb); } catch (e) {} };
  XDT.lset = lset;

  /* ============================ 設定 ============================ */
  const DEFAULTS = {
    theme: 'light',
    // 表示・外観
    birthday: 'show', hideJoin: false, timeFmt: 'off', clockStyle: 'off', timeOrder: 'time', numDetail: true, starLike: false, avatarSquare: false,
    hideText: false, markEngaged: true, lockMark: false, lockColor: '#ffd400', showLocation: true, unblur: false, revealLabel: false,
    // 非表示
    hideCall: false, hideBadge: false, hideBoost: false, hideCreator: false, hidePremium: false, hidePremiumSub: false, hideArticles: false,
    hideGrok: false, hideLive: false, hideNews: false, hideTrends: false, hideWhoFollow: false, hideForYou: false, hideSearchTopics: false,
    hideCommunities: false, hideBusiness: false, hideAds: false, hideCreateSpace: false, hideSearchBar: false, hideTLWhoFollow: false, notifPrivacy: false, hideGetVerified: false,
    // プロフィール
    fromButton: true, copyName: true, copyScreen: true, profSensitive: true, profShadow: true, hideUnfollowMutual: false, acctScore: true,
    autoProfileCheck: true, forceFollowing: false, mediaMergeTabs: false, relIndicator: true,
    // ポスト判定
    tweetSensitive: true, tweetShadow: true, tweetSearchBan: true, tweetRecommend: true, onlyProblem: false, relationChip: true,
    // ポスト拡張 (off | below | menu)
    reactPlace: 'below', erPlace: 'below', dlPlace: 'below', bookmarkCount: true,
    shareCheck: true, muteKeyword: true, replySort: 'off', followSort: 'off',
    composeCheck: true, moreDisplay: true, compX: true, compGoogle: false, compOpenAI: false, imageZoom: true, advSearch: true,
    urlMark: false, urlColor: '#1d9bf0', urlLine: false, urlLineColor: '#1d9bf0', hashMark: false, hashColor: '#00ba7c', hashLine: false, hashLineColor: '#00ba7c',
    blurInactive: false, blurPx: 6, expandMore: false, mediaGrid: false,
    hlList: [], hlOn: true, hlMark: true, hlColor: '#ffd400', hlLine: false, hlLineColor: '#ff3b30',
    snipEnable: true, draftEnable: true, replyNameEnable: true, snippets: [],
    // 追加機能
    notInterested: false, ageLocal: false, erList: false, followerTrack: false,
    hqMedia: false, showEdited: true, birthdayHideSelf: false, muteRules: [],
    hideImgEdit: false, hideDelete: false, blurLocked: false, hideGrokBtn: false, favStar: true, favMenuBtn: true,
    mediaOnly: false, hideFollowBtn: false, twitterMode: false, mediaImageFirst: false, oneClickBlock: false, hideFooter: false, extraPlaceMap: {}, extraLists: true, uthShow: true, extraCustom: [], extraOrder: [], delProtect: false, chartAgg: 'hour',
    chartMode: 'line', chartMetric: 'er', chartPeriod: '28d', sensWindow: '7d',
    safeMode: false,
  };
  const S = (XDT.S = Object.assign({}, DEFAULTS));
  XDT.DEFAULTS = DEFAULTS;
  if (!isHelper && window === window.top) {
    setTimeout(() => {
      if (document.getElementById('placeholder') && !sessionStorage.getItem('xdtWd')) {
        sessionStorage.setItem('xdtWd', '1');
        chrome.storage.sync.set({ safeMode: true }, () => location.reload());
      }
    }, 15000);
  }
  XDT.schedule = () => {};
  XDT.fullApply = () => {};
  if (!isHelper) {
    chrome.storage.sync.get(DEFAULTS, (v) => { Object.assign(S, v); XDT.ready = true; XDT.fullApply(); });
    // 変更しても「取り外し→再描画(fullApply)」まで要らない設定。これらだけの変更ならポップを閉じずに軽く反映する
    const SOFT = { snippets: 1, muteRules: 1, hlList: 1, chartMode: 1, chartMetric: 1 , mediaOnly: 1, twitterMode: 1, mediaImageFirst: 1, oneClickBlock: 1, hideFooter: 1, extraPlaceMap: 1, extraLists: 1, uthShow: 1, extraCustom: 1, extraOrder: 1, delProtect: 1 };
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'sync') {
        for (const k in ch) S[k] = ch[k].newValue !== undefined ? ch[k].newValue : DEFAULTS[k];
        if (Object.keys(ch).every((k) => SOFT[k])) XDT.schedule(); else XDT.fullApply();
      }
      if (area === 'local' && ch.uth) { XDT.uth = ch.uth.newValue || null; XDT.schedule(); }
    });
    chrome.storage.local.get(['uth', 'bgImage'], (v) => { XDT.uth = (v && v.uth) || null; XDT.bgImage = (v && v.bgImage) || null; });
    chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.bgImage) { XDT.bgImage = ch.bgImage.newValue || null; XDT.schedule(); } });
  }

  /* ---- フォロー/フォロワーの増減の記録(このブラウザ内のみ。storage.local) ---- */
  let folHist = {}, erHist = {}, folLoaded = false, folDirty = false;
  // 統計に出すアカウントの一覧(手動で追加/削除)。これに入っているアカウントだけ記録する。自動取得は廃止。
  let tracked = new Set();
  const isListed = (k) => tracked.has(k);
  XDT.isListed = isListed;
  chrome.storage.local.get(['folHist', 'erHist', 'statList'], (v) => {
    folHist = (v && v.folHist) || {}; erHist = (v && v.erHist) || {};
    // statList が未設定の既存ユーザーは、今ある記録のアカウントを一覧として引き継ぐ
    const init = (v && v.statList) || Object.keys(folHist).concat(Object.keys(erHist));
    tracked = new Set(init.map((n) => String(n).toLowerCase()));
    if (!(v && v.statList)) lset({ statList: [...tracked] });
    folLoaded = true;
  });
  XDT.folHist = () => folHist;
  XDT.erHist = () => erHist;
  XDT.trackFollowers = (name, u) => {
    if (!folLoaded || !name || !u || typeof u.followers !== 'number') return;
    const k = name.toLowerCase(); if (!isListed(k)) return;
    const arr = folHist[k] || (folHist[k] = []);
    const last = arr[arr.length - 1];
    if (last && last.fo === u.followers && last.fr === (u.following_count ?? last.fr)) return; // 変化なし
    if (last && Date.now() - last.t < 60e3) { last.fo = u.followers; last.fr = u.following_count ?? last.fr; last.t = Date.now(); } // 1分以内は上書き
    else arr.push({ t: Date.now(), fo: u.followers, fr: u.following_count ?? null });
    const yr = Date.now() - 400 * 864e5; // 1年ぶんは保持
    if (arr.length && arr[0].t < yr) folHist[k] = arr.filter((p) => p.t >= yr);
    if ((folHist[k] || arr).length > 600) folHist[k] = (folHist[k] || arr).slice(-600);
    if (Object.keys(folHist).length > 120) delete folHist[Object.keys(folHist)[0]];
    folDirty = true;
  };
  // 平均ERの記録(1日1点。アカウントごと)
  XDT.trackEr = (name, avg) => {
    if (!folLoaded || !name || avg == null || !isFinite(avg)) return;
    const k = name.toLowerCase(); if (!isListed(k)) return;
    const arr = erHist[k] || (erHist[k] = []);
    const day = new Date().toISOString().slice(0, 10), last = arr[arr.length - 1];
    if (last && last.d === day) last.er = avg; else arr.push({ t: Date.now(), d: day, er: avg });
    if (arr.length > 400) arr.splice(0, arr.length - 400); // 約1年
    if (Object.keys(erHist).length > 120) delete erHist[Object.keys(erHist)[0]];
    folDirty = true;
  };
  safeInterval(() => { if (folDirty && folLoaded) { folDirty = false; lset({ folHist, erHist }); } }, 1500);

  /* ---- スクリーンネーム↔ID の対応表(見かけたユーザーを記録。ポップアップの変換ツール用) ---- */
  let idMap = {}, idMapDirty = false;
  chrome.storage.local.get('idMap', (v) => { idMap = (v && v.idMap) || {}; });
  XDT.noteId = (name, id) => { if (!name || !id) return; const k = name.toLowerCase(); if (idMap[k] !== id) { idMap[k] = id; idMapDirty = true; } };
  safeInterval(() => { if (idMapDirty) { idMapDirty = false; const ks = Object.keys(idMap); if (ks.length > 3000) ks.slice(0, ks.length - 3000).forEach((k) => delete idMap[k]); lset({ idMap }); } }, 5000);

  // お気に入り(☆)。storage.local の favs = [{name,id,dname,avatar}]。name(スクリーンネーム小文字)で判定。
  let favs = [], favSet = new Set(), favDirty = false;
  const rebuildFavSet = () => { favSet = new Set(favs.map((f) => String(f.name || '').toLowerCase())); };
  chrome.storage.local.get('favs', (v) => { favs = (v && Array.isArray(v.favs)) ? v.favs : []; rebuildFavSet(); });
  XDT.isFav = (name) => favSet.has(String(name || '').toLowerCase());
  // お気に入りのマーク種別('star' または 'heart')。未設定は 'star'。
  XDT.favMark = (name) => { const k = String(name || '').toLowerCase(); const f = favs.find((x) => String(x.name || '').toLowerCase() === k); return (f && f.mark === 'heart') ? 'heart' : 'star'; };
  // ポップアップでの追加/削除を取り込む
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.favs) { favs = Array.isArray(ch.favs.newValue) ? ch.favs.newValue : []; rebuildFavSet(); if (XDT.fullApply) XDT.fullApply(); } });
  // お気に入りユーザーを見かけたら、名前・ID・アイコンを補完する
  XDT.enrichFav = (u) => {
    if (!u || !u.name) return;
    const k = u.name.toLowerCase(); if (!favSet.has(k)) return;
    const f = favs.find((x) => String(x.name || '').toLowerCase() === k); if (!f) return;
    let ch = false;
    if (u.id && f.id !== u.id) { f.id = u.id; ch = true; }
    if (u.dname && f.dname !== u.dname) { f.dname = u.dname; ch = true; }
    if (u.avatar && f.avatar !== u.avatar) { f.avatar = u.avatar; ch = true; }
    if (f.name !== k) { f.name = k; ch = true; }
    if (ch) favDirty = true;
  };
  safeInterval(() => { if (favDirty) { favDirty = false; lset({ favs }); } }, 2000);
  // 削除しないようにロックしたポスト(storage.local の delLock = { [id]: {id,author,text,url,t} })
  let delLock = {};
  const normLock = (o) => { const r = {}; if (o && typeof o === 'object') Object.keys(o).forEach((k) => { const v = o[k]; r[k] = (v && typeof v === 'object') ? v : { id: k }; }); return r; };
  chrome.storage.local.get('delLock', (v) => { delLock = normLock(v && v.delLock); });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.delLock) { delLock = normLock(ch.delLock.newValue); if (XDT.schedule) XDT.schedule(); } });
  XDT.isDelLocked = (id) => !!(id && delLock[id]);
  XDT.lockedList = () => Object.keys(delLock).map((k) => delLock[k]);
  // on 省略時はトグル。meta は追加情報(author/text/url)。
  XDT.toggleDelLock = (id, meta, on) => { if (!id) return; const has = !!delLock[id]; const want = (on === undefined) ? !has : !!on; if (!want) delete delLock[id]; else delLock[id] = Object.assign({ id: String(id), t: Date.now() }, meta || {}); lset({ delLock }); };
  // 簡易下書き(ローカル保存)。drafts = [{id, text, t}]。ポップアップと共有。
  let drafts = [];
  chrome.storage.local.get('drafts', (v) => { drafts = (v && Array.isArray(v.drafts)) ? v.drafts : []; });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.drafts) drafts = Array.isArray(ch.drafts.newValue) ? ch.drafts.newValue : []; });
  XDT.drafts = () => drafts;
  XDT.saveDraft = (text) => { text = String(text || '').trim(); if (!text) return; drafts = drafts.concat([{ id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), text, t: Date.now() }]); if (drafts.length > 200) drafts = drafts.slice(-200); lset({ drafts }); };
  XDT.delDraft = (id) => { drafts = drafts.filter((d) => d.id !== id); lset({ drafts }); };
  // プロフィールの「…」メニュー等からお気に入りを追加/削除する
  XDT.toggleFav = (name) => {
    if (!name) return;
    const k = name.toLowerCase();
    const i = favs.findIndex((f) => String(f.name || '').toLowerCase() === k);
    if (i >= 0) favs.splice(i, 1);
    else { const u = users.get(k); const e = { name: k }; if (u) { if (u.id) e.id = u.id; if (u.dname) e.dname = u.dname; if (u.avatar) e.avatar = u.avatar; } favs.push(e); }
    rebuildFavSet();
    lset({ favs });
  };

  /* ============================ ストア ============================ */
  const users = (XDT.users = new Map()), usersById = (XDT.usersById = new Map()), tweets = (XDT.tweets = new Map());
  const results = (XDT.results = new Map()), searchSeen = new Map(), templates = (XDT.templates = {});
  XDT.rver = 0; XDT.ver = 0;
  { const _set = results.set.bind(results); results.set = (k, v) => { XDT.rver++; return _set(k, v); }; } // 判定結果が変わった時だけ再描画するための版番号
  const lastFrom = new Map();
  const stats = (XDT.stats = { api: 0, react: 0, err: 0, lastErr: '' });
  let bearer = null;
  const num = (x) => { const n = Number(x); return x === undefined || x === null || x === '' || isNaN(n) ? undefined : n; };
  const sleep = (XDT.sleep = (ms) => new Promise((r) => setTimeout(r, ms)));
  let myName = ''; // ログイン中アカウントのスクリーンネーム(分かり次第ここに保持)
  chrome.storage.local.get('me', (v) => { if (!myName && v && v.me && v.me.name) myName = v.me.name; });
  XDT.myName = () => myName || '';
  XDT.myId = () => {
    const m = decodeURIComponent((document.cookie.match(/(?:^|;\s*)twid=([^;]+)/) || [])[1] || '').match(/(\d+)/);
    return m ? m[1] : null;
  };
  XDT.snowTime = (id) => Number((BigInt(id) >> 22n) + 1288834974657n);
  const isHomeOp = (op) => op === 'HomeTimeline' || op === 'HomeLatestTimeline';

  function upsertUser(f) {
    if (!f || !f.name) return;
    const key = f.name.toLowerCase();
    const prev = users.get(key) || {};
    delete prev.unavailable;
    for (const k in f) if (f[k] !== undefined && f[k] !== null) prev[k] = f[k];
    prev.ts = Date.now();
    users.set(key, prev);
    if (prev.id) { usersById.set(prev.id, prev); if (XDT.noteId) XDT.noteId(prev.name, prev.id); }
    if (XDT.enrichFav) XDT.enrichFav(prev); // お気に入りの名前・ID・アイコンを補完
    // ログイン中アカウントのスクリーンネームを早めに確定(数字IDしか無い表示を避ける)
    if (prev.id && prev.name && prev.id === XDT.myId() && myName !== prev.name) {
      myName = prev.name;
      lset({ me: { id: prev.id, name: prev.name } });
    }
    // 統計に手動で追加したアカウントは、見かけたときにフォロワー数を記録する(プロフィールの表示設定に依存しない)。
    if (folLoaded && typeof prev.followers === 'number' && XDT.isListed(prev.name.toLowerCase())) XDT.trackFollowers(prev.name, prev);
    return prev;
  }
  // ログイン中のアカウントのポストが「センシティブになった」タイミングを記録(検知した時刻。Xがラベルを付けた正確な時刻ではありません)
  let sensLog = [], ownSeen = {}, sensLoaded = false, ownDirty = false, ownLast = '';
  chrome.storage.local.get(['sensLog', 'ownSeen'], (v) => { sensLog = (v && v.sensLog) || []; ownSeen = (v && v.ownSeen) || {}; sensLoaded = true; });

  // シャドウバンの記録: shadowLog = [{name(スクリーンネーム小文字), t, kind:'became'|'cleared'|'manual'}]。
  // 検知が続く間は最初の検知時刻を保持し(重複記録しない)、検知されなくなったら 'cleared' を記録する。
  let shadowLog = [], shadowLoaded = false, shadowDirty = false;
  chrome.storage.local.get('shadowLog', (v) => { shadowLog = (v && Array.isArray(v.shadowLog)) ? v.shadowLog : []; shadowLoaded = true; });
  // そのアカウントに「未解除のシャドウバン記録」があるか(時間では自然解除しない=実際に検知されなくなるまで保持)
  const shadowActive = (k) => {
    const becs = shadowLog.filter((e) => e.name === k && (e.kind === 'became' || e.kind === 'manual'));
    if (!becs.length) return null;
    const last = becs.reduce((a, b) => (b.t > a.t ? b : a));
    const cleared = shadowLog.some((e) => e.name === k && e.kind === 'cleared' && e.t > last.t);
    if (cleared) return null;
    return last;
  };
  // シャドウバン判定の結果を記録する。c2_ui の判定(shadowOverall)から呼ばれる。
  // 自動記録は「ログイン中の自分のアカウントのみ」。他のユーザーは手動追加のみ。
  XDT.recordShadow = (name, isBad) => {
    if (!shadowLoaded || !name) return;
    const k = String(name).toLowerCase();
    if (!myName || k !== myName.toLowerCase()) return; // 自分以外は自動記録しない
    const active = shadowActive(k);
    if (isBad && !active) { shadowLog.push({ name: k, t: Date.now(), kind: 'became' }); shadowDirty = true; }
    else if (!isBad && active) { shadowLog.push({ name: k, t: Date.now(), kind: 'cleared' }); shadowDirty = true; }
  };
  safeInterval(() => { if (shadowDirty && shadowLoaded) { shadowDirty = false; if (shadowLog.length > 300) shadowLog = shadowLog.slice(-300); lset({ shadowLog }); } }, 3000);
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.shadowLog) { shadowLog = Array.isArray(ch.shadowLog.newValue) ? ch.shadowLog.newValue : []; } });
  const isSensRec = (r) => !!(r.sens && (r.sens.flag || r.sens.ageGate || (r.sens.media || []).length));
  const SENS_WIN = { '1d': 1, '3d': 3, '7d': 7, '1m': 30 };
  function trackOwn(rec) {
    if (!sensLoaded || !rec || rec.rt || !rec.authorId || rec.authorId !== XDT.myId()) return;
    const cur = isSensRec(rec) ? 1 : 0, prev = ownSeen[rec.id], now = Date.now();
    const who = (usersById.get(rec.authorId) || {}).name || rec.authorName || ''; // 記録するアカウントの@ID(スクリーンネーム)
    const win = (SENS_WIN[S.sensWindow] || 7) * 864e5;
    const ageOk = (now - XDT.snowTime(rec.id)) <= win; // 設定した期間内に投稿されたポストだけ記録
    if (prev === undefined) { ownSeen[rec.id] = cur; if (cur && ageOk) sensLog.push({ id: rec.id, t: now, kind: 'first', who }); ownDirty = true; }
    else if (prev === 0 && cur === 1) { ownSeen[rec.id] = 1; if (ageOk) sensLog.push({ id: rec.id, t: now, kind: 'became', who }); ownDirty = true; }
    else if (prev === 1 && cur === 0) { ownSeen[rec.id] = 0; sensLog.push({ id: rec.id, t: now, kind: 'cleared', who }); ownDirty = true; }
  }
  safeInterval(() => {
    const id = XDT.myId();
    if (!sensLoaded || !id) return;
    const keys = Object.keys(ownSeen);
    if (keys.length > 600) keys.sort((a, b) => (BigInt(a) > BigInt(b) ? 1 : -1)).slice(0, keys.length - 600).forEach((k) => delete ownSeen[k]);
    if (sensLog.length > 300) sensLog = sensLog.slice(-300);
    const rsNow = XDT.recentSens(id);
    sensLog.forEach((e) => { if (e.k === undefined && e.kind === 'became' && Date.now() - e.t < 120e3) { e.k = rsNow.k; ownDirty = true; } });
    const u = usersById.get(id);
    const nm = (u && u.name) || myName || '';
    if (nm && myName !== nm) myName = nm;
    const snap = JSON.stringify({ log: sensLog.length, seen: keys.length, me: nm, rs: XDT.recentSens(id) });
    if (!ownDirty && snap === ownLast) return;
    ownLast = snap; ownDirty = false;
    lset({ sensLog, ownSeen, me: { id, name: nm }, ownRecent: Object.assign({ t: Date.now() }, XDT.recentSens(id)) });
  }, 4000);

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.sensLog && !ch.sensLog.newValue) { sensLog = []; ownSeen = {}; ownLast = ''; } // ポップアップで記録をリセットしたら、メモリ上の記録も消す
    // ポップアップで統計の一覧(追加/削除)が変わったら、メモリ上の一覧を同期する。
    if (ch.statList) {
      const next = new Set((ch.statList.newValue || []).map((n) => String(n).toLowerCase()));
      // 一覧から外れたアカウントは、メモリ上の記録も消す(4秒ごとの書き戻しで復活しないように)
      tracked.forEach((k) => { if (!next.has(k)) { delete folHist[k]; delete erHist[k]; } });
      tracked = next;
    }
  });
  function upsertTweet(f) {
    const prev = tweets.get(f.id) || { counts: {}, sens: { media: [] }, media: [], seen: [] };
    const rec = Object.assign({}, prev);
    rec.id = f.id;
    if (f.authorId) rec.authorId = f.authorId;
    if (f.authorName) rec.authorName = f.authorName;
    if (f.rt !== undefined) rec.rt = f.rt;
    if (f.rtOf) rec.rtOf = f.rtOf;
    rec.counts = Object.assign({}, prev.counts);
    for (const k in (f.counts || {})) if (typeof f.counts[k] === 'number' && !isNaN(f.counts[k])) rec.counts[k] = f.counts[k];
    rec.sens = Object.assign({ media: [] }, prev.sens);
    for (const k in (f.sens || {})) if (f.sens[k] !== undefined) rec.sens[k] = f.sens[k];
    if (f.media && f.media.length) rec.media = f.media;
    if (f.createdAt) rec.createdAt = f.createdAt;
    if (f.edit) rec.edit = f.edit;
    if (f.fullText) rec.fullText = f.fullText;
    rec.seen = prev.seen.slice();
    if (f.meta) {
      if (rec.seen.indexOf(f.meta.op) === -1) rec.seen.push(f.meta.op);
      if (!prev.meta || isHomeOp(f.meta.op) || !isHomeOp(prev.meta.op)) rec.meta = f.meta;
    }
    rec.ts = Date.now();
    tweets.set(f.id, rec);
    trackOwn(rec);
    return rec;
  }
  function trim() { if (tweets.size > 4000) { let i = 0; for (const k of tweets.keys()) { tweets.delete(k); if (++i > 1000) break; } } }

  /* ============================ 受信 ============================ */
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.__xdt !== true) return;
    try {
      if (d.type === 'auth') bearer = d.bearer;
      else if (d.type === 'api') { stats.api++; onApi(d.url, d.body, d.req); }
      else if (d.type === 'react' && !isHelper) { stats.react++; onReact(d); }
    } catch (err) { stats.err++; stats.lastErr = String(err && err.message || err); }
  });

  function onReact(d) {
    routeAdd((d.tweets || []).filter((t) => t && t.id).map((t) => t.id));
    (d.users || []).forEach(reactUser);
    (d.tweets || []).forEach((t) => {
      if (!t || !t.id) return;
      reactUser(t.user);
      upsertTweet({
        id: t.id, authorId: t.user && t.user.id, authorName: t.user && t.user.screen_name, rt: t.rt, counts: t.counts,
        sens: {
          flag: t.possibly_sensitive === true, editable: t.editable, ageGate: t.ageGate,
          media: (t.media || []).flatMap((m) => (m.warn ? ['adult_content', 'graphic_violence', 'other'].filter((k) => m.warn[k]) : [])),
        },
        media: (t.media || []).map((m) => ({ type: m.type, url: m.url, variants: m.variants })),
      });
    });
    XDT.schedule();
  }
  function reactUser(u) {
    if (!u || !u.screen_name) return;
    upsertUser({
      id: u.id, name: u.screen_name, dname: u.name, avatar: u.profile_image_url_https || u.profile_image_url, followers: num(u.followers_count), following_count: num(u.friends_count), statuses: num(u.statuses_count),
      possiblySensitive: u.possibly_sensitive, interstitial: u.profile_interstitial_type, gradAccess: u.has_graduated_access,
      withheld: u.withheld_in_countries, protected: u.protected, following: u.following,
      followedBy: u.followed_by, blocking: u.blocking, blockedBy: u.blocked_by, muting: u.muting,
    });
  }

  function paramsOf(u, req) {
    try {
      if (req && (req.variables || req.features)) return { variables: req.variables || {}, features: req.features || null, fieldToggles: req.fieldToggles || null, method: 'POST' };
      if (u.searchParams.has('variables')) {
        return {
          variables: JSON.parse(u.searchParams.get('variables')),
          features: u.searchParams.has('features') ? JSON.parse(u.searchParams.get('features')) : null,
          fieldToggles: u.searchParams.has('fieldToggles') ? JSON.parse(u.searchParams.get('fieldToggles')) : null,
          method: 'GET',
        };
      }
    } catch (e) {}
    return null;
  }

  let helperSent = false;
  // ルート(例: /user, /user/all, /user/with_replies)ごとに、そのページで読み込まれたポストのIDを覚える(タブごとのスコア用)
  const routeTweets = new Map();
  const routeKey = () => location.pathname.toLowerCase().replace(/\/+$/, '');
  const routeAdd = (ids) => {
    if (!ids.length) return;
    const k = routeKey();
    let st = routeTweets.get(k);
    if (!st) { st = new Set(); routeTweets.set(k, st); if (routeTweets.size > 40) routeTweets.delete(routeTweets.keys().next().value); }
    ids.forEach((id) => { if (st.size < 800) st.add(id); });
  };
  XDT.routeIds = () => routeTweets.get(routeKey());

  function onApi(url, body, req) {
    const u = new URL(url, location.origin);
    const m = u.pathname.match(/\/graphql\/([^/]+)\/([A-Za-z0-9_]+)/);
    if (!m) return;
    const op = m[2];
    const p = paramsOf(u, req);
    if (p && p.features) templates[op] = { queryId: m[1], features: p.features, fieldToggles: p.fieldToggles, method: p.method, variables: p.variables };
    if (op === 'UserByScreenName' && p) noteUserResult(p.variables, body);
    if (op === 'AboutAccountQuery' && p) noteAbout(p.variables, body);
    const arr = [];
    walk(body, { op, meta: null, vis: null, collect: arr }, 0);
    routeAdd(arr.map((t) => t.id));
    if (op === 'SearchTimeline') {
      if (isHelper) {
        if (!helperSent && arr.length >= 0) {
          helperSent = true;
          window.parent.postMessage({ __xdtHelper: 1, rawQuery: qs.get('q') || '', ids: arr.map((t) => t.id), authors: arr.map(authorOf).filter(Boolean), tpl: templates.SearchTimeline || null }, location.origin);
        }
      } else if (p) notePassiveSearch(p.variables, arr);
    }
    trim();
    XDT.schedule();
  }
  const authorOf = (XDT.authorOf = (t) => t.authorName || (usersById.get(t.authorId) || {}).name || '');
  const isBy = (t, name) => authorOf(t).toLowerCase() === String(name).toLowerCase();

  function noteUserResult(v, body) {
    const r = body && body.data && body.data.user && body.data.user.result;
    const n = v && v.screen_name;
    if (!n || !r || r.__typename !== 'UserUnavailable') return;
    const rec = upsertUser({ name: n });
    rec.unavailable = r.reason || r.message || 'unavailable';
  }
  function noteAbout(v, body) {
    const n = v && v.screenName;
    const r = body && body.data && body.data.user_result_by_screen_name && body.data.user_result_by_screen_name.result;
    const ap = r && r.about_profile;
    if (!n || !ap) return;
    upsertUser({ name: n, basedIn: ap.account_based_in, appSource: ap.source });
  }
  function notePassiveSearch(v, arr) {
    const q = ((v && v.rawQuery) || '').trim();
    const m = q.match(/^from:@?(\w+)$/i);
    if (!m) return;
    const found = arr.filter((t) => isBy(t, m[1])).length;
    if (found > 0 || (v.product || 'Top') === 'Latest') searchSeen.set(m[1].toLowerCase(), { ts: Date.now(), found, total: arr.length });
  }

  function walk(o, ctx, d) {
    if (!o || typeof o !== 'object' || d > 60) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, ctx, d + 1); return; }
    if (o.itemContent && o.itemContent.tweet_results && o.itemContent.tweet_results.result) {
      const ic = o.itemContent, cei = o.clientEventInfo || {}, sc = ic.socialContext || {};
      const meta = {
        op: ctx.op, entryId: o.entryId || '',
        injectionType: cei.details && cei.details.timelinesDetails && cei.details.timelinesDetails.injectionType,
        socialType: sc.contextType || sc.type || '', socialText: sc.text || sc.contentText || '',
      };
      walk(ic.tweet_results.result, Object.assign({}, ctx, { meta }), d + 1);
      return;
    }
    const tn = o.__typename;
    if (tn === 'TweetWithVisibilityResults' && o.tweet) {
      walk(o.tweet, Object.assign({}, ctx, { vis: { interstitial: o.tweetInterstitial, limited: o.limitedActionResults } }), d + 1);
      return;
    }
    if (o.rest_id && o.legacy && (tn === 'Tweet' || o.legacy.full_text !== undefined)) {
      ingestTweet(o, ctx);
      const c2 = Object.assign({}, ctx, { meta: null, vis: null });
      for (const k in o) walk(o[k], c2, d + 1);
      return;
    }
    if (o.rest_id && o.legacy && (tn === 'User' || o.legacy.screen_name !== undefined || (o.core && o.core.screen_name !== undefined))) ingestUser(o);
    for (const k in o) walk(o[k], ctx, d + 1);
  }

  function ingestUser(o) {
    const l = o.legacy || {};
    const name = (o.core && o.core.screen_name) || l.screen_name;
    if (!name) return;
    const rp = o.relationship_perspectives || {};
    const pick = (a, b) => (a !== undefined ? a : b);
    upsertUser({
      id: o.rest_id, name,
      followers: num(pick(l.followers_count, o.followers_count)), following_count: num(pick(l.friends_count, o.friends_count)), statuses: num(l.statuses_count),
      possiblySensitive: pick(l.possibly_sensitive, o.possibly_sensitive), interstitial: pick(l.profile_interstitial_type, o.profile_interstitial_type),
      gradAccess: pick(o.has_graduated_access, l.has_graduated_access), protected: pick(o.privacy && o.privacy.protected, l.protected),
      following: pick(rp.following, l.following), followedBy: pick(rp.followed_by, l.followed_by),
      blocking: pick(rp.blocking, l.blocking), blockedBy: pick(rp.blocked_by, l.blocked_by), muting: pick(rp.muting, l.muting),
      withheld: l.withheld_in_countries, created: l.created_at || (o.core && o.core.created_at),
      dname: (o.core && o.core.name) || l.name, // 表示名(ユーザー名)
      avatar: (o.avatar && o.avatar.image_url) || l.profile_image_url_https || (o.legacy && o.legacy.profile_image_url_https),
    });
  }

  function ingestTweet(o, ctx) {
    const l = o.legacy;
    const media = [], warn = [];
    ((l.extended_entities && l.extended_entities.media) || (l.entities && l.entities.media) || []).forEach((m) => {
      const w = m.sensitive_media_warning;
      if (w) for (const k of ['adult_content', 'graphic_violence', 'other']) if (w[k]) warn.push(k);
      media.push({ type: m.type, url: m.media_url_https, variants: ((m.video_info && m.video_info.variants) || []).map((v) => ({ b: v.bitrate, t: v.content_type, u: v.url })) });
    });
    let interstitial, limited;
    if (ctx.vis) {
      if (ctx.vis.interstitial) { const ti = ctx.vis.interstitial; interstitial = (ti.text && ti.text.text) || ti.__typename || 'interstitial'; }
      const la = ctx.vis.limited && ctx.vis.limited.limited_actions;
      if (la && la.length) limited = la.map((x) => x.action).join(',');
    }
    const au = o.core && o.core.user_results && o.core.user_results.result;
    const rec = upsertTweet({
      id: o.rest_id, rt: !!l.retweeted_status_result,
      rtOf: (() => { const r = l.retweeted_status_result && l.retweeted_status_result.result; const x = r && (r.rest_id ? r : r.tweet); return x && x.rest_id; })(),
      authorId: (au && au.rest_id) || l.user_id_str,
      authorName: au && ((au.core && au.core.screen_name) || (au.legacy && au.legacy.screen_name)),
      counts: { reply: num(l.reply_count), repost: num(l.retweet_count), quote: num(l.quote_count), like: num(l.favorite_count), bookmark: num(l.bookmark_count), view: o.views ? num(o.views.count) : undefined },
      sens: {
        flag: l.possibly_sensitive === true, editable: l.possibly_sensitive_editable,
        ageGate: !!(o.mediaVisibilityResults && o.mediaVisibilityResults.blurred_image_interstitial),
        media: Array.from(new Set(warn)), interstitial, limited,
      },
      media, meta: ctx.meta || undefined,
      createdAt: l.created_at,
      edit: (() => { const ec = o.edit_control && (o.edit_control.edit_control_initial || o.edit_control); const ids = ec && ec.edit_tweet_ids; return ids && ids.length ? { ids: ids.slice(), until: ec.editable_until_msecs ? Number(ec.editable_until_msecs) : null } : undefined; })(),
      fullText: (o.note_tweet && o.note_tweet.note_tweet_results && o.note_tweet.note_tweet_results.result && o.note_tweet.note_tweet_results.result.text) || undefined,
    });
    if (ctx.collect) ctx.collect.push(rec);
  }

  /* ============================ API呼び出し ============================ */
  function apiHeaders() {
    const ct0 = (document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/) || [])[1] || '';
    return {
      authorization: 'Bearer ' + (bearer || 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'),
      'x-csrf-token': ct0, 'x-twitter-active-user': 'yes', 'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': document.documentElement.lang || 'ja',
    };
  }
  XDT.apiHeaders = apiHeaders;
  const bg = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => res(chrome.runtime.lastError ? null : r)); } catch (e) { res(null); } });

  const scrapeFail = {};
  async function getTemplate(op) {
    if (templates[op]) return templates[op];
    if (S.safeMode || Date.now() - (scrapeFail[op] || 0) < 30 * 60e3) return null; // バンドルの走査は負荷が大きいので失敗後30分は再試行しない
    const perf = performance.getEntriesByType('resource').map((r) => r.name);
    const srcs = Array.from(new Set(Array.from(document.querySelectorAll('script[src]')).map((s) => s.src).concat(perf)))
      .filter((s) => /abs\.twimg\.com\/responsive-web\/client-web[^?]*\.js$/.test(s));
    const re = new RegExp('queryId:"([\\w-]+)",operationName:"' + op + '",operationType:"query",metadata:\\{featureSwitches:\\[([^\\]]*)\\]');
    for (const s of srcs.slice(0, 14)) {
      const r = await bg({ type: 'fetchText', url: s });
      if (!r || !r.ok) continue;
      const m = r.text.match(re);
      if (!m) continue;
      const features = {};
      m[2].split(',').map((x) => x.replace(/["']/g, '').trim()).filter(Boolean).forEach((k) => (features[k] = true));
      templates[op] = { queryId: m[1], features, fieldToggles: null, method: 'GET' };
      return templates[op];
    }
    scrapeFail[op] = Date.now();
    return null;
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms))]);
  XDT.pauseUntil = 0;
  const reqLog = [];
  const tfetch = (url, opt, ms) => {
    if (S.safeMode) return Promise.reject(new Error('SAFE'));
    const now = Date.now();
    if (now < XDT.pauseUntil) return Promise.reject(new Error('PAUSED'));
    while (reqLog.length && now - reqLog[0] > 60e3) reqLog.shift();
    if (reqLog.length >= 30) return Promise.reject(new Error('RATE'));
    reqLog.push(now);
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 15000);
    return fetch(url, Object.assign({}, opt, { signal: c.signal })).then((r) => { if (r.status === 429) XDT.pauseUntil = Date.now() + 15 * 60e3; return r; }).finally(() => clearTimeout(t));
  };
  async function gqlCall(op, variables, tpl) {
    const features = Object.assign({}, tpl.features);
    const base = `${location.origin}/i/api/graphql/${tpl.queryId}/${op}`;
    for (let i = 0; i < 4; i++) {
      let res;
      if (tpl.method === 'POST') {
        res = await tfetch(base, { method: 'POST', credentials: 'include', headers: Object.assign({ 'content-type': 'application/json' }, apiHeaders()), body: JSON.stringify({ variables, features, fieldToggles: tpl.fieldToggles || undefined, queryId: tpl.queryId }) });
      } else {
        const q = new URLSearchParams({ variables: JSON.stringify(variables), features: JSON.stringify(features) });
        if (tpl.fieldToggles) q.set('fieldToggles', JSON.stringify(tpl.fieldToggles));
        res = await tfetch(`${base}?${q}`, { credentials: 'include', headers: apiHeaders() });
      }
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      const m = text.match(/features cannot be null:\s*([^"\\]+)/);
      if (m) { m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((k) => (features[k] = false)); continue; }
      throw new Error('HTTP ' + res.status);
    }
    throw new Error('RETRY');
  }
  const collect = (data) => { const arr = []; walk(data, { op: 'SearchTimeline', meta: null, vis: null, collect: arr }, 0); return arr; };

  // プロフィール/所在地データが無いとき、公式テンプレで自前取得
  const ensuring = new Set();
  XDT.ensureUser = async (name) => {
    const k = name.toLowerCase();
    if (ensuring.has(k)) return;
    ensuring.add(k);
    try {
      const tpl = await getTemplate('UserByScreenName');
      if (tpl) {
        const j = await gqlCall('UserByScreenName', Object.assign({ withSafetyModeUserFields: true }, tpl.variables || {}, { screen_name: name }), tpl);
        walk(j, { op: 'UserByScreenName', meta: null, vis: null, collect: null }, 0);
        XDT.schedule();
      }
    } catch (e) {} finally { setTimeout(() => ensuring.delete(k), 30000); }
  };
  const aboutTried = new Set();
  XDT.ensureAbout = async (name) => {
    const k = name.toLowerCase();
    if (aboutTried.has(k)) return;
    aboutTried.add(k);
    setTimeout(() => aboutTried.delete(k), 120000); // 取得できなければ2分後に再試行
    const got = () => { const u = users.get(k); return !!(u && u.basedIn); };
    const tries = [];
    if (templates.AboutAccountQuery) tries.push(templates.AboutAccountQuery);
    tries.push({ queryId: 'XRqGa7EeokUU5kppkh13EA', features: {}, fieldToggles: null, method: 'GET' });
    for (const tpl of tries) {
      try { noteAbout({ screenName: name }, await withTimeout(gqlCall('AboutAccountQuery', { screenName: name }, tpl), 12000)); XDT.schedule(); if (got()) return; } catch (e) {}
    }
    try {
      const tpl = await withTimeout(getTemplate('AboutAccountQuery'), 12000);
      if (tpl) { noteAbout({ screenName: name }, await withTimeout(gqlCall('AboutAccountQuery', { screenName: name }, tpl), 12000)); XDT.schedule(); }
    } catch (e) {}
  };

  // プロフィールのメディア一覧(画像+動画)をXのUserMediaで取得(テンプレートはXの通信から取得)
  XDT.loadMedia = async (name, cursor) => {
    const u = users.get(name.toLowerCase());
    if (!u || !u.id) throw new Error('NO_USER');
    const tpl = templates.UserMedia || (await withTimeout(getTemplate('UserMedia'), 12000));
    if (!tpl) throw new Error('NO_TEMPLATE');
    const v = Object.assign({ count: 40, includePromotedContent: false, withClientEventToken: false, withBirdwatchNotes: false, withVoice: true, withV2Timeline: true }, tpl.variables || {}, { userId: u.id });
    if (cursor) v.cursor = cursor; else delete v.cursor;
    const j = await withTimeout(gqlCall('UserMedia', v, tpl), 20000);
    const arr = [];
    walk(j, { op: 'UserMedia', meta: null, vis: null, collect: arr }, 0);
    let next = null;
    (function f(o) { if (!o || typeof o !== 'object') return; if (o.cursorType === 'Bottom' && o.value) next = o.value; for (const k in o) f(o[k]); })(j);
    return { tweets: arr.filter((t) => t.authorId === u.id && t.media && t.media.length && !t.rt), next };
  };

  /* ============================ 検索 (内部iframe方式) ============================ */
  function viaIframe(rawQuery) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.src = `${location.origin}/search?q=${encodeURIComponent(rawQuery)}&src=typed_query&f=live&xdt=1`;
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:800px;border:0;opacity:0;pointer-events:none';
      const done = (fn, v) => { clearTimeout(t); window.removeEventListener('message', on); f.remove(); fn(v); };
      const on = (e) => { const d = e.data; if (e.source === f.contentWindow && d && d.__xdtHelper) done(resolve, d); };
      const t = setTimeout(() => done(reject, new Error('HELPER_TIMEOUT')), 12000);
      window.addEventListener('message', on);
      document.body.appendChild(f);
    });
  }
  let apiBroken = 0;
  async function searchAny(rawQuery, allowFrame) {
    const url = `${location.origin}/search?q=${encodeURIComponent(rawQuery)}&src=typed_query&f=live`;
    if (Date.now() - apiBroken > 10 * 60e3) {
      try {
        const tpl = await getTemplate('SearchTimeline');
        if (!tpl) throw new Error('NO_TEMPLATE');
        const arr = collect(await gqlCall('SearchTimeline', { rawQuery, count: 20, querySource: 'typed_query', product: 'Latest' }, tpl));
        return { ids: arr.map((t) => t.id), authors: arr.map(authorOf), url };
      } catch (e) { if (/^HTTP/.test(String(e.message))) apiBroken = Date.now(); }
    }
    if (!allowFrame || S.safeMode) throw new Error('NO_API');
    const d = await viaIframe(rawQuery);
    if (d.tpl) templates.SearchTimeline = d.tpl;
    return { ids: d.ids || [], authors: d.authors || [], url };
  }

  /* ============================ 判定 ============================ */
  const isSelf = (XDT.isSelf = (name) => { const u = users.get(String(name).toLowerCase()); return !!(u && u.id && u.id === XDT.myId()); });
  function recentIdsBy(name, n) {
    const arr = [];
    for (const t of tweets.values()) if (!t.rt && authorOf(t).toLowerCase() === name.toLowerCase() && Date.now() - XDT.snowTime(t.id) < 14 * 864e5) arr.push(t.id);
    arr.sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1));
    return arr.slice(0, n);
  }
  // 公開コード(safety-label-user-agg)の既定ルール: ポストに NSFW_HIGH_PRECISION が新しく付いたとき、
  // プロフィールの最新5ポスト(リポストは元ポストのラベルで数える)のうち、60日以内で同ラベルのものが3件以上ならアカウントにラベル(7日)。
  // このツールでは「警告(センシティブ)付き」をラベルの目安として数える。
  const sensOf = (t) => { const o = t.rt && t.rtOf ? tweets.get(t.rtOf) : t; return !!(o && o.sens && (o.sens.flag || o.sens.ageGate || (o.sens.media || []).length)); };
  XDT.recentSens = (authorId, list) => {
    const arr = list ? list.slice() : [];
    if (!list) for (const t of tweets.values()) if (t.authorId === authorId && (!t.rt || t.rtOf)) arr.push(t);
    arr.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
    const D60 = 60 * 864e5, now = Date.now();
    const seq = arr.slice(0, 10).map((t) => ({ id: t.rtOf && t.rt ? t.rtOf : t.id, own: t.id, rt: !!t.rt, f: sensOf(t) && now - XDT.snowTime(t.id) < D60, at: XDT.snowTime(t.id) }));
    const last = seq.slice(0, 5), flagged = last.filter((x) => x.f);
    return { n: last.length, k: flagged.length, ids: flagged.map((x) => x.id), seq };
  };
  let viewerCfg = null, viewerTs = 0;
  async function viewerSettings() {
    if (viewerCfg && Date.now() - viewerTs < 10 * 60e3) return viewerCfg;
    viewerTs = Date.now();
    try {
      const r = await tfetch(location.origin + '/i/api/1.1/account/settings.json', { credentials: 'include', headers: apiHeaders() });
      if (r.ok) { const j = await r.json(); viewerCfg = { hideSensitive: j.display_sensitive_media === false }; return viewerCfg; }
    } catch (e) {}
    viewerCfg = { hideSensitive: null };
    return viewerCfg;
  }
  const flaggedAccount = (u) => !!(u && (u.possiblySensitive === true || (u.interstitial && /sensitive|offensive/.test(u.interstitial))));

  XDT.checkSuggest = async (name) => {
    const lower = name.toLowerCase(), u = users.get(lower);
    if (isSelf(name)) return { state: 'unk', value: '自分', skip: true, detail: '自分のアカウントは検索候補に出ないため判定対象外です' };
    if (u && u.protected) return { state: 'unk', value: '非公開', skip: true, detail: '非公開アカウントは検索候補に出ないのが通常です' };
    const q = new URLSearchParams({ include_ext_is_blue_verified: '1', include_ext_verified_type: '1', include_ext_profile_image_shape: '1', q: name, src: 'search_box', result_type: 'events,users,topics' });
    const r = await tfetch(`${location.origin}/i/api/1.1/search/typeahead.json?${q}`, { credentials: 'include', headers: apiHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const hit = (j.users || []).some((x) => (x.screen_name || '').toLowerCase() === lower);
    return hit ? { state: 'ok', value: 'なし', detail: '検索候補(サジェスト)に表示されます' }
      : { state: 'bad', value: 'あり', detail: '検索候補に出ません(サジェストバン。新規/フォロワーが少ないアカウントでも出ない場合があります)' };
  };

  XDT.checkSearchBan = async (name, allowFrame) => {
    const lower = name.toLowerCase(), u = users.get(lower), self = isSelf(name);
    if (u && u.protected) return { state: 'unk', value: '非公開', skip: true, detail: '非公開アカウントです' };
    const seen = searchSeen.get(lower);
    const recent = recentIdsBy(name, 3);
    if (seen && Date.now() - seen.ts < 10 * 60e3 && seen.found > 0) return { state: 'ok', value: 'なし', detail: `直近のFrom検索で ${seen.found} 件ヒット`, url: `${location.origin}/search?q=${encodeURIComponent('from:@' + name)}&f=live` };
    const r = await searchAny('from:' + name, allowFrame);
    lastFrom.set(lower, r);
    const found = r.authors.filter((a) => a.toLowerCase() === lower).length;
    const hit = recent.length ? recent.some((id) => r.ids.includes(id)) : found > 0;
    if (found > 0 || hit) {
      if (self && recent.length) {
        // 自分視点では出てしまうため、セーフサーチ視点(未成年/ログアウト等と同等)でも出るかを確認
        try {
          const s = await searchAny(`from:${name} filter:safe`, allowFrame);
          if (!recent.some((id) => s.ids.includes(id))) return { state: 'bad', value: 'あり', url: r.url, detail: '通常検索には出ますが、セーフサーチ視点(未成年/年齢未設定/ログアウト)では出ません(センシティブ関連ラベルの可能性)' };
        } catch (e) {}
      }
      return { state: 'ok', value: 'なし', url: r.url, detail: `from:@${name} でヒット(${found}件)` };
    }
    if (!recent.length && !(u && u.statuses > 0 && found > 0)) return { state: 'unk', value: '不明', url: r.url, detail: '最近のポストが読み込まれていないため判定できません(ポストを表示してから再確認)' };
    const cfg = await viewerSettings();
    if (flaggedAccount(u) && cfg.hideSensitive === true) return { state: 'warn', value: '設定影響', url: r.url, detail: 'あなたの「センシティブな内容を表示しない」設定の影響で出ていない可能性があります' };
    if (self) return { state: 'warn', value: '要確認', url: r.url, detail: '自分視点でヒットしません(自分の検索は不安定です。Under the Hood も確認してください)' };
    if (u && u.following === true) return { state: 'warn', value: '参考', url: r.url, detail: 'フォロー中のためフォロワー視点です。ヒットしません(検索Banの可能性)' };
    return { state: 'bad', value: 'あり', url: r.url, detail: `from:@${name} でヒットしません(検索Ban・投稿が古い場合も同じ結果になります)` };
  };

  XDT.tweetSearchQuery = (id, author) => `from:${author} since_id:${BigInt(id) - 1n} max_id:${id}`;
  XDT.checkTweetSearch = async (id, author, allowFrame) => {
    const t0 = XDT.snowTime(id);
    const day = (o) => new Date(t0 + o * 864e5).toISOString().slice(0, 10);
    const q1 = XDT.tweetSearchQuery(id, author);
    const r1 = await searchAny(q1, allowFrame);
    if (r1.ids.includes(id)) return { state: 'ok', value: 'なし', url: r1.url, detail: 'このポストは from: 検索に表示されます' };
    const r2 = await searchAny(`from:${author} since:${day(-1)} until:${day(2)}`, allowFrame);
    if (r2.ids.includes(id)) return { state: 'ok', value: 'なし', url: r2.url, detail: 'このポストは from: 検索に表示されます' };
    if (Date.now() - t0 < 10 * 60e3) return { state: 'unk', value: '不明', url: r1.url, detail: '投稿直後は検索インデックス未反映の可能性があります' };
    const rec = tweets.get(id), u = users.get(author.toLowerCase());
    const cfg = await viewerSettings();
    if (rec && (rec.sens.flag || rec.sens.ageGate) && cfg.hideSensitive === true) return { state: 'warn', value: '設定影響', url: r1.url, detail: 'ポストがセンシティブ判定で、あなたの表示設定により検索から除外された可能性があります' };
    if (u && u.id === XDT.myId()) return { state: 'warn', value: '要確認', url: r1.url, detail: '自分視点でヒットしません(自分の検索は不安定です)' };
    return { state: 'bad', value: 'あり', url: r1.url, detail: 'このポストは from: 検索にヒットしません(検索Ban・ゴーストBan・削除/非公開などの可能性)' };
  };

  const queued = (() => {
    let active = 0; const q = [];
    const pump = () => { while (active < 3 && q.length) { const j = q.shift(); active++; j.fn().then(j.res, j.rej).finally(() => setTimeout(() => { active--; pump(); }, 150)); } };
    return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); pump(); });
  })();
  const errResult = (e) => {
    const msg = String((e && e.message) || e);
    stats.lastErr = msg;
    if (msg === 'TIMEOUT' || msg === 'AbortError' || /aborted/i.test(msg)) return { state: 'unk', value: '不明', detail: '確認がタイムアウトしました(クリックで再確認)' };
    if (/^(SAFE|PAUSED|RATE|NO_API)$/.test(msg)) return { state: 'unk', value: '不明', skip: true, detail: msg === 'SAFE' ? 'セーフモード中は自動通信を停止しています' : '通信を抑制中です(Xの制限回避)' };
    if (msg === 'HELPER_TIMEOUT') return { state: 'unk', value: '不明', detail: '内部の検索確認がタイムアウトしました' };
    return { state: 'unk', value: '不明', detail: 'エラー: ' + msg + '(レート制限/仕様変更の可能性)' };
  };

  // 結果キー: 'ps:name'(検索Ban) 'pg:name'(サジェストバン) 't:id'(ポスト検索)
  XDT.run = async (key, fn) => {
    const cur = results.get(key);
    if (cur && cur.running) return;
    results.set(key, { running: true, prev: cur });
    XDT.schedule();
    let r;
    try { r = await queued(() => withTimeout(fn(), 45000)); } catch (e) { r = errResult(e); }
    r.ts = Date.now();
    results.set(key, r);
    XDT.schedule();
  };
  XDT.runSearchBan = (name, force) => { const c = results.get('ps:' + name.toLowerCase()); if (c && !c.running && !force && Date.now() - c.ts < 10 * 60e3) return; return XDT.run('ps:' + name.toLowerCase(), () => XDT.checkSearchBan(name, force).then((x) => { const r = lastFrom.get(name.toLowerCase()); if (r && x) x.ids = r.ids; return x; })); };
  XDT.runSuggestBan = (name, force) => { const c = results.get('pg:' + name.toLowerCase()); if (c && !c.running && !force && Date.now() - c.ts < 10 * 60e3) return; return XDT.run('pg:' + name.toLowerCase(), () => XDT.checkSuggest(name)); };
  XDT.runTweetSearch = (id, author, manual) => XDT.run('t:' + id, () => XDT.checkTweetSearch(id, author, manual));

  /* ============================ 状態の計算 ============================ */
  const INTERSTITIAL_JA = { sensitive_media: 'プロフィールのメディアがセンシティブ', offensive_profile_content: 'プロフィール内容が不適切の可能性', fake_account: '不審/偽アカウント警告', timeout: '一時的な制限' };
  XDT.INTERSTITIAL_JA = INTERSTITIAL_JA;
  XDT.uthEffect = (name) => {
    const n = String(name).toUpperCase().replace(/_/g, '');
    if (n.indexOf('NSFW') !== -1) return '非フォロワーのおすすめ・未成年/年齢未設定/ログアウトから非表示';
    if (n === 'SPAM') return 'Xから非表示';
    if (n.indexOf('SPAM') !== -1) return '非フォロワーへのおすすめ停止';
    if (n.indexOf('DONOTAMPLIFY') !== -1) return '拡散抑制';
    if (n.indexOf('FOSNR') !== -1) return 'プロフィールからのみ閲覧可';
    if (n.indexOf('ABUSIVE') !== -1 || n.indexOf('HATE') !== -1) return '表示制限';
    if (n === 'READONLY') return '投稿・操作制限';
    if (n === 'COMPROMISED') return '乗っ取り疑い';
    return '';
  };
  // 検索Ban / サジェストバン を統合した総合状態(プロフィール・ポスト共通): [state, value, title]
  XDT.accountFlags = (u) => {
    const r = [];
    if (!u) return r;
    if (u.possiblySensitive === true) r.push('アカウントにセンシティブフラグ(非フォロワーのおすすめ除外・検索に出にくい)');
    if (u.interstitial && INTERSTITIAL_JA[u.interstitial]) r.push(INTERSTITIAL_JA[u.interstitial] + '(NsfwAvatar/Banner相当: 非フォロワーのおすすめ除外)');
    if (u.gradAccess === false) r.push('段階的な利用制限(リーチ制限の可能性)');
    if (u.id) { const rs = XDT.recentSens(u.id); if (rs.n >= 3 && rs.k >= 3) r.push(`直近${rs.n}件中${rs.k}件がセンシティブ(3/5でアカウントラベル化)`); }
    return r;
  };
})();
