const DEFAULTS = {
  theme: 'light',
  birthday: 'show', hideJoin: false, timeFmt: 'off', clockStyle: 'off', timeOrder: 'time', numDetail: true, starLike: false, avatarSquare: false,
  hideText: false, markEngaged: true, lockMark: false, lockColor: '#ffd400', showLocation: true, unblur: false, revealLabel: false,
  hideCall: false, hideBadge: false, hideBoost: false, hideCreator: false, hidePremium: false, hidePremiumSub: false, hideArticles: false,
  hideGrok: false, hideLive: false, hideNews: false, hideTrends: false, hideWhoFollow: false, hideForYou: false, hideSearchTopics: false,
  hideCommunities: false, hideBusiness: false, hideAds: false, hideCreateSpace: false, hideSearchBar: false, hideTLWhoFollow: false, notifPrivacy: false, hideGetVerified: false,
  fromButton: true, copyName: true, copyScreen: true, profSensitive: true, profShadow: true, hideUnfollowMutual: false, acctScore: true,
  autoProfileCheck: true, forceFollowing: false, mediaMergeTabs: false, relIndicator: true,
  tweetSensitive: true, tweetShadow: true, tweetSearchBan: true, tweetRecommend: true, onlyProblem: false, relationChip: true,
  reactPlace: 'below', erPlace: 'below', dlPlace: 'below', bookmarkCount: true,
  shareCheck: true, muteKeyword: true, replySort: 'off', followSort: 'off',
  composeCheck: true, moreDisplay: true, compX: true, compGoogle: false, compOpenAI: false, imageZoom: true, advSearch: true,
  urlMark: false, urlColor: '#1d9bf0', urlLine: false, urlLineColor: '#1d9bf0', hashMark: false, hashColor: '#00ba7c', hashLine: false, hashLineColor: '#00ba7c',
  blurInactive: false, blurPx: 6, expandMore: false, mediaGrid: false,
  hlList: [], hlOn: true, hlMark: true, hlColor: '#ffd400', hlLine: false, hlLineColor: '#ff3b30',
  snipEnable: true, draftEnable: true, replyNameEnable: true, snippets: [],
  notInterested: false, ageLocal: false, erList: false, followerTrack: false,
  hqMedia: false, showEdited: true, birthdayHideSelf: false, muteRules: [],
  hideImgEdit: false, hideDelete: false, blurLocked: false, hideGrokBtn: false, favStar: true, favMenuBtn: true,
  mediaOnly: false, hideFollowBtn: false, twitterMode: false, mediaImageFirst: false, oneClickBlock: false, hideFooter: false, extraPlaceMap: {}, extraLists: true, uthShow: true, extraCustom: [], extraOrder: [], delProtect: false, chartAgg: 'hour',
  chartMode: 'line', chartMetric: 'er', chartPeriod: '28d', sensWindow: '7d',
  safeMode: false,
};

const $ = (s) => document.querySelector(s);
const isDock = /panel\.html$/.test(location.pathname) || new URLSearchParams(location.search).get('dock') === '1';
if (isDock) document.body.classList.add('dock');
let _idMap = {};
try { chrome.storage.local.get('idMap', (v) => { _idMap = (v && v.idMap) || {}; }); } catch (e) {}
try { chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && ch.idMap) _idMap = ch.idMap.newValue || {}; }); } catch (e) {}

function paint(v) {
  document.documentElement.dataset.theme = v.theme === 'dark' ? 'dark' : 'light';
  document.querySelectorAll('input[type=checkbox][data-k]').forEach((i) => { i.checked = !!v[i.dataset.k]; });
  document.querySelectorAll('input[type=color][data-k]').forEach((i) => { i.value = v[i.dataset.k] || '#ffd400'; });
  document.querySelectorAll('select[data-k]').forEach((i) => { i.value = v[i.dataset.k]; });
  document.querySelectorAll('input[type=range][data-k]').forEach((i) => { i.value = v[i.dataset.k]; });
  document.querySelectorAll('textarea[data-k]').forEach((i) => { if (document.activeElement !== i) i.value = v[i.dataset.k] || ''; });
  document.querySelectorAll('[data-sel]').forEach((g) => g.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v[g.dataset.sel])));
  document.querySelectorAll('#theme button').forEach((b) => b.classList.toggle('on', b.dataset.v === (v.theme || 'light')));
}
chrome.storage.sync.get(DEFAULTS, paint);
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync') chrome.storage.sync.get(DEFAULTS, paint); });

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.dataset || !t.dataset.k) return;
  const val = t.type === 'range' ? Number(t.value) : (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.type === 'color') ? t.value : t.checked;
  chrome.storage.sync.set({ [t.dataset.k]: val });
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('.seg button');
  if (b) {
    const g = b.closest('.seg');
    if (g.id === 'theme') chrome.storage.sync.set({ theme: b.dataset.v });
    else if (g.dataset.sel) chrome.storage.sync.set({ [g.dataset.sel]: b.dataset.v });
  }
});
$('#pin').addEventListener('click', () => chrome.windows.getCurrent((w) => chrome.sidePanel.open({ windowId: w.id }, () => { if (chrome.runtime.lastError) $('#diag').textContent = 'サイドパネルを開けませんでした: ' + chrome.runtime.lastError.message; else window.close(); })));
$('#uth').addEventListener('click', () => window.open('https://x.com/i/under_the_hood', '_blank'));

/* ---- Under the Hood レポートの取り込み(スキーマ非依存の汎用パーサ) ---- */
const KNOWN = /^(SpamHighRecall|AbusiveHighRecall|Compromised|ReadOnly|NsfwHighRecall|NsfwAvatarImage|NsfwBannerImage|DoNotAmplify|[A-Z][A-Z0-9_]{3,})$/;
function extractLabels(j) {
  const out = {};
  (function rec(o) {
    if (Array.isArray(o)) { o.forEach(rec); return; }
    if (!o || typeof o !== 'object') return;
    for (const k in o) {
      const v = o[k];
      if (KNOWN.test(k) && (typeof v === 'number' || (v && typeof v === 'object'))) {
        const c = typeof v === 'number' ? v : (v.count ?? v.postCount ?? v.days ?? v.activeDays ?? 1);
        if (c > 0) out[k] = (out[k] || 0) + Number(c);
      } else if (typeof v === 'string' && KNOWN.test(v) && /label|name/i.test(k)) {
        const c = o.count ?? o.postCount ?? o.days ?? o.activeDays ?? 1;
        if (Number(c) > 0 || c === undefined) out[v] = (out[v] || 0) + (Number(c) || 1);
      }
      rec(v);
    }
  })(j);
  return Object.keys(out).map((name) => ({ name, count: out[name] }));
}
// 該当ポストのID(ラベルごと)。IDは大きな数値なので、数値のままだと桁が欠ける → 文字列として読み込む
const bigIdReviver = function (key, value, ctx) { return typeof value === 'number' && ctx && typeof ctx.source === 'string' && /^\d{15,}$/.test(ctx.source) ? ctx.source : value; };
const ID_RE = /^\d{15,20}$/;
function labelIds(j) {
  const out = {};
  const add = (l, id) => { (out[l] = out[l] || new Set()).add(id); };
  const ids = (o, acc, d) => {
    if (o === null || o === undefined || d > 6) return;
    if (typeof o === 'string' || typeof o === 'number') { if (ID_RE.test(String(o))) acc.add(String(o)); return; }
    if (Array.isArray(o)) { o.forEach((x) => ids(x, acc, d + 1)); return; }
    if (typeof o === 'object') for (const k in o) ids(o[k], acc, d + 1);
  };
  (function rec(o) {
    if (Array.isArray(o)) { o.forEach(rec); return; }
    if (!o || typeof o !== 'object') return;
    for (const k in o) if (KNOWN.test(k)) { const acc = new Set(); ids(o[k], acc, 0); acc.forEach((id) => add(k, id)); } // (A) ラベル名がキー
    const own = new Set(), labs = new Set();
    for (const k in o) { // (B) 1つのオブジェクトにポストIDとラベル名が同居
      const v = o[k];
      if ((typeof v === 'string' || typeof v === 'number') && ID_RE.test(String(v)) && /id|post|tweet/i.test(k)) own.add(String(v));
      if (typeof v === 'string' && KNOWN.test(v)) labs.add(v);
      if (Array.isArray(v)) v.forEach((x) => { if (typeof x === 'string' && KNOWN.test(x)) labs.add(x); });
    }
    if (own.size && labs.size) labs.forEach((l) => own.forEach((id) => add(l, id)));
    for (const k in o) rec(o[k]);
  })(j);
  return out;
}
function withIds(labels, idMap) {
  const byName = {};
  labels.forEach((l) => { byName[l.name] = l; });
  Object.keys(idMap).forEach((n) => { if (!byName[n]) labels.push((byName[n] = { name: n, count: idMap[n].size })); });
  labels.forEach((l) => { l.ids = Array.from(idMap[l.name] || []).sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1)); }); // 新しいポストが上
  return labels;
}
// Under the Hood の実際の形式: {period:{startDate,endDate,timezone}, generatedAt, postCount, postLabels:[{label,about,effect,posts,totalPostsInMonth,percentageOfPosts,postIds}], accountLabels:[...]}
function parseUthV2(j) {
  if (!j || typeof j !== 'object' || (!Array.isArray(j.postLabels) && !Array.isArray(j.accountLabels))) return null;
  const num = (x) => { const n = Number(String(x === null || x === undefined ? '' : x).replace(/,/g, '')); return x !== null && x !== undefined && x !== '' && Number.isFinite(n) ? n : null; };
  const labs = [], uniq = new Set();
  (j.postLabels || []).forEach((l) => {
    const ids = (l.postIds || []).map(String).filter((id) => ID_RE.test(id));
    ids.forEach((id) => uniq.add(id));
    labs.push({ name: l.label, count: num(l.posts) !== null ? num(l.posts) : ids.length, pct: l.percentageOfPosts || '', total: num(l.totalPostsInMonth), ids: ids.sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1)), about: l.about || '', effect: l.effect || '', appeal: l.howToAppeal || '', notShown: l.postIdsNotShownNote || '', recentNote: l.postIdsMostRecentNote || '', scope: 'post' });
  });
  const acct = (j.accountLabels || []).map((l) => (typeof l === 'string' ? { name: l } : { name: l.label || l.name || '(不明)', about: l.about || '', effect: l.effect || '', appeal: l.howToAppeal || '' }));
  const per = j.period || {};
  return { labels: labs, acct, meta: { start: per.startDate || null, end: per.endDate || null, tz: per.timezone || '', generated: j.generatedAt || null, posts: num(j.postCount), uniq: uniq.size } };
}
const idDate = (id) => new Date(Number((BigInt(id) >> 22n) + 1288834974657n)).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
// ラベル名からの一般的な説明(Xの公式な定義ではありません)
function uthInfo(name) {
  const n = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const has = (k) => n.indexOf(k) !== -1;
  if (has('NSFWHIGHPRECISION')) return ['成人向け(高精度)', 'ポストが成人向けと高い確度で判定されたラベル。フォロワー以外へのおすすめや、未成年・年齢未設定・ログアウト時の表示から外れます。'];
  if (has('NSFWHIGHRECALL')) return ['成人向けの疑い(広め判定)', '成人向けの可能性を広めに拾うラベル。非フォロワーへのおすすめや、年齢制限のある閲覧者への表示が抑えられます。'];
  if (has('NSFWAVATAR') || has('NSFWBANNER')) return ['プロフィール画像/バナーが成人向け', 'プロフィールがセンシティブ扱いになり、非フォロワーへのおすすめ・検索での表示が抑えられます。'];
  if (has('NSFWTEXT')) return ['文章が成人向け', '文章の内容が成人向けと判定されたラベル。おすすめや検索での表示が抑えられます。'];
  if (has('NSFW')) return ['成人向け(センシティブ)関連', '成人向けの内容に関するラベル。非フォロワーへのおすすめや、年齢制限のある閲覧者への表示が抑えられます。'];
  if (has('SPAMHIGHRECALL')) return ['スパムの疑い(広め判定)', 'スパムの可能性を広めに拾うラベル。非フォロワーへのおすすめが抑えられます。'];
  if (n === 'SPAM' || has('SPAMHIGHPRECISION')) return ['スパム', 'スパムと判定されたラベル。表示が大きく制限される場合があります。'];
  if (has('SPAM')) return ['スパム関連', 'スパムに関するラベル。おすすめや検索での表示が抑えられます。'];
  if (has('ABUSIVE') || has('HARASS')) return ['攻撃的・嫌がらせの可能性', '攻撃的な内容に関するラベル。返信欄やおすすめでの表示が抑えられます。'];
  if (has('HATE')) return ['ヘイト関連の可能性', 'ヘイト的な内容に関するラベル。表示が制限される場合があります。'];
  if (has('VIOLEN') || has('GORE')) return ['暴力的・残虐な内容の可能性', '暴力的な内容に関するラベル。センシティブ警告や表示制限の対象になります。'];
  if (has('DONOTAMPLIFY')) return ['拡散抑制', 'おすすめやタイムラインでの拡散が抑えられます。投稿自体は残ります。'];
  if (has('FOSNR')) return ['拡散制限(FoSNR)', '投稿は残りますが、おすすめ・検索・返信欄などで目立たなくなります(プロフィールから見られる状態)。'];
  if (has('READONLY')) return ['閲覧専用(操作制限)', 'アカウントの投稿や操作が制限されている状態を示すラベルです。'];
  if (has('COMPROMISED')) return ['乗っ取りの疑い', 'アカウントが第三者に操作されている可能性があるときのラベルです。'];
  if (has('LOWQUALITY')) return ['低品質', '品質が低いと判定されたラベル。おすすめでの表示が抑えられます。'];
  return ['Xの可視性ラベル', 'Xの表示のされやすさに関するラベルです。このラベルの公式な詳細定義は公開されていません。'];
}
// レポートの期間・ポスト数・生成日(スキーマ非依存の推定。見つからない項目は「不明」)
// 期間内のポスト数: キー名が分からないため、「ポスト/tweet」を含む数値のうち、合計・期間・件数を表す名前のものを選ぶ(ラベルごとの数は除外)
function extractPostCount(j) {
  let best = null;
  (function rec(o, path) {
    if (Array.isArray(o)) { o.forEach((x) => rec(x, path + '[]')); return; }
    if (!o || typeof o !== 'object') return;
    for (const k in o) {
      const v = o[k], pth = path ? path + '.' + k : k;
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 && /post|tweet|ポスト/i.test(k)) {
        let sc = 0;
        if (/total|all|overall|sum/i.test(pth)) sc += 3;
        if (/period|range|window|month|report|analy[sz]ed|reviewed|within|in_?range/i.test(pth)) sc += 1;
        if (/count|num|number|total/i.test(k)) sc += 2;
        if (/label|percent|ratio|rate|carried|removed|affected|flagged|limited|hidden|share/i.test(pth)) sc -= 4;
        if (!best || sc > best.sc) best = { sc, v, pth };
      }
      rec(v, pth);
    }
  })(j, '');
  return best && best.sc > -2 ? best.v : null;
}
function numericItems(j) { // 見つからないときに確認できるよう、レポート内の数値項目(名前に post/count/total などを含むもの)を出す
  const out = [];
  (function rec(o, path) {
    if (Array.isArray(o)) { o.slice(0, 3).forEach((x) => rec(x, path + '[]')); return; }
    if (!o || typeof o !== 'object' || out.length >= 40) return;
    for (const k in o) {
      const v = o[k], pth = path ? path + '.' + k : k;
      if (typeof v === 'number' && Number.isFinite(v) && /post|tweet|count|total|num|period|day|ポスト/i.test(k)) out.push({ p: pth, v });
      rec(v, pth);
    }
  })(j, '');
  return out.slice(0, 40);
}
function extractMeta(j) {
  const m = { start: null, end: null, generated: null };
  const isDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) || (typeof v === 'number' && v > 1e9 && v < 4e12);
  (function rec(o) {
    if (Array.isArray(o)) { o.forEach(rec); return; }
    if (!o || typeof o !== 'object') return;
    for (const k in o) {
      const v = o[k];
      if (isDate(v)) {
        if (!m.start && /start|from|begin|since/i.test(k)) m.start = v;
        else if (!m.end && /end|^to$|until|through/i.test(k)) m.end = v;
        else if (!m.generated && /generat|creat|report|export|updated|timestamp|date/i.test(k)) m.generated = v;
      }
      rec(v);
    }
  })(j);
  m.posts = extractPostCount(j);
  m.nums = numericItems(j);
  return m;
}
const fmtDate = (v) => {
  if (v === null || v === undefined) return '不明';
  const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v);
  if (isNaN(d)) return String(v);
  return typeof v === 'string' && v.length <= 10 ? d.toLocaleDateString('ja-JP') : d.toLocaleString('ja-JP');
};
function appendMeta(el, u) {
  const m = u.meta || {};
  const lines = [
    ['対象期間', m.start || m.end ? `${fmtDate(m.start)} 〜 ${fmtDate(m.end)}${m.tz ? ' (' + m.tz + ')' : ''}` : '不明'],
    ['期間内のポスト数', m.posts !== null && m.posts !== undefined ? `${Number(m.posts).toLocaleString()}件` : '不明(下の「レポート内の数値」を参照)'],
    ['ラベル付きのポスト(重複なし)', m.uniq !== undefined && m.uniq !== null ? `${m.uniq}件` : null],
    ['レポート生成日', m.generated ? fmtDate(m.generated) : (u.fileTs ? fmtDate(u.fileTs) + '(ファイルの更新日)' : '不明')],
  ];
  lines.filter((l) => l[1] !== null).forEach(([k, v]) => { const d = document.createElement('div'); d.className = 'uthmeta'; d.textContent = `${k}: ${v}`; el.appendChild(d); });
  if (m.nums && m.nums.length) {
    const dt = document.createElement('details');
    dt.className = 'uthnums';
    const sm = document.createElement('summary');
    sm.textContent = `レポート内の数値(${m.nums.length}件)`;
    dt.appendChild(sm);
    m.nums.forEach((n) => { const r = document.createElement('div'); r.className = 'uthnum'; r.textContent = `${n.p}: ${n.v}`; dt.appendChild(r); });
    el.appendChild(dt);
  }
}
function showUth(u) {
  const el = $('#uthinfo');
  el.textContent = '';
  if (!u) { el.textContent = 'レポート未取り込み'; return; }
  const head = document.createElement('div');
  head.textContent = (u.labels.length ? `ラベル ${u.labels.length}件` : 'ラベルなし(クリーンなレポート)') + ` / 取り込み: ${new Date(u.ts).toLocaleDateString()}`;
  el.appendChild(head);
  appendMeta(el, u);
  u.labels.forEach((l) => {
    const [jp, desc] = uthInfo(l.name);
    const row = document.createElement('div');
    row.className = 'uthrow';
    const t = document.createElement('b');
    t.textContent = `${jp}`;
    const meta = document.createElement('span');
    meta.textContent = ` ${l.name} ×${l.count}${l.pct ? ' (' + l.pct + ')' : ''}`;
    const d = document.createElement('p');
    d.textContent = desc;
    row.append(t, meta, d);
    if (l.effect || l.about) { // Xの公式の説明(英語のまま)
      const dt = document.createElement('details');
      dt.className = 'uthofficial';
      const sm = document.createElement('summary');
      sm.textContent = '公式の説明(英語)';
      dt.appendChild(sm);
      [l.about, l.effect].filter(Boolean).forEach((x) => { const pp = document.createElement('p'); pp.textContent = x; dt.appendChild(pp); });
      row.appendChild(dt);
    }
    if (l.appeal) { const ap = document.createElement('p'); ap.className = 'uthnote'; ap.textContent = '異議申し立て: ' + l.appeal + (/appeal from the post/i.test(l.appeal) ? '(ポストにラベルが残っていれば、ポストの「…」から申し立てできます)' : ''); row.appendChild(ap); }
    if ((!l.ids || !l.ids.length) && l.notShown) { const ns = document.createElement('p'); ns.className = 'uthnote'; ns.textContent = 'ポストの一覧なし: ' + l.notShown + '(期間内のポストの5%を超えると一覧は出ません。3件以下なら常に出ます)'; row.appendChild(ns); }
    if (l.recentNote) { const rn = document.createElement('p'); rn.className = 'uthnote'; rn.textContent = l.recentNote + '(最新の分だけ一覧に出ています)'; row.appendChild(rn); }
    if (l.ids && l.ids.length) {
      const cap = document.createElement('div');
      cap.className = 'uthcap';
      cap.textContent = `該当ポスト ${l.ids.length}件(URLをクリックでポストを開く)`;
      const list = document.createElement('div');
      list.className = 'uthidlist'; // 6件を超えると専用スクロールバー
      l.ids.forEach((id) => {
        const a = document.createElement('a');
        a.className = 'uthid'; a.textContent = 'https://x.com/i/status/' + id; a.href = 'https://x.com/i/status/' + id; a.target = '_blank'; a.rel = 'noopener noreferrer';
        const dts = document.createElement('span');
        dts.className = 'uthdate'; dts.textContent = idDate(id); a.appendChild(dts); // ポストの投稿日時(IDから算出)
        list.appendChild(a);
      });
      row.append(cap, list);
    }
    el.appendChild(row);
  });
  if (u.v2) {
    const ac = document.createElement('div');
    ac.className = 'uthrow';
    const ab = document.createElement('b');
    ab.textContent = 'アカウントのラベル(期間内)';
    ac.appendChild(ab);
    if (!u.acct || !u.acct.length) { const pp = document.createElement('p'); pp.textContent = 'ありません。'; ac.appendChild(pp); }
    else u.acct.forEach((a) => { const [jp, desc] = uthInfo(a.name); const pp = document.createElement('p'); pp.textContent = `${jp} (${a.name}): ${desc}`; ac.appendChild(pp); if (a.effect) { const e2 = document.createElement('p'); e2.className = 'uthnote'; e2.textContent = a.effect; ac.appendChild(e2); } });
    el.appendChild(ac);
  }
  if (!u.v2 && u.labels.length && !u.labels.some((l) => l.ids && l.ids.length)) {
    const ni = document.createElement('p');
    ni.className = 'uthnote';
    ni.textContent = '該当ポストのIDはレポートに含まれていません。現在の公開コードでは、ラベルが3件以下のポストなら常に一覧が出て、期間内のポストの5%を超えると出ません。その間なら最新50件までが出ます(この機能が有効な場合)。';
    el.appendChild(ni);
  }
  const note = document.createElement('p');
  note.className = 'uthnote';
  note.textContent = '※ラベル名からの一般的な説明で、Xの公式な定義ではありません。この内容はプロフィールやポストの判定には反映されません(ここでの表示のみ)。';
  el.appendChild(note);
}
$('#uthreset').addEventListener('click', () => chrome.storage.local.remove('uth', () => showUth(null)));
chrome.storage.local.get('uth', (v) => showUth(v.uth));
$('#uthfile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result, bigIdReviver), v2 = parseUthV2(j);
      const u = v2 ? { ts: Date.now(), v2: true, labels: v2.labels, acct: v2.acct, meta: v2.meta, fileTs: f.lastModified } : { ts: Date.now(), labels: withIds(extractLabels(j), labelIds(j)), meta: extractMeta(j), fileTs: f.lastModified };
      chrome.storage.local.set({ uth: u }, () => showUth(u));
    } catch (err) { $('#uthinfo').textContent = '読み込みに失敗しました: ' + err.message; }
  };
  r.readAsText(f);
});

/* ---- 診断 ---- */
function diag() {
  const el = $('#diag');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0]) { el.textContent = 'タブなし'; return; }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'diag' }, (r) => {
      if (chrome.runtime.lastError || !r) { el.textContent = 'Xのタブを開いて確認してください'; return; }
      el.textContent = `API ${r.api} / React ${r.react} / ユーザー ${r.users} / ポスト ${r.tweets} / エラー ${r.err}${r.lastErr ? ' (' + r.lastErr + ')' : ''}${r.me && r.me.id ? ' / ログイン中: ' + (meScreenName(r.me, _idMap) ? '@' + meScreenName(r.me, _idMap) : 'ID ' + r.me.id) : ' / ログイン中: 未取得'}`;
    });
  });
}
diag();
setInterval(diag, 3000);

/* ---- 一覧の追加・削除(定型文 / キーワード強調 共通) ---- */
function limitRows(el, n) {
  el.style.maxHeight = ''; el.style.overflowY = '';
  const rows = el.children;
  if (rows.length <= n) return;
  let h = 0;
  for (let i = 0; i < n; i++) h += rows[i].getBoundingClientRect().height;
  if (!h) return; // 折り畳み中は計測できないので、開いたときに再計算
  const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
  el.style.maxHeight = Math.ceil(h + gap * (n - 1) + 2) + 'px';
  el.style.overflowY = 'auto';
}
const limitAll = () => ['#snList', '#hlList', '#sensList'].forEach((s) => { const e = $(s); if (e) limitRows(e, 6); });
function listEditor(key, prefix) {
  const render = (list) => {
    const el = $('#' + prefix + 'List');
    el.innerHTML = '';
    (list || []).forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'snr';
      // クリックでその場で編集。空にして確定すると削除
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'snedit'; inp.value = t;
      inp.addEventListener('change', () => chrome.storage.sync.get({ [key]: [] }, (v) => {
        const a = v[key].slice(), nv = inp.value.trim();
        if (nv) a[i] = nv; else a.splice(i, 1);
        chrome.storage.sync.set({ [key]: a }, () => render(a));
      }));
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn snx'; del.title = '削除'; del.textContent = '✕';
      del.addEventListener('click', () => chrome.storage.sync.get({ [key]: [] }, (v) => { const a = v[key].slice(); a.splice(i, 1); chrome.storage.sync.set({ [key]: a }, () => render(a)); }));
      row.append(inp, del);
      el.appendChild(row);
    });
    requestAnimationFrame(() => limitRows(el, 6));
  };
  chrome.storage.sync.get({ [key]: [] }, (v) => render(v[key]));
  $('#' + prefix + 'Add').addEventListener('click', () => {
    const t = $('#' + prefix + 'Text').value.trim();
    if (!t) return;
    chrome.storage.sync.get({ [key]: [] }, (v) => {
      const a = v[key].concat([t]);
      if (JSON.stringify(a).length > 7000) { $('#' + prefix + 'Info').textContent = '保存容量の上限です。不要な項目を削除してください'; return; }
      chrome.storage.sync.set({ [key]: a }, () => { $('#' + prefix + 'Text').value = ''; $('#' + prefix + 'Info').textContent = ''; render(a); });
    });
  });
}
listEditor('snippets', 'sn');
listEditor('hlList', 'hl');
listEditor('muteRules', 'mt');
$('#reload').addEventListener('click', () => chrome.tabs.query({ active: true, currentWindow: true }, (t) => { if (t[0]) chrome.tabs.reload(t[0].id); }));
// 設定の初期化(2回押しで確定)。sync の設定だけを既定値に戻す。保存データ(local)は残す。
if ($('#resetSettings')) {
  let armed = false, timer = null;
  const btn = $('#resetSettings');
  btn.addEventListener('click', () => {
    if (!armed) { armed = true; btn.textContent = 'もう一度押すと初期化します'; btn.classList.add('on'); timer = setTimeout(() => { armed = false; btn.textContent = '設定をすべて初期化'; btn.classList.remove('on'); }, 4000); return; }
    clearTimeout(timer); armed = false;
    chrome.storage.sync.clear(() => chrome.storage.sync.set(DEFAULTS, () => { btn.textContent = '初期化しました'; btn.classList.remove('on'); setTimeout(() => location.reload(), 500); }));
  });
}
/* 背景色・背景画像・文字色・中央列の幅(背景・レイアウト)機能は削除しました。 */

/* 左サイドメニューの項目非表示は data-k チェックボックス(hideCall 等)で行う。
   以前の並べ替え(navCfg)機能は、Xの更新で安定して動作しないため廃止した。 */

/* ---- カテゴリー・サブカテゴリーの開閉状態を保持 ---- */
document.querySelectorAll('.grp').forEach((g) => {
  Array.from(g.children).filter((c) => c.classList.contains('sub')).forEach((sub) => {
    const det = document.createElement('details');
    det.className = 'subd'; det.open = true;
    const sum = document.createElement('summary');
    sum.className = 'sub'; sum.textContent = sub.textContent;
    det.appendChild(sum);
    const nodes = [];
    for (let n = sub.nextSibling; n && !(n.nodeType === 1 && n.classList.contains('sub')); n = n.nextSibling) nodes.push(n);
    sub.before(det);
    nodes.forEach((x) => det.appendChild(x));
    sub.remove();
  });
});
/* ---- カテゴリーをタブにして切り替える ---- */
let showTab = () => {};
(() => {
  const cats = Array.from(document.querySelectorAll('body > details'));
  if (!cats.length) return;
  const nav = document.createElement('nav');
  nav.className = 'tabs';
  const items = [];
  cats.forEach((d, i) => {
    const label = ((d.querySelector(':scope > summary') || {}).textContent || 'タブ' + (i + 1)).trim();
    const sec = document.createElement('section');
    sec.className = 'tabp';
    Array.from(d.children).forEach((c) => { if (c.tagName !== 'SUMMARY') sec.appendChild(c); });
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tabb'; b.textContent = label;
    b.addEventListener('click', () => showTab(i, true));
    nav.appendChild(b);
    d.before(sec);
    d.remove();
    items.push([b, sec]);
  });
  items[0][1].before(nav);
  showTab = (i, save) => {
    if (!items[i]) i = 0;
    items.forEach(([b, s], k) => { b.classList.toggle('on', k === i); s.classList.toggle('on', k === i); });
    if (save) chrome.storage.local.set({ uiTab: i });
    window.scrollTo(0, 0);
    setTimeout(limitAll, 0);
  };
  showTab(0, false);
})();
const detKey = (d) => {
  const parts = [];
  for (let e = d; e; e = e.parentElement) if (e.tagName === 'DETAILS') parts.unshift(((e.querySelector(':scope > summary') || {}).textContent || '').trim());
  return parts.join('/');
};
let uiReady = false;
document.body.style.visibility = 'hidden';
chrome.storage.local.get(['uiOpen', 'uiTab'], (v) => {
  const st = v.uiOpen || {};
  showTab(Number.isInteger(v.uiTab) ? v.uiTab : 0, false);
  document.querySelectorAll('details').forEach((d) => { const k = detKey(d); if (k in st) d.open = !!st[k]; });
  document.body.style.visibility = '';
  setTimeout(() => { uiReady = true; limitAll(); }, 80);
});
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d || d.tagName !== 'DETAILS' || !uiReady) return;
  if (d.open) setTimeout(limitAll, 0);
  chrome.storage.local.get('uiOpen', (v) => { const st = v.uiOpen || {}; st[detKey(d)] = d.open; chrome.storage.local.set({ uiOpen: st }); });
}, true);

/* ---- 外部AIのAPIキー(このブラウザのstorage.localにのみ保存。同期はしません) ---- */
chrome.storage.local.get('apiKeys', (v) => {
  const k = (v && v.apiKeys) || {};
  if ($('#keyGoogle')) $('#keyGoogle').value = k.google || '';
  if ($('#keyOpenAI')) $('#keyOpenAI').value = k.openai || '';
});
[['#keyGoogle', 'google'], ['#keyOpenAI', 'openai']].forEach(([sel, name]) => {
  const el = $(sel);
  if (!el) return;
  el.addEventListener('change', () => chrome.storage.local.get('apiKeys', (v) => {
    const k = Object.assign({}, v && v.apiKeys);
    if (el.value.trim()) k[name] = el.value.trim(); else delete k[name];
    chrome.storage.local.set({ apiKeys: k });
  }));
});

/* ---- センシティブの記録(ログイン中のアカウント) ----
   公開コード(safety-label-user-agg)の既定ルールに沿って表示する:
   ・ポストに NSFW_HIGH_PRECISION が新しく付いた時点で、最新5ポスト(リポスト含む)のうち60日以内の同ラベルが3件以上 → アカウントにラベル(7日で期限切れ)
   ・24時間・暦日でのリセットは公開コードに見当たらない */
const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const dhms = (ms) => { const d = Math.floor(Math.max(0, ms) / 864e5); return (d ? d + '日 ' : '') + hms(ms - d * 864e5); };
const snow = (id) => Number((BigInt(id) >> 22n) + 1288834974657n);
const KIND = { became: 'センシティブになった', first: 'すでにセンシティブ', cleared: '解除を検知', manual: '手動で追加' };
const D7 = 7 * 864e5, D1 = 864e5, YR = 400 * 864e5;
const dayStr = (ms) => { const d = new Date(ms); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
function pruneSens(log) { const cut = Date.now() - YR; return (log || []).filter((e) => e.t >= cut); } // 約1年ぶん保持
// センシティブ記録を「ポストの投稿日」ごとの件数にまとめる(解除されたものは除く)
function sensDaily(log) {
  const cleared = new Set((log || []).filter((e) => e.kind === 'cleared').map((e) => e.id));
  const byDay = {};
  (log || []).forEach((e) => {
    if (e.kind === 'cleared' || cleared.has(e.id)) return;
    const day = new Date(snow(e.id)); day.setHours(0, 0, 0, 0);
    (byDay[day.getTime()] = byDay[day.getTime()] || new Set()).add(e.id);
  });
  return Object.keys(byDay).map((k) => ({ t: +k, v: byDay[k].size })).sort((a, b) => a.t - b.t);
}
// ログイン中アカウントのスクリーンネーム。me.name が無いときは idMap(名前→ID)から逆引きする。
function meScreenName(me, idMap) {
  if (me && me.name) return me.name;
  if (me && me.id && idMap) { const id = String(me.id); const hit = Object.keys(idMap).find((n) => String(idMap[n]) === id); if (hit) return hit; }
  return '';
}
function renderSens() {
  const box = $('#sensBox'), list = $('#sensList');
  if (!box || !list) return;
  chrome.storage.local.get(['sensLog', 'me', 'ownRecent', 'idMap'], (v) => {
    const now = Date.now(), all = v.sensLog || [], kept = pruneSens(all);
    if (kept.length !== all.length) chrome.storage.local.set({ sensLog: kept });
    const clearedIds = new Set(kept.filter((e) => e.kind === 'cleared').map((e) => e.id));
    const entries = kept.filter((e) => e.kind !== 'cleared').slice().sort((a, b) => b.t - a.t);
    const r = v.ownRecent || {};
    const meName = meScreenName(v.me, v.idMap);
    const lines = [v.me && v.me.id ? `ログイン中: ${meName ? '@' + meName : 'ID ' + v.me.id}` : 'ログイン中のアカウント: 未取得(Xのタブを開いてください)'];
    if (r.n) lines.push(`最新5ポスト(リポスト含む)のうち警告付き: ${r.k}/${r.n}件 — 3件以上でアカウント判定の条件に該当`);
    lines.push('各記録に「投稿日時」「検知からの残り時間(1日)」「解除済み」を表示。右の✕で削除、下の欄で手動追加できます。時刻は拡張機能が検知した時刻で、Xがラベルを付けた正確な時刻ではありません。');
    box.textContent = lines.join('\n');
    const sig = entries.map((e) => e.id + e.t + (e.who || '') + (clearedIds.has(e.id) ? 'c' : '')).join(',');
    // アカウント(@ID)ごとにまとめる
    entries.sort((a, b) => { const wa = (a.who || '').toLowerCase(), wb = (b.who || '').toLowerCase(); return wa < wb ? -1 : wa > wb ? 1 : b.t - a.t; });
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.textContent = '';
      let curWho = null;
      entries.forEach((e) => {
        const who = e.who || '(不明)';
        if (who !== curWho) { curWho = who; const linkable = who && who !== '(不明)'; const h = document.createElement(linkable ? 'a' : 'div'); h.className = 'sensgroup'; if (linkable) { h.href = 'https://x.com/' + who; h.target = '_blank'; h.rel = 'noopener noreferrer'; } h.textContent = '@' + who; list.appendChild(h); }
        const row = document.createElement('div');
        row.className = 'sensrow';
        row.dataset.id = e.id; row.dataset.t = String(e.t);
        const t = document.createElement('span');
        t.className = 'senst';
        t.textContent = `投稿 ${new Date(snow(e.id)).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} / 検知 ${new Date(e.t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${e.k !== undefined && e.kind === 'became' ? ` (当時 ${e.k}/5件)` : ''}`;
        const a = document.createElement('a');
        a.href = 'https://x.com/i/status/' + e.id; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'https://x.com/i/status/' + e.id;
        const left = document.createElement('span');
        left.className = 'sensleft'; left.dataset.cleared = clearedIds.has(e.id) ? '1' : '';
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'btn snx'; del.textContent = '✕'; del.title = 'この記録を削除';
        del.addEventListener('click', () => chrome.storage.local.get('sensLog', (vv) => { const a2 = (vv.sensLog || []).filter((x) => !(x.id === e.id && x.t === e.t)); chrome.storage.local.set({ sensLog: a2 }, () => { list.dataset.sig = ''; renderSens(); }); }));
        row.append(t, a, left, del);
        list.appendChild(row);
      });
      requestAnimationFrame(() => limitRows(list, 8));
    }
    // 残り時間は毎回更新(作り直さずテキストだけ)
    list.querySelectorAll('.sensrow').forEach((row) => { const left = row.querySelector('.sensleft'); if (!left) return; if (left.dataset.cleared) { left.textContent = '解除済み'; return; } const et = +row.dataset.t, r1 = et + D1 - now; left.textContent = `解除まで ${r1 > 0 ? dhms(r1) : '経過'}`; });
  });
}
if ($('#sensReset')) $('#sensReset').addEventListener('click', () => chrome.storage.local.remove(['sensLog', 'ownSeen'], () => { $('#sensList').removeAttribute('data-sig'); renderSens(); }));
if ($('#sensAddBtn')) $('#sensAddBtn').addEventListener('click', () => {
  const m = (($('#sensNew').value) || '').match(/(\d{15,20})/);
  if (!m) { $('#sensNew').value = ''; return; }
  chrome.storage.local.get('sensLog', (v) => { const a = (v.sensLog || []).concat([{ id: m[1], t: Date.now(), kind: 'manual' }]); chrome.storage.local.set({ sensLog: a }, () => { $('#sensNew').value = ''; $('#sensList').dataset.sig = ''; renderSens(); }); });
});
renderSens();
setInterval(renderSens, 1000);

/* ---- シャドウバンの記録(7日・14日・1か月での解除を表示) ---- */
function shadowActiveList(log) {
  // name ごとに、未解除の最新 became/manual を1件返す(解除は 'cleared' イベントで判定)
  const byName = {};
  (log || []).forEach((e) => { (byName[e.name] = byName[e.name] || []).push(e); });
  const out = [];
  Object.keys(byName).forEach((name) => {
    const arr = byName[name];
    const becs = arr.filter((e) => e.kind === 'became' || e.kind === 'manual');
    if (!becs.length) return;
    const last = becs.reduce((a, b) => (b.t > a.t ? b : a));
    const cleared = arr.some((e) => e.kind === 'cleared' && e.t > last.t);
    out.push({ name, t: last.t, cleared });
  });
  return out.sort((a, b) => b.t - a.t);
}
function renderShadow() {
  const box = $('#shadowBox'), list = $('#shadowList');
  if (!box || !list) return;
  chrome.storage.local.get('shadowLog', (v) => {
    const now = Date.now(), all = Array.isArray(v.shadowLog) ? v.shadowLog : [];
    const kept = all.filter((e) => e.t >= now - YR);
    if (kept.length !== all.length) chrome.storage.local.set({ shadowLog: kept });
    const items = shadowActiveList(kept);
    box.textContent = items.length ? `記録 ${items.length} 件` : '記録なし';
    const sig = items.map((e) => e.name + e.t + (e.cleared ? 'c' : '')).join(',');
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.textContent = '';
      items.forEach((e) => {
        const row = document.createElement('div');
        row.className = 'sensrow'; row.dataset.name = e.name; row.dataset.t = String(e.t); row.dataset.cleared = e.cleared ? '1' : '';
        const head = document.createElement('a'); head.className = 'sensgroup'; head.style.flexBasis = '100%'; head.href = 'https://x.com/' + e.name; head.target = '_blank'; head.rel = 'noopener noreferrer'; head.textContent = '@' + e.name;
        const t = document.createElement('span'); t.className = 'senst';
        t.textContent = `検知 ${new Date(e.t).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
        const left = document.createElement('span'); left.className = 'sensleft';
        const del = document.createElement('button'); del.type = 'button'; del.className = 'btn snx'; del.textContent = '✕'; del.title = 'この記録を削除';
        del.addEventListener('click', () => chrome.storage.local.get('shadowLog', (vv) => { const a2 = (vv.shadowLog || []).filter((x) => x.name !== e.name); chrome.storage.local.set({ shadowLog: a2 }, () => { list.dataset.sig = ''; renderShadow(); }); }));
        row.append(head, t, left, del);
        list.appendChild(row);
      });
    }
    list.querySelectorAll('.sensrow').forEach((row) => {
      const left = row.querySelector('.sensleft'); if (!left) return;
      // 解除された(cleared)場合は、カウントダウンはすべて出さず「解除済み」のみ
      if (row.dataset.cleared) { left.textContent = '解除済み'; return; }
      const et = +row.dataset.t, elapsed = now - et;
      // 7日・14日・1か月での解除をそれぞれ表示。過ぎた期間は非表示。
      const THRESH = [[D7, '7日'], [2 * D7, '14日'], [30 * D1, '1か月']];
      const remaining = THRESH.filter(([ms]) => elapsed < ms);
      if (!remaining.length) { left.textContent = '1か月以上シャドウバンされています'; return; }
      left.textContent = remaining.map(([ms, label]) => `${label}で解除まで あと${dhms(ms - elapsed)}`).join(' / ');
    });
  });
}
if ($('#shadowAddBtn')) $('#shadowAddBtn').addEventListener('click', () => {
  const m = (($('#shadowNew').value) || '').match(/@?([A-Za-z0-9_]{1,15})/);
  if (!m) { $('#shadowNew').value = ''; return; }
  const name = m[1].toLowerCase();
  chrome.storage.local.get('shadowLog', (v) => { const a = (Array.isArray(v.shadowLog) ? v.shadowLog : []).filter((x) => x.name !== name).concat([{ name, t: Date.now(), kind: 'manual' }]); chrome.storage.local.set({ shadowLog: a }, () => { $('#shadowNew').value = ''; $('#shadowList').dataset.sig = ''; renderShadow(); }); });
});
if ($('#shadowNew')) $('#shadowNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#shadowAddBtn').click(); });
if ($('#shadowReset')) $('#shadowReset').addEventListener('click', () => chrome.storage.local.remove('shadowLog', () => { $('#shadowList').removeAttribute('data-sig'); renderShadow(); }));
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.shadowLog) renderShadow(); });
renderShadow();
setInterval(renderShadow, 1000);

/* ---- 統計・情報: ER/フォロワー/センシティブ件数の推移(棒/折れ線/数字・期間切替・ホバー数値) ---- */
const PERIOD_DAYS = { '3d': 3, '7d': 7, '28d': 28, '6m': 182, '1y': 365 };
function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
// 日付ごとに集計(各日の最後の値を代表にする)。時系列の点を日単位にまとめる。
function aggDaily(pts) {
  const by = new Map();
  pts.slice().sort((a, b) => a.t - b.t).forEach((p) => { const d = new Date(p.t); const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime(); by.set(key, { t: mid, v: p.v }); });
  return Array.from(by.values()).sort((a, b) => a.t - b.t);
}
// 時間ごとに集計(各時間の最後の値を代表にする)
function aggHourly(pts) {
  const by = new Map();
  pts.slice().sort((a, b) => a.t - b.t).forEach((p) => { const d = new Date(p.t); const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`; const mid = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 30).getTime(); by.set(key, { t: mid, v: p.v }); });
  return Array.from(by.values()).sort((a, b) => a.t - b.t);
}
function drawChart(pts, mode, unit, color) {
  const box = $('#statChart');
  if (!box) return;
  color = color || '#1d9bf0';
  if (!pts || !pts.length) { box.innerHTML = '<div class="statempty">この期間の記録がありません</div>'; return; }
  const fv = (v) => (unit === '%' ? v.toFixed(2) + '%' : fmtNum(v));
  const last = pts[pts.length - 1], first = pts[0], delta = last.v - first.v;
  const head = `<div class="stathead">最新: <b>${fv(last.v)}</b>　増減: <b>${delta >= 0 ? '+' : ''}${unit === '%' ? delta.toFixed(2) : fmtNum(delta)}</b>　記録: ${pts.length}</div>`;
  if (mode === 'num') {
    box.innerHTML = head + '<div class="statnums">' + pts.slice().reverse().map((p) => `<div class="statrow"><span>${new Date(p.t).toLocaleString('ja-JP', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><b>${fv(p.v)}</b></div>`).join('') + '</div>';
    return;
  }
  const W = 408, H = 150, pad = 6, vals = pts.map((p) => p.v), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), span = mx - mn || 1;
  const x = (i) => pad + (pts.length === 1 ? (W - 2 * pad) / 2 : (i / (pts.length - 1)) * (W - 2 * pad));
  const y = (v) => H - pad - ((v - mn) / span) * (H - 2 * pad);
  const tip = (p) => `${dayStr(p.t)}: ${fv(p.v)}`;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="statsvg" preserveAspectRatio="none">`;
  if (mode === 'bar') {
    const bw = Math.max(2, (W - 2 * pad) / pts.length * 0.7);
    pts.forEach((p, i) => { const yy = y(p.v); svg += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad - yy).toFixed(1)}" fill="${color}"><title>${tip(p)}</title></rect>`; });
  } else {
    svg += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;
    // 見える丸(大きめ)+ ホバー用の透明な大きい円で、カーソルを合わせやすくする
    pts.forEach((p, i) => { const cx = x(i).toFixed(1), cy = y(p.v).toFixed(1); svg += `<circle cx="${cx}" cy="${cy}" r="5" fill="${color}"/><circle cx="${cx}" cy="${cy}" r="11" fill="transparent" style="cursor:pointer"><title>${tip(p)}</title></circle>`; });
  }
  svg += '</svg>';
  box.innerHTML = head + svg + `<div class="stataxis"><span>${dayStr(first.t)}</span><span>${dayStr(last.t)}</span></div>`;
}
function renderStats() {
  chrome.storage.local.get(['folHist', 'erHist', 'sensLog'], (v) => {
    const fol = v.folHist || {}, er = v.erHist || {}, sel = $('#statAcct');
    if (!sel) return;
    // 自分/他の人の区別はなし。手動で追加したアカウントを一覧にするだけ。
    const names = Array.from(new Set(Object.keys(fol).concat(Object.keys(er)))).sort();
    const sig = names.join(',');
    if (sel.dataset.sig !== sig) {
      const prev = sel.value;
      sel.dataset.sig = sig;
      sel.innerHTML = names.length ? names.map((n) => `<option value="${n}">@${n}</option>`).join('') : '<option value="">(アカウント未登録)</option>';
      const def = (prev && names.indexOf(prev) >= 0) ? prev : (names[0] || '');
      if (def) sel.value = def;
    }
    const name = sel.value;
    chrome.storage.sync.get({ chartMode: 'line', chartMetric: 'er', chartPeriod: '28d', chartAgg: 'hour' }, (s) => {
      let pts = [], unit = '';
      if (s.chartMetric === 'er') { pts = (er[name] || []).map((p) => ({ t: p.t, v: p.er })); unit = '%'; }
      else if (s.chartMetric === 'sens') pts = sensDaily(v.sensLog || []); // センシティブ件数はログイン中のアカウントのログ
      else pts = (fol[name] || []).map((p) => ({ t: p.t, v: s.chartMetric === 'fo' ? p.fo : p.fr })).filter((p) => p.v != null);
      const cut = Date.now() - (PERIOD_DAYS[s.chartPeriod] || 28) * 864e5;
      pts = pts.filter((p) => p.t >= cut);
      // センシ件数はもともと日別。それ以外は「時間ごと」「日付ごと」で集計する
      if (s.chartMetric !== 'sens') pts = (s.chartAgg === 'day') ? aggDaily(pts) : aggHourly(pts);
      drawChart(pts, s.chartMode, unit, '#1d9bf0');
    });
  });
}
if ($('#statAcct')) $('#statAcct').addEventListener('change', renderStats);
// statList を既存の記録から補完(未設定の既存ユーザー向け)
function statListOf(v) { return Array.isArray(v.statList) ? v.statList.slice() : Array.from(new Set(Object.keys(v.folHist || {}).concat(Object.keys(v.erHist || {})))); }
if ($('#statDel')) $('#statDel').addEventListener('click', () => { const sel = $('#statAcct'); const n = sel.value || (sel.options.length === 1 ? sel.options[0].value : ''); if (!n) return; chrome.storage.local.get(['folHist', 'erHist', 'statList'], (v) => { const fo = v.folHist || {}, er = v.erHist || {}; delete fo[n]; delete er[n]; const list = statListOf(v).filter((x) => x !== n); chrome.storage.local.set({ folHist: fo, erHist: er, statList: list }, () => { sel.removeAttribute('data-sig'); renderStats(); }); }); });
if ($('#statAdd')) $('#statAdd').addEventListener('click', () => { const m = (($('#statNew').value) || '').match(/@?([A-Za-z0-9_]{1,15})/); if (!m) { $('#statNew').value = ''; return; } const n = m[1].toLowerCase(); chrome.storage.local.get(['folHist', 'statList'], (v) => { const fo = v.folHist || {}; if (!fo[n]) fo[n] = []; const list = statListOf(v); if (list.indexOf(n) < 0) list.push(n); chrome.storage.local.set({ folHist: fo, statList: list }, () => { $('#statNew').value = ''; $('#statAcct').removeAttribute('data-sig'); renderStats(); }); }); });
renderStats();
setInterval(renderStats, 1500);

/* ---- データのバックアップ(エクスポート/インポート) ---- */
if ($('#expBtn')) $('#expBtn').addEventListener('click', () => {
  chrome.storage.sync.get(null, (sync) => chrome.storage.local.get(null, (local) => {
    const data = { _app: 'x-customize-utility', _ver: 1, _at: new Date().toISOString(), sync, local };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'x-customize-utility-backup.json'; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
    if ($('#backupInfo')) $('#backupInfo').textContent = '書き出しました';
  }));
});
if ($('#impFile')) $('#impFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || (d._app !== 'x-customize-utility' && d._app !== 'x-assist-toolkit') || typeof d.sync !== 'object') throw new Error('このツールのバックアップではありません');
      chrome.storage.sync.set(d.sync, () => chrome.storage.local.set(d.local || {}, () => { if ($('#backupInfo')) $('#backupInfo').textContent = '読み込みました。Xのタブを再読み込みすると反映されます。'; e.target.value = ''; }));
    } catch (err) { if ($('#backupInfo')) $('#backupInfo').textContent = '読み込みに失敗: ' + err.message; }
  };
  r.readAsText(f);
});
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.folHist || ch.erHist || ch.sensLog || ch.statList)) renderStats(); if (area === 'sync' && (ch.chartMode || ch.chartMetric || ch.chartPeriod || ch.chartAgg)) renderStats(); });

/* ---- スクリーンネーム ↔ ID 変換 ---- */
// 変換結果を表示し、結果の値(@名前 または ID)をコピーできるボタンを付ける
function renderIdConv(text, copyVal) {
  const out = $('#idConvOut');
  if (!out) return;
  out.textContent = text || '';
  if (!copyVal) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn'; b.textContent = 'コピー'; b.style.marginLeft = '6px'; b.style.padding = '1px 8px';
  b.onclick = () => {
    const done = () => { b.textContent = 'コピー済'; setTimeout(() => { b.textContent = 'コピー'; }, 1200); };
    try { navigator.clipboard.writeText(copyVal).then(done, done); } catch (e) { done(); }
  };
  out.appendChild(document.createTextNode(' '));
  out.appendChild(b);
}
if ($('#idConvBtn')) $('#idConvBtn').addEventListener('click', () => {
  const raw = (($('#idConvIn').value) || '').trim();
  if (!raw) { renderIdConv('', null); return; }
  chrome.storage.local.get('idMap', (v) => {
    const map = v.idMap || {}, rev = {};
    Object.keys(map).forEach((n) => { rev[String(map[n])] = n; });
    if (/^\d{5,}$/.test(raw)) { const n = rev[raw]; if (n) renderIdConv(`ID ${raw} → @${n}`, '@' + n); else renderIdConv(`ID ${raw}: 未取得(そのプロフィールを一度開くと取得できます)`, null); }
    else { const h = raw.replace(/^@/, ''), n = h.toLowerCase(), id = map[n]; if (id) renderIdConv(`@${h} → ID ${id}`, String(id)); else renderIdConv(`@${h}: 未取得(そのプロフィールを一度開くと取得できます)`, null); }
  });
});
if ($('#idConvIn')) $('#idConvIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#idConvBtn').click(); });

/* ---- お気に入り(☆) ---- */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function renderFavs() {
  const box = $('#favList'); if (!box) return;
  chrome.storage.local.get(['favs', 'idMap'], (v) => {
    const favs = Array.isArray(v.favs) ? v.favs : [], idMap = v.idMap || {};
    if (!favs.length) { box.innerHTML = '<div class="statempty">お気に入りはまだありません。@スクリーンネームを追加してください。</div>'; return; }
    box.innerHTML = '';
    const move = (i, dir) => { chrome.storage.local.get('favs', (w) => { const list = Array.isArray(w.favs) ? w.favs : []; const j = i + dir; if (j < 0 || j >= list.length) return; const t = list[i]; list[i] = list[j]; list[j] = t; chrome.storage.local.set({ favs: list }, renderFavs); }); };
    favs.forEach((f, i) => {
      const name = f.name || '';
      const row = document.createElement('div'); row.className = 'favrow';
      const open = () => { const url = 'https://x.com/' + name; try { chrome.tabs.create({ url }); } catch (e) { window.open(url, '_blank', 'noopener'); } };
      const mv = document.createElement('div'); mv.className = 'favmv';
      const up = document.createElement('button'); up.type = 'button'; up.className = 'btn'; up.textContent = '↑'; up.title = '上へ'; up.disabled = i === 0; up.onclick = () => move(i, -1);
      const dn = document.createElement('button'); dn.type = 'button'; dn.className = 'btn'; dn.textContent = '↓'; dn.title = '下へ'; dn.disabled = i === favs.length - 1; dn.onclick = () => move(i, 1);
      mv.append(up, dn);
      const av = document.createElement('div'); av.className = 'favav'; av.title = 'プロフィールを開く'; av.style.cursor = 'pointer'; av.onclick = open;
      if (f.avatar) { const img = document.createElement('img'); img.src = f.avatar; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.onerror = () => { av.textContent = '👤'; }; av.appendChild(img); } else av.textContent = '👤';
      const info = document.createElement('div'); info.className = 'favinfo'; info.title = 'プロフィールを開く'; info.style.cursor = 'pointer'; info.onclick = open;
      info.innerHTML = `<div class="favdn">${f.dname ? esc(f.dname) : '<span style=\"opacity:.6\">(名前未取得)</span>'}</div><div class="favid">@${esc(name)}</div>`;
      const mk = document.createElement('button'); mk.type = 'button'; mk.className = 'btn'; mk.textContent = f.mark === 'heart' ? '❤️' : '★';
      mk.title = 'マークを ★ / ❤️ で切り替え';
      mk.onclick = () => { chrome.storage.local.get('favs', (w) => { const list = Array.isArray(w.favs) ? w.favs : []; const it = list.find((x) => (x.name || '').toLowerCase() === name.toLowerCase()); if (it) { it.mark = it.mark === 'heart' ? 'star' : 'heart'; chrome.storage.local.set({ favs: list }, renderFavs); } }); };
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn favx'; del.textContent = '✕'; del.title = 'お気に入りから削除';
      del.onclick = () => { chrome.storage.local.get('favs', (w) => { const list = (Array.isArray(w.favs) ? w.favs : []).filter((x) => (x.name || '').toLowerCase() !== name.toLowerCase()); chrome.storage.local.set({ favs: list }, renderFavs); }); };
      row.append(mv, av, info, mk, del); box.appendChild(row);
    });
  });
}
if ($('#favAdd')) $('#favAdd').addEventListener('click', () => {
  const m = (($('#favNew').value) || '').match(/@?([A-Za-z0-9_]{1,15})/);
  if (!m) { $('#favNew').value = ''; return; }
  const name = m[1].toLowerCase();
  chrome.storage.local.get('favs', (v) => {
    const list = Array.isArray(v.favs) ? v.favs : [];
    if (!list.some((x) => (x.name || '').toLowerCase() === name)) list.push({ name });
    chrome.storage.local.set({ favs: list }, () => { $('#favNew').value = ''; renderFavs(); });
  });
});
if ($('#favNew')) $('#favNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#favAdd').click(); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.favs || ch.idMap)) renderFavs(); });
renderFavs();

/* ---- 追加項目(もっと見る/左メニュー)の並び替え・自作 ---- */
const EXTRA_BUILTIN = [
  ['lists', '📋', 'リスト', 'extraLists'],
  ['mute', '🔇', 'ミュートするキーワード', 'muteKeyword'],
  ['adv', '🔎', '高度な検索', 'advSearch'],
  ['disp', '🖥', '表示', 'moreDisplay'],
  ['uth', '🛠', 'Under the Hood', 'uthShow'],
];
function renderExtra() {
  const box = $('#extraMgr'); if (!box) return;
  chrome.storage.sync.get({ extraCustom: [], extraOrder: [], extraPlaceMap: {}, extraLists: true, uthShow: true, muteKeyword: true, advSearch: true, moreDisplay: true }, (v) => {
    const custom = Array.isArray(v.extraCustom) ? v.extraCustom : [];
    const placeMap = (v.extraPlaceMap && typeof v.extraPlaceMap === 'object') ? v.extraPlaceMap : {};
    const bkeys = EXTRA_BUILTIN.map((b) => b[0]);
    const ckeys = custom.map((c) => 'c:' + c.id);
    let order = (Array.isArray(v.extraOrder) ? v.extraOrder : []).filter((k) => bkeys.includes(k) || ckeys.includes(k));
    [...bkeys, ...ckeys].forEach((k) => { if (order.indexOf(k) < 0) order.push(k); });
    const meta = (k) => { if (k.indexOf('c:') === 0) { const c = custom.find((x) => 'c:' + x.id === k); return c ? ['🔗', c.name] : null; } const b = EXTRA_BUILTIN.find((x) => x[0] === k); return b ? [b[1], b[2]] : null; };
    const flagOf = (k) => { const b = EXTRA_BUILTIN.find((x) => x[0] === k); return b ? b[3] : null; };
    const shown = (k) => { if (k.indexOf('c:') === 0) { const c = custom.find((x) => 'c:' + x.id === k); return !!(c && c.show !== false); } const f = flagOf(k); if (!f) return true; return !!v[f]; };
    const placeOf = (k) => placeMap[k] === 'left' ? 'left' : 'more';
    const save = (o) => chrome.storage.sync.set(o, renderExtra);
    const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= order.length) return; const t = order[i]; order[i] = order[j]; order[j] = t; save({ extraOrder: order }); };
    const setShow = (k, on) => { if (k.indexOf('c:') === 0) { const cust = custom.map((c) => ('c:' + c.id === k ? Object.assign({}, c, { show: on }) : c)); save({ extraCustom: cust }); } else { const f = flagOf(k); if (f) save({ [f]: on }); } };
    const setPlace = (k, pl) => { const m = Object.assign({}, placeMap); m[k] = pl; save({ extraPlaceMap: m }); };
    box.innerHTML = '';
    order.forEach((k, i) => {
      const m = meta(k); if (!m) return;
      const row = document.createElement('div'); row.className = 'favrow xrow';
      const mv = document.createElement('div'); mv.className = 'favmv';
      const up = document.createElement('button'); up.type = 'button'; up.className = 'btn'; up.textContent = '↑'; up.disabled = i === 0; up.onclick = () => move(i, -1);
      const dn = document.createElement('button'); dn.type = 'button'; dn.className = 'btn'; dn.textContent = '↓'; dn.disabled = i === order.length - 1; dn.onclick = () => move(i, 1);
      mv.append(up, dn);
      const info = document.createElement('div'); info.className = 'favinfo'; info.innerHTML = `<div class="favdn">${m[0]} ${esc(m[1])}</div>`;
      const show = document.createElement('label'); show.className = 'xchk'; show.title = '表示';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = shown(k); cb.onchange = () => setShow(k, cb.checked);
      show.append(cb, document.createTextNode('表示'));
      const seg = document.createElement('div'); seg.className = 'seg xseg';
      const bMore = document.createElement('button'); bMore.type = 'button'; bMore.textContent = 'もっと見る'; bMore.className = placeOf(k) === 'more' ? 'on' : ''; bMore.onclick = () => setPlace(k, 'more');
      const bLeft = document.createElement('button'); bLeft.type = 'button'; bLeft.textContent = '左'; bLeft.className = placeOf(k) === 'left' ? 'on' : ''; bLeft.onclick = () => setPlace(k, 'left');
      seg.append(bMore, bLeft);
      const ctr = document.createElement('div'); ctr.className = 'xctrls'; ctr.append(show, seg);
      if (k.indexOf('c:') === 0) { const del = document.createElement('button'); del.type = 'button'; del.className = 'btn favx'; del.textContent = '✕'; del.title = '削除'; del.onclick = () => { const cust = custom.filter((c) => 'c:' + c.id !== k); const ord = order.filter((x) => x !== k); save({ extraCustom: cust, extraOrder: ord }); }; ctr.append(del); }
      row.append(mv, info, ctr);
      box.appendChild(row);
    });
  });
}
if ($('#extraAdd')) $('#extraAdd').addEventListener('click', () => {
  const name = (($('#extraName').value) || '').trim();
  let url = (($('#extraUrl').value) || '').trim();
  if (!name || !url || /^\s*javascript:/i.test(url)) return;
  if (!/^https?:\/\//i.test(url) && url[0] !== '/') url = '/' + url;
  chrome.storage.sync.get({ extraCustom: [], extraOrder: [] }, (v) => {
    const cust = Array.isArray(v.extraCustom) ? v.extraCustom : [];
    const id = 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    cust.push({ id, name, url, show: true });
    const ord = (Array.isArray(v.extraOrder) ? v.extraOrder : []).slice(); ord.push('c:' + id);
    chrome.storage.sync.set({ extraCustom: cust, extraOrder: ord }, () => { $('#extraName').value = ''; $('#extraUrl').value = ''; renderExtra(); });
  });
});
if ($('#extraUrl')) $('#extraUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#extraAdd').click(); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && (ch.extraCustom || ch.extraOrder || ch.extraPlaceMap || ch.extraLists || ch.uthShow || ch.muteKeyword || ch.advSearch || ch.moreDisplay)) renderExtra(); });
renderExtra();

/* ---- 削除ロックの一覧・管理 ---- */
function renderLocks() {
  const box = $('#lockList'); if (!box) return;
  chrome.storage.local.get('delLock', (v) => {
    const map = (v && v.delLock && typeof v.delLock === 'object') ? v.delLock : {};
    const ids = Object.keys(map);
    if (!ids.length) { box.innerHTML = '<div class="statempty">ロック中のポストはありません。</div>'; return; }
    box.innerHTML = '';
    ids.sort((a, b) => ((map[b] && map[b].t) || 0) - ((map[a] && map[a].t) || 0)).forEach((id) => {
      const it = map[id] || { id };
      const url = it.url || ('/i/status/' + id);
      const full = /^https?:/i.test(url) ? url : ('https://x.com' + url);
      const row = document.createElement('div'); row.className = 'favrow';
      const info = document.createElement('div'); info.className = 'favinfo'; info.style.cursor = 'pointer'; info.title = 'ポストを開く';
      info.onclick = () => { try { chrome.tabs.create({ url: full }); } catch (e) { window.open(full, '_blank', 'noopener'); } };
      info.innerHTML = `<div class="favdn">${it.author ? '@' + esc(it.author) : 'ID ' + esc(id)}</div><div class="favid">${it.text ? esc(it.text) : esc(url)}</div>`;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn favx'; del.textContent = '✕'; del.title = 'ロック解除';
      del.onclick = () => chrome.storage.local.get('delLock', (w) => { const mm = (w && w.delLock && typeof w.delLock === 'object') ? w.delLock : {}; delete mm[id]; chrome.storage.local.set({ delLock: mm }, renderLocks); });
      row.append(info, del); box.appendChild(row);
    });
  });
}
if ($('#lockAdd')) $('#lockAdd').addEventListener('click', () => {
  const raw = (($('#lockNew').value) || '').trim();
  const m = raw.match(/status\/(\d+)/) || raw.match(/^(\d{5,25})$/);
  if (!m) { $('#lockNew').value = ''; return; }
  const id = m[1];
  const um = raw.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\//);
  const author = um ? um[1] : '';
  chrome.storage.local.get('delLock', (v) => {
    const map = (v && v.delLock && typeof v.delLock === 'object') ? v.delLock : {};
    map[id] = { id, author, url: author ? ('/' + author + '/status/' + id) : ('/i/status/' + id), t: Date.now() };
    chrome.storage.local.set({ delLock: map }, () => { $('#lockNew').value = ''; renderLocks(); });
  });
});
if ($('#lockNew')) $('#lockNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#lockAdd').click(); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.delLock) renderLocks(); });
renderLocks();

/* ---- 簡易下書き(ローカル保存) ---- */
let dfEditId = null;
function dfSetEditing(on) { const c = $('#dfCancel'), a = $('#dfAdd'); if (c) c.style.display = on ? '' : 'none'; if (a) a.textContent = on ? '更新' : '保存'; }
function renderDrafts() {
  const list = $('#dfList'); if (!list) return;
  chrome.storage.local.get('drafts', (v) => {
    const ds = (Array.isArray(v.drafts) ? v.drafts : []).slice().reverse();
    list.textContent = '';
    if (!ds.length) { const e = document.createElement('div'); e.className = 'statempty'; e.textContent = '下書きはまだありません。'; list.appendChild(e); return; }
    ds.forEach((d) => {
      const row = document.createElement('div'); row.className = 'snr';
      const span = document.createElement('span'); span.textContent = d.text;
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'btn snx'; edit.textContent = '✏'; edit.title = '編集'; edit.style.opacity = '1';
      edit.onclick = () => { const t = $('#dfText'); if (t) { t.value = d.text; t.focus(); } dfEditId = d.id; dfSetEditing(true); };
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn snx'; del.textContent = '✕'; del.title = '削除';
      del.onclick = () => chrome.storage.local.get('drafts', (w) => { const a = (Array.isArray(w.drafts) ? w.drafts : []).filter((x) => x.id !== d.id); chrome.storage.local.set({ drafts: a }, () => { if (dfEditId === d.id) { dfEditId = null; dfSetEditing(false); } renderDrafts(); }); });
      row.append(span, edit, del); list.appendChild(row);
    });
  });
}
if ($('#dfAdd')) $('#dfAdd').addEventListener('click', () => {
  const t = $('#dfText'), text = (t && t.value || '').trim(); if (!text) return;
  chrome.storage.local.get('drafts', (v) => {
    let ds = Array.isArray(v.drafts) ? v.drafts : [];
    if (dfEditId) { ds = ds.map((x) => x.id === dfEditId ? Object.assign({}, x, { text, t: Date.now() }) : x); dfEditId = null; dfSetEditing(false); }
    else { ds = ds.concat([{ id: 'd' + Date.now() + Math.random().toString(36).slice(2, 6), text, t: Date.now() }]); if (ds.length > 200) ds = ds.slice(-200); }
    chrome.storage.local.set({ drafts: ds }, () => { if (t) t.value = ''; renderDrafts(); });
  });
});
if ($('#dfCancel')) $('#dfCancel').addEventListener('click', () => { dfEditId = null; const t = $('#dfText'); if (t) t.value = ''; dfSetEditing(false); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.drafts) renderDrafts(); });
renderDrafts();
