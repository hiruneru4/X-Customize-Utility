(() => {
  'use strict';
  const XDT = window.XDT;
  if (!XDT || XDT.isHelper) return;
  const { S, users, usersById, tweets, results, stats, sleep } = XDT;

  /* ============================ ユーティリティ ============================ */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const meta = new WeakMap(), touched = new Set();
  const origOf = (n) => { const m = meta.get(n); return m && m.applied !== null && n.data === m.applied ? m.orig : n.data; };
  function setNode(n, text) {
    let m = meta.get(n);
    if (!m) { m = { orig: n.data, applied: null }; meta.set(n, m); } else if (m.applied !== null && n.data !== m.applied) m.orig = n.data;
    if (n.data !== text) n.data = text;
    m.applied = text; touched.add(n);
  }
  function restoreText() {
    for (const n of touched) { const m = meta.get(n); if (m && n.data === m.applied) n.data = m.orig; meta.delete(n); }
    touched.clear();
  }
  function textNodes(el) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), r = [];
    let n;
    while ((n = w.nextNode())) r.push(n);
    return r;
  }
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const TOKEN = /(\d[\d,]*(?:\.\d+)?)(?:\s*(万|億|千|[KMB])(?![A-Za-z]))?/;
  const MULT = { '万': 1e4, '億': 1e8, '千': 1e3, K: 1e3, M: 1e6, B: 1e9 };
  function applyNumber(el, cands) {
    for (const n of textNodes(el)) {
      const base = origOf(n), m = base.match(TOKEN);
      if (!m) continue;
      const unit = m[2], shown = parseFloat(m[1].replace(/,/g, '')) * (unit ? MULT[unit] : 1);
      let val;
      if (!unit) val = shown;
      else { val = cands.find((c) => Math.abs(c - shown) <= Math.max(shown * 0.1, 50)); if (val === undefined) continue; }
      const out = base.replace(TOKEN, fmt(val));
      if (out === base && !meta.has(n)) return;
      setNode(n, out);
      return;
    }
  }
  function parseAria(s) {
    const out = {};
    if (!s) return out;
    const g = (re) => { const m = s.match(re); return m ? Number(m[1].replace(/,/g, '')) : undefined; };
    out.reply = g(/([\d,]+)\s*(?:件の返信|repl)/i); out.repost = g(/([\d,]+)\s*(?:件のリポスト|reposts?|retweets?)/i);
    out.like = g(/([\d,]+)\s*(?:件のいいね|likes?)/i); out.bookmark = g(/([\d,]+)\s*(?:件のブックマーク|bookmarks?)/i);
    out.view = g(/([\d,]+)\s*(?:件の表示|views?)/i);
    return out;
  }
  const getGroup = (a) => { const rb = a.querySelector('[data-testid="reply"]'); return rb && rb.closest('[role="group"]'); };
  function articleInfo(a) {
    const t = a.querySelector('a[href*="/status/"] time');
    let link = t && t.closest('a');
    if (!link) link = Array.from(a.querySelectorAll('a[href*="/status/"]')).find((x) => /\/status\/\d+/.test(x.getAttribute('href')));
    if (!link) return null;
    const m = (link.getAttribute('href') || '').match(/^\/([^/]+)\/status\/(\d+)/);
    return m ? { author: m[1], id: m[2] } : null;
  }
  const profileSegs = ['with_replies', 'replies', 'highlights', 'media', 'articles', 'likes', 'superfollows', 'reposts'];
  const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose', 'login', 'signup', 'tos', 'privacy', 'about', 'jobs', 'hashtag', 'intent', 'share', 'lists', 'bookmarks', 'communities', 'premium', 'verified', 'account', 'download', 'logout']);
  // プロフィールのタブ(ポスト/返信/メディア/すべて 等)は種類が多いので、プロフィールではないページだけを除外する
  const NON_PROFILE_SEGS = new Set(['status', 'followers', 'following', 'verified_followers', 'followers_you_follow', 'lists', 'communities', 'topics', 'photo', 'header_photo', 'moments', 'connect_people']);
  let profLostAt = 0;
  function profileName() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (!parts.length || parts.length > 2 || RESERVED.has(parts[0].toLowerCase())) return null;
    if (parts[1] && NON_PROFILE_SEGS.has(parts[1].toLowerCase())) return null;
    const un = document.querySelector('[data-testid="primaryColumn"] [data-testid="UserName"]');
    if (!un) return null;
    const hs = Array.from((un.textContent || '').matchAll(/@([A-Za-z0-9_]{1,15})/g)).map((m) => m[1]);
    return hs.find((h) => h.toLowerCase() === parts[0].toLowerCase()) || null;
  }

  /* ============================ チップ ============================ */
  // cls: 固定幅スロット(表示位置を固定してレイアウトのずれを防ぐ)
  function chip(cls, label, state, value, title, act, data, extra) {
    const inner = (label ? `<span class="xdt-l">${esc(label)}</span>` : '') + `<span class="xdt-v">${esc(value)}</span>` + (extra || '');
    const c = `xdt-chip ${cls} xdt-${state}`;
    if (act) {
      const attrs = Object.keys(data || {}).map((k) => ` data-${k}="${esc(data[k])}"`).join('');
      return `<button type="button" class="${c} xdt-act" data-act="${act}"${attrs} title="${esc(title || '')}">${inner}</button>`;
    }
    return `<span class="${c}" title="${esc(title || '')}">${inner}</span>`;
  }
  const bad = (st) => st === 'bad' || st === 'warn';
  const SENS_JA = { adult_content: '成人向け', graphic_violence: '暴力的', other: 'その他' };

  function tweetSens(rec) {
    if (!rec) return ['unk', '不明', 'データ未取得(タイムライン読込後に判定されます)'];
    const r = [];
    if (rec.sens.flag) r.push(rec.sens.editable === false ? 'ポストにセンシティブ判定(変更不可): 検索から非表示+年齢制限' : 'ポストにセンシティブ判定: 「センシティブな内容を表示しない」設定の人の検索に出ない');
    if (rec.sens.ageGate) r.push('年齢制限(メディアに警告オーバーレイ)');
    if (rec.sens.media && rec.sens.media.length) r.push('メディア警告: ' + rec.sens.media.map((k) => SENS_JA[k] || k).join('/'));
    if (rec.sens.interstitial) r.push('表示制限: ' + rec.sens.interstitial);
    if (rec.sens.limited) r.push('制限アクション: ' + rec.sens.limited);
    if (r.length) return ['bad', 'あり', r.join(' / ')];
    const af = XDT.accountFlags(usersById.get(rec.authorId));
    if (af.length) return ['warn', '投稿者', '投稿自体のフラグはありませんが、' + af.join(' / ')];
    return ['ok', 'なし', 'センシティブフラグ・警告なし'];
  }
  function resChip(cls, label, r, infer, act, data, title0) {
    if (r && r.running) return ['unk', '…', '確認中'];
    if (r && r.state) return [r.state, r.value, r.detail + (act ? '\n(クリックで再確認)' : '')];
    if (infer) return infer;
    return ['unk', '確認', title0 || 'クリックで確認します'];
  }
  // おすすめ配信の判定を強化: 取得元の種類(injectionType)・ソーシャル文脈・HomeTimeline/おすすめ検索の各シグナルから推定
  const RECO_INJ = /Rank|Recommend|ForYou|Discover|WhoToFollow|Nux|Suggest|Trends|CommunityToJoin|Organic/i;
  function tweetReco(rec, ctx) {
    if (!rec) return ['unk', '不明', 'データ未取得'];
    const u = usersById.get(rec.authorId), fol = u && u.following === true, mine = rec.authorId === XDT.myId();
    const m = rec.meta || {}, inj = m.injectionType || '', soc = m.socialText || m.socialType || '';
    const det = m.op ? `取得元: ${m.op}${inj ? ' / ' + inj : ''}${soc ? ' / ' + soc : ''}` : '';
    if (mine) return ['unk', '自分', '自分のポストです'];
    const onHome = ctx.home === 'foryou' || rec.seen.indexOf('HomeTimeline') !== -1;
    const onExploreOrSearch = rec.seen.indexOf('SearchTimeline') !== -1 || rec.seen.some((op) => /Explore|Recommend|Discover/i.test(op));
    // 明確に「おすすめ(アルゴリズム配信)」といえるシグナル
    const recoInjected = RECO_INJ.test(inj);
    const socialReason = /おすすめ|興味|話題|フォロー中.*さん|likes|リポスト|いいね|さんがフォロー|さんがいいね|Recommended|Popular|trending/i.test(soc);
    if (ctx.home === 'following' && !recoInjected) return ['unk', '対象外', 'フォロー中タブの表示です'];
    if (recoInjected || (onHome && !fol) || (onExploreOrSearch && !fol)) {
      return ['info', 'あり', 'おすすめ(アルゴリズム配信)に表示されています' + (recoInjected ? `(種類: ${inj})` : '') + (socialReason ? ' / 理由: ' + soc : '') + '。' + det];
    }
    if (onHome && fol) return ['unk', 'フォロー中', 'おすすめタブに出たフォロー中アカウントのポスト。' + det];
    const why = [];
    if (rec.sens.flag || rec.sens.ageGate || (rec.sens.media || []).length) why.push('ポストのセンシティブ判定');
    why.push.apply(why, XDT.accountFlags(u));
    if (why.length) return ['bad', '出にくい', 'おすすめ/検索に出にくい要因: ' + why.join(' / ') + '(フォロワー以外へのおすすめから除外される場合があります)'];
    return ['unk', 'なし', 'おすすめ配信は確認されていません(ホームの「おすすめ」や検索を読み込むと更新されます)。' + det];
  }
  function relOfUser(u) {
    if (!u || (u.id && u.id === XDT.myId())) return null;
    if (u.blocking === true) return ['bad', '🚫ブロック', 'あなたがブロックしています'];
    if (u.blockedBy === true) return ['bad', '⛔被ブロック', '相手にブロックされています'];
    if (u.muting === true) return ['warn', '🔇ミュート', 'ミュート中'];
    if (u.following === true) return u.followedBy === true ? ['ok', '🤝相互', '相互フォロー'] : u.followedBy === false ? ['info', '片思い', 'あなたがフォローしていますが、フォローされていません'] : ['info', 'フォロー中', 'あなたがフォローしています'];
    if (u.followedBy === true) return ['info', '片思われ', '相手があなたをフォローしています(あなたはフォローしていません)'];
    if (u.following === false) return ['unk', '未フォロー', 'フォロー関係なし'];
    return null;
  }
  function relation(rec) { return relOfUser(usersById.get(rec.authorId)); }
  // ユーザー一覧・ホバーカードなどポスト以外でも、@スクリーンネームの隣に関係を表示
  function relFromDom(row) {
    const d = {};
    if (row.querySelector('[data-testid$="-unblock"]')) d.blocking = true;
    else if (row.querySelector('[data-testid$="-unfollow"]')) d.following = true;
    else if (row.querySelector('[data-testid$="-follow"]')) d.following = false;
    if (d.following !== undefined) d.followedBy = !!row.querySelector('[data-testid="userFollowIndicator"]');
    return d;
  }
  function processRelEverywhere() {
    // アカウント切り替えのメニューなどには付けない(過去に付いたものも外す)
    document.querySelectorAll('[role="menu"] .xdt-relb,[data-testid="Dropdown"] .xdt-relb').forEach((n) => n.remove());
    document.querySelectorAll('[data-testid="UserCell"],[data-testid="HoverCard"]').forEach((row) => {
      let sp = row.querySelector('.xdt-relb');
      const isHover = row.matches('[data-testid="HoverCard"]');
      if (!isHover) {
        const layer = row.closest('#layers > *');
        if (row.closest('[role="menu"],[data-testid="Dropdown"],[data-testid="HoverCard"]') || (layer && /ログアウト|Log out|既存のアカウントを追加|Add an existing account/i.test(layer.textContent || ''))) { if (sp) sp.remove(); return; }
      }
      const tn = textNodes(row).find((n) => /^@[A-Za-z0-9_]{1,15}$/.test(n.data.trim()) && !(n.parentElement && n.parentElement.closest('.xdt-relb')));
      const h = tn && tn.data.trim().slice(1);
      const base = h ? users.get(h.toLowerCase()) : null;
      // APIのデータを優先し、足りない項目はカード内のボタン表示から補う
      const dom = relFromDom(row), u = h ? Object.assign({ id: base && base.id }, dom, base && { following: base.following !== undefined ? base.following : dom.following, followedBy: base.followedBy !== undefined ? base.followedBy : dom.followedBy, blocking: base.blocking !== undefined ? base.blocking : dom.blocking, blockedBy: base.blockedBy, muting: base.muting }) : null;
      const rl = S.relationChip && u ? relOfUser(u) : null;
      if (isHover) {
        const unf = row.querySelector('[data-testid$="-unfollow"]');
        if (unf) unf.classList.toggle('xdt-gone', !!(S.hideUnfollowMutual && u && u.following === true && u.followedBy === true));
      }
      if (!rl) { if (sp) sp.remove(); return; }
      if (!sp) sp = document.createElement('span');
      sp.className = 'xdt-relb xdt-' + rl[0];
      if (sp.textContent !== rl[1]) sp.textContent = rl[1];
      sp.title = rl[2];
      if (isHover) {
        // アイコンとフォローボタンの間(横並びのとき)、そうでなければフォローボタンの下に置く。フォロー数の行には入れない
        const av = row.querySelector('[data-testid^="UserAvatar-Container"]');
        const fb = row.querySelector('[data-testid$="-follow"],[data-testid$="-unfollow"],[data-testid$="-unblock"],[data-testid="editProfileButton"]');
        if (av && fb) {
          const lca = lcaOf(av, fb);
          if (lca) {
            let au = av;
            while (au.parentElement && au.parentElement !== lca) au = au.parentElement;
            const cs = getComputedStyle(lca);
            if (au.parentElement === lca && cs.display.indexOf('flex') !== -1 && cs.flexDirection.indexOf('row') === 0) {
              sp.classList.add('xdt-relb-mid');
              if (sp.previousSibling !== au) au.after(sp);
              return;
            }
          }
          let fu = fb;
          while (fu.parentElement && fu.parentElement !== row && fu.parentElement.children.length === 1) fu = fu.parentElement;
          sp.classList.add('xdt-relb-under');
          if (sp.previousSibling !== fu) fu.after(sp);
          return;
        }
        if (sp.parentElement) sp.remove();
        return;
      }
      if (tn && sp.parentElement !== tn.parentElement) tn.parentElement.appendChild(sp);
    });
  }
  function erInfo(rec) {
    const c = rec && rec.counts;
    if (!c || !c.view) return null;
    const rates = { like: c.like || 0, repost: c.repost || 0, quote: c.quote || 0, reply: c.reply || 0, bookmark: c.bookmark || 0 };
    const pos = Object.keys(rates).reduce((s, k) => s + rates[k], 0);
    return { er: (pos / c.view) * 100, rates, view: c.view };
  }
  function mediaItems(rec, a, author, id) {
    const items = [];
    let i = 0;
    if (rec && rec.media && rec.media.length) {
      for (const m of rec.media) {
        i++;
        if (m.type === 'photo') {
          const mm = (m.url || '').match(/^(https:\/\/pbs\.twimg\.com\/media\/[^.?]+)\.(\w+)/);
          if (mm) items.push({ url: `${mm[1]}?format=${mm[2]}&name=orig`, filename: `X/${author}/${id}_${i}.${mm[2]}` });
        } else {
          const vs = (m.variants || []).filter((v) => /mp4/.test(v.t || '')).sort((x, y) => (y.b || 0) - (x.b || 0));
          if (vs[0]) items.push({ url: vs[0].u, filename: `X/${author}/${id}_${i}${m.type === 'animated_gif' ? '_gif' : ''}.mp4` });
        }
      }
    } else if (a) {
      a.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((img) => {
        i++;
        const s = img.src || '';
        if (!/pbs\.twimg\.com\/media\//.test(s)) return;
        const ext = (s.match(/format=(\w+)/) || [])[1] || 'jpg';
        items.push({ url: s.replace(/name=\w+/, 'name=orig'), filename: `X/${author}/${id}_${i}.${ext}` });
      });
    }
    return items;
  }
  function doDownload(id, author, article) {
    const items = mediaItems(tweets.get(id), article, author, id);
    if (!items.length) results.set('m:' + id, { v: '✖' });
    else { chrome.runtime.sendMessage({ type: 'download', items }); results.set('m:' + id, { v: '✔' }); }
    XDT.schedule();
    setTimeout(() => { results.delete('m:' + id); XDT.schedule(); }, 2000);
  }

  /* ============================ ポスト下の表示 ============================ */
  const disp = (st, v) => (st === 'ok' ? '正常' : st === 'bad' ? '疑い' : v);
  // シャドウバン判定(総合): アカウントのフラグ + 検索Ban + サジェストバン
  function shadowOverall(u, ps, pg) {
    if (!u || !u.id) return ['unk', '不明', 'アカウントデータ未取得(読み込み後に判定されます)'];
    const flags = XDT.accountFlags(u), sBad = ps && ps.state === 'bad', gBad = pg && pg.state === 'bad', sOk = ps && ps.state === 'ok';
    const note = '\n※公開コード(Under the Hood ラベル)に基づく推定で、100%正確ではありません。';
    if (sBad && gBad) return ['bad', '疑い', '検索Ban・サジェストバンの両方に該当' + (flags.length ? ' / ' + flags.join(' / ') : '') + note];
    if (sBad) return ['bad', '疑い', 'From検索に出ません(検索Ban)' + (flags.length ? ' / ' + flags.join(' / ') : '') + note];
    if (flags.length) return [sOk ? 'warn' : 'bad', sOk ? '注意' : '疑い', flags.join(' / ') + (sOk ? '\n(From検索には出ています)' : '') + note];
    if (gBad) return ['warn', '注意', '検索候補(サジェスト)に出ません(サジェストバン)' + note];
    return ['ok', 'なし', 'ラベル・フラグ・検索Banは検出されていません' + (sOk ? '' : '(検索系は未確認)') + note];
  }
  // ポスト単位の From検索 結果: 個別の確認結果 → 投稿者の from:検索結果(最新20件)に含まれるか、の順
  function tweetFromState(rec, info, ps, tr) {
    if (tr && tr.state) return tr;
    if (ps && ps.ids && ps.ids.length && !(rec && rec.rt)) {
      let min = BigInt(ps.ids[0]);
      for (const x of ps.ids) if (BigInt(x) < min) min = BigInt(x);
      if (BigInt(info.id) >= min) {
        if (ps.ids.indexOf(info.id) !== -1) return { state: 'ok', value: '正常', detail: 'from:検索の結果にこのポストが含まれています' };
        if (Date.now() - XDT.snowTime(info.id) > 10 * 60e3) return { state: 'warn', value: '要確認', detail: 'このポストだけ from:検索の最新結果に出ていません(検索から除外されている可能性。クリックで再確認)' };
      }
    }
    return null;
  }
  // 自分との関係: タイムラインでは名前の隣の「時間/日付」の右、ポスト詳細では名前(認証マークがあればその右)
  function processRelInline(a, rec, info) {
    let span = a.querySelector('.xdt-relb');
    const rl = S.relationChip && rec ? relation(rec) : null;
    if (!rl) { if (span) span.remove(); return; }
    const un = a.querySelector('[data-testid="User-Name"]');
    if (!un) return;
    const detail = new RegExp('/status/' + info.id + '(/|$)').test(location.pathname);
    if (!span) { span = document.createElement('span'); span.textContent = ''; }
    span.className = 'xdt-relb xdt-' + rl[0];
    if (span.textContent !== rl[1]) span.textContent = rl[1];
    span.title = rl[2] || '';
    let after = null, host = null;
    if (detail) { after = un.querySelector('[data-testid="icon-verified"]'); host = un.querySelector('div[dir="ltr"],div[dir="auto"]') || un; }
    else { const t = un.querySelector('time'); after = t && t.closest('a'); }
    if (after) { if (after.nextSibling !== span) after.after(span); }
    else if (host && span.parentElement !== host) host.appendChild(span);
  }
  function renderTweetBadges(a, info, rec, ctx) {
    let box = a.querySelector('.xdt-tbadges');
    const op = S.onlyProblem;
    const row1On = S.tweetSensitive || S.tweetShadow || S.tweetSearchBan;
    const row2On = S.tweetRecommend || S.erPlace === 'below' || S.reactPlace === 'below' || S.dlPlace === 'below' || S.notInterested;
    const group = getGroup(a);
    if (!group || !group.parentElement) return; // 再描画の途中は触らない(表示を消さない)
    if (!(row1On || row2On)) { if (box) box.remove(); return; }
    const mine = !!(rec && rec.authorId && rec.authorId === XDT.myId());
    const au = info.author.toLowerCase();
    const u = (rec && usersById.get(rec.authorId)) || users.get(au);
    const ps = results.get('ps:' + au), pg = results.get('pg:' + au), tr = results.get('t:' + info.id);
    const r1 = [], r2 = [];
    // 1行目: センシティブ / シャドウバン / サジェストバン / From検索
    if (S.tweetSensitive) { const [st, v, t] = tweetSens(rec); if (!op || bad(st)) r1.push(chip('xdt-w1', 'センシティブ', st, v, t)); }
    if (S.tweetShadow) { const [st, v, t] = shadowOverall(u, ps, pg); if (!op || bad(st)) r1.push(chip('xdt-w2', 'シャドウバン', st, v, t)); if (XDT.recordShadow && u && u.name && (st === 'bad' || st === 'ok')) XDT.recordShadow(u.name, st === 'bad'); }
    if (S.tweetSearchBan) {
      const fs = tweetFromState(rec, info, ps, tr);
      const [st, v, t] = resChip('', '', fs || tr, ps && ps.state && ps.state !== 'unk' ? [ps.state, ps.value, 'アカウント全体: ' + ps.detail] : null, 1, null, 'クリックでこのポストの検索結果ページを開きます');
      if ((st === 'ok' || st === 'bad' || st === 'warn') && (!op || bad(st))) r1.push(chip('xdt-w4', 'ポストの検索', st, disp(st, v), t, 'tsb', { id: info.id, author: info.author }));
    }
    // 2行目: おすすめ / ER / 反応 / 保存 / 関係
    if (S.tweetRecommend) { const [st, v, t] = tweetReco(rec, ctx); r2.push(chip('xdt-w5', 'おすすめ', st, v, t)); }
    if (S.erPlace === 'below') {
      const e = erInfo(rec);
      r2.push(e ? chip('xdt-w6', 'ER', e.er >= 3 ? 'ok' : e.er >= 1 ? 'info' : 'unk', e.er.toFixed(2) + '%', 'クリックで詳細グラフを表示', 'er', { id: info.id }) : chip('xdt-w6', 'ER', 'unk', '—', 'インプレッションが取得できないため算出できません'));
    }
    if (S.reactPlace === 'below') r2.push(chip('xdt-w7', '', 'info', '💬 反応', 'ポストへの反応(リポスト・引用・いいね)', 'react', { id: info.id, author: info.author, mine: mine ? '1' : '0' }));
    if (S.dlPlace === 'below') {
      const n = mediaItems(rec, a, info.author, info.id).length, m = results.get('m:' + info.id);
      if (n || a.querySelector('[data-testid="videoPlayer"]')) r2.push(chip('xdt-w8', '', 'info', m ? m.v : '📥 保存', `メディアを保存する (${n || '?'}件)`, 'mdl', { id: info.id, author: info.author }));
    }
    if (S.notInterested && !mine && a.querySelector('[data-testid="caret"]')) r2.push(chip('xdt-w9 xdt-ni', '', 'unk', '🚫 興味なし', 'このポストをX公式メニューの「興味がない」で非表示にします(おすすめの学習に反映されます)', 'notint', { id: info.id }));
    const html = (r1.length ? `<div class="xdt-row">${r1.join('')}</div>` : '') + (r2.length ? `<div class="xdt-row">${r2.join('')}</div>` : '');
    if (!html) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.className = 'xdt-tbadges'; group.parentElement.insertBefore(box, group); }
    box.style.height = op ? '' : ((row1On ? 1 : 0) + (row2On ? 1 : 0)) * 24 + 'px';
    if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
  }

  /* ---- アクションバーへの追加: ブックマーク数 / 興味なし ---- */
  function processActionExtras(a, rec, info) {
    a.querySelectorAll('.xdt-bm').forEach((n) => n.remove()); // 旧版の残り(.xdt-ni は現行の興味なしチップで使用)
    const group = getGroup(a);
    const bk = group && group.querySelector('[data-testid="bookmark"],[data-testid="removeBookmark"]');
    const cnt = (rec && rec.counts && rec.counts.bookmark) || (group && parseAria(group.getAttribute('aria-label') || '').bookmark) || 0;
    const isDetail = !!(info && new RegExp('/status/' + info.id + '(/|$)').test(location.pathname));
    let bn = a.querySelector('.xdt-bmn');
    if (!bk || !(S.bookmarkCount && cnt > 0 && !isDetail)) { if (bn) bn.remove(); return; }
    const host = bk.firstElementChild || bk;
    if (!bn) { bn = document.createElement('span'); bn.className = 'xdt-bmn'; bn.style.marginLeft = '4px'; }
    // 公式のカウント(返信・いいね等)の書体に合わせ、色はブックマークボタン自身の色(押下で青)に追従
    const ref = group.querySelector('[data-testid="like"] [data-testid="app-text-transition-container"],[data-testid="unlike"] [data-testid="app-text-transition-container"]') || group.querySelector('[data-testid="app-text-transition-container"]');
    const rtn = ref && textNodes(ref).find((n) => n.data.trim());
    const cs = ref ? getComputedStyle((rtn && rtn.parentElement) || ref) : null, bcs = getComputedStyle(bk);
    const cref = group.querySelector('[data-testid="reply"] [data-testid="app-text-transition-container"],[data-testid="retweet"] [data-testid="app-text-transition-container"],[data-testid="unretweet"] [data-testid="app-text-transition-container"]');
    const ctn = cref && textNodes(cref).find((n) => n.data.trim()), ccol = cref ? getComputedStyle((ctn && ctn.parentElement) || cref).color : bcs.color;
    const st = (cs ? cs.fontSize + cs.fontFamily + cs.lineHeight + cs.fontWeight : '') + '|' + ccol;
    if (bn.dataset.st !== st) {
      bn.dataset.st = st;
      bn.style.fontSize = cs ? cs.fontSize : '13px'; bn.style.fontFamily = cs ? cs.fontFamily : 'inherit';
      bn.style.lineHeight = cs ? cs.lineHeight : '16px'; bn.style.fontWeight = cs ? cs.fontWeight : '400';
      bn.style.color = ccol;
      delete bn.dataset.gap;
    }
    const txt = fmt(cnt);
    if (bn.textContent !== txt) bn.textContent = txt;
    if (bn.parentElement !== host) host.appendChild(bn);
    // アイコンから数字までの距離を、公式のいいね数と同じにそろえる
    if (!bn.dataset.gap) {
      const like = group.querySelector('[data-testid="like"],[data-testid="unlike"]');
      const lsvg = like && like.querySelector('svg'), lcnt = like && like.querySelector('[data-testid="app-text-transition-container"]'), bsvg = bk.querySelector('svg');
      if (lsvg && lcnt && bsvg) {
        const want = lcnt.getBoundingClientRect().left - lsvg.getBoundingClientRect().right;
        bn.style.marginLeft = '0px';
        const m = want - (bn.getBoundingClientRect().left - bsvg.getBoundingClientRect().right);
        if (isFinite(m) && Math.abs(m) < 40) { bn.style.marginLeft = m + 'px'; bn.dataset.gap = '1'; } else bn.style.marginLeft = '4px';
      }
    }
  }

  /* ---- ポストごとの装飾 ---- */
  const LOCK_ICON = '[data-testid="icon-lock"]';
  function processDecor(a, rec, info) {
    // いいね/リポストの強調 (リポスト優先)
    const rtOn = !!a.querySelector('[data-testid="unretweet"]'), lkOn = !!a.querySelector('[data-testid="unlike"]');
    const m = S.markEngaged ? (rtOn && lkOn ? 'both' : rtOn ? 'rt' : lkOn ? 'like' : '') : '';
    if ((a.dataset.xdtMark || '') !== m) { if (m) a.dataset.xdtMark = m; else delete a.dataset.xdtMark; }
    // 鍵垢(非公開アカウント)のポストをぼかす(カーソルで解除)。鍵マーク or protected で判定
    const au = rec && usersById.get(rec.authorId);
    const locked = (au && au.protected === true) || !!a.querySelector('[data-testid="UserName"] ' + LOCK_ICON + ', [data-testid="User-Name"] ' + LOCK_ICON);
    a.classList.toggle('xdt-pblur', !!(S.blurLocked && locked));
    // ぼかし解除(ぼかしだけを外す)
    const ov = Array.from(a.querySelectorAll('[role="button"],button')).filter((b) => /^(表示|表示する|もっと見る|View|Show|Show more)$/i.test((b.textContent || '').trim()));
    if (S.unblur) {
      const cands = new Set();
      a.querySelectorAll('img,video,[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="videoComponent"],[data-testid="previewInterstitial"],[style*="blur"],[style*="background-image"]').forEach((el) => {
        let e = el;
        for (let i = 0; i < 8 && e && e !== a; i++) { cands.add(e); e = e.parentElement; }
      });
      // 取りこぼし対策: 候補の中にぼかしが残っていれば、描画が変わっていなくても全要素を走査し直す
      // (Xが画像のあとから警告の覆いを足したり、再描画でこちらの解除が消えたりするため)
      let stillBlur = false;
      for (const el of cands) { if (el.style.filter === 'none') continue; const cs = getComputedStyle(el); if (((cs.filter || '') + (cs.backdropFilter || '')).indexOf('blur') !== -1) { stillBlur = true; break; } }
      const msig = a.querySelectorAll('img,video').length + '|' + (a.querySelector('[data-testid="previewInterstitial"]') || ov.length ? 1 : 0);
      if (a.dataset.xdtUbs !== msig || stillBlur) { a.dataset.xdtUbs = msig; a.querySelectorAll('div,img,video,span').forEach((el) => cands.add(el)); }
      cands.forEach((el) => {
        if (el.style.filter === 'none') return;
        const cs = getComputedStyle(el);
        if (((cs.filter || '') + (cs.backdropFilter || '')).indexOf('blur') !== -1) {
          el.style.setProperty('filter', 'none', 'important');
          el.style.setProperty('backdrop-filter', 'none', 'important');
          el.dataset.xdtUnb = '1';
        }
      });
    }
    if (ov.length) a.dataset.xdtSens = '1';
    if (S.revealLabel && ov.length && !a.dataset.xdtRev) { a.dataset.xdtRev = '1'; ov.forEach((b) => b.click()); } // 初回のみ(その後は任意で隠せる)
    // 高度なミュート(Xの標準より細かい条件: 語句 / /正規表現/ / @ユーザー / #タグ)
    if (S.muteRules && S.muteRules.length) {
      const txt = ((rec && rec.fullText) || (a.querySelector('[data-testid="tweetText"]') || {}).textContent || '') + ' ' + (info.author || '');
      const unit = a.closest('[data-testid="cellInnerDiv"]') || a;
      unit.classList.toggle('xdt-hide', muteMatch(txt, info.author));
    }
    // 文字のみのポストを非表示(画像・動画のみ)。ポスト詳細(/status/)と通知(/notifications)では隠さない。
    {
      const unit2 = a.closest('[data-testid="cellInnerDiv"]') || a;
      let fhide = false;
      const onStatus = /\/status\/\d+/.test(location.pathname);
      const onNotif = /^\/notifications(\/|$)/.test(location.pathname);
      if (S.mediaOnly && !onStatus && !onNotif) {
        const media = Array.from(a.querySelectorAll('[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="videoComponent"]')).filter((p) => !p.closest('[data-testid="quoteTweet"]'));
        if (!media.length) fhide = true;
      }
      unit2.classList.toggle('xdt-fhide', fhide);
    }
    // 編集履歴(編集回数)
    let em = a.querySelector('.xdt-edit');
    const edited = S.showEdited && rec && rec.edit && rec.edit.ids && rec.edit.ids.length > 1;
    if (edited) {
      const tl = a.querySelector('a[href*="/status/"] time'), host = tl && tl.closest('a');
      if (host) {
        if (!em) { em = document.createElement('span'); em.className = 'xdt-edit'; }
        const n = rec.edit.ids.length - 1, lt = new Date(XDT.snowTime(rec.edit.ids[rec.edit.ids.length - 1]));
        const txt = `✎${n}`, title = `編集 ${n}回 / 最終 ${lt.toLocaleString('ja-JP')}`;
        if (em.textContent !== txt) em.textContent = txt;
        if (em.title !== title) em.title = title;
        if (host.nextSibling !== em) host.after(em);
      } else if (em) em.remove();
    } else if (em) em.remove();
    // アカウントの場所(ポスト詳細)
    const detail = new RegExp('/status/' + info.id + '(/|$)').test(location.pathname);
    let loc = a.querySelector('.xdt-loc');
    if (S.showLocation && detail) {
      const u = users.get(info.author.toLowerCase());
      if (u && u.basedIn) {
        const host = a.querySelector('a[href$="/analytics"]');
        const h = ` · ${u.basedIn}`;
        if (host) {
          if (!loc) { loc = document.createElement('span'); loc.className = 'xdt-loc'; }
          if (loc.textContent !== h) loc.textContent = h;
          if (host.nextSibling !== loc) host.after(loc);
        }
      } else XDT.ensureAbout(info.author);
    } else if (loc) loc.remove();
  }

  /* ---- アカウント切り替え: アクティブでないアカウントをぼかす(カーソルを合わせると解除) ---- */
  let blurMe = null, layersMo = null, layersEl = null;
  function processBlurInactive() {
    // 名前に「@」が含まれることがあるため、スクリーンネームは「最後の@xx」を使う
    const lastHandle = (t) => { const a = String(t || '').match(/@[A-Za-z0-9_]{1,15}/g); return a ? a[a.length - 1].slice(1) : undefined; };
    const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    const m = btn && lastHandle(btn.textContent);
    if (m) blurMe = m; // 一時的にボタンが取れなくても、直前のアカウントを使い続ける
    const self = usersById.get(XDT.myId()); // ボタンが無い画面幅などでは、ログイン中のユーザーのデータから知る
    if (!blurMe && self && self.name) blurMe = self.name;
    const rows = Array.from(document.querySelectorAll('#layers [data-testid="UserCell"],#layers [role="menuitem"]'));
    if (!blurMe) {
      for (const r of rows) { const lo = (r.textContent || '').match(/@([A-Za-z0-9_]{1,15})\s*(?:からログアウト|をログアウト)|Log out\s*@([A-Za-z0-9_]{1,15})/i); if (lo) { blurMe = lo[1] || lo[2]; break; } }
    }
    const me = blurMe && blurMe.toLowerCase();
    // 他人のプロフィール(ホバーカード等)の目印: フォロー系ボタン・フォロー数のリンク
    const PROFILE = '[data-testid$="-follow"],[data-testid$="-unfollow"],[data-testid$="-unblock"],[data-testid="editProfileButton"],a[href$="/following"],a[href$="/followers"],a[href$="/verified_followers"]';
    const hasProfileSigns = (r) => { let e = r; for (let i = 0; i < 8 && e && e.id !== 'layers'; i++, e = e.parentElement) if (e.querySelector(PROFILE)) return true; return false; };
    // 「相手のユーザーに対する操作」の行(@xx さんをフォロー/ブロック/ミュート 等)
    const VERB = /@[A-Za-z0-9_]{1,15}\s*(?:さん)?を|@[A-Za-z0-9_]{1,15}\s*(?:さん)?の|(?:Follow|Unfollow|Block|Unblock|Mute|Unmute|Report)\s+@/i;
    const LOGOUT = /ログアウト|Log out|既存のアカウントを追加|Add an existing account/i;
    let n = 0, ex = 0;
    rows.forEach((r) => {
      const L = r.closest('#layers > *') || r, h = lastHandle(r.textContent);
      // アカウント切り替え(ログアウト等がある層)は常に対象。それ以外は、プロフィールの目印やフォロー等の操作行を除外
      const excluded = !LOGOUT.test(L.textContent || '') && (hasProfileSigns(r) || VERB.test(r.textContent || ''));
      const on = !!(S.blurInactive && me && h && !excluded && h.toLowerCase() !== me);
      if (excluded) ex++;
      if (on) n++;
      if (r.classList.contains('xdt-blur') !== on) r.classList.toggle('xdt-blur', on);
    });
    stats.blurInfo = `行 ${rows.length} / ぼかし ${n} / 除外 ${ex} / 自分 ${blurMe || '不明'}`;
  }
  // Xがメニューの行を書き換えてクラスが外れたときも、待たずにその場で付け直す
  let sqLast = 0;
  function processSquareAvatars() {
    if (!S.avatarSquare) return;
    const nowT = Date.now();
    if (nowT - sqLast < 500) return;
    sqLast = nowT;
    // 円形に見える要素か: 大きな角丸(半径が幅の35%以上)またはクリップ/マスクで切り抜かれている
    const isRound = (e, w) => {
      const cs = getComputedStyle(e), br = cs.borderTopLeftRadius || '', v = parseFloat(br);
      if (v) return br.indexOf('%') !== -1 ? v >= 35 : v >= w * 0.35;
      return (cs.clipPath && cs.clipPath !== 'none') || (cs.maskImage && cs.maskImage !== 'none');
    };
    const mark = (el, certain) => {
      const sig = el.currentSrc || el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('style') || 'x';
      if (el.dataset.xdtSqd === sig) {
        const nChain = +el.dataset.xdtSqn || 0;
        if (!nChain) return; // 対象外と判定済み
        let okAll = true, q = el;
        for (let i = 0; i < nChain && q; i++, q = q.parentElement) if (!q.classList.contains('xdt-sq')) { okAll = false; break; }
        if (okAll) return; // Xの再描画でクラスが外れていたら、下で付け直す
      }
      const r = el.getBoundingClientRect();
      if (r.width < 18 || r.width > 420 || Math.abs(r.width - r.height) > 0.12 * r.width) return; // 正方形に近いものだけ
      el.dataset.xdtSqd = sig;
      const tol = Math.max(6, r.width * 0.2), chain = [];
      let e = el;
      for (let i = 0; i < 5 && e && e.id !== 'layers' && e.tagName !== 'ARTICLE' && e.tagName !== 'BODY' && e.tagName !== 'MAIN'; i++, e = e.parentElement) {
        const b = e === el ? r : e.getBoundingClientRect();
        if (Math.abs(b.width - r.width) > tol || Math.abs(b.height - r.height) > tol) break;
        chain.push(e);
      }
      const doIt = certain || chain.some((x) => isRound(x, r.width));
      el.dataset.xdtSqn = doIt ? chain.length : 0;
      if (doIt) chain.forEach((x) => x.classList.add('xdt-sq'));
    };
    document.querySelectorAll('img,image').forEach((el) => mark(el, /profile_images/.test(el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || '')));
    document.querySelectorAll('[style*="profile_images"]').forEach((el) => mark(el, true));
    // DM: 背景画像で描かれたアイコンも対象
    document.querySelectorAll('[data-testid="conversation"] div,[data-testid="DMDrawer"] div,[data-testid="DmActivityContainer"] div').forEach((el) => {
      if (el.dataset.xdtSqd || el.children.length > 2) return;
      const r = el.getBoundingClientRect();
      if (r.width < 18 || r.width > 140) return;
      if ((getComputedStyle(el).backgroundImage || '').indexOf('profile_images') !== -1) mark(el, true);
    });
  }
  function watchLayers() {
    const el = document.getElementById('layers');
    if (!el || el === layersEl) return;
    layersEl = el;
    if (layersMo) layersMo.disconnect();
    layersMo = new MutationObserver(() => { if (S.blurInactive) processBlurInactive(); });
    layersMo.observe(el, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
  }

  /* ---- 鍵垢マーカー(ポスト・プロフィール・アカウント切替などすべて) ---- */
  // 名前の文字を持つ末端の要素にマーカーを付ける(URL・ハッシュタグと同じ見え方)
  function markNameLeafs(root) {
    if (!root) return;
    const leaves = Array.from(root.querySelectorAll('span,div')).filter((e) => e.children.length === 0 && (e.textContent || '').trim() && !/^@/.test((e.textContent || '').trim()) && !e.closest('svg,[data-testid^="UserAvatar"]'));
    (leaves.length ? leaves : [root]).forEach((e) => { if (!e.classList.contains('xdt-lock')) e.classList.add('xdt-lock'); });
  }
  function processLocks() {
    if (!S.lockMark) return;
    const mark = (lk) => {
      let e = lk && lk.parentElement;
      for (let i = 0; i < 4 && e; i++) {
        const t = (e.textContent || '').trim();
        if (t) { if (t.length < 80 && !e.querySelector('[data-testid^="UserAvatar"]')) markNameLeafs(e); break; }
        e = e.parentElement;
      }
    };
    document.querySelectorAll('[data-testid="icon-lock"],svg[aria-label*="非公開"],svg[aria-label*="Protected" i],svg[aria-label*="鍵"]').forEach(mark);
    document.querySelectorAll('svg path[d^="M17.5 7H17v-.25"]').forEach((p) => mark(p.closest('svg')));
  }
  function processLockData(a, rec) {
    if (!S.lockMark || !rec) return;
    const u = usersById.get(rec.authorId);
    if (!u || u.protected !== true) return;
    const un = a.querySelector('[data-testid="User-Name"]'), h = un && un.querySelector('div[dir="ltr"],div[dir="auto"]');
    markNameLeafs(h);
  }

  /* ============================ 追加機能 ============================ */
  function processStyleVars() {
    const root = document.documentElement, ds = root.dataset, st = root.style;
    ds.xdtUrlMark = S.urlMark ? '1' : '0'; ds.xdtUrlLine = S.urlLine ? '1' : '0';
    ds.xdtHashMark = S.hashMark ? '1' : '0'; ds.xdtHashLine = S.hashLine ? '1' : '0';
    st.setProperty('--xdt-blurpx', (S.blurPx || 6) + 'px');
    st.setProperty('--xdt-url', S.urlColor || '#1d9bf0'); st.setProperty('--xdt-urlline', S.urlLineColor || '#1d9bf0');
    st.setProperty('--xdt-hash', S.hashColor || '#00ba7c'); st.setProperty('--xdt-hashline', S.hashLineColor || '#00ba7c');
    // 外観(背景・文字色・レイアウト)
    const img = S.bgImageOn && XDT.bgImage;
    const panel = S.bgColorOn || !!img;
    ds.xdtBgcolor = S.bgColorOn ? '1' : '0';
    ds.xdtBgimg = img ? '1' : '0';
    ds.xdtBgpanel = panel ? '1' : '0';
    ds.xdtTxtcolor = S.textColorOn ? '1' : '0';
    ds.xdtWide = S.wideColumn ? '1' : '0';
    st.setProperty('--xdt-bgc', S.bgColor || '#000000');
    st.setProperty('--xdt-txt', S.textColor || '#e7e9ea');
    st.setProperty('--xdt-bgop', (S.bgOpacity == null ? 85 : S.bgOpacity) / 100);
    st.setProperty('--xdt-colorstr', (S.bgColorOn ? (S.colorStrength == null ? 70 : S.colorStrength) : 0) + '%'); // 色の濃さ(色OFFなら0=中立のすりガラス)
    st.setProperty('--xdt-bgblur', (S.bgBlur == null ? 8 : S.bgBlur) + 'px');
    st.setProperty('--xdt-wide', (S.widePx || 1000) + 'px');
    st.setProperty('--xdt-panelbase', S.theme === 'dark' ? '#000000' : '#ffffff');
    if (img) st.setProperty('--xdt-bgimg', 'url("' + XDT.bgImage + '")'); else st.removeProperty('--xdt-bgimg');
    processWide();
  }
  // 中央の列の幅: JSで直接当てる(列の幅＋中央寄せグループのmax-widthを広げ、両側の余白を使う)
  const wideTouched = new Set();
  function clearWide() {
    const pc = document.querySelector('[data-testid="primaryColumn"]');
    if (pc) { pc.style.removeProperty('width'); pc.style.removeProperty('max-width'); pc.style.removeProperty('min-width'); }
    wideTouched.forEach((el) => { if (el.isConnected) el.style.removeProperty('max-width'); });
    wideTouched.clear();
  }
  function processWide() {
    const pc = document.querySelector('[data-testid="primaryColumn"]');
    const header = document.querySelector('header[role="banner"]');
    if (!S.wideColumn || !pc) { if (wideTouched.size || (pc && pc.style.width)) clearWide(); return; }
    const w = S.widePx || 1000;
    if (pc.style.width !== w + 'px') { pc.style.setProperty('width', w + 'px', 'important'); pc.style.setProperty('max-width', w + 'px', 'important'); pc.style.setProperty('min-width', w + 'px', 'important'); }
    // 左メニュー(header)と中央列を含む「中央寄せの行」までさかのぼって max-width を広げる。
    // こうすると行全体が広がって再センタリングされ、左の余白も右の余白も均等に使われる(左メニューも一緒に左へ寄る)。
    let p = pc.parentElement;
    for (let i = 0; i < 12 && p && p.tagName !== 'BODY'; i++, p = p.parentElement) {
      const cs = getComputedStyle(p), mw = parseFloat(cs.maxWidth);
      if (cs.maxWidth && cs.maxWidth !== 'none' && isFinite(mw) && mw < w + 660) { p.style.setProperty('max-width', (w + 660) + 'px', 'important'); wideTouched.add(p); }
      if (header && p.contains(header)) break; // 左メニューを含む行に達したら終了
    }
  }

  // 複数メディアの横スクロールをやめ、格子状に一括表示(動画・GIFが混ざっていてもサムネイルで並べる)
  function processMediaGrid(a, rec, info) {
    let g = a.querySelector('.xdt-mgrid');
    const root = a.querySelector('.xdt-mroot');
    const ok = S.mediaGrid && rec && rec.media && rec.media.length >= 2;
    if (!ok) { if (g) g.remove(); if (root) root.classList.remove('xdt-mroot'); return; }
    let mroot = root;
    if (!mroot) {
      const pics = Array.from(a.querySelectorAll('[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="videoComponent"]')).filter((p) => p.closest('article') === a && !p.closest('[data-testid="quoteTweet"]') && !p.closest('.xdt-mgrid'));
      if (!pics.length) return;
      let e = pics[0];
      while (e && !pics.every((p) => e.contains(p))) e = e.parentElement;
      // 全メディアを含み、本文やユーザー名は含まない最上位の要素 = メディアのブロック
      while (e && e.parentElement && e.parentElement !== a && !e.parentElement.querySelector('[data-testid="tweetText"],[data-testid="User-Name"]')) e = e.parentElement;
      if (!e || e === a) return;
      e.classList.add('xdt-mroot'); mroot = e;
    }
    const sig = rec.media.map((m) => m.url + m.type).join('|');
    if (!g) { g = document.createElement('div'); g.className = 'xdt-mgrid'; }
    if (g.dataset.sig !== sig) {
      g.dataset.sig = sig; g.dataset.n = String(rec.media.length);
      g.innerHTML = rec.media.map((m, i) => {
        const mm = (m.url || '').match(/^(https:\/\/pbs\.twimg\.com\/[^.?]+)\.(\w+)/);
        const src = mm ? `${mm[1]}?format=${mm[2]}&name=medium` : m.url;
        return `<div class="xdt-gi" data-n="${i + 1}" data-t="${m.type === 'photo' ? 'photo' : 'video'}"><img src="${esc(src)}" loading="lazy" alt="">${m.type === 'photo' ? '' : '<span class="xdt-play">' + (m.type === 'animated_gif' ? 'GIF' : '▶') + '</span>'}</div>`;
      }).join('');
    }
    if (g.nextSibling !== mroot) mroot.before(g);
  }

  // 「さらに表示」を最初から展開(全文はAPIの note_tweet から取得)
  function linkify(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|\s)#([^\s#@<]+)/g, '$1<a href="/hashtag/$2">#$2</a>').replace(/(^|\s)@(\w{1,15})/g, '$1<a href="/$2">@$2</a>');
  }
  function processExpand(a, rec) {
    const link = a.querySelector('[data-testid="tweet-text-show-more-link"]');
    let full = a.querySelector('.xdt-full');
    const tt = a.querySelector('[data-testid="tweetText"]');
    if (!S.expandMore || !rec || !rec.fullText) {
      if (full) { full.remove(); a.querySelectorAll('.xdt-orig').forEach((n) => n.classList.remove('xdt-orig')); }
      return;
    }
    if (!link || !tt) return;
    if (!full) { full = document.createElement('div'); full.className = 'xdt-full'; full.dir = 'auto'; }
    const html = linkify(rec.fullText);
    if (full.dataset.sig !== html) {
      const cs = getComputedStyle(tt);
      full.style.fontFamily = cs.fontFamily; full.style.fontSize = cs.fontSize; full.style.lineHeight = cs.lineHeight; full.style.color = cs.color;
      full.dataset.sig = html; full.innerHTML = html;
    }
    tt.classList.add('xdt-orig'); link.classList.add('xdt-orig');
    if (full.previousSibling !== tt) tt.after(full);
  }

  // 「フォローされています」の隣に 相互/片思われ、スクリーンネームの隣に 片思い
  // 対象要素の右隣に、折り返さず横に置く(親を相対配置にして座標で配置)
  function placeAfter(el, span, gap) {
    const p = el.parentElement;
    if (!p) return;
    if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
    if (span.previousSibling !== el) el.after(span);
    span.style.position = 'absolute'; span.style.whiteSpace = 'nowrap';
    const left = el.offsetLeft + el.offsetWidth + gap, top = el.offsetTop + (el.offsetHeight - span.offsetHeight) / 2;
    if (span.style.left !== left + 'px') span.style.left = left + 'px';
    if (span.style.top !== top + 'px') span.style.top = top + 'px';
  }
  function processRelIndicator(name, u) {
    const pc = document.querySelector('[data-testid="primaryColumn"]');
    if (!pc) return;
    const f = u && u.id && u.id !== XDT.myId() ? u : null;
    const ind = pc.querySelector('[data-testid="userFollowIndicator"]');
    let a1 = pc.querySelector('.xdt-rel1'), a2 = pc.querySelector('.xdt-rel2');
    const t1 = f && ind && S.relIndicator && f.followedBy === true ? (f.following === true ? '🤝 相互' : '片思われ') : '';
    if (!t1) { if (a1) a1.remove(); }
    else {
      if (!a1) { a1 = document.createElement('span'); a1.className = 'xdt-rel xdt-rel1'; }
      if (a1.textContent !== t1) a1.textContent = t1;
      placeAfter(ind, a1, 8);
    }
    const un = pc.querySelector('[data-testid="UserName"]');
    const t2 = f && un && S.relIndicator ? (f.blocking === true ? 'ブロック中' : f.blockedBy === true ? 'ブロックされています' : (f.following === true && f.followedBy === false ? '片思い' : '')) : '';
    if (!t2) { if (a2) a2.remove(); return; }
    const tn2 = textNodes(un).find((n) => n.data.trim() === '@' + name && !(n.parentElement && n.parentElement.classList.contains('xdt-rel')));
    if (!tn2) return;
    if (!a2) { a2 = document.createElement('span'); a2.className = 'xdt-rel xdt-rel2'; }
    if (a2.textContent !== t2) a2.textContent = t2;
    // スクリーンネームの直後にコピーボタンがあれば、その右に置く
    let anchor = tn2.parentElement;
    const nx = anchor.nextElementSibling;
    if (nx && nx.classList.contains('xdt-copy')) anchor = nx;
    placeAfter(anchor, a2, 8);
  }

  // ぼかし解除(プロフィールのメディア一覧などのタイル)
  function unblurLayers() {
    if (!S.unblur) return;
    document.querySelectorAll('#layers img[src*="pbs.twimg.com"],#layers video').forEach((m) => {
      let e = m;
      for (let i = 0; i < 8 && e && e.id !== 'layers'; i++, e = e.parentElement) {
        if (e.style.filter === 'none') continue;
        const cs = getComputedStyle(e);
        if (((cs.filter || '') + (cs.backdropFilter || '')).indexOf('blur') !== -1) { e.style.setProperty('filter', 'none', 'important'); e.style.setProperty('backdrop-filter', 'none', 'important'); e.dataset.xdtUnb = '1'; }
      }
    });
  }
  function unblurTiles() {
    if (!S.unblur) return;
    const pc = document.querySelector('[data-testid="primaryColumn"]');
    if (!pc) return;
    pc.querySelectorAll('a[href*="/photo/"],a[href*="/video/"]').forEach((l) => {
      if (l.closest('article')) return;
      const tile = l.closest('li,[role="listitem"]') || l;
      if (tile.dataset.xdtUt) return;
      let n = 0;
      [tile].concat(Array.from(tile.querySelectorAll('*'))).forEach((el) => {
        if (el.style.filter === 'none') return;
        const cs = getComputedStyle(el);
        if (((cs.filter || '') + (cs.backdropFilter || '')).indexOf('blur') !== -1) {
          el.style.setProperty('filter', 'none', 'important'); el.style.setProperty('backdrop-filter', 'none', 'important');
          el.dataset.xdtUnb = '1'; n++;
        }
      });
      if (n) tile.dataset.xdtUt = '1';
    });
  }

  // Grokボタン(プロフィール上部を含む) / 画像を編集ボタン
  function processExtraHides() {
    if (S.hideGetVerified) {
      const RE = /^(認証される|認証を受ける|認証済みになる|認証バッジを取得|Get verified)$/i;
      document.querySelectorAll('header a,header [role="link"],[data-testid="primaryColumn"] a,[data-testid="primaryColumn"] [role="button"],[data-testid="primaryColumn"] button,[data-testid="sidebarColumn"] a,[data-testid="sidebarColumn"] [role="button"],[data-testid="sidebarColumn"] button,[data-testid="sidebarColumn"] aside').forEach((el) => {
        if (el.classList.contains('xdt-gone') || el.closest('article,[data-testid="tweetText"]')) return;
        const own = (el.textContent || '').trim(), lab = (el.getAttribute('aria-label') || '').trim();
        if ((own.length <= 16 && RE.test(own)) || RE.test(lab)) gone(rowUnit(el));
        else {
          // ボタンの文字が内側の要素にある場合(カード内の「認証される」)
          el.querySelectorAll('span,div').forEach((x) => {
            if (x.children.length || !RE.test((x.textContent || '').trim())) return;
            const t = x.closest('a,button,[role="button"],[role="link"]');
            if (t && t !== el.closest('[data-testid="primaryColumn"],[data-testid="sidebarColumn"]')) gone(rowUnit(t));
          });
        }
      });
    }
    if (S.hideBoost) {
      document.querySelectorAll('a,button,[role="button"],[role="link"],[role="menuitem"]').forEach((el) => {
        if (el.classList.contains('xdt-gone') || el.closest('[data-testid="tweetText"]')) return;
        const own = (el.textContent || '').trim(), lab = el.getAttribute('aria-label') || '';
        if ((own.length < 22 && /^(ポストを)?ブースト(する)?$|^Boost( post)?$/i.test(own)) || /^(ポストを)?ブースト|^Boost( post)?$/i.test(lab)) gone(rowUnit(el));
      });
    }
    if (S.hideBadge) {
      document.querySelectorAll('a,button,[role="button"],[role="link"]').forEach((el) => {
        if (el.classList.contains('xdt-gone') || el.closest('article,[data-testid="tweetText"]')) return;
        const t = ((el.textContent || '').trim() || el.getAttribute('aria-label') || '').trim();
        if (t.length < 24 && /^(認証される|認証を受ける|Get verified|Verify)$/i.test(t)) gone(rowUnit(el));
      });
    }
    // Grok の左メニュー項目・「もっと見る」内は MENU_RULES(hideGrok)で非表示にする
    // 画像の上/右下に出る「画像を編集」(Grok)ボタン。画像(tweetPhoto)や画像ビューアの中/近くにあるものを対象にする
    if (S.hideImgEdit) {
      document.querySelectorAll('[data-testid="tweetPhoto"] a[href*="grok"], [data-testid="tweetPhoto"] a[href*="/i/grok"]').forEach((el) => el.classList.add('xdt-gone'));
      document.querySelectorAll('[data-testid="primaryColumn"] button, [data-testid="primaryColumn"] [role="button"], [data-testid="primaryColumn"] a, #layers button, #layers [role="button"], #layers a').forEach((el) => {
        if (el.classList.contains('xdt-gone')) return;
        const lab = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-testid') || '') + ' ' + (el.getAttribute('href') || '') + ' ' + (el.textContent || '').slice(0, 24)).toLowerCase();
        const isEdit = /画像を編集|画像編集|写真を編集|メディアを編集|edit (image|photo|media|with grok)|grok.*edit|edit.*grok|image[_-]?edit|edit[_-]?image|composerGrok|grokImageEdit/.test(lab) || (/grok/.test(lab) && /edit|編集/.test(lab));
        // 画像の近く(tweetPhoto / 画像ビューア / メディアを含む記事)にあるGrok/編集ボタンだけを隠す
        if (isEdit && (el.closest('[data-testid="tweetPhoto"],[data-testid="swipe-to-dismiss"],[aria-modal="true"]') || el.closest('article') && el.closest('article').querySelector('[data-testid="tweetPhoto"],img[src*="pbs.twimg.com/media"]'))) el.classList.add('xdt-gone');
        else if (/grok/.test(lab) && el.closest('[data-testid="tweetPhoto"]')) el.classList.add('xdt-gone');
      });
    }
    // ポストの「削除」(…メニュー内)
    if (S.hideDelete) {
      document.querySelectorAll('[role="menuitem"],[data-testid="Dropdown"] [role="menuitem"]').forEach((el) => {
        if (el.classList.contains('xdt-gone')) return;
        const t = ((el.textContent || '').trim());
        if (/^(削除|ポストを削除|Delete|Delete post)$/i.test(t)) gone(rowUnit(el));
      });
    }
  }

  // Grok のボタン(プロフィール上・ポスト上・右の浮きボタンなど)をまとめて非表示にする。
  // 左サイドメニューの Grok 項目は「左サイドメニューの非表示」(hideGrok)で別に制御するため、ここでは対象外。
  // Twitter 時代の見た目にする(ロゴ=青い鳥 / ポスト→ツイート / 認証バッジ・ボタンをTwitter色 / ロード画面も鳥)
  const TW_BIRD = 'M23.643 4.937c-.835.37-1.732.62-2.675.733.962-.576 1.7-1.49 2.048-2.578-.9.534-1.897.922-2.958 1.13-.85-.904-2.06-1.47-3.4-1.47-2.572 0-4.658 2.086-4.658 4.66 0 .364.042.718.12 1.06-3.873-.195-7.304-2.05-9.602-4.868-.4.69-.63 1.49-.63 2.342 0 1.616.823 3.043 2.072 3.878-.764-.025-1.482-.234-2.11-.583v.06c0 2.257 1.605 4.14 3.737 4.568-.392.106-.803.162-1.227.162-.3 0-.593-.028-.877-.082.593 1.85 2.313 3.198 4.352 3.234-1.595 1.25-3.604 1.995-5.786 1.995-.376 0-.747-.022-1.112-.065 2.062 1.323 4.51 2.093 7.14 2.093 8.57 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602.91-.658 1.7-1.477 2.323-2.41z';
  // 旧Twitterの認証バッジ(青いギザギザの丸+白チェック)
  const TW_BADGE = 'M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44C11.274 2.86 10.643 2.662 10 2.646c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245C1.82 10.726 1.622 11.354 1.604 12c.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z';
  // Twitterテーマ用のアイコン(鳥)データURI(favicon・ロード画面フォールバック)
  const TW_BIRD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#1DA1F2" d="' + TW_BIRD + '"/></svg>';
  const TW_BIRD_URI = 'data:image/svg+xml,' + encodeURIComponent(TW_BIRD_SVG);
  function setTwitterFavicon(on) {
    const head = document.head || document.documentElement;
    const links = document.querySelectorAll('link[rel~="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]');
    if (on) {
      links.forEach((l) => { if (l.dataset.xdtFav === '1') return; if (!('xdtOldFav' in l.dataset)) l.dataset.xdtOldFav = l.getAttribute('href') || ''; if (l.getAttribute('href') !== TW_BIRD_URI) l.setAttribute('href', TW_BIRD_URI); l.dataset.xdtFav = '1'; });
      // Xが後からhrefを書き換えても戻す
      links.forEach((l) => { if (l.dataset.xdtFav === '1' && l.getAttribute('href') !== TW_BIRD_URI) l.setAttribute('href', TW_BIRD_URI); });
      if (!document.querySelector('link[data-xdt-fav="1"]')) { const n = document.createElement('link'); n.rel = 'icon'; n.setAttribute('href', TW_BIRD_URI); n.dataset.xdtFav = '1'; head.appendChild(n); }
    } else {
      document.querySelectorAll('link[data-xdt-fav="1"]').forEach((l) => { if ('xdtOldFav' in l.dataset) { if (l.dataset.xdtOldFav) l.setAttribute('href', l.dataset.xdtOldFav); delete l.dataset.xdtOldFav; delete l.dataset.xdtFav; } else l.remove(); });
    }
  }
  // SVGの中身を差し替える(元の内容を保存しておき、オフ時に即座に戻せるようにする)
  function swapSvgInner(svg, inner, mark) {
    if (!svg.__xdtOrig) svg.__xdtOrig = { html: svg.innerHTML, vb: svg.getAttribute('viewBox') };
    svg.dataset[mark] = '1';
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.innerHTML = inner;
  }
  // Twitterテーマを即座に解除(ロゴ・バッジ・ボタン文言・favicon・ロード画面を元に戻す)
  function revertTwitter() {
    document.querySelectorAll('svg[data-xdt-bird],svg[data-xdt-badge]').forEach((svg) => {
      const o = svg.__xdtOrig;
      if (o) { if (o.vb != null) svg.setAttribute('viewBox', o.vb); else svg.removeAttribute('viewBox'); svg.innerHTML = o.html; }
      delete svg.dataset.xdtBird; delete svg.dataset.xdtBadge;
    });
    document.querySelectorAll('span[data-xdt-tw]').forEach((sp) => {
      if (typeof sp.__xdtOrigText === 'string') sp.textContent = sp.__xdtOrigText;
      delete sp.dataset.xdtTw;
    });
    setTwitterFavicon(false);
  }
  function processTwitter() {
    const h = document.documentElement;
    if (!S.twitterMode) {
      if (h.hasAttribute('data-xdt-twitter')) { h.removeAttribute('data-xdt-twitter'); revertTwitter(); }
      return;
    }
    if (h.getAttribute('data-xdt-twitter') !== '1') h.setAttribute('data-xdt-twitter', '1');
    // X ロゴ(ナビ上)→ 青い鳥。Xロゴのパスを判定して中身を差し替える。
    document.querySelectorAll('svg').forEach((svg) => {
      if (svg.dataset.xdtBird === '1') return;
      const p = svg.querySelector('path'), d = (p && p.getAttribute('d')) || '';
      const owner = svg.closest('[aria-label]'); const lab = (svg.getAttribute('aria-label') || (owner && owner.getAttribute('aria-label')) || '');
      // X ロゴの特徴的なパス断片(複数の表記ゆれに対応)/ aria-label=X
      const isX = /18\.244\s*2\.25|M18\.24|M13\.158|2\.25h3\.308|8\.502 11\.24/.test(d) || /^(X|Xホーム|X Home)$/i.test(lab.trim());
      if (!isX) return;
      // 認証バッジ(verified)は別処理。ここでは大きめ/ロゴだけ鳥にする。
      if (svg.closest('[data-testid="icon-verified"]')) return;
      swapSvgInner(svg, '<g><path fill="#1DA1F2" d="' + TW_BIRD + '"/></g>', 'xdtBird');
    });
    // ロード画面(中央の大きいロゴ): #placeholder 内のSVGは無条件に鳥(青)へ。Xのロゴ判定に依存しない。
    const ph = document.getElementById('placeholder');
    if (ph) {
      const psvg = ph.querySelector('svg');
      if (psvg && psvg.dataset.xdtBird !== '1') swapSvgInner(psvg, '<g><path fill="#1DA1F2" d="' + TW_BIRD + '"/></g>', 'xdtBird');
    }
    // サイトのアイコン(favicon)も鳥に
    setTwitterFavicon(true);
    // 認証バッジ → 旧Twitterの青バッジ
    document.querySelectorAll('[data-testid="icon-verified"]').forEach((b) => {
      const svg = b.tagName === 'svg' ? b : b.querySelector('svg');
      if (!svg || svg.dataset.xdtBadge === '1') return;
      swapSvgInner(svg, '<g><path fill="#1DA1F2" d="' + TW_BADGE + '"/></g>', 'xdtBadge');
    });
    // ポストする → ツイートする
    document.querySelectorAll('[data-testid="SideNav_NewTweet_Button"],[data-testid="SideNav_NewTweet_Button_Mobile"],[data-testid="tweetButton"],[data-testid="tweetButtonInline"]').forEach((btn) => {
      btn.querySelectorAll('span').forEach((sp) => {
        if (sp.children.length) return; const t = (sp.textContent || '').trim();
        const map = { 'ポストする': 'ツイートする', 'ポスト': 'ツイート', 'Post': 'Tweet', 'すべてのポスト': 'すべてのツイート' };
        if (map[t] !== undefined) { if (typeof sp.__xdtOrigText !== 'string') sp.__xdtOrigText = sp.textContent; sp.dataset.xdtTw = '1'; sp.textContent = map[t]; }
      });
    });
  }
  function processGrokButtons() {
    if (!S.hideGrokBtn) return;
    const nav = document.querySelector('header[role="banner"] nav');
    document.querySelectorAll('a[aria-label],button[aria-label],[role="button"][aria-label],a[href*="grok" i],[data-testid*="grok" i]').forEach((el) => {
      if (el.classList.contains('xdt-gone')) return;
      if (nav && nav.contains(el)) return; // 左ナビの Grok は対象外
      const lab = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-testid') || '') + ' ' + (el.getAttribute('href') || '') + ' ' + ((el.textContent || '').length < 20 ? el.textContent : '');
      // Grok 各種ボタン + 「プロフィールの要約」(Grok機能)も対象
      if (!/grok|グロック|グロク|プロフィールの要約|プロフィールの要点|Profile Summary/i.test(lab)) return;
      const t = el.closest('a,button,[role="button"]') || el;
      t.classList.add('xdt-gone');
    });
    // 「プロフィールの要約」ボタンが span などの入れ子にしか文字を持たない場合の保険
    document.querySelectorAll('[data-testid="primaryColumn"] button, [data-testid="primaryColumn"] [role="button"]').forEach((el) => {
      if (el.classList.contains('xdt-gone') || (nav && nav.contains(el))) return;
      const t = (el.textContent || '').trim();
      if (t.length < 20 && /プロフィールの要約|プロフィールの要点|Profile Summary/i.test(t)) el.classList.add('xdt-gone');
    });
  }

  // お気に入り(☆)のユーザーは、名前の横に★を付ける。
  function processFavStar() {
    if (!S.favStar || !XDT.isFav) return;
    document.querySelectorAll('[data-testid="User-Name"],[data-testid="UserName"]').forEach((un) => {
      if (un.querySelector('.xdt-fav')) return;
      // スクリーンネーム(@handle)を取り出す
      let handle = null;
      const link = un.querySelector('a[href^="/"]');
      const m = link && (link.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (m) handle = m[1].toLowerCase();
      if (!handle) { const t = (un.textContent || '').match(/@([A-Za-z0-9_]{1,15})/); if (t) handle = t[1].toLowerCase(); }
      if (!handle || !XDT.isFav(handle)) return;
      // アイコン・表示名を一覧用に補完(APIにアイコンが無くてもDOMから拾う)
      if (XDT.enrichFav) {
        const scope = un.closest('article,[data-testid="UserCell"],[data-testid="primaryColumn"],[data-testid="HoverCard"]') || document;
        const img = scope.querySelector('[data-testid^="UserAvatar-Container"] img, img[src*="profile_images"]');
        const src = img && img.getAttribute('src');
        if (src) XDT.enrichFav({ name: handle, avatar: src });
      }
      // 表示名(1行目)の末尾に★または💗(ピンクのハート)を付ける
      const dn = un.querySelector('div[dir="ltr"],div[dir="auto"]') || un.firstElementChild || un;
      const heart = XDT.favMark && XDT.favMark(handle) === 'heart';
      const star = document.createElement('span');
      star.className = 'xdt-fav'; star.textContent = heart ? ' ❤️' : ' ★'; star.title = 'お気に入り'; star.style.whiteSpace = 'nowrap';
      if (!heart) star.style.color = '#f5b301';
      dn.appendChild(star);
    });
  }

  /* ============================ 画像ズーム(専用ビューア) ============================ */
  // Xの画像表示の構造に依存しないよう、画像の上でホイールを上に回すと専用の全画面ビューアを開く
  let zoomEl = null;
  function closeZoom() { if (zoomEl) { zoomEl.remove(); zoomEl = null; } }
  function openZoom(img, cx, cy) {
    closeZoom();
    const ov = document.createElement('div');
    ov.className = 'xdt-zoom';
    ov.innerHTML = '<img alt="" draggable="false"><button type="button" class="xdt-zoom-x" title="閉じる(Esc)">✕</button><div class="xdt-zoom-h">ホイール: 拡大縮小 / ドラッグ: 移動 / ダブルクリック: 戻す・拡大 / Esc: 閉じる</div>';
    const im = ov.querySelector('img');
    im.src = (img.currentSrc || img.src).replace(/name=\w+/, 'name=orig').replace(/_(normal|bigger|mini|200x200|400x400|reasonably_small)(\.\w+)$/, '$2');
    let s = 1, tx = 0, ty = 0, drag = null;
    const paint = () => { im.style.transform = `translate(-50%,-50%) translate(${tx}px,${ty}px) scale(${s})`; im.style.cursor = s > 1 ? 'grab' : 'zoom-in'; };
    const zoomAt = (x, y, ns) => {
      ns = Math.max(1, Math.min(10, ns));
      const dx = x - innerWidth / 2, dy = y - innerHeight / 2;
      tx = dx - (dx - tx) * ns / s; ty = dy - (dy - ty) * ns / s; s = ns;
      if (s === 1) { tx = 0; ty = 0; }
      paint();
    };
    ov.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); zoomAt(e.clientX, e.clientY, s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); }, { passive: false });
    ov.addEventListener('mousedown', (e) => { if (e.target === im && s > 1) { e.preventDefault(); drag = { x: e.clientX, y: e.clientY, tx, ty }; im.style.cursor = 'grabbing'; } });
    window.addEventListener('mousemove', function mv(e) { if (!zoomEl) { window.removeEventListener('mousemove', mv); return; } if (drag) { tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y; paint(); } });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; paint(); } });
    ov.addEventListener('dblclick', (e) => { e.preventDefault(); if (s > 1) { s = 1; tx = 0; ty = 0; paint(); } else zoomAt(e.clientX, e.clientY, 3); });
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.xdt-zoom-x')) closeZoom(); });
    document.body.appendChild(ov);
    zoomEl = ov;
    paint();
    zoomAt(cx, cy, 1.4);
  }
  document.addEventListener('wheel', (e) => {
    if (!S.imageZoom || zoomEl || e.deltaY >= 0 || !/\/status\/\d+\/photo\/\d+|^\/[^/]+\/(photo|header_photo)\/?$/.test(location.pathname)) return;
    const img = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.tagName === 'IMG' && /pbs\.twimg\.com\/(media|profile_images|profile_banners)/.test(el.currentSrc || el.src) && el.getBoundingClientRect().width > 120);
    if (!img) return;
    e.preventDefault(); e.stopPropagation();
    openZoom(img, e.clientX, e.clientY);
  }, { capture: true, passive: false });
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (zoomEl) { e.preventDefault(); e.stopPropagation(); closeZoom(); } else if (mv) { e.preventDefault(); e.stopPropagation(); closeMediaView(); } }, true);

  /* ============================ メディア一覧(画像+動画を一緒に) ============================ */
  let mv = null;
  function closeMediaView() { if (mv) { mv.ov.remove(); mv = null; } }
  function mvRender() {
    if (!mv) return;
    const g = mv.ov.querySelector('.xdt-mv-g');
    const list = mv.items.filter((i) => mv.f === 'all' || (mv.f === 'photo' ? i.t === 'photo' : i.t !== 'photo'));
    g.innerHTML = list.map((i) => `<a class="xdt-mvt" href="${esc(i.href)}" target="_blank" rel="noopener"><img src="${esc(i.src)}" loading="lazy" alt="">${i.t === 'photo' ? '' : '<span class="xdt-play">' + (i.t === 'animated_gif' ? 'GIF' : '▶') + '</span>'}</a>`).join('');
    mv.ov.querySelectorAll('.xdt-mv-f button').forEach((b) => b.classList.toggle('on', b.dataset.f === mv.f));
  }
  async function mvMore() {
    const st = mv;
    if (!st || st.loading || st.done) return;
    st.loading = true;
    const msg = st.ov.querySelector('.xdt-mv-s');
    msg.textContent = '読み込み中…';
    try {
      const r = await XDT.loadMedia(st.name, st.next);
      if (mv !== st) return;
      let added = 0;
      r.tweets.forEach((t) => t.media.forEach((m, i) => {
        const key = t.id + '_' + i;
        if (st.seen.has(key)) return;
        st.seen.add(key); added++;
        const mm = (m.url || '').match(/^(https:\/\/pbs\.twimg\.com\/[^.?]+)\.(\w+)/);
        st.items.push({ t: m.type, src: mm ? `${mm[1]}?format=${mm[2]}&name=small` : m.url, href: `/${st.name}/status/${t.id}/${m.type === 'photo' ? 'photo' : 'video'}/${i + 1}` });
      }));
      st.next = r.next;
      if (!r.next || !added) st.done = true;
      msg.textContent = st.done ? (st.items.length ? '以上です' : 'メディアがありません') : '';
      mvRender();
    } catch (e) {
      const m = String((e && e.message) || e);
      msg.textContent = m === 'NO_TEMPLATE' ? 'Xの通信設定を未取得です。プロフィールのメディア欄を一度開いてから、もう一度押してください' + (Object.keys(XDT.templates).filter((k) => /media/i.test(k)).length ? '' : '') : m === 'NO_USER' ? 'プロフィール情報を未取得です。少し待ってから押してください' : '取得できませんでした: ' + m;
      st.done = m === 'NO_TEMPLATE' || m === 'NO_USER';
      if (st.done) st.retry = true;
    } finally { st.loading = false; }
    if (!st.done) setTimeout(() => { const g = st.ov; if (mv === st && g.scrollHeight - g.scrollTop - g.clientHeight < 400) mvMore(); }, 120);
  }
  function openMediaView(name) {
    closeMediaView();
    const ov = document.createElement('div');
    ov.className = 'xdt-mview';
    ov.innerHTML = `<div class="xdt-mv-h"><b>@${esc(name)} のメディア</b><span class="xdt-mv-f"><button type="button" data-f="all">すべて</button><button type="button" data-f="photo">画像</button><button type="button" data-f="video">動画</button></span><button type="button" class="xdt-mv-x" title="閉じる(Esc)">✕</button></div><div class="xdt-mv-g"></div><div class="xdt-mv-s"></div>`;
    document.body.appendChild(ov);
    const bs = getComputedStyle(document.body);
    ov.style.background = bs.backgroundColor; ov.style.color = bs.color;
    mv = { ov, name, items: [], seen: new Set(), next: null, loading: false, done: false, f: 'all' };
    ov.addEventListener('click', (e) => {
      if (e.target.closest('.xdt-mv-x')) closeMediaView();
      const b = e.target.closest('.xdt-mv-f button');
      if (b && mv) { mv.f = b.dataset.f; mvRender(); }
    });
    ov.addEventListener('scroll', () => { if (mv && ov.scrollHeight - ov.scrollTop - ov.clientHeight < 600) mvMore(); });
    mvRender();
    mvMore();
  }

  /* ============================ 定型文(投稿画面) ============================ */
  let snEditor = null;
  function processSnippets() {
    document.querySelectorAll('[data-testid="toolBar"]').forEach((tb) => {
      let btn = tb.querySelector('.xdt-sn');
      // 定型文・下書き・返信相手の名前 のどれかが有効なら「書き込みボタン」を出す
      if (!(S.snipEnable || S.draftEnable || S.replyNameEnable)) { if (btn) btn.remove(); return; }
      if (btn) return;
      const host = tb.querySelector('[data-testid="ScrollSnap-List"]') || tb.firstElementChild || tb;
      btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'xdt-sn'; btn.title = '書き込み(定型文・下書き・返信相手の名前)'; btn.textContent = '📝';
      host.appendChild(btn);
    });
  }
  function insertText(ed, text, atStart) {
    if (!ed || !ed.isConnected) return;
    ed.focus();
    const sel = getSelection();
    const r = document.createRange();
    r.selectNodeContents(ed); r.collapse(!!atStart);
    if (!atStart && sel.rangeCount && ed.contains(sel.anchorNode)) { /* 現在のカーソル位置を使う */ } else { sel.removeAllRanges(); sel.addRange(r); }
    // Draft.jsの貼り付け処理に任せる(状態と画面がずれず、二重にならない)
    const before = ed.textContent, dt = new DataTransfer();
    dt.setData('text/plain', text);
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    // 貼り付けが処理されなかった場合のみ、遅れて1回だけ通常入力する
    setTimeout(() => { if (ed.isConnected && ed.textContent === before) { ed.focus(); document.execCommand('insertText', false, text); } }, 300);
  }
  function insertSnippet(text) { insertText(snEditor, text, false); }

  /* ============================ 日時の表示 ============================ */
  // 時刻部分を clockStyle に応じて整形する
  function clockStr(h, mi) {
    if (S.clockStyle === 'colon24') return `${String(h).padStart(2, '0')}:${mi}`; // 24時間表記 13:20
    return `${h < 12 ? '午前' : '午後'}${h % 12 === 0 ? 12 : h % 12}:${mi}`;        // 午後1:20(既定)
  }
  function absTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const h = d.getHours(), mi = String(d.getMinutes()).padStart(2, '0');
    const tm = clockStr(h, mi), dt = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    return S.timeOrder === 'date' ? `${dt} · ${tm}` : `${tm}・${dt}`; // 日付が先: 2026年11月12日 · 午前11:53
  }
  // 「5分」「1時間前」「10月18日」などの相対・省略表示に、詳細な日時を括弧で追記(または詳細のみに置き換え)。
  // clockStyle が指定されているときは、すでに時刻を表示している箇所(ポスト詳細)も指定の書式に整形する。
  function processTimes() {
    const reclock = S.clockStyle && S.clockStyle !== 'off';
    if (S.timeFmt !== 'both' && S.timeFmt !== 'exact' && !reclock) return;
    document.querySelectorAll('time[datetime]').forEach((el) => {
      if (el.closest('.xdt-tbadges,.xdt-pop,.xdt-mview,.xdt-zoom')) return;
      const n = textNodes(el).find((x) => x.data.trim());
      if (!n) return;
      const base = origOf(n);
      const hasClock = /\d{1,2}:\d{2}|\d{1,2}時\d/.test(base);
      if (hasClock) { if (reclock) { const a = absTime(el.getAttribute('datetime')); if (a) setNode(n, a); } return; } // ポスト詳細など、時刻表示を書式変更
      if (S.timeFmt !== 'both' && S.timeFmt !== 'exact') return; // 相対表示の追記は timeFmt のときだけ
      const abs = absTime(el.getAttribute('datetime'));
      if (abs) setNode(n, S.timeFmt === 'exact' ? abs : `${base} (${abs})`);
    });
  }

  /* ============================ キーワード強調(TL・プロフィール・ポスト・DM) ============================ */
  let hlLast = 0, hlSig = '';
  function processHighlight() {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
    const words = (Array.isArray(S.hlList) ? S.hlList : []).map((w) => String(w).trim().toLowerCase()).filter(Boolean).slice(0, 50);
    if (!S.hlOn || !words.length || !(S.hlMark || S.hlLine)) { CSS.highlights.delete('xdt-hlm'); CSS.highlights.delete('xdt-hll'); hlSig = ''; return; }
    const sig = words.join('|') + S.hlColor + S.hlLineColor + S.hlMark + S.hlLine, now = Date.now();
    if (sig === hlSig && now - hlLast < 600) return;
    hlLast = now; hlSig = sig;
    let st = document.getElementById('xdt-hl-style');
    if (!st) { st = document.createElement('style'); st.id = 'xdt-hl-style'; document.head.appendChild(st); }
    const css = `::highlight(xdt-hlm){background-color:${S.hlColor}66;}::highlight(xdt-hll){text-decoration:underline;text-decoration-color:${S.hlLineColor};text-decoration-thickness:2px;}`;
    if (st.textContent !== css) st.textContent = css;
    const ranges = [];
    document.querySelectorAll('main,[data-testid="DMDrawer"],#layers').forEach((root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && !n.parentElement.closest('script,style,textarea,input,[contenteditable="true"],.xdt-tbadges,.xdt-ppanel,.xdt-pop') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
      let n;
      while ((n = w.nextNode()) && ranges.length < 4000) {
        const t = n.data.toLowerCase();
        for (const k of words) {
          let i = t.indexOf(k);
          while (i !== -1 && ranges.length < 4000) { const r = new Range(); r.setStart(n, i); r.setEnd(n, i + k.length); ranges.push(r); i = t.indexOf(k, i + k.length); }
        }
      }
    });
    if (S.hlMark) CSS.highlights.set('xdt-hlm', new Highlight(...ranges)); else CSS.highlights.delete('xdt-hlm');
    if (S.hlLine) CSS.highlights.set('xdt-hll', new Highlight(...ranges)); else CSS.highlights.delete('xdt-hll');
  }

  /* ---- 読み込み時の自動判定(画面内のポスト投稿者。検索は15分あたり30件まで) ---- */
  let autoCount = 0, autoCountT = 0, autoReset = Date.now();
  function autoChecks(a, info) {
    if (S.safeMode || !S.autoProfileCheck || !(S.tweetShadow || S.tweetSearchBan)) return;
    const r = a.getBoundingClientRect();
    if (r.bottom < -200 || r.top > innerHeight + 500) return;
    if (Date.now() - autoReset > 15 * 60e3) { autoCount = 0; autoCountT = 0; autoReset = Date.now(); }
    const au = info.author.toLowerCase();
    if (!results.has('ps:' + au) && (S.tweetShadow || S.tweetSearchBan) && autoCount < 30) { autoCount++; XDT.runSearchBan(info.author, false); }
    if (S.tweetSearchBan && !results.has('t:' + info.id)) {
      // 投稿者の検索結果の範囲で判定できないポストだけ、裏でポスト単位の検索チェックを実行(15分あたり40件まで)
      const rec = tweets.get(info.id), ps = results.get('ps:' + au);
      const onDetail = new RegExp('/status/' + info.id + '(/|$)').test(location.pathname);
      if (!(rec && rec.rt) && ((ps && !ps.running && !tweetFromState(rec, info, ps, null) && autoCountT < 40) || onDetail)) { autoCountT++; XDT.runTweetSearch(info.id, info.author); }
    }
  }

  /* ============================ 星 / 非表示ルール ============================ */
  const STAR_O = 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z';
  const STAR_F = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';
  const HEART = '2.48-4.001 5.12'; // ハート図形に共通のパス断片(いいねボタン・通知アイコン)
  function processStar() {
    document.querySelectorAll('svg path').forEach((p) => {
      const cur = p.getAttribute('d') || '';
      if (cur !== STAR_O && cur !== STAR_F && cur.indexOf(HEART) === -1) return;
      const btn = p.closest('[data-testid="like"],[data-testid="unlike"]');
      const star = btn ? (btn.getAttribute('data-testid') === 'unlike' ? STAR_F : STAR_O) : STAR_F;
      if (S.starLike) {
        if (cur !== star) { if (cur.indexOf(HEART) !== -1) p.dataset.xdtD = cur; p.setAttribute('d', star); }
        if (!btn) { const sv = p.closest('svg'); if (sv) { sv.dataset.xdtN = '1'; sv.style.setProperty('color', '#ffad1f', 'important'); } }
      } else if (p.dataset.xdtD) {
        p.setAttribute('d', p.dataset.xdtD); delete p.dataset.xdtD;
        const sv = p.closest('svg'); if (sv && sv.dataset.xdtN) { sv.style.removeProperty('color'); delete sv.dataset.xdtN; }
      }
    });
  }

  const gone = (el) => { if (el && !el.classList.contains('xdt-gone')) el.classList.add('xdt-gone'); };
  const MENU_RULES = [
    ['hideSearchTopics', /^(話題を検索|Explore)$/i, /^\/explore$/],
    ['hideCreator', /^(クリエイタースタジオ|Creator Studio)$/i, /\/i\/studio/], ['hidePremium', /^(プレミアム|Premium)$/i, /premium_sign_up|\/i\/premium/],
    ['hideArticles', /^(記事|Articles)$/i, /\/i\/articles/], ['hideGrok', /^Grok$/i, /\/i\/grok/], ['hideBoost', /^(ポストを)?ブースト|^Boost/i, /boost/i],
    ['hideCommunities', /^(コミュニティ|Communities)$/i, /communities/], ['hideBusiness', /^(ビジネス|Business)$/i, /\/i\/business|verified-orgs/],
    ['hideAds', /^(広告|Ads)$/i, /ads\.(x|twitter)\.com/], ['hideCreateSpace', /^(スペースを作成|Create (your )?Space)$/i, /spaces\/start/],
    ['hideCall', /^(通話|Calls?|通話を開始)$/i, /\/i\/(audio_room|spaces\/)?call|voice/i], ['hideLive', /^(ライブ放送|Live on X|Go Live)$/i, /broadcasts|\/i\/broadcasts/i],
    ['hideFollowBtn', /^(フォロー|フォローする|Follow)$/i, null],
  ];
  const SIDE_RULES = [
    ['hideNews', /本日のニュース|Today.s News/i], ['hideTrends', /「いま」を見つけよう|いまどうしてる|What.s happening|Trending/i],
    ['hideWhoFollow', /おすすめユーザー|^おすすめ$|Who to follow|Suggested/i], ['hidePremiumSub', /プレミアムにサブスクライブ|Subscribe to Premium/i], ['hideLive', /ライブ放送|Live on X/i],
  ];
  // 左メニューの「行」= nav直下の子要素(aやbuttonを含む枠)を隠して、空白が残らないようにする
  const navRow = (el, nav) => { let u = el; while (u.parentElement && u.parentElement !== nav) u = u.parentElement; return u.parentElement === nav ? u : el; };
  function processHides() {
    const active = MENU_RULES.filter((r) => S[r[0]]);
    if (active.length) {
      document.querySelectorAll('header nav').forEach((nav) => {
        nav.querySelectorAll('a[href], [role="link"], button, [role="button"]').forEach((el) => {
          const label = (el.getAttribute('aria-label') || el.textContent || '').trim(), href = el.getAttribute('href') || (el.querySelector('a[href]') && el.querySelector('a[href]').getAttribute('href')) || '';
          for (const [k, re, hre] of active) if (re.test(label) || (href && hre && hre.test(href))) { gone(navRow(el, nav)); break; }
        });
      });
      // 「…」メニュー内(ブースト等)は枠ごと隠す
      document.querySelectorAll('[role="menu"] [role="menuitem"], [data-testid="Dropdown"] [role="menuitem"]').forEach((el) => {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
        for (const [k, re] of active) if (re.test(label)) { gone(rowUnit(el)); break; }
      });
    }
    if (S.hideForYou) {
      document.querySelectorAll('[data-testid="primaryColumn"] [role="tablist"] [role="tab"]').forEach((t) => { if (/^(おすすめ|For you)$/i.test((t.textContent || '').trim())) gone(t); });
    }
    const side = SIDE_RULES.filter((r) => S[r[0]]);
    const col = document.querySelector('[data-testid="sidebarColumn"]');
    if (col && side.length) {
      // 右サイドバーのモジュール見出しを「テキスト」で探す(h2/role=heading でない構造にも対応)。
      // 見出しから上へ、別モジュール・検索バー・フッターを含み始める手前までを1枚のカードとして隠す。
      // 他モジュールやフッターの印(これを含み始めたら、その親は複数モジュールをまたぐ=手前がカード)
      const OTHER = /プレミアムにサブスクライブ|Subscribe to Premium|いま」を見つけよう|いまどうしてる|What.?s happening|本日のニュース|Today.?s News|おすすめユーザー|Who to follow|ライブ放送|Live on X|利用規約|プライバシー|Terms of Service|Privacy Policy|©\s*\d{4}/;
      const findHeading = (re) => {
        let best = null, bestSize = Infinity;
        col.querySelectorAll('span,div,h1,h2,h3,[role="heading"]').forEach((e) => {
          const t = (e.textContent || '').trim();
          if (t.length > 40 || !re.test(t)) return; // 見出しは短い
          const s = e.querySelectorAll('*').length;
          if (s < bestSize) { bestSize = s; best = e; }
        });
        return best;
      };
      const sideCard = (h, selfRe) => {
        let best = h, el = h;
        while (el.parentElement && el.parentElement !== col && col.contains(el.parentElement)) {
          const p = el.parentElement;
          if (p.querySelector('[role="search"]')) break; // 検索バーを含む=上がりすぎ
          const pt = (p.textContent || '').replace(selfRe, ''); // 自分の見出しを除いて
          if (OTHER.test(pt)) break;                          // 他モジュール/フッターを含み始めたら手前がカード
          best = p; el = p;
        }
        return best;
      };
      side.forEach((r) => {
        const h = findHeading(r[1]);
        if (!h) return;
        const mod = sideCard(h, r[1]);
        if (mod && mod !== col && !mod.querySelector('[role="search"]')) gone(mod);
      });
    }
    if (S.hideSearchBar && col) col.querySelectorAll('[role="search"]').forEach(gone);
    if (S.hideTLWhoFollow && !/^\/(search|i\/|explore|settings|messages)/.test(location.pathname) && !/\/(followers|following|verified_followers|followers_you_follow|retweets|quotes|likes)$/.test(location.pathname)) {
      document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]').forEach((cell) => {
        if (cell.querySelector('article')) return;
        const h = cell.querySelector('h2,[role="heading"]');
        if ((h && /^(おすすめ|おすすめユーザー)$|Who to follow|おすすめのアカウント|Suggested/i.test((h.textContent || '').trim())) || cell.querySelector('[data-testid="UserCell"]')) gone(cell);
      });
    }
  }

  /* ============================ メニュー追加 ============================ */
  let lastArt = null; // 直近に触ったポスト {id, author, article, t}
  function lcaOf(a, b) { let p = a.parentElement; while (p && !p.contains(b)) p = p.parentElement; return p; }
  function menuUnit(its) {
    const tmpl = its[its.length - 1];
    if (its.length < 2) return tmpl;
    const lca = lcaOf(its[0], tmpl);
    let unit = tmpl;
    while (unit.parentElement && unit.parentElement !== lca) unit = unit.parentElement;
    return unit.parentElement === lca ? unit : tmpl;
  }
  // Xの部品は複製せず、実測した文字サイズ・色に合わせた自前の行を作る(縦に潰れる/崩れるのを防ぐ)
  function mkMenuItem(unit, emoji, text, act, data) {
    const tn = textNodes(unit).find((n) => n.data.trim());
    const txtEl = (tn && tn.parentElement) || unit;
    const cs = getComputedStyle(txtEl), h = Math.max(44, Math.round(unit.getBoundingClientRect().height) || 44);
    const el = document.createElement('div');
    el.className = 'xdt-mi';
    el.setAttribute('role', 'menuitem');
    el.tabIndex = 0;
    el.style.minHeight = h + 'px';
    el.style.fontFamily = cs.fontFamily; el.style.fontSize = cs.fontSize; el.style.fontWeight = cs.fontWeight; el.style.color = cs.color;
    el.innerHTML = `<span class="xdt-mi-i">${emoji}</span><span class="xdt-mi-t">${esc(text)}</span>`;
    el.dataset.xdtAct = act;
    Object.keys(data || {}).forEach((k) => (el.dataset['xdt' + k[0].toUpperCase() + k.slice(1)] = data[k]));
    return el;
  }
  function processMenus() {
    // 同じ項目が複数あれば、最後の1つだけ残す
    document.querySelectorAll('#layers > *').forEach((layer) => {
      const seen = new Set();
      Array.from(layer.querySelectorAll('.xdt-mi')).reverse().forEach((el) => { const k = el.dataset.xdtXk || el.dataset.xdtAct; if (seen.has(k)) el.remove(); else seen.add(k); });
    });
    document.querySelectorAll('[data-testid="Dropdown"],[role="menu"]').forEach((menu) => {
      const layer = menu.closest('#layers > *') || menu;
      if (layer.querySelector('.xdt-mi') || menu.closest('.xdt-mi')) return;
      const its = Array.from(menu.querySelectorAll('[role="menuitem"]')).filter((x) => !x.closest('.xdt-mi'));
      if (!its.length) return;
      const txt = its.map((x) => x.textContent || '').join('|');
      // プロフィール(ユーザー)の「…」メニューを最優先で判定する。
      // ポスト用の項目を含まず、プロフィール固有の項目(このアカウントについて/リスト/プロフィールのリンク/@○○さんを報告 等)を含むもの。
      const isPostMenu = /ポストを報告|Report post|ポストのアクティビティ|Post activity|興味がない|Not interested|埋め込む|Embed post|アナリティクスを表示|View post analytics|このポスト|ピン留め|Pin to|固定表示|返信できるアカウント|Who can reply/i.test(txt);
      const isProfileMenu = !isPostMenu && /@[A-Za-z0-9_]{1,15}/.test(txt)
        && /このアカウントについて|About this account|リストから追加|リストを表示|プロフィールのリンクをコピー|Copy link to profile|さんを報告|さんをブロック|Block @|リポストをオフ|Turn off Reposts/i.test(txt);
      if (isProfileMenu) {
        // プロフィールの「…」にだけ、お気に入りの追加/削除を足す(ポスト用の検索チェック等は入れない)
        if (S.favMenuBtn && XDT.isFav) {
          const hm = txt.match(/@([A-Za-z0-9_]{1,15})/);
          if (hm) {
            const handle = hm[1].toLowerCase(), fav = XDT.isFav(handle), unit = menuUnit(its);
            const el = mkMenuItem(unit, fav ? '★' : '☆', fav ? 'お気に入りから削除' : 'お気に入りに追加', 'favtoggle', { handle });
            // 位置がずれないよう、常にメニューの先頭に固定で入れる
            const parent = unit.parentElement;
            if (parent) parent.insertBefore(el, parent.firstElementChild); else unit.before(el);
          }
        }
        return;
      }
      const kind = /設定とプライバシー|Settings and privacy/i.test(txt) ? 'more'
        : /リンクをコピー|Copy link/i.test(txt) ? 'share'
        : /ポストを報告|Report post|埋め込む|Embed post|コミュニティノート|アクティビティ|アナリティクス|Post activity/i.test(txt) ? 'caret' : '';
      if (!kind) return;
      if (kind === 'more') return; // 「もっと見る」は別処理(processMoreMenu)
      const unit = menuUnit(its), fresh = lastArt && Date.now() - lastArt.t < 20000;
      let before = false;
      const adds = [];
      if (kind === 'more') { if (S.muteKeyword) adds.push(['🔇', 'ミュートするキーワードを追加', 'mute', {}]); before = true; }
      else if (fresh) {
        const rec = tweets.get(lastArt.id), mine = rec && rec.authorId === XDT.myId() ? '1' : '0', d = { id: lastArt.id, author: lastArt.author, mine };
        if (kind === 'caret') {
          if (S.reactPlace === 'menu') adds.push(['💬', 'ポストへの反応', 'react', d]);
          if (S.erPlace === 'menu') { const e = erInfo(rec); adds.push(['📊', 'エンゲージメント率' + (e ? ' ' + e.er.toFixed(2) + '%' : ' —'), 'er', d]); }
          if (S.dlPlace === 'menu') adds.push(['📥', 'メディアを保存する', 'mdl', d]);
        } else if (kind === 'share' && S.shareCheck) adds.push(['🔎', 'ポストの検索チェック', 'scheck', d]);
      }
      let last = unit;
      adds.forEach(([emoji, text, act, d]) => {
        const el = mkMenuItem(unit, emoji, text, act, d);
        if (before) unit.before(el); else { last.after(el); last = el; }
      });
      // 削除しないようにロック: 自分のポストの「削除」の下にトグルを追加。ロック時は「削除」を隠す。
      if (S.delProtect && kind === 'caret' && fresh && lastArt && lastArt.id) {
        const id = lastArt.id, author = lastArt.author || '';
        const art = lastArt.article;
        const text = (art && (art.querySelector('[data-testid="tweetText"]') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const url = author ? `/${author}/status/${id}` : `/i/status/${id}`;
        const delItem = its.find((x) => /^(削除|ポストを削除|Delete|Delete post)$/i.test((x.textContent || '').trim()));
        if (delItem) {
          const locked = XDT.isDelLocked && XDT.isDelLocked(id);
          const delRow = rowUnit(delItem);
          delRow.classList.toggle('xdt-gone', !!locked);
          let el = menu.querySelector('.xdt-mi[data-xdt-act="dellock"]');
          if (!el) { el = mkMenuItem(unit, locked ? '🔒' : '🔓', locked ? '削除ロックを解除' : '削除しないようにロック', 'dellock', { id, author, text, url }); delRow.after(el); }
          else setLockLabel(el, locked); // 状態に合わせてラベルを最新化
        }
      }
    });
  }
  // 削除ロック項目のラベル(アイコン・文言)を状態に合わせて更新する
  function setLockLabel(el, locked) {
    const i = el.querySelector('.xdt-mi-i'), t = el.querySelector('.xdt-mi-t');
    if (i) i.textContent = locked ? '🔒' : '🔓';
    if (t) t.textContent = locked ? '削除ロックを解除' : '削除しないようにロック';
  }
  // 枠(行)単位で扱うため、1つの子しか持たない入れ物をたどって「行」を求める
  const rowUnit = (el) => { let u = el; for (let i = 0; i < 6 && u.parentElement && u.parentElement.children.length === 1 && !u.parentElement.matches('#layers,[data-testid="sidebarColumn"],[data-testid="primaryColumn"],main,header,nav,body,#react-root'); i++) u = u.parentElement; return u; };
  // 「もっと見る」メニュー: role属性に頼らず、項目の文字から探す
  function findMoreMenu() {
    const root = document.getElementById('layers');
    if (!root) return null;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!/^(設定とプライバシー|Settings and privacy)$/i.test(n.data.trim())) continue;
      let u = n.parentElement;
      while (u && u.parentElement && u.parentElement.children.length < 3) u = u.parentElement;
      const box = u && u.parentElement;
      if (!box || box.children.length < 3 || box.children.length > 16) continue;
      if (!/広告|Ads|コミュニティ|Communities|スペース|Spaces|ビジネス|Business|リスト|Lists/i.test(box.textContent || '')) continue;
      return { box, unit: u };
    }
    return null;
  }
  // Under the Hood のリンク先
  const UTH_URL = '/i/jf/under_the_hood';
  const listsUrl = () => { const n = XDT.myName && XDT.myName(); return n ? '/' + n + '/lists' : '/home'; };
  // 公式の「リスト」アイコン(SVG)
  const LISTS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" width="26" height="26" style="fill:currentColor"><g><path d="M3 4.5C3 3.12 4.12 2 5.5 2h13C19.88 2 21 3.12 21 4.5v15c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 22 3 20.88 3 19.5v-15zM5.5 4c-.28 0-.5.22-.5.5v15c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-15c0-.28-.22-.5-.5-.5h-13zM16 10H8V8h8v2zm0 4H8v-2h8v2z"></path></g></svg>';
  // 組み込みの追加項目(キー・絵文字・ラベル・URL・有効条件)
  function builtinExtras() {
    return [
      ['lists', '📋', 'リスト', listsUrl(), !!S.extraLists],
      ['mute', '🔇', 'ミュートするキーワードを追加', '/settings/add_muted_keyword', !!S.muteKeyword],
      ['adv', '🔎', '高度な検索', '/search-advanced', !!S.advSearch],
      ['disp', '🖥', '表示', '/settings/display', !!S.moreDisplay],
      ['uth', '🛠', 'Under the Hood', UTH_URL, !!S.uthShow],
    ];
  }
  // 各項目の表示場所('more' / 'left')。extraPlaceMap[key] で個別指定。既定は 'more'。
  const extraPlaceOf = (key) => { const m = (S.extraPlaceMap && typeof S.extraPlaceMap === 'object') ? S.extraPlaceMap : {}; return m[key] === 'left' ? 'left' : 'more'; };
  // 並び順(extraOrder)・自作項目(extraCustom)・表示/非表示・表示場所 を反映した一覧 [{key,emoji,label,url,place}]
  function extraItemsAll() {
    const bmap = new Map(builtinExtras().map((b) => [b[0], b]));
    const custom = Array.isArray(S.extraCustom) ? S.extraCustom : [];
    const cmap = new Map(custom.map((c) => ['c:' + c.id, c]));
    const order = Array.isArray(S.extraOrder) ? S.extraOrder.slice() : [];
    [...bmap.keys(), ...cmap.keys()].forEach((k) => { if (order.indexOf(k) < 0) order.push(k); });
    const out = [];
    order.forEach((k) => {
      if (bmap.has(k)) { const [key, emoji, label, url, on] = bmap.get(k); if (on) out.push({ key, emoji, label, url, place: extraPlaceOf(key) }); }
      else if (cmap.has(k)) { const c = cmap.get(k); if (c && c.name && c.url && c.show !== false) out.push({ key: 'c:' + c.id, emoji: '🔗', label: c.name, url: c.url, place: extraPlaceOf('c:' + c.id) }); }
    });
    return out;
  }
  function processMoreMenu() {
    const hit = findMoreMenu();
    if (!hit) return;
    const { box, unit } = hit;
    const active = MENU_RULES.filter((r) => S[r[0]]);
    Array.from(box.children).forEach((row) => {
      if (row.classList.contains('xdt-mi')) return;
      const label = (row.textContent || '').trim();
      if (active.some((r) => r[1].test(label))) gone(row);
    });
    // リストは公式の「リスト」項目を使う。非表示設定 or 左サイドメニューに出す設定なら、もっと見る内の公式リストを隠す。
    const hideNativeList = !S.extraLists || extraPlaceOf('lists') === 'left';
    Array.from(box.children).forEach((row) => { if (!row.classList.contains('xdt-mi') && /^(リスト|Lists)$/.test((row.textContent || '').trim())) row.classList.toggle('xdt-gone', hideNativeList); });
    // もっと見るに出す追加項目。リストは公式項目を使うので自前では注入しない。
    const items = extraItemsAll().filter((i) => i.place === 'more' && i.key !== 'lists');
    const present = new Set(items.map((i) => i.key));
    box.querySelectorAll('.xdt-mi[data-xdt-xk]').forEach((el) => { if (!present.has(el.dataset.xdtXk)) el.remove(); });
    let ref = unit;
    items.slice().reverse().forEach((it) => {
      let el = box.querySelector(`.xdt-mi[data-xdt-xk="${CSS.escape(it.key)}"]`);
      if (!el) { el = mkMenuItem(unit, it.emoji, it.label, 'exnav', { url: it.url, xk: it.key }); }
      ref.parentElement ? ref.parentElement.insertBefore(el, ref) : ref.before(el);
      ref = el;
    });
  }
  // 追加項目を左サイドメニューの「プロフィール」の上に出す(place === 'left' の項目)
  function processLeftExtras() {
    const nav = document.querySelector('header[role="banner"] nav');
    if (!nav) return;
    const items = extraItemsAll().filter((i) => i.place === 'left');
    const present = new Set(items.map((i) => i.key));
    nav.querySelectorAll('.xdt-navx').forEach((n) => { if (!present.has(n.dataset.xdtXk)) n.remove(); });
    const prof = nav.querySelector('a[data-testid="AppTabBar_Profile_Link"]')
      || Array.from(nav.querySelectorAll('a[role="link"],a[href]')).find((a) => /^(プロフィール|Profile)$/.test(((a.getAttribute('aria-label') || a.textContent) || '').trim()));
    const profRow = prof ? navRow(prof, nav) : null;
    const ref = profRow;
    items.forEach((it) => {
      let a = nav.querySelector(`.xdt-navx[data-xdt-xk="${CSS.escape(it.key)}"]`);
      if (!a) {
        a = document.createElement('a');
        a.className = 'xdt-navx'; a.dataset.xdtXk = it.key; a.href = it.url; a.setAttribute('role', 'link');
        const icon = it.key === 'lists' ? LISTS_SVG : it.emoji;
        a.innerHTML = `<span class="xdt-navx-i">${icon}</span><span class="xdt-navx-t">${esc(it.label)}</span>`;
        a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); location.assign(a.getAttribute('href')); });
      } else { a.href = it.url; }
      if (ref && ref.parentElement) ref.parentElement.insertBefore(a, ref); else nav.appendChild(a);
    });
  }
  // 右サイドメニュー下部のフッター(利用規約・プライバシー・© X Corp. 等)を非表示にする
  function processHideFooter() {
    const col = document.querySelector('[data-testid="sidebarColumn"]');
    if (!col) return;
    col.querySelectorAll('nav').forEach((nav) => {
      const txt = nav.textContent || '';
      const isFooter = nav.querySelector('a[href="/tos"],a[href="/privacy"],a[href*="help.x.com"],a[href*="/settings/cookie"]')
        || /利用規約|プライバシー|アクセシビリティ|Cookie|© ?\d{4} X Corp|広告について/i.test(txt);
      if (isFooter) nav.classList.toggle('xdt-gone', !!S.hideFooter);
    });
  }
  const closeMenu = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));

  /* ---- ポップオーバー ---- */
  function showPop(rect, html, w) {
    document.querySelectorAll('.xdt-pop').forEach((n) => n.remove());
    const pop = document.createElement('div');
    pop.className = 'xdt-pop';
    pop.innerHTML = html;
    pop.style.width = (w || 230) + 'px';
    pop.style.left = Math.max(8, Math.min(rect.left, innerWidth - (w || 230) - 12)) + 'px';
    pop.style.top = Math.max(8, Math.min(rect.bottom + 4, innerHeight - 220)) + 'px';
    document.body.appendChild(pop);
  }
  function showReactPop(rect, author, id, mine) {
    const base = `/${author}/status/${id}`;
    showPop(rect, `<a href="${base}/retweets" target="_blank" rel="noopener">🔁 リポストしたユーザー</a><a href="${base}/quotes" target="_blank" rel="noopener">💬 引用したポスト</a>` +
      (mine ? `<a href="${base}/likes" target="_blank" rel="noopener">${S.starLike ? '⭐' : '❤️'} いいねしたユーザー</a>` : ''));
  }
  function bars(title, rows, note) {
    const max = Math.max.apply(null, rows.map((r) => r.pct).concat([1]));
    return `<div class="xdt-erp"><b>${esc(title)}</b>` + rows.map((r) => `<div class="r"><span>${esc(r.label)}</span><i><u style="width:${Math.max(2, (r.pct / max) * 100).toFixed(0)}%"></u></i><em>${esc(r.text)}</em></div>`).join('') + (note ? `<small>${esc(note)}</small>` : '') + '</div>';
  }
  function showErPop(rect, rec) {
    const e = erInfo(rec);
    if (!e) return showPop(rect, '<div class="xdt-erp"><b>エンゲージメント率</b><small>インプレッションが取得できません</small></div>', 280);
    const nm = { like: S.starLike ? '⭐ いいね' : '❤️ いいね', repost: '🔁 リポスト', quote: '💬 引用', reply: '↩️ 返信', bookmark: '🔖 ブックマーク' };
    const rows = Object.keys(e.rates).map((k) => ({ label: nm[k], pct: (e.rates[k] / e.view) * 100, text: `${((e.rates[k] / e.view) * 100).toFixed(2)}% (${fmt(e.rates[k])})` }));
    showPop(rect, bars(`エンゲージメント率 ${e.er.toFixed(2)}%`, rows, `インプレッション ${fmt(e.view)} 件あたり。公開カウントからの参考指標で、Xの実スコアは非公開です。`), 300);
  }

  /* ============================ アカウント関連 ============================ */
  function acctMetrics(name) {
    const u = users.get(name.toLowerCase());
    if (!u) return null;
    const ratio = u.followers != null && u.following_count != null ? u.followers / Math.max(1, u.following_count) : null;
    // 表示中のタブ(ルート)で読み込まれたポストを使う。まだ無ければ、これまでに読み込んだすべてのポスト
    let mine = [];
    const rids = XDT.routeIds && XDT.routeIds();
    if (rids) rids.forEach((id) => { const t = tweets.get(id); if (t && t.authorId === u.id && !t.rt) mine.push(t); });
    if (!mine.length) for (const t of tweets.values()) if (t.authorId === u.id && !t.rt) mine.push(t);
    mine.sort((x, y) => (BigInt(y.id) > BigInt(x.id) ? 1 : -1));
    const ers = [];
    mine.slice(0, 10).forEach((t) => { if (t.counts.view >= 100) { const e = erInfo(t); if (e) ers.push(e.er); } });
    const avg = ers.length ? ers.reduce((s2, x) => s2 + x, 0) / ers.length : null;
    // センシティブ率は公開コードと同じく、リポストも含めた最新5件で数える(リポストは元ポストの状態)
    const withRt = [];
    if (rids) rids.forEach((id) => { const t = tweets.get(id); if (t && t.authorId === u.id && (!t.rt || t.rtOf)) withRt.push(t); });
    const rs = u.id ? XDT.recentSens(u.id, withRt.length ? withRt : undefined) : { n: 0, k: 0, ids: [] };
    const flags = XDT.accountFlags(u);
    const rp = ratio == null ? 0 : Math.min(100, Math.log10(ratio + 1) * 50), ep = avg == null ? 0 : Math.min(100, avg * 10);
    const sr = rs.n ? rs.k / rs.n : 0;
    const total = Math.round((rp * 0.4 + ep * 0.6) * (1 - 0.5 * sr) * (flags.length ? 0.6 : 1));
    return { ratio, avg, n: ers.length, rs, flags, rp, ep, sr, total };
  }
  function showAcctPop(rect, name) {
    const m = acctMetrics(name);
    if (!m) return showPop(rect, '<div class="xdt-erp"><b>アカウントスコア</b><small>データ未取得</small></div>', 280);
    let html = bars(`リーチ指標 ${m.total}/100`, [
      { label: 'フォロワー比', pct: m.rp, text: m.ratio == null ? '—' : m.ratio.toFixed(2) },
      { label: '平均ER', pct: m.ep, text: m.avg == null ? '—' : `${m.avg.toFixed(2)}% (${m.n}件)` },
      { label: 'センシティブ率', pct: m.sr * 100, text: m.rs.n ? `${m.rs.k}/${m.rs.n}件` : '—' },
      { label: '制限シグナル', pct: Math.min(100, m.flags.length * 40), text: `${m.flags.length}件` },
    ], '表示中のタブで読み込まれたポストの最新10件(センシティブ率は最新5件)から計算します。Xの公開コードの考え方(エンゲージメント予測の重み付き和、ラベルによる配信抑制、直近5件中3件のセンシティブでラベル化)を参考にした推定値で、実スコアは非公開です。');
    // どのポストでセンシティブを検出したか
    if (m.rs.ids && m.rs.ids.length) {
      html += `<div class="xdt-erp"><small>センシティブを検出したポスト(${m.rs.k}/${m.rs.n}件)</small>` +
        m.rs.ids.map((id) => `<a href="https://x.com/i/status/${id}" target="_blank" rel="noopener noreferrer">https://x.com/i/status/${id}</a>`).join('') + '</div>';
    }
    showPop(rect, html, 340);
  }

  function profSens(u) {
    if (!u || (!u.id && u.unavailable === undefined)) return ['unk', '不明', 'プロフィールデータ未取得'];
    if (u.unavailable) return ['bad', String(u.unavailable), 'アカウントが利用不可(凍結/停止など)'];
    const af = XDT.accountFlags(u);
    const r = af.slice();
    if (u.withheld && u.withheld.length) r.push('一部の国/地域で非表示: ' + u.withheld.join(','));
    if (u.possiblySensitive === true) return ['bad', 'あり', r.join(' / ')];
    if (r.length) return ['warn', '注意', r.join(' / ')];
    return ['ok', 'なし', 'センシティブフラグ・プロフィール警告なし'];
  }

  /* ---- From検索ボタン(Xのボタンは複製せず、隣のボタンの実寸・書体に合わせた自前の部品) ---- */
  function ensureFromButton(name) {
    let btn = document.querySelector('.xdt-from');
    if (!S.fromButton) { if (btn) btn.remove(); return; }
    const pc = document.querySelector('[data-testid="primaryColumn"]');
    if (!pc) return;
    const f = pc.querySelector('[data-testid="editProfileButton"],[data-testid$="-follow"],[data-testid$="-unfollow"]');
    const ua = pc.querySelector('[data-testid="userActions"]');
    const tmpl = ua || f;
    if (!tmpl) return;
    // ボタンが実際に並んでいる「横並び(flex row)・高さ64px以下」の最も近い祖先を行(host)とする
    let host = null;
    for (let p = tmpl.parentElement, i = 0; p && p !== pc && i < 8; p = p.parentElement, i++) {
      const cs = getComputedStyle(p);
      if (cs.display.indexOf('flex') !== -1 && cs.flexDirection.indexOf('row') === 0 && p.getBoundingClientRect().height <= 64) { host = p; break; }
    }
    if (!host) return;
    let unit = tmpl;
    while (unit.parentElement && unit.parentElement !== host) unit = unit.parentElement;
    if (unit.parentElement !== host) return;
    const href = `${location.origin}/search?q=from%3A%40${encodeURIComponent(name)}`;
    if (btn && btn.dataset.xdtName !== name) { btn.remove(); btn = null; }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xdt-from';
      btn.dataset.xdtName = name; btn.dataset.xdtHref = href;
      btn.innerHTML = '<span>🔍</span><span>From検索</span>';
      btn.title = `@${name} のポストをFrom検索`;
      btn.setAttribute('aria-label', `@${name} をFrom検索`);
    }
    const ref = ua || f || tmpl, fref = f || ref;
    const h = Math.round(ref.getBoundingClientRect().height) || 36;
    const tn = textNodes(fref).find((n) => n.data.trim());
    const cs = getComputedStyle((tn && tn.parentElement) || fref);
    const css = `${h}|${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}`;
    if (btn.dataset.xdtCss !== css) {
      btn.dataset.xdtCss = css;
      btn.style.height = h + 'px';
      btn.style.fontFamily = cs.fontFamily; btn.style.fontSize = cs.fontSize; btn.style.fontWeight = cs.fontWeight;
    }
    if (btn.parentElement !== host || btn.nextSibling !== unit) host.insertBefore(btn, unit);
  }

  const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
  const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
  function nameText(un) {
    const holder = un.querySelector('div[dir="ltr"],div[dir="auto"]') || un;
    let out = '';
    (function rec(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.data;
        else if (c.nodeType === 1 && !c.classList.contains('xdt-copy') && c.tagName !== 'svg') { if (c.tagName === 'IMG') out += c.alt || ''; else rec(c); }
      }
    })(holder);
    return out.trim();
  }
  function processCopyButtons(name) {
    const un = document.querySelector('[data-testid="primaryColumn"] [data-testid="UserName"]');
    if (!un) return;
    const mk = (kind, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'xdt-copy'; b.dataset.kind = kind; b.title = title; b.innerHTML = COPY_SVG; return b; };
    if (S.copyName) {
      const holder = un.querySelector('div[dir="ltr"],div[dir="auto"]');
      if (holder && !holder.querySelector('.xdt-copy[data-kind="name"]')) holder.appendChild(mk('name', 'ユーザー名(表示名)をコピー'));
    } else un.querySelectorAll('.xdt-copy[data-kind="name"]').forEach((b) => b.remove());
    if (S.copyScreen) {
      const h = Array.from(un.querySelectorAll('span,div')).find((e) => e.children.length === 0 && (e.textContent || '').trim() === '@' + name);
      if (h && !h.parentElement.querySelector('.xdt-copy[data-kind="screen"]')) h.after(mk('screen', 'スクリーンネーム(@なし)をコピー'));
    } else un.querySelectorAll('.xdt-copy[data-kind="screen"]').forEach((b) => b.remove());
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }

  function processPostCount(lower) {
    if (!S.numDetail) return;
    const u = users.get(lower);
    if (!u || typeof u.statuses !== 'number') return;
    document.querySelectorAll('[data-testid="primaryColumn"] [dir="ltr"]').forEach((el) => {
      if (el.children.length > 2) return;
      if (/^[\d.,]+\s*(万|億|千|[KMB])?\s*(件のポスト|ポスト|posts?)$/i.test((el.textContent || '').trim())) applyNumber(el, [u.statuses]);
    });
  }

  function processProfile() {
    const name = profileName();
    if (!name) {
      // 投稿画面などのオーバーレイ中は、背後のプロフィール表示を消さない
      if (/^\/(compose|i)\b/.test(location.pathname)) return false;
      // タブ切り替え中の一瞬の描き換えで消さない(1.5秒以上プロフィールでなければ片付ける)
      if (!profLostAt) profLostAt = Date.now();
      if (Date.now() - profLostAt > 1500) document.querySelectorAll('.xdt-from,.xdt-ppanel').forEach((n) => n.remove());
      return false;
    }
    profLostAt = 0;
    const lower = name.toLowerCase();
    if (!users.get(lower) || !users.get(lower).id) XDT.ensureUser(name);
    document.querySelectorAll('.xdt-from').forEach((n) => n.remove());
    processPostCount(lower);
    processCopyButtons(name);
    const u = users.get(lower);
    processRelIndicator(name, u);
    // 相互フォローのときはフォロー解除(フォロー中)ボタンを隠す
    const unf = document.querySelector('[data-testid="primaryColumn"] [data-testid$="-unfollow"]');
    if (unf) unf.classList.toggle('xdt-gone', !!(S.hideUnfollowMutual && u && u.following === true && u.followedBy === true));
    if (S.autoProfileCheck && S.profShadow && !S.safeMode) XDT.runSearchBan(name, false);
    // 統計は手動で追加したアカウントのみ記録(プロフィールの表示設定ER一覧/増減には依存しない)。
    if (u && XDT.isListed && XDT.isListed(name.toLowerCase())) {
      XDT.trackFollowers(name, u);
      const mm = acctMetrics(name); if (mm && mm.avg != null) XDT.trackEr(name, mm.avg);
    }
    let panel = document.querySelector('.xdt-ppanel');
    if (!(S.profSensitive || S.profShadow || S.acctScore || S.fromButton || S.mediaMergeTabs || S.erList || S.followerTrack)) { if (panel) panel.remove(); return true; }
    const hook = document.querySelector('[data-testid="UserProfileHeader_Items"]') || (document.querySelector('[data-testid="primaryColumn"] [data-testid="UserName"]') || {}).parentElement;
    if (!hook || !hook.parentElement) return true;
    const op = S.onlyProblem, ps = results.get('ps:' + lower), pg = results.get('pg:' + lower);
    const r1 = [], r2 = [];
    if (S.profSensitive) { const [st, v, t] = profSens(u); if (!op || bad(st)) r1.push(chip('xdt-w1', 'センシティブ', st, v, t)); }
    if (S.profShadow) { const [st, v, t] = shadowOverall(u, ps, pg); if (!op || bad(st)) r1.push(chip('xdt-w2', 'シャドウバン', st, v, t)); if (XDT.recordShadow && (st === 'bad' || st === 'ok')) XDT.recordShadow(name, st === 'bad'); }
    // 並び順: スコア → ER一覧 → 増減 → From検索 → メディア
    if (S.acctScore) { const m = acctMetrics(name); r2.push(chip('xdt-w6', 'スコア', 'info', m && m.total != null ? String(m.total) : '—', m && m.total == null ? '「ポスト」タブを開くと計算されます' : 'クリックでアカウントのリーチ指標グラフを表示', 'ascore', { name })); }
    if (S.erList) r2.push(chip('xdt-w7', '', 'info', '📈 ER一覧', '読み込み済みポストのエンゲージメント率の一覧とCSV書き出し', 'erlist', { name }));
    if (S.followerTrack) { const h = XDT.folHist()[lower]; r2.push(chip('xdt-w7', '', 'info', '📉 増減', h && h.length > 1 ? 'フォロワーの増減を表示' : 'この端末での記録を表示(ひらくたびに記録)', 'folhist', { name })); }
    if (S.fromButton) r2.push(chip('xdt-w8', '', 'info', '🔍 From検索', `@${name} のポストをFrom検索(新しいタブ)`, 'fromq', { name }));
    if (S.mediaMergeTabs) r2.push(chip('xdt-w7', '', 'info', '🖼 メディア', '画像と動画を一緒に一覧表示します', 'mview', { name }));
    const html = (r1.length ? `<div class="xdt-row">${r1.join('')}</div>` : '') + (r2.length ? `<div class="xdt-row">${r2.join('')}</div>` : '');
    if (!html) { if (panel) panel.remove(); return true; }
    if (!panel) { panel = document.createElement('div'); panel.className = 'xdt-ppanel'; }
    if (panel.previousSibling !== hook || panel.parentElement !== hook.parentElement) hook.parentElement.insertBefore(panel, hook.nextSibling);
    if (panel.dataset.sig !== html) { panel.dataset.sig = html; panel.innerHTML = html; }
    return true;
  }

  /* ============================ 自動操作(1回のみ) ============================ */
  let ffDone = false;
  const sortDone = new Map();
  const IMG_LABEL = /^(画像|写真|フォト|イメージ|Photos?|Images?|Pictures?)$/i;
  function realClick(el) {
    const o = { bubbles: true, cancelable: true, view: window, button: 0 };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(new (t.indexOf('pointer') === 0 && window.PointerEvent ? PointerEvent : MouseEvent)(t, o)));
  }
  // トリガーを押してメニューを開き、文言が合う項目を選ぶ(操作中はメニューを見えなくする)
  async function menuPick(btn, want) {
    document.documentElement.dataset.xdtBusy = '1';
    try {
      realClick(btn);
      let it = null;
      for (let i = 0; i < 25 && !it; i++) {
        await sleep(60);
        it = Array.from(document.querySelectorAll('[role="menuitem"],[role="option"]')).find((x) => !x.closest('.xdt-mi') && want.test((x.textContent || '').trim()));
      }
      if (!it) { closeMenu(); return false; }
      realClick(it);
      return true;
    } finally { setTimeout(() => (document.documentElement.dataset.xdtBusy = '0'), 500); }
  }
  // ワンクリックブロック: 通常のブロック操作で出る確認ダイアログ(「ブロック」ボタン)を自動で押して、確認なしで即ブロックする。
  // どの導線(プロフィール / ポストの…メニュー / ユーザー一覧 等)でも、確認ダイアログは同じ確認シートを使うため共通で反映される。
  let autoBlkT = 0;
  function processAutoBlock() {
    if (!S.oneClickBlock) return;
    const cf = document.querySelector('[data-testid="confirmationSheetConfirm"]');
    if (!cf) return;
    const t = (cf.textContent || '').trim();
    // 確認ボタンが「ブロック」のときだけ自動実行(ブロック解除・削除・フォロー解除などは対象外)
    if (!/^(ブロック|Block)$/i.test(t)) return;
    if (Date.now() - autoBlkT < 800) return;
    autoBlkT = Date.now();
    realClick(cf);
  }
  let fsDone = false, fsTries = 0, fsT = 0, mfDone = null, mfTries = 0, mfT = 0;
  function processTasks() {
    // フォロー中フィードを強制
    if (location.pathname !== '/home') ffDone = false;
    else if (S.forceFollowing && !ffDone) {
      const f = Array.from(document.querySelectorAll('[data-testid="primaryColumn"] [role="tablist"] [role="tab"]')).find((t) => /^(フォロー中|Following)$/.test((t.textContent || '').trim()));
      if (f) { ffDone = true; if (f.getAttribute('aria-selected') !== 'true') f.click(); }
    }
    // ホームの「フォロー中」の並び順(人気/最新)
    if (location.pathname !== '/home') { fsDone = false; fsTries = 0; }
    else if (S.followSort !== 'off' && !fsDone && fsTries < 8 && Date.now() - fsT > 800) {
      const sel = document.querySelector('[data-testid="primaryColumn"] [role="tab"][aria-selected="true"]');
      if (sel && /^(フォロー中|Following)$/.test((sel.textContent || '').trim())) {
        fsT = Date.now(); fsTries++;
        const btn = Array.from(document.querySelectorAll('[data-testid="primaryColumn"] [aria-haspopup="menu"],[data-testid="primaryColumn"] [role="button"],[data-testid="primaryColumn"] button')).find((b) => /^(人気|最新|Popular|Latest|Recent)$/i.test((b.textContent || '').trim()) && !b.closest('article'));
        if (btn) {
          const want = S.followSort === 'popular' ? /^(人気|Popular)$/i : /^(最新|Latest|Recent)$/i;
          fsDone = true;
          if (!want.test((btn.textContent || '').trim())) menuPick(btn, want);
        }
      }
    }
    // プロフィールのメディアを開いた「初回だけ」画像(filter=photo)にする。
    // 以降は手動でのフィルタ変更(動画/すべて等)を尊重し、二度と自動切り替えしない。
    // メディアから離れて再度開いたときは、その訪問の初回として再適用する。
    {
      const onMedia = /\/media\/?$/.test(location.pathname);
      const base = location.pathname.replace(/\/+$/, ''); // クエリは含めない(手動変更で再発火しないように)
      if (!onMedia) { mfDone = null; mfTries = 0; }
      else if (!S.mediaImageFirst) { /* 無効 */ }
      else if (mfDone === base) { /* この訪問では適用済み → 手動操作を尊重して何もしない */ }
      else if (/[?&]filter=(photo|image|images|media)\b/i.test(location.search)) {
        mfDone = base; mfTries = 0; // 既に画像(直リンク等) → 済みとして記録
      } else if (mfTries < 12 && Date.now() - mfT > 600) {
        mfT = Date.now(); mfTries++;
        const FILTER_LABEL = /^(すべて(のメディア)?|動画|画像|写真|メディア|GIFs?|Videos?|Photos?|Images?|All|Media)$/i;
        // 1) フィルタのドロップダウン(現在値=すべて/動画 等)を探してメニューから「画像」を選ぶ
        const trig = Array.from(document.querySelectorAll('[data-testid="primaryColumn"] [role="button"],[data-testid="primaryColumn"] button,[data-testid="primaryColumn"] [role="tab"]'))
          .find((b) => !b.closest('article') && FILTER_LABEL.test((b.textContent || '').trim()) && (b.getAttribute('aria-haspopup') === 'menu' || b.querySelector('svg')));
        if (trig && IMG_LABEL.test((trig.textContent || '').trim())) { mfDone = base; }
        else if (trig) { mfDone = base; menuPick(trig, IMG_LABEL).then((ok) => { if (!ok) mfDone = null; }); }
        else {
          // 2) フォールバック: 文言がちょうど「画像/写真」の要素(タブ/ボタン/リンク/メニュー項目)を直接クリック
          const direct = Array.from(document.querySelectorAll('[data-testid="primaryColumn"] [role="tab"],[data-testid="primaryColumn"] [role="menuitem"],[data-testid="primaryColumn"] [role="option"],[data-testid="primaryColumn"] a[role="link"],[data-testid="primaryColumn"] [role="button"]'))
            .find((b) => !b.closest('article') && IMG_LABEL.test((b.textContent || '').trim()));
          if (direct) { mfDone = base; realClick(direct); }
        }
      }
    }
    // 返信のデフォルト並び替え
    const sm = location.pathname.match(/\/status\/(\d+)/);
    if (sm && S.replySort !== 'off') {
      const st = sortDone.get(sm[1]) || { tries: 0, ok: false, t: 0 };
      if (!st.ok && st.tries < 6 && Date.now() - st.t > 700) {
        st.t = Date.now(); st.tries++; sortDone.set(sm[1], st);
        const btn = Array.from(document.querySelectorAll('[data-testid="primaryColumn"] [role="button"][aria-haspopup="menu"], [data-testid="primaryColumn"] button[aria-haspopup="menu"]'))
          .find((b) => /関連性|最新|いいね|Relevan|Recent|Latest|Likes/i.test(b.textContent || ''));
        if (btn) {
          const want = { relevance: /関連性|Relevan/i, recent: /最新|Recen|Latest/i, likes: /いいね|Likes/i }[S.replySort];
          if (want.test(btn.textContent || '')) st.ok = true;
          else {
            document.documentElement.dataset.xdtBusy = '1';
            btn.click();
            let n = 0;
            const iv = setInterval(() => {
              const it = Array.from(document.querySelectorAll('[role="menuitem"]')).find((x) => want.test(x.textContent || ''));
              if (it || ++n > 15) { clearInterval(iv); if (it) { it.click(); st.ok = true; } else closeMenu(); setTimeout(() => (document.documentElement.dataset.xdtBusy = '0'), 300); }
            }, 60);
          }
        }
      }
    }
  }

  /* ============================ 投稿画面の添付メディア判定 ============================ */
  // Xの判定モデル(NSFW_*系/Grok)は非公開。メディアポリシーの2区分(アダルト/過度な暴力)を画素から推定する。
  // 肌色領域の「割合」だけでなく、最大の塊の大きさ・塊の数・肌のなめらかさを使い、顔のアップ等の誤検知を抑える。
  const sensCache = new Map();
  const c01 = (x) => Math.max(0, Math.min(1, x));
  function scanPixels(d, N) {
    const n2 = N * N, mask = new Uint8Array(n2), smooth = new Uint8Array(n2), Y = new Float32Array(n2);
    for (let p = 0, i = 0; p < n2; p++, i += 4) Y[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let skin = 0, blood = 0, w = 0;
    for (let p = 0, i = 0; p < n2; p++, i += 4) {
      const x = p % N, y0 = (p / N) | 0, wt = x > N * 0.25 && x < N * 0.75 && y0 > N * 0.25 && y0 < N * 0.75 ? 1.6 : 1;
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      w += wt;
      if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && Y[p] > 50 && r > g && g > b * 0.9 && sat > 0.12 && sat < 0.7 && r - g > 8) { mask[p] = 1; skin += wt; }
      if (r > 100 && r > g * 2.4 && r > b * 2.2 && g < 80 && sat > 0.6) blood += wt;
      if (x < N - 1 && y0 < N - 1 && Math.abs(Y[p] - Y[p + 1]) + Math.abs(Y[p] - Y[p + N]) < 10) smooth[p] = 1;
    }
    const seen = new Uint8Array(n2), stack = [];
    let largest = 0, blobs = 0, cnt = 0, sm = 0;
    for (let p = 0; p < n2; p++) {
      if (mask[p]) { cnt++; if (smooth[p]) sm++; }
      if (!mask[p] || seen[p]) continue;
      let size = 0; stack.push(p); seen[p] = 1;
      while (stack.length) {
        const q = stack.pop(); size++;
        const x = q % N;
        if (x > 0 && mask[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack.push(q - 1); }
        if (x < N - 1 && mask[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack.push(q + 1); }
        if (q >= N && mask[q - N] && !seen[q - N]) { seen[q - N] = 1; stack.push(q - N); }
        if (q < n2 - N && mask[q + N] && !seen[q + N]) { seen[q + N] = 1; stack.push(q + N); }
      }
      if (size > largest) largest = size;
      if (size > n2 * 0.02) blobs++;
    }
    return { skin: skin / w, blood: blood / w, largest: largest / n2, blobs, smooth: cnt ? sm / cnt : 0 };
  }
  function scoreOf(f) {
    let a = 0.5 * c01((f.skin - 0.14) / 0.36) + 0.3 * c01((f.largest - 0.12) / 0.33) + 0.2 * c01((f.smooth - 0.35) / 0.45);
    if (f.skin < 0.32 && f.largest < 0.2 && f.blobs <= 2) a *= 0.5; // 顔のアップ等
    if (f.skin > 0.5 && f.largest > 0.3) a = Math.max(a, 0.85);
    return { adult: Math.round(c01(a) * 100), gore: Math.round(c01(f.blood / 0.1) * 100) };
  }
  function analyzeEl(el) {
    try {
      const N = 128, c = document.createElement('canvas');
      c.width = c.height = N;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(el, 0, 0, N, N);
      return scoreOf(scanPixels(g.getImageData(0, 0, N, N).data, N));
    } catch (e) { return null; }
  }
  function analyzeVideo(key, el) {
    sensCache.set(key, { pending: true });
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = el.currentSrc || el.src;
    v.addEventListener('error', () => sensCache.set(key, null), { once: true });
    v.addEventListener('loadedmetadata', async () => {
      const d = v.duration || 1, out = { adult: 0, gore: 0 };
      for (const f of [0.08, 0.25, 0.45, 0.65, 0.85, 0.97]) {
        await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(d - 0.05, d * f); setTimeout(res, 1500); });
        const r = analyzeEl(v);
        if (r) { out.adult = Math.max(out.adult, r.adult); out.gore = Math.max(out.gore, r.gore); }
      }
      sensCache.set(key, out);
      v.removeAttribute('src'); v.load();
      XDT.schedule();
    }, { once: true });
  }
  /* ---- 外部AIの判定(利用者が自分のAPIキーを登録したときだけ。画像は各社のサーバーへ送信されます) ---- */
  let apiKeys = {};
  chrome.storage.local.get('apiKeys', (v) => { apiKeys = (v && v.apiKeys) || {}; });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.apiKeys) { apiKeys = ch.apiKeys.newValue || {}; XDT.schedule(); } });
  const extCache = new Map(); // 「メディアのキー|提供元」→ {state: pending|done|err, adult, gore, err}
  function imgB64(el) {
    try {
      const w = el.naturalWidth || el.videoWidth, h = el.naturalHeight || el.videoHeight;
      if (!w || !h) return null;
      const k = Math.min(1, 1024 / Math.max(w, h)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    } catch (e) { return null; }
  }
  function videoMidB64(el) { // 動画は途中の1コマだけ
    return new Promise((res) => {
      let fin = false;
      const v = document.createElement('video');
      const done = (x) => { if (fin) return; fin = true; v.removeAttribute('src'); v.load(); res(x); };
      v.muted = true; v.preload = 'auto'; v.src = el.currentSrc || el.src;
      v.addEventListener('error', () => done(null), { once: true });
      v.addEventListener('loadedmetadata', () => { const d = v.duration || 1; v.onseeked = () => done(imgB64(v)); v.currentTime = Math.min(Math.max(0, d - 0.05), d * 0.4); setTimeout(() => done(null), 6000); }, { once: true });
    });
  }
  function askProvider(key, provider, m, isV) {
    const k = key + '|' + provider;
    if (extCache.has(k)) return;
    extCache.set(k, { state: 'pending' });
    Promise.resolve(isV ? videoMidB64(m) : imgB64(m)).then((b64) => {
      if (!b64) { extCache.set(k, { state: 'err', err: '画像を読み取れませんでした' }); XDT.schedule(); return; }
      chrome.runtime.sendMessage({ type: 'classify', provider, b64 }, (res) => {
        const le = chrome.runtime.lastError;
        extCache.set(k, res && res.ok ? { state: 'done', adult: res.adult, gore: res.gore } : { state: 'err', err: (res && res.error) || (le && le.message) || '判定に失敗しました' });
        XDT.schedule();
      });
    });
  }
  function processCompose() {
    const present = new Set();
    const PROV = [['x', 'X方針', 'compX', null], ['google', 'Google', 'compGoogle', 'google'], ['openai', 'OpenAI', 'compOpenAI', 'openai']];
    const lv = (p) => (p < 35 ? ['ok', '低'] : p < 65 ? ['warn', '中'] : ['bad', '高']);
    const TIPS = {
      x: 'Xのメディアポリシーの区分(アダルト/過度な暴力)に沿った簡易推定。肌色・血色の画素から端末内で計算し、画像は外部に送信しません。',
      google: 'Google Cloud Vision の SafeSearch(アダルト・きわどい・暴力の確からしさ)。画像をGoogleのサーバーへ送信して判定します。',
      openai: 'OpenAI Moderation(omni)の sexual / violence スコア。画像をOpenAIのサーバーへ送信して判定します。',
    };
    document.querySelectorAll('[data-testid="attachments"]').forEach((att) => {
      let box = att.nextElementSibling && att.nextElementSibling.classList.contains('xdt-compose') ? att.nextElementSibling : null;
      const anyOn = S.composeCheck && (S.compX || S.compGoogle || S.compOpenAI);
      if (!anyOn) { if (box) box.remove(); return; }
      const agg = {}; PROV.forEach((p) => { agg[p[0]] = { A: 0, G: 0, any: false, pend: false, err: '', nokey: false }; });
      let n = 0;
      att.querySelectorAll('img,video').forEach((m) => {
        const isV = m.tagName === 'VIDEO', src = m.currentSrc || m.src || '';
        if (!src || (!isV && (m.naturalWidth || 0) < 64)) return;
        const key = src + '|' + (isV ? 'v' : 'i');
        present.add(key); n++;
        if (S.compX) {
          if (!sensCache.has(key)) { if (isV) analyzeVideo(key, m); else sensCache.set(key, analyzeEl(m)); }
          const r = sensCache.get(key);
          if (r && r.pending) agg.x.pend = true;
          else if (r) { agg.x.A = Math.max(agg.x.A, r.adult); agg.x.G = Math.max(agg.x.G, r.gore); agg.x.any = true; }
        }
        PROV.slice(1).forEach(([id, , flag, kname]) => {
          if (!S[flag]) return;
          if (!apiKeys[kname]) { agg[id].nokey = true; return; }
          askProvider(key, id, m, isV);
          const e = extCache.get(key + '|' + id);
          if (!e || e.state === 'pending') agg[id].pend = true;
          else if (e.state === 'err') agg[id].err = e.err;
          else { agg[id].A = Math.max(agg[id].A, e.adult); agg[id].G = Math.max(agg[id].G, e.gore); agg[id].any = true; }
        });
      });
      if (!n) { if (box) box.remove(); return; }
      let html = '', hi = false;
      PROV.forEach(([id, label, flag]) => {
        if (!S[flag]) return;
        const g = agg[id];
        if (g.nokey && !g.any) html += chip('', label, 'unk', '鍵未設定', 'ポップアップの「ポスト・投稿」でAPIキーを登録してください。\n' + TIPS[id]);
        else if (g.any) { const L = lv(g.A); hi = hi || g.A >= 35 || g.G >= 35; html += chip('', label, L[0], `${g.A}%${g.G >= 20 ? ' 暴' + g.G + '%' : ''}`, `${label}: アダルト ${g.A}% (${L[1]}) / 暴力 ${g.G}%\n${TIPS[id]}`); }
        else if (g.err) html += chip('', label, 'bad', '✖', `${label}: ${g.err}`);
        else html += chip('', label, 'unk', '…', '測定中');
      });
      if (hi) html += chip('', '', 'info', '⚠ センシティブ設定オン推奨', 'アダルト・暴力的なメディアは、投稿の「センシティブな内容を含む」設定をオンにしてください。');
      if (!box) { box = document.createElement('div'); box.className = 'xdt-compose'; att.after(box); }
      if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
    });
    // 添付を消した後に結果が残らないよう、存在しない添付の結果と孤立した表示を片付ける
    for (const k of Array.from(sensCache.keys())) if (!present.has(k)) sensCache.delete(k);
    for (const k of Array.from(extCache.keys())) if (!present.has(k.slice(0, k.lastIndexOf('|')))) extCache.delete(k);
    document.querySelectorAll('.xdt-compose').forEach((b) => {
      const p = b.previousElementSibling;
      if (!(S.composeCheck && (S.compX || S.compGoogle || S.compOpenAI)) || !(p && p.matches('[data-testid="attachments"]') && p.querySelector('img,video'))) b.remove();
    });
  }

  /* ============================ 外観トグル ============================ */
  const ATTRS = { hideBadge: 'hidebadge', hideBoost: 'hideboost', hideText: 'hidetext', hideJoin: 'hidejoin', starLike: 'star', avatarSquare: 'square', unblur: 'unblur', notifPrivacy: 'notifpriv', hideImgEdit: 'imgedit' };
  // 投稿画面(/compose/post)や画像表示などは、いまのページの上に重なる表示。通知欄の上に出ても、通知欄として扱い続ける
  let basePath = location.pathname;
  const baseOf = () => { if (!/^\/(compose|i\/)|\/(photo|video)\/\d+\/?$/.test(location.pathname)) basePath = location.pathname; return basePath; };
  function processDataset() {
    const h = document.documentElement;
    for (const k in ATTRS) h.setAttribute('data-xdt-' + ATTRS[k], S[k] ? '1' : '0');
    h.setAttribute('data-xdt-bday', S.birthday);
    h.setAttribute('data-xdt-notif', /^\/notifications/.test(baseOf()) ? '1' : '0');
    h.setAttribute('data-xdt-theme', S.theme === 'dark' ? 'dark' : 'light');
    h.style.setProperty('--xdt-lockc', S.lockColor || '#ffd400');
  }
  function processBirthday() {
    if (S.birthday !== 'hideYear') return;
    document.querySelectorAll('[data-testid="UserBirthdate"]').forEach((el) => {
      for (const n of textNodes(el)) {
        const base = origOf(n);
        let out = base.replace(/\d{4}\s*年\s*/, '');
        if (out === base) out = base.replace(/,?\s*\b\d{4}\b/, '');
        if (out !== base) setNode(n, out);
      }
    });
  }
  function processFollowLinks() {
    if (!S.numDetail) return;
    document.querySelectorAll('a[href$="/following"],a[href$="/followers"],a[href$="/verified_followers"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/^\/([^/]+)\/(following|followers|verified_followers)$/);
      if (!m) return;
      const u = users.get(m[1].toLowerCase());
      if (!u) return;
      const v = m[2] === 'following' ? u.following_count : u.followers;
      if (typeof v === 'number') applyNumber(a, [v]);
    });
  }
  const METRICS = [
    ['reply', '[data-testid="reply"]'], ['repost', '[data-testid="retweet"],[data-testid="unretweet"],a[href$="/retweets"]'],
    ['quote', 'a[href$="/quotes"],a[href$="/retweets/with_comments"]'], ['like', '[data-testid="like"],[data-testid="unlike"],a[href$="/likes"]'],
    ['bookmark', '[data-testid="bookmark"],[data-testid="removeBookmark"]'], ['view', 'a[href$="/analytics"]'],
  ];
  function applyMetrics(a, rec) {
    const g = getGroup(a);
    const ar = parseAria(g ? g.getAttribute('aria-label') || '' : '');
    for (const [key, sel] of METRICS) {
      const cands = [rec && rec.counts && rec.counts[key], ar[key]].filter((v) => typeof v === 'number' && !isNaN(v));
      a.querySelectorAll(sel).forEach((el) => { if (el.closest('article') === a) applyNumber(el, cands); });
    }
  }
  function homeState() {
    if (location.pathname !== '/home') return null;
    const t = document.querySelector('[data-testid="primaryColumn"] [role="tablist"] [role="tab"][aria-selected="true"]');
    const txt = t ? (t.textContent || '').trim() : '';
    return !txt ? null : /おすすめ|For you/i.test(txt) ? 'foryou' : 'following';
  }

  /* ============================ クリック ============================ */
  // 削除ロック: ロック中ポストの「削除」クリックを確実に無効化(キャプチャ段階で止める)
  function delTarget(el) {
    const mi = el && el.closest && el.closest('[role="menuitem"],[data-testid="confirmationSheetConfirm"]');
    if (!mi) return null;
    const t = (mi.textContent || '').trim();
    if (/^(削除|ポストを削除|Delete|Delete post)$/i.test(t)) return 'menu';
    if (mi.getAttribute && mi.getAttribute('data-testid') === 'confirmationSheetConfirm' && /^(削除|Delete)$/i.test(t)) return 'confirm';
    return null;
  }
  document.addEventListener('click', (e) => {
    if (!S.delProtect) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (!delTarget(el)) return;
    const id = lastArt && lastArt.id;
    if (id && XDT.isDelLocked && XDT.isDelLocked(id)) {
      e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      closeMenu();
    }
  }, true);
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (!t.closest('.xdt-pop')) document.querySelectorAll('.xdt-pop').forEach((n) => n.remove());
    // 直近に触ったポストを記録(メニュー項目の対象になる)
    const art = t.closest('article'), ainfo = art && articleInfo(art);
    if (ainfo) lastArt = { id: ainfo.id, author: ainfo.author, article: art, t: Date.now() };
    XDT.schedule(); setTimeout(XDT.schedule, 250); setTimeout(XDT.schedule, 900);

    // 再生中の動画の操作(再生/一時停止・シークバー等)は、そのまま通す
    if (t.closest('.xdt-gi video')) return;
    const gi = t.closest('.xdt-gi');
    if (gi) {
      e.preventDefault(); e.stopPropagation();
      const art = gi.closest('article'), n = gi.dataset.n, info = art && articleInfo(art);
      const rec = info && tweets.get(info.id), m = rec && rec.media && rec.media[+n - 1];
      if (gi.dataset.t === 'video') {
        // 動画・GIFは、格子の中でそのまま再生する(最高画質のmp4)
        const vs = ((m && m.variants) || []).filter((v) => /mp4/.test(v.t || '')).sort((x, y) => (y.b || 0) - (x.b || 0));
        if (vs[0]) {
          if (!gi.querySelector('video')) {
            const gif = m.type === 'animated_gif', v = document.createElement('video');
            v.src = vs[0].u; v.controls = !gif; v.autoplay = true; v.loop = gif; v.muted = gif; v.playsInline = true; v.preload = 'auto';
            const im = gi.querySelector('img');
            if (im) v.poster = im.src;
            // ポスト全体のクリック(ポストを開く)に伝わらないよう、動画の内側で止める
            gi.addEventListener('click', (ev) => { if (ev.target.closest('video')) ev.stopPropagation(); });
            gi.appendChild(v);
            gi.classList.add('xdt-playing');
            const pr = v.play();
            if (pr && pr.catch) pr.catch(() => { v.muted = true; v.play().catch(() => {}); });
          }
          return;
        }
      }
      const l = art && art.querySelector(`.xdt-mroot a[href*="/photo/${n}"],.xdt-mroot a[href*="/video/${n}"]`);
      if (l) l.click();
      else if (info) window.open(`/${info.author}/status/${info.id}`, '_blank', 'noopener');
      return;
    }
    const sn = t.closest('.xdt-sn');
    if (sn) {
      e.preventDefault(); e.stopPropagation();
      const root = sn.closest('[role="dialog"],[aria-modal="true"],[data-testid="primaryColumn"]') || document;
      snEditor = root.querySelector('[data-testid^="tweetTextarea_"] [contenteditable="true"]') || root.querySelector('[contenteditable="true"][role="textbox"]') || root.querySelector('[contenteditable="true"]');
      openSnipPop(sn.getBoundingClientRect());
      return;
    }
    const fr = t.closest('.xdt-from');
    if (fr) { e.preventDefault(); e.stopPropagation(); window.open(fr.dataset.xdtHref, '_blank', 'noopener'); return; }
    const mi = t.closest('.xdt-mi');
    if (mi) {
      e.preventDefault(); e.stopPropagation();
      const rect = mi.getBoundingClientRect(), d = mi.dataset, act = d.xdtAct;
      // 削除ロックはメニューを開いたまま、その場でラベルと削除の表示を即時切り替える
      if (act === 'dellock') {
        if (XDT.toggleDelLock) XDT.toggleDelLock(d.xdtId, { author: d.xdtAuthor || '', text: d.xdtText || '', url: d.xdtUrl || '' });
        const locked = XDT.isDelLocked && XDT.isDelLocked(d.xdtId);
        setLockLabel(mi, locked);
        const menu = mi.closest('[role="menu"],[data-testid="Dropdown"]');
        const delItem = menu && Array.from(menu.querySelectorAll('[role="menuitem"]')).find((x) => /^(削除|ポストを削除|Delete|Delete post)$/i.test((x.textContent || '').trim()));
        if (delItem) rowUnit(delItem).classList.toggle('xdt-gone', !!locked);
        XDT.schedule && XDT.schedule();
        return;
      }
      closeMenu();
      if (act === 'mdl') doDownload(d.xdtId, d.xdtAuthor, lastArt && lastArt.article);
      else if (act === 'react') showReactPop(rect, d.xdtAuthor, d.xdtId, d.xdtMine === '1');
      else if (act === 'er') showErPop(rect, tweets.get(d.xdtId));
      else if (act === 'scheck') {
        const r = results.get('t:' + d.xdtId);
        window.open((r && r.url) || `${location.origin}/search?q=${encodeURIComponent(XDT.tweetSearchQuery(d.xdtId, d.xdtAuthor))}&src=typed_query&f=live`, '_blank', 'noopener');
      } else if (act === 'favtoggle') { if (XDT.toggleFav) XDT.toggleFav(d.xdtHandle); }
      else if (act === 'exnav') { if (d.xdtUrl && !/^\s*javascript:/i.test(d.xdtUrl)) location.assign(d.xdtUrl); }
      return;
    }
    const cp = t.closest('.xdt-copy');
    if (cp) {
      e.preventDefault(); e.stopPropagation();
      const un = cp.closest('[data-testid="UserName"]');
      let text = '';
      if (cp.dataset.kind === 'screen') text = (profileName() || '');
      else if (un) text = nameText(un);
      const ok = text && (await copyText(text));
      cp.innerHTML = ok ? CHECK_SVG : COPY_SVG;
      cp.classList.toggle('xdt-copied', !!ok);
      setTimeout(() => { cp.innerHTML = COPY_SVG; cp.classList.remove('xdt-copied'); }, 1200);
      return;
    }
    if (!t.closest('.xdt-tbadges,.xdt-ppanel,.xdt-pop,.xdt-compose,.xdt-bm')) return;
    e.stopPropagation();
    const b = t.closest('.xdt-act');
    if (!b) return;
    e.preventDefault();
    const d = b.dataset;
    switch (d.act) {
      case 'tsb': {
        const r = results.get('t:' + d.id);
        if (!r) XDT.runTweetSearch(d.id, d.author, true);
        window.open((r && r.url) || `${location.origin}/search?q=${encodeURIComponent(XDT.tweetSearchQuery(d.id, d.author))}&src=typed_query&f=live`, '_blank', 'noopener');
        break;
      }
      case 'mdl': doDownload(d.id, d.author, b.closest('article')); break;
      case 'react': showReactPop(b.getBoundingClientRect(), d.author, d.id, d.mine === '1'); break;
      case 'er': showErPop(b.getBoundingClientRect(), tweets.get(d.id)); break;
      case 'ascore': showAcctPop(b.getBoundingClientRect(), d.name); break;
      case 'mview': openMediaView(d.name); break;
      case 'fromq': window.open(`${location.origin}/search?q=${encodeURIComponent('from:@' + d.name)}&src=typed_query&f=live`, '_blank', 'noopener'); break;
      case 'erlist': showErList(b.getBoundingClientRect(), d.name); break;
      case 'ercsv': erCsv(d.name); break;
      case 'folhist': showFolPop(b.getBoundingClientRect(), d.name); break;
      case 'notint': { const art = b.closest('article'); b.classList.add('xdt-busy'); try { await clickNotInterested(art); } finally { b.classList.remove('xdt-busy'); } break; }
      case 'snins': { const txt = (S.snippets || [])[+d.i]; if (txt != null) insertSnippet(txt); break; } // 返信相手名と同様、ポップは閉じない
      case 'sndel': { const a = (S.snippets || []).slice(); a.splice(+d.i, 1); chrome.storage.sync.set({ snippets: a }); S.snippets = a; refreshSnipPop(); break; }
      case 'snadd': {
        const inp = b.parentElement.querySelector('.xdt-snnew'), v = inp && inp.value.trim();
        if (v) { const a = (S.snippets || []).concat([v]); if (JSON.stringify(a).length < 7500) { chrome.storage.sync.set({ snippets: a }); S.snippets = a; } inp.value = ''; refreshSnipPop(); }
        break;
      }
      case 'snreply': { const h = replyNames(); if (h.length) insertText(snEditorEl(), h.join(' ') + ' ', true); break; } // 定型文の追加/削除と同様、ポップは閉じない
      case 'draftview': { popMode = 'draft'; refreshSnipPop(); break; }
      case 'snipview': { popMode = 'snip'; refreshSnipPop(); break; }
      case 'draftins': { const ds = XDT.drafts ? XDT.drafts() : []; const dr = ds.find((x) => x.id === d.id); if (dr) insertSnippet(dr.text); break; } // ポップは閉じない
      case 'draftdel': { if (XDT.delDraft) XDT.delDraft(d.id); refreshSnipPop(); break; }
      case 'draftsave': { const ed = snEditorEl(); const t = ed ? (ed.textContent || '') : ''; if (t.trim() && XDT.saveDraft) XDT.saveDraft(t); refreshSnipPop(); break; }
    }
  }, true);

  /* ============================ 通知・DMのぼかし ============================ */
  // CSSの:hoverは、スクロール中に前の位置の行が解除されたまま残ることがあるため、実際にマウスが動いた行にだけクラスを付ける
  let hovEl = null, hovSig = '', lastMX = -1, lastMY = -1;
  const HOV = '[data-testid="cellInnerDiv"]';
  const clearHov = () => { if (hovEl) { hovEl.classList.remove('xdt-hov'); hovEl = null; } };
  // その行の中身(時刻・リンク)の目印。読み込みで同じ要素に別の通知が入ったら、解除されたまま残らないよう判別に使う
  const sigOf = (c) => { const t = c.querySelector('time'), l = c.querySelector('a[href^="/"]'); return (t ? t.getAttribute('datetime') : '') + '|' + (l ? l.getAttribute('href') : ''); };
  document.addEventListener('mousemove', (e) => {
    lastMX = e.clientX; lastMY = e.clientY;
    const c = e.target && e.target.closest ? e.target.closest(HOV) : null;
    if (c === hovEl) return;
    clearHov();
    if (c) { c.classList.add('xdt-hov'); hovEl = c; hovSig = sigOf(c); }
  }, true);
  window.addEventListener('scroll', clearHov, true);
  document.addEventListener('wheel', clearHov, { capture: true, passive: true });
  document.addEventListener('mouseleave', clearHov);
  function checkHov() {
    if (!hovEl) return;
    if (!hovEl.isConnected || sigOf(hovEl) !== hovSig) { clearHov(); return; }
    const e = document.elementFromPoint(lastMX, lastMY);
    if (!e || !hovEl.contains(e)) clearHov();
  }

  // 通知: アイコン(CSS)に加えて、名前を含む1行の文(プロフィールへのリンクの親)も確実にぼかす
  function processNotifPrivacy() {
    if (!S.notifPrivacy || !/^\/notifications/.test(baseOf())) return;
    document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]').forEach((cell) => {
      // リプライ等のポスト表示の名前・アイコン(名前が長くて省略されている場合も)
      cell.querySelectorAll('[data-testid="User-Name"],[data-testid^="UserAvatar-Container"]').forEach((e) => { if (!e.classList.contains('xdt-np')) e.classList.add('xdt-np'); });
      cell.querySelectorAll('a[href^="/"]').forEach((a) => {
        if (!/^\/[A-Za-z0-9_]{1,15}\/?$/.test(a.getAttribute('href') || '') || a.closest('[data-testid="tweetText"],time,[role="group"]')) return;
        if (!a.classList.contains('xdt-np')) a.classList.add('xdt-np');
        const p = a.parentElement;
        if (p && p !== cell && !p.querySelector('[data-testid="tweetText"],time,[role="group"],[data-testid^="card"],[data-testid^="UserAvatar"],img') && (p.textContent || '').length <= 120 && !p.classList.contains('xdt-np')) p.classList.add('xdt-np');
      });
    });
  }

  /* ============================ 高度なミュート / 高画質 / 誕生日(自分のみ) ============================ */
  function muteMatch(text, author) {
    for (const r of (S.muteRules || [])) {
      const t = (typeof r === 'string' ? r : (r && r.t) || '').trim();
      if (!t) continue;
      let hit = false;
      const rm = t.match(/^\/(.*)\/([a-z]*)$/);
      if (rm) { try { hit = new RegExp(rm[1], rm[2].indexOf('i') !== -1 ? 'i' : '').test(text); } catch (e) {} }
      else if (t[0] === '@') hit = author && ('@' + author).toLowerCase() === t.toLowerCase();
      else hit = text.toLowerCase().indexOf(t.toLowerCase()) !== -1;
      if (hit) return true;
    }
    return false;
  }
  function processHqMedia() {
    if (!S.hqMedia) return;
    document.querySelectorAll('img[src*="pbs.twimg.com/media/"]').forEach((img) => {
      const s = img.getAttribute('src') || '';
      if (/[?&]name=(?:orig|large|4096x4096)/.test(s) || !/[?&]name=/.test(s)) return;
      const ns = s.replace(/([?&]name=)[^&]+/, '$1large');
      if (ns !== s && img.dataset.xdtHq !== ns) { img.dataset.xdtHq = ns; img.src = ns; }
    });
  }
  // 自分のプロフィールの誕生日だけを非表示にする(他人のは表示)
  function processBirthdaySelf() {
    const name = profileName();
    document.querySelectorAll('[data-testid="UserBirthdate"]').forEach((el) => {
      el.classList.toggle('xdt-gone', !!(S.birthdayHideSelf && name && XDT.isSelf(name)));
    });
  }

  /* 左サイドメニューの項目非表示は processHides() の MENU_RULES で行う(並べ替え機能は廃止)。 */

  /* ============================ 興味なし(X公式メニューを代わりに押す) ============================ */
  async function clickNotInterested(article) {
    if (!article) return false;
    const caret = article.querySelector('[data-testid="caret"]');
    if (!caret) return false;
    realClick(caret);
    for (let i = 0; i < 22; i++) {
      await sleep(80);
      const menu = document.querySelector('[role="menu"],[data-testid="Dropdown"]');
      const items = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"],[data-testid="Dropdown"] [role="menuitem"]'));
      const it = items.find((m) => /興味がない|関心がない|Not interested/i.test(m.textContent || ''));
      if (it) { realClick(it); return true; }
      if (i > 4 && !menu) break; // メニューが開かなかった/閉じた
    }
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // 見つからなければ閉じる
    return false;
  }

  /* ============================ 返信時にリプライ相手の名前を本文へ ============================ */
  /* ============================ 年齢(誕生日から) ============================ */
  function processAgeLocal() {
    document.querySelectorAll('[data-testid="UserBirthdate"]').forEach((el) => {
      let tag = el.querySelector('.xdt-age');
      if (!S.ageLocal) { if (tag) tag.remove(); return; }
      const txt = textNodes(el).map((n) => origOf(n)).join(' '); // 年を非表示にしていても元の文から読む
      const m = txt.match(/(\d{4})\D{1,4}(\d{1,2})\D{1,4}(\d{1,2})/) || txt.match(/(\d{1,2})\D{1,4}(\d{1,2})\D{1,4}(\d{4})/);
      let y, mo, d;
      if (m) { if (m[1].length === 4) { y = +m[1]; mo = +m[2]; d = +m[3]; } else { mo = +m[1]; d = +m[2]; y = +m[3]; } }
      if (!y) { if (tag) tag.remove(); return; } // 年が無ければ年齢は出せない
      const now = new Date();
      let age = now.getFullYear() - y;
      if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
      if (age < 0 || age > 150) { if (tag) tag.remove(); return; }
      if (!tag) { tag = document.createElement('span'); tag.className = 'xdt-age'; el.appendChild(tag); }
      const t = `(${age}歳)`;
      if (tag.textContent !== t) tag.textContent = t;
    });
  }

  /* ============================ ER一覧・CSV / フォロワー増減 ============================ */
  function postsOf(name) {
    const u = users.get(name.toLowerCase());
    if (!u) return [];
    const rids = XDT.routeIds && XDT.routeIds(), arr = [], seen = new Set();
    const push = (t) => { if (t && t.authorId === u.id && !t.rt && !seen.has(t.id)) { seen.add(t.id); arr.push(t); } };
    if (rids) rids.forEach((id) => push(tweets.get(id)));
    if (!arr.length) for (const t of tweets.values()) push(t);
    arr.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
    return arr;
  }
  function downloadCsv(filename, text) {
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }
  function showErList(rect, name) {
    const posts = postsOf(name).slice(0, 50);
    if (!posts.length) return showPop(rect, '<div class="xdt-erp"><b>ER一覧</b><small>「ポスト」タブを開くと読み込まれます</small></div>', 300);
    const rows = posts.map((t) => { const e = erInfo(t), c = t.counts || {}; return { id: t.id, d: new Date(XDT.snowTime(t.id)), er: e ? e.er : null, view: c.view || 0, like: c.like || 0, rt: c.repost || 0, q: c.quote || 0, rp: c.reply || 0, bm: c.bookmark || 0 }; });
    const fd = (d) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const list = rows.map((r) => `<a href="https://x.com/i/status/${r.id}" target="_blank" rel="noopener noreferrer"><b>${r.er == null ? 'ER —' : 'ER ' + r.er.toFixed(2) + '%'}</b> <span>${esc(fd(r.d))} ・ 👁${fmt(r.view)} ❤${fmt(r.like)} 🔁${fmt(r.rt)}</span></a>`).join('');
    showPop(rect, `<div class="xdt-erp"><b>ER一覧(最新${rows.length}件)</b><div class="xdt-erl">${list}</div><button type="button" class="xdt-act xdt-csvbtn" data-act="ercsv" data-name="${esc(name)}">CSVを書き出す</button><small>読み込み済みのポストのみ。インプレッションが取れない投稿は ER — になります。</small></div>`, 340);
  }
  function erCsv(name) {
    const posts = postsOf(name).slice(0, 500);
    const head = 'post_id,url,datetime,impressions,likes,reposts,quotes,replies,bookmarks,engagement_rate_percent\n';
    const body = posts.map((t) => {
      const c = t.counts || {}, e = erInfo(t), d = new Date(XDT.snowTime(t.id));
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return [t.id, 'https://x.com/i/status/' + t.id, iso, c.view || 0, c.like || 0, c.repost || 0, c.quote || 0, c.reply || 0, c.bookmark || 0, e ? e.er.toFixed(3) : ''].join(',');
    }).join('\n');
    downloadCsv(`X_${name}_engagement.csv`, head + body);
  }
  function showFolPop(rect, name) {
    const h = (XDT.folHist()[name.toLowerCase()] || []).slice();
    if (h.length < 1) return showPop(rect, '<div class="xdt-erp"><b>フォロワーの増減</b><small>記録はこの端末にだけ保存されます。プロフィールを開くたびに記録します。</small></div>', 300);
    const fmt2 = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + fmt(n));
    const first = h[0], last = h[h.length - 1];
    const dfo = last.fo - first.fo, dfr = (last.fr != null && first.fr != null) ? last.fr - first.fr : null;
    const span = `${new Date(first.t).toLocaleDateString('ja-JP')}〜${new Date(last.t).toLocaleDateString('ja-JP')}`;
    const recent = h.slice(-12).reverse().map((p, i, a) => {
      const prev = a[i + 1];
      const delta = prev ? p.fo - prev.fo : 0;
      return `<a><b>${fmt(p.fo)}</b> <span>${esc(new Date(p.t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}${prev ? ' (' + fmt2(delta) + ')' : ''}</span></a>`;
    }).join('');
    showPop(rect, `<div class="xdt-erp"><b>フォロワーの増減</b><div class="xdt-erl">${recent}</div><small>期間(${esc(span)}) 合計: フォロワー ${fmt2(dfo)} / フォロー ${fmt2(dfr)}。この端末にだけ保存され、他の人には見えません。</small></div>`, 320);
  }

  /* ============================ 定型文のポップ(挿入・追加・削除・返信相手の名前) ============================ */
  function snEditorEl() {
    const root = (snEditor && snEditor.closest('[role="dialog"],[data-testid="primaryColumn"]')) || document;
    return (snEditor && snEditor.isConnected && snEditor) || root.querySelector('[data-testid^="tweetTextarea_"] [contenteditable="true"]') || document.querySelector('[data-testid^="tweetTextarea_"] [contenteditable="true"]');
  }
  // host の中から「返信先 / Replying to」の行を1つ返す(入力欄を含まない・最も具体的=小さい要素)。
  // 「返信先 : @ID さん」のようにリンクでなく文字でも拾えるよう、@ID を含む文字列で判定する。
  const REPLY_RE = /(返信先|Replying to)/;
  const hasHandle = (t) => /@[A-Za-z0-9_]{1,15}/.test(t || '');
  function replyRowIn(host, ed) {
    let best = null, bestSize = Infinity;
    host.querySelectorAll('div,span').forEach((e) => {
      if (e === ed || e.contains(ed)) return;
      const t = e.textContent || '';
      if (!REPLY_RE.test(t) || !hasHandle(t)) return;
      const size = e.querySelectorAll('*').length; // 子孫が少ないほど行そのものに近い
      if (size < bestSize) { bestSize = size; best = e; }
    });
    return best;
  }
  // このコンポーザー自身の返信先行を探す。
  // 入力欄から親をたどり、見つからなければダイアログ/中央カラム/全体から「入力欄に最も近い行」を選ぶ。
  function findReplyRow() {
    const ed = snEditorEl();
    if (!ed) return null;
    let row = null;
    for (let host = ed.parentElement; host && host !== document.body && !row; host = host.parentElement) row = replyRowIn(host, ed);
    if (row) return row;
    // フォールバック: 広い範囲から候補を集め、入力欄にDOM上で最も近いものを選ぶ
    const scope = ed.closest('[role="dialog"],[aria-modal="true"]') || document.querySelector('[data-testid="primaryColumn"]') || document;
    const cands = [];
    scope.querySelectorAll('div,span').forEach((e) => {
      if (e === ed || e.contains(ed)) return;
      const t = e.textContent || '';
      if (REPLY_RE.test(t) && hasHandle(t)) cands.push(e);
    });
    if (!cands.length) return null;
    const chain = []; for (let n = ed; n; n = n.parentElement) chain.push(n);
    const dist = (e) => { let d = 0; for (let n = e; n; n = n.parentElement) { const i = chain.indexOf(n); if (i >= 0) return d + i; d++; } return 1e9; };
    cands.sort((a, b) => dist(a) - dist(b) || a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    const near = cands[0];
    let best = near, bestSize = near.querySelectorAll('*').length;
    near.querySelectorAll('div,span').forEach((e) => {
      if (e === ed || e.contains(ed)) return;
      const t = e.textContent || '';
      if (!REPLY_RE.test(t) || !hasHandle(t)) return;
      const s = e.querySelectorAll('*').length; if (s < bestSize) { bestSize = s; best = e; }
    });
    return best;
  }
  // 返信画面かどうか(返信先行があるか)。ボタンの表示判定に使う。
  function inReplyCompose() { return !!findReplyRow(); }
  // 返信先の @ID を集める(リンクの href と、テキスト内の @ID の両方から)。
  function replyHandles(row) {
    const set = [];
    const push = (h) => { h = String(h).toLowerCase(); if (h && set.indexOf(h) === -1) set.push(h); };
    row.querySelectorAll('a[href^="/"]').forEach((a) => { const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/); if (m) push(m[1]); });
    // 「返信先 :」より後ろのテキストから @ID を拾う(別ポストの引用などを避けるため先頭の見出しは除く)
    const txt = (row.textContent || '').replace(REPLY_RE, '');
    let m; const re = /@([A-Za-z0-9_]{1,15})/g;
    while ((m = re.exec(txt))) push(m[1]);
    return set;
  }
  // 返信相手の名前(ユーザー名=表示名)。@ID から users マップで名前を引く。自分は除外。
  function replyNames() {
    const row = findReplyRow();
    if (!row) return [];
    const myHandle = ((usersById.get(XDT.myId()) || {}).name || '').toLowerCase();
    const out = [];
    replyHandles(row).forEach((h) => {
      if (myHandle && h === myHandle) return; // 自分は除外
      const u = users.get(h);
      const name = (u && u.dname) || ('@' + h); // 名前が取れなければ @ID をそのまま
      if (out.indexOf(name) === -1) out.push(name);
    });
    return out;
  }
  XDT._replyNamesTest = replyNames; // テスト用フック
  XDT._inReplyTest = inReplyCompose;
  let popMode = 'snip'; // 'snip' | 'draft'
  // 並び順: 定型文 → 下書き → 返信相手の名前を入れる
  function snipViewHtml() {
    let html = '';
    if (S.snipEnable) {
      const items = S.snippets || [];
      const rows = items.map((x, i) => `<div class="xdt-snrow"><button type="button" class="xdt-act xdt-snb" data-act="snins" data-i="${i}" title="${esc(x)}">${esc(x.length > 40 ? x.slice(0, 40) + '…' : x)}</button><button type="button" class="xdt-act xdt-snx" data-act="sndel" data-i="${i}" title="削除">✕</button></div>`).join('') || '<div class="xdt-snb" style="opacity:.6">(定型文はまだありません。下の欄から追加できます)</div>';
      const add = `<div class="xdt-snadd"><input type="text" class="xdt-snnew" placeholder="定型文を追加"><button type="button" class="xdt-act" data-act="snadd">追加</button></div>`;
      html += `<div class="xdt-snrows">${rows}</div>${add}`;
    }
    if (S.draftEnable) {
      const dn = (XDT.drafts ? XDT.drafts() : []).length;
      html += `<div class="xdt-snadd"><button type="button" class="xdt-act" data-act="draftview" style="flex:1">📄 下書き (${dn})</button></div>`;
    }
    if (S.replyNameEnable && inReplyCompose()) {
      html += `<div class="xdt-snadd"><button type="button" class="xdt-act" data-act="snreply" style="flex:1">💬 返信相手の名前を入れる</button></div>`;
    }
    if (!html) html = '<div class="xdt-snb" style="opacity:.6">(有効な機能がありません。設定で「文字編集」の各有効化をオンにしてください)</div>';
    return `<div class="xdt-snl">${html}</div>`;
  }
  function draftViewHtml() {
    const ds = (XDT.drafts ? XDT.drafts() : []).slice().reverse();
    const head = `<div class="xdt-snb" style="opacity:.7;font-weight:700">📄 下書き (${ds.length})</div>`;
    const rows = ds.map((d) => { const one = (d.text || '').replace(/\s+/g, ' '); const t = one.length > 44 ? one.slice(0, 44) + '…' : one; return `<div class="xdt-snrow"><button type="button" class="xdt-act xdt-snb" data-act="draftins" data-id="${esc(d.id)}" title="${esc(d.text)}">${esc(t)}</button><button type="button" class="xdt-act xdt-snx" data-act="draftdel" data-id="${esc(d.id)}" title="削除">✕</button></div>`; }).join('') || '<div class="xdt-snb" style="opacity:.6">(下書きはまだありません。下のボタンで今の入力を保存できます)</div>';
    const save = `<div class="xdt-snadd"><button type="button" class="xdt-act" data-act="draftsave" style="flex:1">💾 今の入力を下書き保存</button></div>`;
    const back = `<div class="xdt-snadd"><button type="button" class="xdt-act" data-act="snipview" style="flex:1">← 戻る</button></div>`;
    return `<div class="xdt-snl">${head}<div class="xdt-snrows">${rows}</div>${save}${back}</div>`;
  }
  function snipPopHtml() { return popMode === 'draft' ? draftViewHtml() : snipViewHtml(); }
  function openSnipPop(rect) { popMode = 'snip'; showPop(rect, snipPopHtml(), 280); }
  function refreshSnipPop() { const p = document.querySelector('.xdt-pop'); if (p) p.innerHTML = snipPopHtml(); }

  /* ============================ 適用ループ ============================ */
  let timer = 0, pend = false;
  XDT.schedule = () => { if (timer) return; timer = setTimeout(() => { timer = 0; apply(); }, 70); };
  // 新しいポストが描画された直後は、画面に描かれる前(マイクロタスク)に反映して高さの後変更を防ぐ
  XDT.now = () => { if (pend) return; pend = true; queueMicrotask(() => { pend = false; apply(); }); };
  // 設定変更: 取り外し→再描画を同じ処理内で行い、途中の状態が画面に出ない(一瞬崩れない)ようにする
  XDT.fullApply = () => {
    XDT.ver++;
    restoreText();
    document.querySelectorAll('.xdt-pop,.xdt-mi').forEach((n) => n.remove());
    document.querySelectorAll('.xdt-gone').forEach((n) => n.classList.remove('xdt-gone'));
    document.querySelectorAll('.xdt-lock').forEach((n) => n.classList.remove('xdt-lock'));
    document.querySelectorAll('.xdt-fav').forEach((n) => n.remove());
    document.querySelectorAll('[data-xdt-unb]').forEach((el) => { el.style.removeProperty('filter'); el.style.removeProperty('backdrop-filter'); delete el.dataset.xdtUnb; });
    document.querySelectorAll('article[data-xdt-mark]').forEach((a) => delete a.dataset.xdtMark);
    document.querySelectorAll('[data-xdt-ut]').forEach((el) => delete el.dataset.xdtUt);
    document.querySelectorAll('.xdt-sq').forEach((el) => { el.classList.remove('xdt-sq'); delete el.dataset.xdtSqd; });
    apply();
  };
  const hasNew = (n) => n.nodeType === 1 && ((n.parentElement && n.parentElement.closest('#layers')) || n.id === 'layers' || n.tagName === 'ARTICLE' || (n.matches && n.matches('[data-testid="cellInnerDiv"]')) || (n.querySelector && n.querySelector('article,[data-testid="cellInnerDiv"]')));
  const mo = new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) if (hasNew(n)) { XDT.now(); return; }
    XDT.schedule();
  });
  const observe = () => mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  observe();
  (XDT.safeInterval || setInterval)(XDT.schedule, 1500); // 再描画で消えた表示を確実に復元(context無効時は自動停止)

  function apply() {
    if (!XDT.ready || !document.body) return;
    mo.disconnect();
    const run = (f, name) => { try { f(); } catch (e) { stats.err++; stats.lastErr = (name || f.name || '処理') + ': ' + String((e && e.message) || e); } };
    try {
      for (const n of touched) if (!n.isConnected) touched.delete(n);
      run(processDataset);
      run(checkHov);
      run(processBirthday);
      run(processFollowLinks);
      run(processHides);
      let ctx = { home: null };
      run(() => { ctx = { home: homeState() }; }, 'homeState');
      run(() => {
        document.querySelectorAll('article').forEach((a) => {
          try {
            const info = articleInfo(a);
            if (!info) return;
            const rec = tweets.get(info.id);
            if (S.numDetail) applyMetrics(a, rec);
            // 判定結果・データ・設定が変わっていない投稿はチップの再計算を省く(高速化)
            const u = rec && usersById.get(rec.authorId);
            const key = `${XDT.ver}|${XDT.rver}|${rec ? rec.ts : 0}|${u ? u.ts : 0}|${ctx.home}`;
            if (a.dataset.xdtK !== key || !a.querySelector('.xdt-tbadges')) { renderTweetBadges(a, info, rec, ctx); a.dataset.xdtK = key; }
            processActionExtras(a, rec, info);
            processRelInline(a, rec, info);
            processLockData(a, rec);
            processDecor(a, rec, info);
            processMediaGrid(a, rec, info);
            processExpand(a, rec);
            autoChecks(a, info);
          } catch (e) { stats.err++; stats.lastErr = '投稿: ' + String((e && e.message) || e); }
        });
      }, '投稿一覧');
      // アカウント切り替えのぼかしは、重い処理より先に実行
      run(watchLayers);
      run(processBlurInactive);
      [processNotifPrivacy, processProfile, processMoreMenu, processLeftExtras, processHideFooter, unblurTiles, unblurLayers, processSnippets, processAgeLocal, processBirthdaySelf, processHqMedia, processExtraHides, processGrokButtons, processTwitter, processAutoBlock, processFavStar, processStar, processSquareAvatars, processLocks, processRelEverywhere, processTimes, processHighlight, processMenus, processCompose, processTasks].forEach((f) => run(f));
    } finally { observe(); }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'diag') sendResponse({ api: stats.api, react: stats.react, users: users.size, tweets: tweets.size, err: stats.err, lastErr: stats.lastErr, templates: Object.keys(XDT.templates), mediaTabs: stats.mediaTabs || '', composeBtns: stats.composeBtns || '', me: { id: XDT.myId(), name: ((usersById.get(XDT.myId()) || {}).name) || blurMe || '' } });
  });
})();
