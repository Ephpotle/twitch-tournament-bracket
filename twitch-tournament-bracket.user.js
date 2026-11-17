// ==UserScript==
// @name         Twitch tournament bracket
// @namespace    claude-for-zen
// @version      1.2.2
// @description  On a Twitch stream that is showing an ongoing esports tournament (looked up on Liquipedia), adds a "Bracket" button next to Follow that shows or hides the live tournament bracket.
// @author       Ephpotle
// @license      MIT
// @homepageURL  https://github.com/Ephpotle/twitch-tournament-bracket
// @supportURL   https://github.com/Ephpotle/twitch-tournament-bracket/issues
// @match        https://www.twitch.tv/*
// @grant        GM_xmlhttpRequest
// @connect      liquipedia.net
// ==/UserScript==

(function () {
  'use strict';
  if (window.__ttbLoaded) return; window.__ttbLoaded = true;
  // Twitch category slug -> Liquipedia wiki
  const WIKIS = { 'dota-2': 'dota2', 'counter-strike': 'counterstrike', 'valorant': 'valorant', 'league-of-legends': 'leagueoflegends', 'rocket-league': 'rocketleague', 'starcraft-ii': 'starcraft2', 'apex-legends': 'apexlegends', 'overwatch-2': 'overwatch', 'tom-clancys-rainbow-six-siege': 'rainbowsix', 'mobile-legends-bang-bang': 'mobilelegends', 'warcraft-iii': 'warcraft', 'pubg-battlegrounds': 'pubg', 'deadlock': 'deadlock', 'marvel-rivals': 'marvelrivals', 'teamfight-tactics': 'tft', 'hearthstone': 'hearthstone', 'world-of-warcraft': 'worldofwarcraft', 'heroes-of-the-storm': 'heroes', 'age-of-empires-ii-definitive-edition': 'ageofempires', 'age-of-empires-iv': 'ageofempires' };
  const UA = 'TwitchTournamentBracket/1.2 (+https://github.com/Ephpotle/twitch-tournament-bracket)';
  const PARSE_GAP = 31000, MATCH_TTL = 10 * 60e3, BRACKET_TTL = 3 * 60e3, SEC_TTL = 6 * 3600e3, COL = 206;
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem('ttb:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('ttb:' + k, JSON.stringify(v)); } catch (e) {} }
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const direct = (e, cls) => [...e.children].filter(c => c.classList.contains(cls));

  /* ---------- Liquipedia access ---------- */
  function httpGet(url) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((res, rej) => GM_xmlhttpRequest({
        method: 'GET', url, headers: { 'User-Agent': UA }, timeout: 30000,
        onload: r => r.status === 200 ? res(r.responseText) : rej(new Error('HTTP ' + r.status)),
        onerror: () => rej(new Error('network error')), ontimeout: () => rej(new Error('timeout'))
      }));
    }
    return fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  }
  // Liquipedia allows one action=parse request per 30 s. Requests are queued and spaced 31 s apart;
  // a Web Lock keeps that true across every open Twitch tab, with a per-tab queue as the fallback.
  let chain = Promise.resolve();
  function gate(fn) {
    const run = async () => {
      const wait = (ls.get('last') || 0) + PARSE_GAP - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      ls.set('last', Date.now());
      return fn();
    };
    const local = () => { const p = chain.then(run, run); chain = p.catch(() => {}); return p; };
    if (!(navigator.locks && navigator.locks.request)) return local();
    let ran = false;
    try {
      return Promise.resolve(navigator.locks.request('ttb-liquipedia', () => { ran = true; return run(); }))
        .catch(e => { if (ran) throw e; return local(); });
    } catch (e) { return local(); }
  }
  function parsePage(wiki, page, section) {
    return gate(async () => {
      const txt = await httpGet('https://liquipedia.net/' + wiki + '/api.php?action=parse&page=' + encodeURIComponent(page) +
        (section != null ? '&section=' + section : '') + '&prop=text%7Cdisplaytitle&format=json&origin=*');
      const j = JSON.parse(txt);
      if (j.error) throw new Error(j.error.info || 'Liquipedia API error');
      return { html: j.parse.text['*'], title: (j.parse.displaytitle || page).replace(/<[^>]+>/g, '') };
    });
  }
  // Fetch the wiki's list of current matches and save it. If the fetch fails, the previous list is kept.
  const pendingM = {};
  function fetchMatches(wiki) {
    if (!pendingM[wiki]) {
      pendingM[wiki] = parsePage(wiki, 'Liquipedia:Matches').then(r => parseMatches(r.html), () => null).then(list => {
        delete pendingM[wiki];
        const old = ls.get('m:' + wiki);
        const use = list || (old && old.list) || [];
        ls.set('m:' + wiki, { t: Date.now(), list: use });
        return use;
      });
    }
    return pendingM[wiki];
  }
  // Each opponent is kept as a list of name variants: the short name Liquipedia displays ("TSpirit")
  // and the full name from the team link ("Team Spirit"), because stream titles use either.
  function oppNames(op) {
    const nm = op.querySelector('.name'), a = op.querySelector('a[title]');
    const short = nm ? nm.textContent.trim() : '';
    const full = a ? a.getAttribute('title').replace(/\s*\(page does not exist\)$/, '').replace(/\s*\([^)]*\)$/, '').trim() : '';
    return [short, full].filter((v, i, arr) => v && arr.indexOf(v) === i);
  }
  function parseMatches(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    return [...d.querySelectorAll('.match-info')].map(x => {
      const a = x.querySelector('.match-info-tournament a[href]');
      const href = a && a.getAttribute('href');
      if (!href || href.includes('index.php')) return null;
      const t = x.querySelector('.timer-object');
      const nameEl = x.querySelector('.match-info-tournament-name');
      let page; try { page = decodeURIComponent(href.replace(/^\/[^/]+\//, '').split('#')[0]); } catch (e) { return null; }
      return {
        p: page, n: (nameEl ? nameEl.textContent.trim() : '') || page.replace(/_/g, ' '),
        s: [...x.querySelectorAll('a[href*="Special:Stream/twitch/"]')].map(l => norm(l.getAttribute('href').split('Special:Stream/twitch/')[1])),
        ts: t ? +t.dataset.timestamp || 0 : 0, fin: !!t && t.dataset.finished === 'finished',
        o: [...x.querySelectorAll('.match-info-header-opponent')].map(oppNames)
      };
    }).filter(Boolean);
  }
  // Which tournament is this stream showing? 1) Liquipedia lists this channel as the stream,
  // 2) both teams of a current match are named in the stream title,
  // 3) the tournament name, or the name of its series ("1win Essence"), is in the title.
  function pick(list, chan, title) {
    const now = Date.now() / 1000, c = norm(chan), tl = ' ' + title.toLowerCase() + ' ';
    const word = n => { const i = tl.indexOf(n.toLowerCase()); return i > 0 && !/[a-z0-9]/.test(tl[i - 1]) && !/[a-z0-9]/.test(tl[i + n.length] || ' '); };
    const variants = n => (Array.isArray(n) ? n : [n]).filter(v => v && v.length >= 2 && v !== 'TBD');
    const cand = list.filter(m => !m.fin && m.ts < now + 3 * 3600 && m.ts > now - 12 * 3600);
    let hit = cand.filter(m => m.s.includes(c));
    if (!hit.length) hit = cand.filter(m => m.ts < now + 1800 && m.o.length === 2 && m.o.every(n => variants(n).some(word)));
    if (!hit.length) hit = cand.filter(m => {
      const nm = m.n.split(' - ')[0], series = m.p.split('/')[0].replace(/_/g, ' ');
      return (nm.length >= 6 && tl.includes(nm.toLowerCase())) || (series.length >= 8 && word(series));
    });
    hit.sort((a, b) => Math.abs(a.ts - now) - Math.abs(b.ts - now));
    return hit[0] || null;
  }

  /* ---------- bracket parsing (Liquipedia pages are publicly editable: treat everything as untrusted text) ---------- */
  const isDark = () => !document.documentElement.classList.contains('tw-root--theme-light');
  // Only ever load images from liquipedia.net itself.
  function safeLogo(src) {
    if (!src) return '';
    try { const u = new URL(src, 'https://liquipedia.net'); return u.protocol === 'https:' && u.hostname === 'liquipedia.net' ? u.href : ''; }
    catch (e) { return ''; }
  }
  function parseOpp(e) {
    const nameEl = e.querySelector('.team-bracketname, .team-name') || e.querySelector('.name');
    const name = ((nameEl ? nameEl.textContent : '') || e.getAttribute('aria-label') || '').trim();
    const img = e.querySelector(isDark() ? '.team-template-darkmode img' : '.team-template-lightmode img') || e.querySelector('.brkts-opponent-entry-left img');
    const sc = e.querySelector('.brkts-opponent-score-inner');
    const tbd = !name || name === 'TBD';
    const win = e.classList.contains('brkts-opponent-win') || !!e.querySelector('.brkts-opponent-win');
    return { name: tbd ? 'TBD' : name, tbd, logo: tbd || !img ? '' : safeLogo(img.getAttribute('src')), score: sc ? sc.textContent.trim() : '', win };
  }
  function parseMatch(m) {
    const o = direct(m, 'brkts-opponent-entry').map(parseOpp);
    const t = m.querySelector('.timer-object');
    const ts = t ? +t.dataset.timestamp || 0 : 0, fin = !!t && t.dataset.finished === 'finished';
    const done = fin || o.some(x => x.win);
    return { o, ts, done, live: !done && ts > 0 && ts <= Date.now() / 1000 && o.some(x => !x.tbd) };
  }
  function convert(container) {
    const out = [];
    for (const c of container.children) {
      if (c.classList.contains('brkts-round-header')) {
        out.push({ h: direct(c, 'brkts-header').map(h => { const op = h.querySelector('.brkts-header-option'); return (op || h).textContent.trim(); }) });
      } else if (c.classList.contains('brkts-round-body')) {
        const lower = direct(c, 'brkts-round-lower')[0], center = direct(c, 'brkts-round-center')[0];
        const kids = lower ? convert(lower) : [];
        const mEl = center && center.querySelector('.brkts-match');
        if (mEl) out.push({ kids, m: parseMatch(mEl) }); else out.push(...kids);
      } else if (!/brkts-/.test(c.className) && c.children.length) out.push(...convert(c));
    }
    return out;
  }
  // Walk backwards/upwards from a bracket to the nearest heading matching sel.
  function headingBefore(b, root, sel) {
    let e = b;
    while (e && e !== root) {
      let p = e.previousElementSibling;
      while (p) {
        const h = p.matches(sel) ? p : p.querySelector(sel);
        if (h) return h;
        p = p.previousElementSibling;
      }
      e = e.parentElement;
    }
    return null;
  }
  function headingOf(b, root) {
    const h = headingBefore(b, root, 'h2,h3,h4');
    if (!h) return '';
    const hl = h.querySelector('.mw-headline');
    return (hl || h).textContent.replace(/\[edit\]/g, '').trim();
  }
  // Number of the top-level (h2) section a bracket sits in, read from that heading's edit link.
  function sectionOf(b, root) {
    const h = headingBefore(b, root, 'h2');
    if (!h) return null;
    const a = (h.closest('.mw-heading') || h).querySelector('a[href*="section="]');
    const m = a && (a.getAttribute('href') || '').match(/[?&]section=(\d+)/);
    return m ? +m[1] : null;
  }
  function parseBrackets(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    const els = [...d.querySelectorAll('.brkts-bracket')].filter(b => !b.closest('.brkts-popup')).slice(0, 4);
    const brackets = els.map(b => ({ title: headingOf(b, d.body), items: convert(b) })).filter(b => b.items.some(i => i.m));
    const secs = [...new Set(els.map(b => sectionOf(b, d.body)))];
    return { brackets, sec: secs.length === 1 && secs[0] != null ? secs[0] : null };
  }
  const bcache = new Map(), pendingB = {};
  // The first load fetches the whole tournament page and notes which section holds the bracket;
  // later refreshes fetch only that section, falling back to the whole page if it has moved.
  function loadBracket(t, force) {
    const k = t.wiki + '|' + t.page, c = bcache.get(k);
    if (c && !force && Date.now() - c.t < BRACKET_TTL) return Promise.resolve(c);
    if (!pendingB[k]) {
      pendingB[k] = (async () => {
        const sc = ls.get('sec:' + k);
        let d = null;
        if (sc && Date.now() - sc.t < SEC_TTL) {
          try {
            const r = await parsePage(t.wiki, t.page, sc.n), pb = parseBrackets(r.html);
            if (pb.brackets.length) d = { t: Date.now(), title: r.title, brackets: pb.brackets };
          } catch (e) {}
          if (!d) ls.set('sec:' + k, null);
        }
        if (!d) {
          const r = await parsePage(t.wiki, t.page), pb = parseBrackets(r.html);
          d = { t: Date.now(), title: r.title, brackets: pb.brackets };
          if (pb.sec != null) ls.set('sec:' + k, { t: Date.now(), n: pb.sec });
        }
        bcache.set(k, d); return d;
      })().finally(() => { delete pendingB[k]; });
    }
    return pendingB[k];
  }

  /* ---------- UI ---------- */
  const CSS = `
:host{all:initial;--bg:#121218;--bg2:#1d1830;--fg:#f0f0f5;--mut:#8d8da0;--box:#22222c;--line:#4b4b5e;--win:#3ddc84;--live:#a58bff;--gold:#ffc94d;--row:#2c2c38;--chip:#17171d}
:host([data-theme=light]){--bg:#f6f5fb;--bg2:#e6e1f8;--fg:#1b1b1f;--mut:#6f6f82;--box:#fff;--line:#c5c3d6;--win:#12a150;--live:#7c4dff;--gold:#c98a00;--row:#ecebf3;--chip:#e9e8f1}
*{box-sizing:border-box}
.btn{display:inline-flex;align-items:center;gap:6px;height:30px;margin-right:10px;padding:0 12px;border-radius:15px;border:1px solid var(--live);background:transparent;color:var(--fg);font:600 13px/1 Inter,Roobert,system-ui,sans-serif;cursor:pointer;white-space:nowrap;transition:background .15s}
.btn:hover{background:rgba(145,71,255,.25)}.btn.on{background:#9147ff;border-color:#9147ff;color:#fff}
.panel{position:relative;width:100%;height:100%;font:12px/1.2 Inter,Roobert,system-ui,sans-serif;color:var(--fg);background:radial-gradient(600px 300px at 80% 0%,var(--bg2),transparent),radial-gradient(500px 300px at 0% 100%,var(--bg2),transparent),var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.55);display:flex;flex-direction:column;max-width:calc(100vw - 32px);max-height:calc(100vh - 80px);overflow:hidden}
.head{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 18px;cursor:move;user-select:none;border-bottom:1px solid var(--line);flex:none}
.head b{font-size:13px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.head button{all:unset;cursor:pointer;color:var(--mut);font-size:15px;padding:2px 7px;border-radius:5px}.head button:hover{background:var(--row);color:var(--fg)}
.body{flex:1;display:flex;overflow:auto;padding:6px 14px 4px;min-width:260px;min-height:60px}
.zoom{margin:auto;flex:none;width:max-content}
.foot{flex:none;padding:5px 18px 7px 14px;color:var(--mut);font-size:10px;border-top:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.foot a{color:var(--mut)}
.rz{position:absolute;width:16px;height:16px;z-index:3;cursor:nwse-resize;touch-action:none}
.rz.tl{left:0;top:0;background:linear-gradient(135deg,var(--line) 0 38%,transparent 38%)}
.rz.br{right:0;bottom:0;background:linear-gradient(135deg,transparent 62%,var(--line) 62%)}
.rz.tl:hover{background:linear-gradient(135deg,var(--live) 0 38%,transparent 38%)}.rz.br:hover{background:linear-gradient(135deg,transparent 62%,var(--live) 62%)}
.msg{padding:18px 4px;color:var(--mut);font-size:12px;max-width:340px}
.bt{font-size:12px;font-weight:700;margin:8px 0 0;align-self:flex-start}
.br{position:relative;display:flex;flex-direction:column;align-items:flex-end;width:max-content;padding:0 2px 18px 0}
.br svg{position:absolute;left:0;top:0;pointer-events:none}
.hrow{display:flex;justify-content:flex-end;margin:12px 0 8px}
.hd{width:${COL}px;padding-left:28px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.node{display:flex;align-items:center;justify-content:flex-end}
.kids{display:flex;flex-direction:column;align-items:flex-end;gap:18px}
.m{position:relative;flex:none;width:178px;margin-left:28px;background:var(--box);border:1px solid var(--line);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.18);opacity:0;transform:translateX(-14px) scale(.96);animation:in .5s cubic-bezier(.2,.9,.3,1.2) forwards;transition:opacity .2s,transform .2s}
@keyframes in{to{opacity:1;transform:none}}
.noanim .m{animation:none;opacity:1;transform:none}.noanim .c{animation:none;stroke-dashoffset:0}
.t{display:flex;align-items:center;gap:7px;height:26px;padding:0 8px 0 5px;position:relative;transition:background .2s}
.t+.t{border-top:1px solid var(--row)}.t:first-child{border-radius:7px 7px 0 0}.t:nth-child(2){border-radius:0 0 7px 7px}
.lg{width:20px;height:20px;border-radius:5px;background:var(--chip);display:grid;place-items:center;flex:none;font-size:9px;font-weight:700;color:var(--mut);overflow:hidden}
.lg img{max-width:16px;max-height:16px;display:block}
.n{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s{font-weight:700;font-variant-numeric:tabular-nums;min-width:10px;text-align:right}
.w .n{font-weight:700}.w .s{color:var(--win)}.w::before{content:"";position:absolute;left:0;top:4px;bottom:4px;width:3px;border-radius:2px;background:var(--win)}
.l .n,.l .s,.ph .n{color:var(--mut)}.l .lg{opacity:.55}
.tbd{border-style:dashed}
.live{border-color:var(--live);animation:in .5s cubic-bezier(.2,.9,.3,1.2) forwards,pulse 1.6s 1s ease-in-out infinite}.noanim .live{animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(145,71,255,.55)}50%{box-shadow:0 0 0 7px rgba(145,71,255,0),0 0 18px rgba(145,71,255,.55)}}
.pill{position:absolute;right:8px;top:-8px;background:#9147ff;color:#fff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:8px;letter-spacing:.06em}
.pill::before{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:#fff;margin-right:4px;animation:blink 1s infinite}
@keyframes blink{50%{opacity:.2}}
.note{position:absolute;left:2px;top:55px;font-size:10px;color:var(--mut);white-space:nowrap}
.gf{border-color:var(--gold);box-shadow:0 0 16px rgba(255,190,60,.28)}
.gf::after{content:"";position:absolute;inset:0;border-radius:8px;background:linear-gradient(110deg,transparent 35%,rgba(255,220,130,.25) 50%,transparent 65%);background-size:250% 100%;animation:sh 3s linear infinite;pointer-events:none}
@keyframes sh{from{background-position:120% 0}to{background-position:-130% 0}}
.cup{position:absolute;right:-6px;top:-20px;font-size:20px;animation:bob 2s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(-4px) rotate(8deg)}}
.c{fill:none;stroke:var(--line);stroke-width:1.5;stroke-dasharray:500;stroke-dashoffset:500;animation:draw .7s ease-out forwards;transition:opacity .2s}
@keyframes draw{to{stroke-dashoffset:0}}
.dim .m{opacity:.3!important}.dim .m.on{opacity:1!important;transform:scale(1.03)}.dim .t.on{background:var(--row)}.dim .c{opacity:.25}
`;
  const S = { key: null, tour: null, title: '', open: ls.get('open') === 1, timer: 0 };
  let btnHost, btn, panelHost, panel, titleEl, body, foot;
  // Saved window geometry: {l, t, w, h}; w/h are unset until the user resizes.
  let G = ls.get('geo'), natW = 0, natH = 0;

  function makeHost(id) {
    const h = el('div'); h.id = id; h.dataset.theme = isDark() ? 'dark' : 'light';
    const sh = h.attachShadow({ mode: 'open' }); sh.append(el('style', null, CSS)); return h;
  }
  // The button belongs next to Follow. If Twitch has not drawn that row yet it waits in the bottom-left
  // corner, and moves into the row as soon as the row exists (this runs again on every page change).
  function placeButton() {
    if (!btnHost) {
      btnHost = makeHost('ttb-button'); btn = el('button', 'btn', '🏆 Bracket');
      btn.addEventListener('click', () => setOpen(!S.open)); btnHost.shadowRoot.append(btn);
    }
    btn.title = (S.tour ? S.tour.name + ': ' : '') + 'show or hide the tournament bracket';
    btn.classList.toggle('on', S.open);
    btnHost.dataset.theme = isDark() ? 'dark' : 'light';
    if (btnHost.isConnected && btnHost.dataset.where === 'row') return;
    const sel = '[data-a-target="follow-button"],[data-a-target="unfollow-button"]';
    const info = document.querySelector('.metadata-layout__support');
    const f = (info && info.querySelector(sel)) || document.querySelector(sel);
    let e = f, n = 0;
    while (e && e.parentElement && n++ < 14 && !(e.parentElement.children.length > 1 && e.parentElement.getBoundingClientRect().width > 150)) e = e.parentElement;
    if (f && e && e.parentElement && n < 14) {
      btnHost.style.cssText = 'display:flex;align-items:center'; btnHost.dataset.where = 'row';
      e.parentElement.insertBefore(btnHost, e);
    } else if (!btnHost.isConnected && document.querySelector('a[data-a-target="stream-game-link"]')) {
      btnHost.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9998'; btnHost.dataset.where = 'fixed';
      document.body.append(btnHost);
    }
  }
  function applyGeo() {
    const st = panelHost.style;
    if (!G) { st.left = st.top = st.width = st.height = ''; st.right = st.bottom = '16px'; return; }
    st.right = st.bottom = 'auto';
    st.left = Math.max(0, Math.min(innerWidth - 80, G.l)) + 'px';
    st.top = Math.max(0, Math.min(innerHeight - 40, G.t)) + 'px';
    st.width = G.w ? G.w + 'px' : ''; st.height = G.h ? G.h + 'px' : '';
  }
  // When the window has been resized by the user, scale the bracket so all of it stays visible.
  function fit() {
    const z = body && body.querySelector('.zoom');
    if (!z) return;
    if (!G || !G.w || !natW || !natH) { z.style.zoom = ''; return; }
    const s = Math.min((body.clientWidth - 28) / natW, (body.clientHeight - 12) / natH);
    z.style.zoom = String(Math.max(0.35, Math.min(2.5, s)));
  }
  function ensurePanel() {
    if (panelHost) return;
    panelHost = makeHost('ttb-panel'); panelHost.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999';
    panel = el('div', 'panel'); const head = el('div', 'head'); titleEl = el('b', null, 'Bracket');
    head.title = 'Drag to move. Drag a corner to resize. Double-click to reset size and position.';
    const rf = el('button', null, '↻'); rf.title = 'Refresh now'; rf.addEventListener('click', () => refresh(true));
    const x = el('button', null, '✕'); x.title = 'Hide bracket'; x.addEventListener('click', () => setOpen(false));
    head.append(titleEl, rf, x); body = el('div', 'body'); foot = el('div', 'foot'); panel.append(head, body, foot);
    const mkRz = cls => {
      const h = el('div', 'rz ' + cls); h.title = 'Drag to resize'; let st = null;
      h.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const r = panelHost.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, w: r.width, h: r.height };
        try { h.setPointerCapture(e.pointerId); } catch (err) {}
      });
      h.addEventListener('pointermove', e => {
        if (!st) return;
        const dx = e.clientX - st.x, dy = e.clientY - st.y; let w, hh, l = st.l, t = st.t;
        if (cls === 'br') { w = Math.max(320, st.w + dx); hh = Math.max(200, st.h + dy); }
        else { w = Math.max(320, st.w - dx); hh = Math.max(200, st.h - dy); l = st.l + st.w - w; t = st.t + st.h - hh; }
        G = { l, t, w, h: hh }; applyGeo(); fit();
      });
      const end = () => { if (st) { st = null; ls.set('geo', G); } };
      h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
      return h;
    };
    panel.append(mkRz('tl'), mkRz('br'));
    panelHost.shadowRoot.append(panel); document.body.append(panelHost);
    applyGeo();
    let drag = null;
    head.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const r = panelHost.getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top }; try { head.setPointerCapture(e.pointerId); } catch (err) {} });
    head.addEventListener('pointermove', e => { if (!drag) return; G = { l: e.clientX - drag.x, t: e.clientY - drag.y, w: G && G.w, h: G && G.h }; applyGeo(); });
    head.addEventListener('pointerup', () => { if (drag) { drag = null; if (G) ls.set('geo', G); } });
    head.addEventListener('dblclick', e => { if (e.target.closest('button')) return; G = null; ls.set('geo', null); applyGeo(); fit(); });
    window.addEventListener('resize', () => { if (panelHost.style.display !== 'none') { applyGeo(); fit(); } });
    body.addEventListener('mouseover', e => {
      const t = e.target.closest ? e.target.closest('.t') : null;
      body.querySelectorAll('.on').forEach(o => o.classList.remove('on'));
      if (t && t.dataset.t) { body.classList.add('dim'); body.querySelectorAll('.t').forEach(o => { if (o.dataset.t === t.dataset.t) { o.classList.add('on'); o.parentNode.classList.add('on'); } }); }
      else body.classList.remove('dim');
    });
    body.addEventListener('mouseleave', () => body.classList.remove('dim'));
  }
  const fmt = ts => new Date(ts * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  function logoImg(o, lg) {
    // Liquipedia serves a wide placeholder banner to hot-linked images; without a referrer it serves the logo.
    const im = el('img'); im.alt = ''; im.referrerPolicy = 'no-referrer';
    let retried = false;
    im.addEventListener('error', () => { lg.textContent = o.name[0]; });
    im.addEventListener('load', () => {
      if (im.naturalHeight && im.naturalWidth / im.naturalHeight > 4) {
        if (!retried) { retried = true; im.src = o.logo + (o.logo.includes('?') ? '&' : '?') + 'nr=1'; } else lg.textContent = o.name[0];
      }
    });
    im.src = o.logo; lg.append(im);
  }
  function rMatch(m, isRoot) {
    const d = el('div', 'm' + (m.live ? ' live' : '') + (!m.done && !m.live ? ' tbd' : '') + (isRoot ? ' gf' : ''));
    const anyWin = m.o.some(x => x.win);
    m.o.slice(0, 2).forEach(o => {
      const r = el('div', 't' + (anyWin ? (o.win ? ' w' : ' l') : '') + (o.tbd ? ' ph' : '')); r.dataset.t = o.tbd ? '' : o.name;
      const lg = el('span', 'lg');
      if (o.logo) logoImg(o, lg); else lg.textContent = o.tbd ? '?' : o.name[0];
      r.append(lg, el('span', 'n', o.name), el('span', 's', o.score)); d.append(r);
    });
    if (m.live) d.append(el('span', 'pill', 'LIVE')); else if (!m.done && m.ts) d.append(el('span', 'note', fmt(m.ts)));
    if (isRoot) d.append(el('span', 'cup', '🏆'));
    return d;
  }
  function rItem(it, links, isRoot) {
    if (it.h) { const r = el('div', 'hrow'); it.h.forEach(t => r.append(el('div', 'hd', t))); return { node: r }; }
    const node = el('div', 'node'), kidEls = [];
    if (it.kids.length) { const k = el('div', 'kids'); it.kids.forEach(c => { const r = rItem(c, links, false); k.append(r.node); if (r.m) kidEls.push(r.m); }); node.append(k); }
    const m = rMatch(it.m, isRoot); node.append(m); links.push([m, kidEls]);
    return { node, m };
  }
  function render(data, animate) {
    panelHost.dataset.theme = isDark() ? 'dark' : 'light';
    titleEl.textContent = data.title || (S.tour ? S.tour.name : 'Bracket');
    body.textContent = '';
    const z = el('div', 'zoom'); body.append(z);
    if (!data.brackets.length) z.append(el('div', 'msg', 'Liquipedia has no bracket on this tournament page (yet).'));
    data.brackets.forEach(b => {
      const wrap = el('div', 'br' + (animate ? '' : ' noanim')), links = [];
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); wrap.append(svg);
      if (data.brackets.length > 1 && b.title) wrap.append(el('div', 'bt', b.title));
      const total = JSON.stringify(b.items).split('"o":').length - 1;
      const bodies = b.items.filter(i => i.m);
      b.items.forEach(it => wrap.append(rItem(it, links, total >= 3 && bodies.length === 1 && it === bodies[0]).node));
      z.append(wrap);
      svg.setAttribute('width', wrap.scrollWidth); svg.setAttribute('height', wrap.scrollHeight);
      links.forEach(([m, kids]) => {
        const col = Math.round(m.offsetLeft / COL); m.style.animationDelay = col * 0.3 + 's';
        kids.forEach(k => {
          const x1 = k.offsetLeft + k.offsetWidth, y1 = k.offsetTop + k.offsetHeight / 2, x2 = m.offsetLeft, y2 = m.offsetTop + m.offsetHeight / 2;
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('class', 'c');
          p.setAttribute('d', 'M' + x1 + ' ' + y1 + 'H' + (x2 - 14) + 'V' + y2 + 'H' + x2); p.style.animationDelay = (col - 0.4) * 0.3 + 's'; svg.append(p);
        });
      });
    });
    natW = z.offsetWidth; natH = z.offsetHeight; fit();
    foot.textContent = '';
    const a = el('a', null, 'Liquipedia'); a.href = 'https://liquipedia.net/' + S.tour.wiki + '/' + S.tour.page.split('/').map(encodeURIComponent).join('/'); a.target = '_blank'; a.rel = 'noopener';
    foot.append('Data: ', a, ' (CC BY-SA 3.0) · updated ' + new Date(data.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · hover a team to trace its path');
  }
  function message(text) { body.textContent = ''; body.append(el('div', 'msg', text)); }
  function refresh(force, animate) {
    const t = S.tour; if (!t || !S.open) return;
    if (!bcache.get(t.wiki + '|' + t.page)) message('Loading the bracket from Liquipedia… It allows one request every 30 seconds, so this can take a moment.');
    loadBracket(t, force).then(d => { if (S.tour === t && S.open) render(d, !!animate); },
      e => { if (S.tour === t && S.open && !bcache.get(t.wiki + '|' + t.page)) message('Could not load the bracket: ' + e.message); });
  }
  function setOpen(open) {
    S.open = open; ls.set('open', open ? 1 : 0);
    if (btn) btn.classList.toggle('on', open);
    clearInterval(S.timer);
    if (open && S.tour) {
      ensurePanel(); panelHost.style.display = ''; titleEl.textContent = S.tour.name; applyGeo();
      refresh(false, true);
      S.timer = setInterval(() => { if (!document.hidden) refresh(true, false); }, BRACKET_TTL);
    } else if (panelHost) panelHost.style.display = 'none';
  }
  function hideAll() { clearInterval(S.timer); if (btnHost) btnHost.remove(); if (panelHost) panelHost.style.display = 'none'; }
  function titleText() { const t = document.querySelector('[data-a-target="stream-title"]'); return t ? t.textContent : ''; }
  // Match this stream against a list of current matches; show the button when a tournament is found.
  function tryList(list, chan, wiki) {
    S.title = titleText();
    const hit = pick(list, chan, S.title);
    if (!hit || (S.tour && S.tour.page === hit.p)) return;
    S.tour = { wiki, page: hit.p, name: hit.n.split(' - ')[0] };
    placeButton();
    if (S.open) setOpen(true); else loadBracket(S.tour, false).catch(() => {});
  }
  // Use the saved match list straight away (even if it is a little old) so the button appears at once,
  // then fetch a fresh list in the background when the saved one has expired.
  async function detect(key, chan, wiki) {
    try {
      const c = ls.get('m:' + wiki);
      if (c && c.list) { tryList(c.list, chan, wiki); if (Date.now() - c.t < MATCH_TTL) return; }
      const list = await fetchMatches(wiki);
      if (S.key === key) tryList(list, chan, wiki);
    } catch (e) { console.debug('[twitch-bracket]', e); }
  }
  function tick() {
    const m = location.pathname.match(/^\/([A-Za-z0-9_]{3,25})\/?$/);
    const gl = document.querySelector('a[data-a-target="stream-game-link"]');
    const slug = gl ? ((gl.getAttribute('href') || '').split('/category/')[1] || '').split(/[?#/]/)[0] : '';
    const wiki = WIKIS[slug];
    const key = m && wiki ? m[1].toLowerCase() + '|' + wiki : null;
    if (key !== S.key) { S.key = key; S.tour = null; S.title = ''; hideAll(); if (key) detect(key, m[1], wiki); }
    else if (S.tour) placeButton();
    else if (key && titleText() !== S.title) {
      // The stream title arrived or changed after the first check: try the saved list again.
      const c = ls.get('m:' + wiki);
      if (c && c.list) tryList(c.list, m[1], wiki); else S.title = titleText();
    }
  }
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; tick(); }, 1000); })
    .observe(document.documentElement, { childList: true, subtree: true });
  tick();
})();
