// ==UserScript==
// @name         Twitch tournament bracket
// @namespace    claude-for-zen
// @version      1.6.0
// @description  On a Twitch stream that is showing an ongoing esports tournament (looked up on Liquipedia), adds a "Bracket" button next to Follow that shows the stage being played (group standings and matches, or the bracket) with tabs for the other stages, drafts per game when a match is clicked, and for Dota 2 live game stats from the stream's Dota 2 Tooltips extension.
// @author       Ephpotle
// @license      MIT
// @homepageURL  https://github.com/Ephpotle/twitch-tournament-bracket
// @supportURL   https://github.com/Ephpotle/twitch-tournament-bracket/issues
// @match        https://www.twitch.tv/*
// @match        https://nukn6qm6lg8vq63evx3v9ir4cdrzq2.ext-twitch.tv/*
// @grant        GM_xmlhttpRequest
// @connect      liquipedia.net
// @connect      api.opendota.com
// ==/UserScript==

(function () {
  'use strict';
  const EXT_ORIGIN = 'https://nukn6qm6lg8vq63evx3v9ir4cdrzq2.ext-twitch.tv';

  /* ---------- inside the Dota 2 Tooltips extension frame: pass the game feed up to the Twitch page ---------- */
  // Only the "broadcast" game data is forwarded (never the extension's login/auth messages).
  if (location.origin === EXT_ORIGIN) {
    window.addEventListener('message', e => {
      let d;
      try { d = e.data; d = JSON.parse(JSON.stringify((d && d.wrappedJSObject) || d)); } catch (err) { return; }
      if (!d || d.action !== 'twitch-ext-pubsub-message' || !d.payload || d.payload.target !== 'broadcast') return;
      const c = d.payload.content;
      (Array.isArray(c) ? c : [c]).forEach(x => {
        let o; try { o = typeof x === 'string' ? JSON.parse(x) : x; } catch (err) { return; }
        if (o && o.active_game) {
          try { window.top.postMessage(JSON.stringify({ ttbLive: 1, g: o.active_game }), 'https://www.twitch.tv'); } catch (err) {}
        }
      });
    }, true);
    return;
  }
  if (window.top !== window) return;
  if (window.__ttbLoaded) return; window.__ttbLoaded = true;

  // Liquipedia wiki -> the Twitch categories that belong to it (category URL slugs, checked against Twitch).
  const GAMES = {
    dota2: 'dota-2', counterstrike: 'counter-strike', valorant: 'valorant', leagueoflegends: 'league-of-legends',
    mobilelegends: 'mobile-legends-bang-bang', rocketleague: 'rocket-league', overwatch: 'overwatch-2',
    rainbowsix: 'tom-clancys-rainbow-six-siege', apexlegends: 'apex-legends', pubg: 'pubg-battlegrounds',
    pubgmobile: 'pubg-mobile', freefire: 'garena-free-fire', starcraft2: 'starcraft-ii', starcraft: 'starcraft',
    warcraft: 'warcraft-iii', brawlstars: 'brawl-stars', honorofkings: 'honor-of-kings', marvelrivals: 'marvel-rivals',
    fortnite: 'fortnite', worldoftanks: 'world-of-tanks', hearthstone: 'hearthstone', heroes: 'heroes-of-the-storm',
    wildrift: 'league-of-legends-wild-rift', standoff2: 'standoff-2', tft: 'teamfight-tactics', trackmania: 'trackmania',
    deadlock: 'deadlock-1', crossfire: 'crossfire-2007', geoguessr: 'geoguessr', clashroyale: 'clash-royale',
    identityv: 'identity-v', thefinals: 'the-finals', osu: 'osu', deltaforce: 'delta-force-hawk-ops',
    teamfortress: 'team-fortress-2', halo: 'halo-infinite', worldofwarcraft: 'world-of-warcraft',
    clashofclans: 'clash-of-clans', eva: 'after-h', warthunder: 'war-thunder', tarkovarena: 'escape-from-tarkov-arena',
    omegastrikers: 'omega-strikers', brawlhalla: 'brawlhalla', naraka: 'naraka-bladepoint', rematch: 'rematch',
    splatoon: 'splatoon-3', stormgate: 'stormgate', goals: 'goals', chess: 'chess-1', formula1: 'formula-1',
    smash: 'super-smash-bros-ultimate super-smash-bros-melee',
    ageofempires: 'age-of-empires-ii age-of-empires-iv age-of-empires-iii age-of-mythology',
    callofduty: 'call-of-duty-black-ops-7 call-of-duty-black-ops-6 call-of-duty-modern-warfare-iii call-of-duty-warzone call-of-duty-mobile call-of-duty-warzone-mobile',
    easportsfc: 'ea-sports-fc-26 ea-sports-fc-25 fc-mobile',
    pokemon: 'pokemon-unite pokemon-scarlet-violet pokemon-trading-card-game-live pokemon-go pokemon-champions pokemon-legends-z',
    tetris: 'tetris-1989 tetr-io tetris-effect-connected tetris-99',
    arenafps: 'quake-champions quake-live quake-iii-arena diabotical',
    simracing: 'iracing assetto-corsa-competizione assetto-corsa assetto-corsa-2 rfactor-2 gran-turismo-7 le-mans-ultimate raceroom-racing-experience f1-25 ea-sports-f1-24',
    fighters: 'street-fighter-6 tekken-8 guilty-gear-strive mortal-kombat-1 granblue-fantasy-versus-rising fatal-fury-city-of-the-wolves street-fighter-v dragon-ball-fighterz the-king-of-fighters-xv 2xko under-night-in-birth-ii-sys-celes tekken-7-2015 virtua-fighter-5-r-e-v-o marvel-tokon-fighting-souls invincible-vs'
  };
  const WIKIS = {};
  for (const w in GAMES) GAMES[w].split(' ').forEach(s => { WIKIS[s] = w; });
  const UA = 'TwitchTournamentBracket/1.6 (+https://github.com/Ephpotle/twitch-tournament-bracket)';
  const PARSE_GAP = 31000, MATCH_TTL = 10 * 60e3, BRACKET_TTL = 3 * 60e3, LIVE_STALE = 20000, COL = 206;
  const LIVE = '__live';
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem('ttb:' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('ttb:' + k, JSON.stringify(v)); } catch (e) {} }
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const direct = (e, cls) => [...e.children].filter(c => c.classList.contains(cls));
  // Name variants of a team as written in stream titles: "Team Spirit" is often just "Spirit".
  const variants = n => (Array.isArray(n) ? n : [n]).flatMap(v => [v, (v || '').replace(/^team\s+/i, '')])
    .filter((v, i, arr) => v && v.length >= 2 && v !== 'TBD' && arr.indexOf(v) === i);

  /* ---------- network ---------- */
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
  function parsePage(wiki, page) {
    return gate(async () => {
      const txt = await httpGet('https://liquipedia.net/' + wiki + '/api.php?action=parse&page=' + encodeURIComponent(page) +
        '&prop=text%7Cdisplaytitle&format=json&origin=*');
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
  // Dota 2 item numbers -> internal names (for icons), from OpenDota's public constants; kept for a week.
  let ITEMS = null, itemsLoading = false;
  function ensureItems() {
    if (ITEMS || itemsLoading) return;
    const c = ls.get('items');
    if (c && c.map && Date.now() - c.t < 7 * 864e5) { ITEMS = c.map; return; }
    itemsLoading = true;
    httpGet('https://api.opendota.com/api/constants/item_ids').then(t => {
      const j = JSON.parse(t), map = {};
      for (const k in j) if (/^\d+$/.test(k) && typeof j[k] === 'string' && /^[a-z0-9_]+$/.test(j[k])) map[k] = j[k];
      ITEMS = map; ls.set('items', { t: Date.now(), map });
    }).catch(() => {}).finally(() => { itemsLoading = false; });
  }

  /* ---------- Liquipedia match list ---------- */
  // Each opponent is kept as a list of name variants: the short name ("TSpirit"), the bracket/full
  // names ("Team Spirit") and the team link title, because stream titles use any of them.
  function oppNames(op) {
    const parts = [...op.querySelectorAll('.team-shortname, .team-bracketname, .team-name')].map(e => e.textContent.trim());
    if (!parts.length) { const nm = op.querySelector('.name'); if (nm) parts.push(nm.textContent.trim()); }
    const a = op.querySelector('a[title]');
    const full = a ? a.getAttribute('title').replace(/\s*\(page does not exist\)$/, '').replace(/\s*\([^)]*\)$/, '').trim() : '';
    return [...parts, full].filter((v, i, arr) => v && arr.indexOf(v) === i);
  }
  // Current layout uses .match-ticker-card, the older one .match-info. Besides the tournament page, each
  // match records which part of it it belongs to: the link's #fragment ("Group_A") and the stage label ("Group A - Bo3").
  function parseMatches(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    let cards = [...d.querySelectorAll('.match-ticker-card')];
    if (!cards.length) cards = [...d.querySelectorAll('.match-info')];
    return cards.map(x => {
      const a = x.querySelector('.match-ticker-card-tournament-name a[href], .match-info-tournament a[href]');
      const href = a && a.getAttribute('href');
      if (!href || href.includes('index.php')) return null;
      const t = x.querySelector('.timer-object');
      const nameEl = x.querySelector('.match-ticker-card-tournament-name, .match-info-tournament-name');
      let page, frag = '';
      try {
        const [path, hash] = href.replace(/^\/[^/]+\//, '').split('#');
        page = decodeURIComponent(path); frag = hash ? decodeURIComponent(hash) : '';
      } catch (e) { return null; }
      const hd = x.querySelector('.match-ticker-card__header');
      const lab = hd ? [...hd.children].find(c => c.tagName === 'DIV') : null;
      return {
        p: page, f: frag, g: lab ? lab.textContent.replace(/\s*-\s*Bo\d+.*$/i, '').trim() : '',
        n: (nameEl ? nameEl.textContent.trim() : '') || page.replace(/_/g, ' '),
        s: [...x.querySelectorAll('a[href*="Special:Stream/twitch/"]')].map(l => norm(l.getAttribute('href').split('Special:Stream/twitch/')[1])),
        ts: t ? +t.dataset.timestamp || 0 : 0, fin: !!t && t.dataset.finished === 'finished',
        o: [...x.querySelectorAll('.match-ticker-card__opponent, .match-info-header-opponent')].map(oppNames)
      };
    }).filter(Boolean);
  }
  // Which match is this stream showing? 1) Liquipedia lists this channel as the stream,
  // 2) both teams of a current match are named in the stream title,
  // 3) the tournament name, or the name of its series ("1win Essence"), is in the title.
  // Among several candidates the one whose teams are named in the title wins, then the one closest in time.
  function pick(list, chan, title) {
    const now = Date.now() / 1000, c = norm(chan), tl = ' ' + title.toLowerCase() + ' ';
    const word = n => { const i = tl.indexOf(n.toLowerCase()); return i > 0 && !/[a-z0-9]/.test(tl[i - 1]) && !/[a-z0-9]/.test(tl[i + n.length] || ' '); };
    const named = m => m.o.filter(n => variants(n).some(word)).length;
    const cand = list.filter(m => !m.fin && m.ts < now + 3 * 3600 && m.ts > now - 12 * 3600);
    let hit = cand.filter(m => m.s.includes(c));
    if (!hit.length) hit = cand.filter(m => m.ts < now + 1800 && m.o.length === 2 && named(m) === 2);
    if (!hit.length) hit = cand.filter(m => {
      const nm = m.n.split(' - ')[0], series = m.p.split('/')[0].replace(/_/g, ' ');
      return (nm.length >= 6 && tl.includes(nm.toLowerCase())) || (series.length >= 8 && word(series));
    });
    hit.sort((a, b) => (named(b) - named(a)) || (Math.abs(a.ts - now) - Math.abs(b.ts - now)));
    return hit[0] || null;
  }

  /* ---------- tournament page parsing (Liquipedia pages are publicly editable: treat everything as untrusted text) ---------- */
  const isDark = () => !document.documentElement.classList.contains('tw-root--theme-light');
  // Only ever load images from liquipedia.net itself, or Valve's Dota CDN for the live feed.
  function safeLogo(src) {
    if (!src) return '';
    try { const u = new URL(src, 'https://liquipedia.net'); return u.protocol === 'https:' && u.hostname === 'liquipedia.net' ? u.href : ''; }
    catch (e) { return ''; }
  }
  const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/';
  const cdn = (kind, key) => /^[a-z0-9_]+$/.test(key || '') ? CDN + kind + '/' + key + '.png' : '';
  function teamOf(e) {
    const nameEl = e.querySelector('.team-bracketname, .team-name') || e.querySelector('.name.hidden-xs') || e.querySelector('.name');
    const name = ((nameEl ? nameEl.textContent : '') || e.getAttribute('aria-label') || '').trim();
    const img = e.querySelector(isDark() ? '.team-template-darkmode img' : '.team-template-lightmode img') ||
      e.querySelector('.team-template-image-icon img, .brkts-opponent-entry-left img');
    const tbd = !name || name === 'TBD';
    return { name: tbd ? 'TBD' : name, tbd, logo: tbd || !img ? '' : safeLogo(img.getAttribute('src')) };
  }
  // Drafts from a match's details popup: per game the heroes of each side (with Radiant/Dire),
  // the game length, the winner and the bans.
  function heroList(thumbs) {
    if (!thumbs) return [];
    return [...thumbs.querySelectorAll('a[title]')].slice(0, 8).map(a => {
      const img = a.querySelector('img'), sideEl = a.closest('.brkts-popup-side-color');
      return { n: a.getAttribute('title').trim().slice(0, 40), img: img ? safeLogo(img.getAttribute('src')) : '',
        side: sideEl ? ((sideEl.className.match(/--(radiant|dire)\b/) || [])[1] || '') : '' };
    });
  }
  function parseGames(root) {
    const pop = root.querySelector('.brkts-popup');
    if (!pop) return [];
    const bans = [...pop.querySelectorAll('.brkts-popup-veto-row')];
    return [...pop.querySelectorAll('.brkts-popup-body-grid-row')].map((r, i) => {
      const det = r.querySelector('.brkts-popup-body-grid-row-detail');
      if (!det) return null;
      const sp = direct(det, 'brkts-popup-spaced');
      const th = k => sp[k] ? sp[k].querySelector('.brkts-popup-body-element-thumbs') : null;
      const lab = r.querySelector('.generic-label'), lt = lab ? lab.dataset.labelType || '' : '';
      const bth = bans[i] ? [...bans[i].querySelectorAll('.brkts-popup-body-element-thumbs')] : [];
      const g = { a: heroList(th(0)), b: heroList(th(2)), len: sp[1] && !th(1) ? sp[1].textContent.trim().slice(0, 12) : '',
        w: lt === 'result-win' ? 'a' : lt === 'result-loss' ? 'b' : '', ba: heroList(bth[0]), bb: heroList(bth[1]) };
      return g.a.length || g.b.length ? g : null;
    }).filter(Boolean).slice(0, 7);
  }
  function state(root, o) {
    const t = root.querySelector('.timer-object');
    const ts = t ? +t.dataset.timestamp || 0 : 0, fin = !!t && t.dataset.finished === 'finished';
    const done = fin || o.some(x => x.win);
    return { o, ts, done, live: !done && ts > 0 && ts <= Date.now() / 1000 && o.some(x => !x.tbd), games: parseGames(root) };
  }
  function parseMatch(m) {
    const o = direct(m, 'brkts-opponent-entry').map(e => {
      const sc = e.querySelector('.brkts-opponent-score-inner');
      return Object.assign(teamOf(e), { score: sc ? sc.textContent.trim() : '', win: e.classList.contains('brkts-opponent-win') || !!e.querySelector('.brkts-opponent-win') });
    });
    return state(m, o);
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
  // Group standings. Tables with one view per round (Swiss) keep only the round shown by default.
  function parseStandings(host) {
    const area = host.querySelector('[data-toggle-area]') || host.closest('[data-toggle-area]');
    const act = area ? area.dataset.toggleArea : null;
    let scope = host;
    if (act != null) { const c = host.querySelector('[data-toggle-area-content="' + act + '"]'); if (c && c.querySelector('tr')) scope = c; }
    let rows = [...scope.querySelectorAll('tr')].filter(r => !r.querySelector('th') && r.querySelector('.block-team'));
    if (act != null) { const f = rows.filter(r => !r.dataset.toggleAreaContent || r.dataset.toggleAreaContent === act); if (f.length) rows = f; }
    const head = [...host.querySelectorAll('tr')].find(r => r.querySelectorAll('th').length >= 3);
    const ths = head ? [...head.querySelectorAll('th')].map(t => t.textContent.trim()) : [];
    const pi = ths.findIndex(t => /participant|team|player/i.test(t));
    const cols = pi >= 0 ? ths.slice(pi + 1) : [];
    const out = rows.slice(0, 32).map(r => {
      const cells = [...r.cells], part = cells.find(c => c.querySelector('.block-team')), ix = cells.indexOf(part);
      return Object.assign(teamOf(part), {
        pos: ix > 0 ? cells[0].textContent.trim() : '', st: r.dataset.positionStatus || '',
        vals: cells.slice(ix + 1).map(c => c.textContent.trim().replace(/\s+/g, ' '))
      });
    });
    const tt = host.querySelector('.table2__title');
    return { k: 's', title: tt ? tt.textContent.trim() : 'Standings', cols: cols.length ? cols : (out[0] ? out[0].vals.map(() => '') : []), rows: out };
  }
  function parseList(ml) {
    const rows = [];
    ml.querySelectorAll('.brkts-matchlist-header, .brkts-matchlist-match').forEach(x => {
      if (x.closest('.brkts-popup')) return;
      if (x.classList.contains('brkts-matchlist-header')) { rows.push({ h: x.textContent.trim() }); return; }
      const opp = direct(x, 'brkts-matchlist-opponent'), sc = direct(x, 'brkts-matchlist-score');
      const o = opp.slice(0, 2).map((c, i) => Object.assign(teamOf(c), {
        score: sc[i] ? sc[i].textContent.trim() : '', win: c.classList.contains('brkts-matchlist-slot-winner')
      }));
      if (o.length === 2) rows.push({ m: state(x, o) });
    });
    return { k: 'l', title: 'Matches', rows };
  }
  // Team rosters from the Participants section, used to tell which five players in the live feed are which team,
  // and which position (1-5) each of them plays (the number Liquipedia shows next to each member).
  function parseRosters(d) {
    return [...d.querySelectorAll('.team-participant-card')].slice(0, 64).map(cd => {
      const op = cd.querySelector('.team-participant-card__opponent-full') || cd.querySelector('.team-participant-card__opponent');
      if (!op) return null;
      const t = teamOf(op);
      let mem = [...cd.querySelectorAll('.team-participant-card__member')].map(m => {
        const n = m.querySelector('.team-participant-card__member-name'), r = m.querySelector('[class*="team-participant-card__member-role"]');
        return { n: n ? n.textContent.trim() : '', r: r ? r.textContent.trim() : '' };
      });
      if (!mem.length) mem = [...cd.querySelectorAll('.team-participant-card__member-name')].map(x => ({ n: x.textContent.trim(), r: '' }));
      mem = mem.filter(x => x.n).slice(0, 10);
      const players = mem.map(x => x.n.slice(0, 32));
      const roles = mem.map(x => /^[1-5]$/.test(x.r) ? x.r : '');
      return t.tbd || !players.length ? null : { name: t.name, logo: t.logo, players, roles };
    }).filter(Boolean);
  }
  // Walk backwards/upwards from an element to the nearest heading matching sel.
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
  // A tournament page becomes a list of views, one per section heading that holds a bracket,
  // group standings or a match list: e.g. Group A, Group B, ..., Playoffs.
  function parseTour(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    const items = [];
    d.querySelectorAll('.brkts-bracket').forEach(e => { if (!e.closest('.brkts-popup')) items.push({ k: 'b', e }); });
    d.querySelectorAll('[data-analytics-name]').forEach(e => { if (/standings/i.test(e.dataset.analyticsName || '') && e.querySelector('table')) items.push({ k: 's', e }); });
    d.querySelectorAll('.brkts-matchlist').forEach(e => { if (!e.closest('.brkts-popup')) items.push({ k: 'l', e }); });
    items.sort((a, b) => (a.e.compareDocumentPosition(b.e) & 4) ? -1 : 1);
    const views = [], byKey = {};
    items.forEach(it => {
      const h = headingBefore(it.e, d.body, 'h2,h3,h4');
      const id = h ? (h.id || ((h.querySelector('[id]') || {}).id) || '') : '';
      const title = h ? (h.querySelector('.mw-headline') || h).textContent.replace(/\[edit\]/g, '').trim() : 'Bracket';
      const key = id || title;
      let v = byKey[key];
      if (!v) { if (views.length >= 16) return; v = byKey[key] = { id, title, parts: [] }; views.push(v); }
      if (it.k === 'b') {
        if (v.parts.filter(p => p.k === 'b').length >= 4) return;
        const items2 = convert(it.e);
        if (items2.some(i => i.m)) v.parts.push({ k: 'b', items: items2 });
      } else if (it.k === 's') { const s = parseStandings(it.e); if (s.rows.length) v.parts.push(s); }
      else { const l = parseList(it.e); if (l.rows.some(r => r.m)) v.parts.push(l); }
    });
    return { views: views.filter(v => v.parts.length), rosters: parseRosters(d) };
  }
  const vkey = v => v.id || v.title;
  const mkey = m => m.o.map(x => x.name).join('|') + '|' + m.ts;
  function viewMatches(v) {
    const out = [];
    const walk = items => items.forEach(i => { if (i.m) out.push(i.m); if (i.kids) walk(i.kids); });
    (v.parts || []).forEach(p => { if (p.k === 'b') walk(p.items); else if (p.k === 'l') p.rows.forEach(r => { if (r.m) out.push(r.m); }); });
    return out;
  }
  // Is this the match on stream? Both names must belong to the two teams of the matched Liquipedia match.
  function isCur(m) {
    const o = S.tour && S.tour.o;
    if (!o || o.length !== 2 || m.o.length < 2 || m.o.some(x => x.tbd)) return false;
    const has = (n, vs) => variants(vs).some(v => norm(v) === norm(n));
    const [a, b] = m.o;
    return (has(a.name, o[0]) && has(b.name, o[1])) || (has(a.name, o[1]) && has(b.name, o[0]));
  }
  // The view to open on: the section the stream's match links to, or whose title is the match's
  // stage label, or the one holding the stream's match, a live match, or the next match; else the first.
  function pickView(views, t) {
    const f = norm(t.f), g = norm(t.g), now = Date.now() / 1000;
    return (f && views.find(v => norm(v.id) === f)) || (g && views.find(v => norm(v.title) === g)) ||
      views.find(v => viewMatches(v).some(isCur)) || views.find(v => viewMatches(v).some(m => m.live)) ||
      views.map(v => ({ v, d: Math.min(...viewMatches(v).filter(m => !m.done && m.ts > now - 3 * 3600).map(m => Math.abs(m.ts - now)), Infinity) }))
        .sort((a, b) => a.d - b.d).filter(x => x.d < Infinity).map(x => x.v)[0] ||
      views.find(v => v.parts.some(p => p.k === 'b')) || views[0];
  }
  const bcache = new Map(), pendingB = {};
  function loadTour(t, force) {
    const k = t.wiki + '|' + t.page, c = bcache.get(k);
    if (c && !force && Date.now() - c.t < BRACKET_TTL) return Promise.resolve(c);
    if (!pendingB[k]) {
      pendingB[k] = (async () => {
        const r = await parsePage(t.wiki, t.page), p = parseTour(r.html);
        const d = { t: Date.now(), title: r.title, views: p.views, rosters: p.rosters };
        bcache.set(k, d); return d;
      })().finally(() => { delete pendingB[k]; });
    }
    return pendingB[k];
  }

  /* ---------- live game feed (Dota 2 Tooltips extension) ---------- */
  const HERO_NAMES = { magnataur: 'Magnus', doom_bringer: 'Doom', windrunner: 'Windranger', shredder: 'Timbersaw', nevermore: 'Shadow Fiend',
    obsidian_destroyer: 'Outworld Destroyer', furion: "Nature's Prophet", wisp: 'Io', zuus: 'Zeus', rattletrap: 'Clockwerk',
    skeleton_king: 'Wraith King', life_stealer: 'Lifestealer', queenofpain: 'Queen of Pain', vengefulspirit: 'Vengeful Spirit',
    centaur: 'Centaur Warrunner', treant: 'Treant Protector', necrolyte: 'Necrophos', abyssal_underlord: 'Underlord', antimage: 'Anti-Mage' };
  const tcase = s => (s || '').split('_').map((w, i) => (i && /^(of|the)$/.test(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const heroName = k => HERO_NAMES[k] || tcase(k);
  const num = v => (Number.isFinite(+v) ? +v : 0);
  // The feed is untrusted: keep only known fields, as numbers or short strings.
  function cleanLive(g) {
    const hd = g && g.hero_data;
    if (!hd || typeof hd !== 'object') return null;
    const heroes = [];
    Object.keys(hd).slice(0, 10).forEach(k => {
      if (!/^[a-z0-9_]{2,40}$/.test(k)) return;
      const h = hd[k] || {}, arr = (a, n) => (Array.isArray(a) ? a.slice(0, n).map(num) : []);
      const items = [];
      for (let i = 0; i < 6; i++) { const it = h.items && h.items[i]; items.push(it && Number.isInteger(+it.i) && +it.i > 0 ? +it.i : 0); }
      heroes.push({ k, p: String(h.p == null ? '' : h.p).slice(0, 32), lvl: num(h.lvl), nw: num(h.nw), hd: num(h.hd), kd: arr(h.kd, 3), cs: arr(h.cs, 2), items });
    });
    if (heroes.length !== 10) return null;
    return { id: String(g.matchid || '').replace(/\D/g, '').slice(0, 20), sel: String(g.selected_hero || '').replace(/^npc_dota_hero_/, ''), heroes };
  }
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const fmtK = n => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
  const liveFresh = () => !!(S.live && Date.now() - S.live.t < LIVE_STALE);
  window.addEventListener('message', e => {
    if (e.origin !== EXT_ORIGIN || typeof e.data !== 'string' || e.data.indexOf('{"ttbLive":1') !== 0) return;
    let L; try { L = cleanLive(JSON.parse(e.data).g); } catch (err) { return; }
    if (!L || !S.tour) return;
    L.t = Date.now(); S.live = L; ensureItems();
    // Net worth lead over time (first five heroes minus the other five), one point every 8 s.
    const lead = sum(L.heroes.slice(0, 5), h => h.nw) - sum(L.heroes.slice(5), h => h.nw);
    if (!S.hist || S.hist.id !== L.id) S.hist = { id: L.id, pts: [] };
    const last = S.hist.pts[S.hist.pts.length - 1];
    if (!last || L.t - last[0] >= 8000) { S.hist.pts.push([L.t, lead]); if (S.hist.pts.length > 900) S.hist.pts.shift(); }
    liveTick();
  });
  // Which roster is each side of the feed? Players are matched by name, preferring the two teams of the stream's match.
  function liveTeams(sides, rosters) {
    const tourNames = (S.tour && S.tour.o) || [];
    const inTour = rosters.filter(r => tourNames.some(vs => variants(vs).some(v => norm(v) === norm(r.name))));
    const pool = inTour.length >= 2 ? inTour : rosters;
    const same = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a === b || (b.length >= 3 && a.includes(b)) || (a.length >= 3 && b.includes(a))); };
    const score = (side, r) => side.filter(h => r.players.some(p => same(h.p, p))).length;
    const best = side => pool.map(r => ({ r, s: score(side, r) })).sort((x, y) => y.s - x.s)[0];
    let A = best(sides[0]), B = best(sides[1]);
    A = A && A.s >= 2 ? A.r : null; B = B && B.s >= 2 ? B.r : null;
    if (A && B && A === B) { if (score(sides[0], A) >= score(sides[1], A)) B = null; else A = null; }
    if (inTour.length === 2) { if (A && !B) B = inTour.find(r => r !== A); else if (B && !A) A = inTour.find(r => r !== B); }
    return [A || { name: 'Team 1', logo: '' }, B || { name: 'Team 2', logo: '' }];
  }
  // Position (1-5) of a player in the live feed, from the team's tournament roster; '' when the player
  // is not listed there (a stand-in, say). Exact name first, then one name containing the other ("kaori ✏").
  const POS = { 1: 'Position 1: carry (safe lane)', 2: 'Position 2: mid', 3: 'Position 3: offlane', 4: 'Position 4: soft support', 5: 'Position 5: hard support' };
  function roleOf(team, name) {
    const a = norm(name);
    if (!a || !team || !team.players || !team.roles) return '';
    let i = team.players.findIndex(p => norm(p) === a);
    if (i < 0) i = team.players.findIndex(p => { const b = norm(p); return b.length >= 3 && a.length >= 3 && (a.includes(b) || b.includes(a)); });
    return i >= 0 ? team.roles[i] || '' : '';
  }
  let lastLiveDraw = 0;
  function liveTick() {
    if (!S.open || !panelHost || !S.data || panelHost.style.display === 'none') return;
    const fresh = liveFresh();
    if (fresh !== S.liveTab || (S.shown === LIVE && Date.now() - lastLiveDraw > 1800)) {
      const st = body.scrollTop; render(S.data, false); body.scrollTop = st;
    }
  }

  /* ---------- UI ---------- */
  const CSS = `
:host{all:initial;--bg:#121218;--bg2:#1d1830;--fg:#f0f0f5;--mut:#8d8da0;--box:#22222c;--line:#4b4b5e;--win:#3ddc84;--lose:#ff6b6b;--live:#a58bff;--gold:#ffc94d;--row:#2c2c38;--chip:#17171d;--cur:#ff4f4f;--ta:#5aa9ff;--tb:#ff9f43}
:host([data-theme=light]){--bg:#f6f5fb;--bg2:#e6e1f8;--fg:#1b1b1f;--mut:#6f6f82;--box:#fff;--line:#c5c3d6;--win:#12a150;--lose:#d93636;--live:#7c4dff;--gold:#c98a00;--row:#ecebf3;--chip:#e9e8f1;--cur:#e5212b;--ta:#1f7ae0;--tb:#e07a12}
*{box-sizing:border-box}
.btn{display:inline-flex;align-items:center;gap:6px;height:30px;margin-right:10px;padding:0 12px;border-radius:15px;border:1px solid var(--live);background:transparent;color:var(--fg);font:600 13px/1 Inter,Roobert,system-ui,sans-serif;cursor:pointer;white-space:nowrap;transition:background .15s}
.btn:hover{background:rgba(145,71,255,.25)}.btn.on{background:#9147ff;border-color:#9147ff;color:#fff}
.panel{position:relative;width:100%;height:100%;font:12px/1.2 Inter,Roobert,system-ui,sans-serif;color:var(--fg);background:radial-gradient(600px 300px at 80% 0%,var(--bg2),transparent),radial-gradient(500px 300px at 0% 100%,var(--bg2),transparent),var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.55);display:flex;flex-direction:column;max-width:calc(100vw - 32px);max-height:calc(100vh - 80px);overflow:hidden}
.head{display:flex;align-items:center;gap:10px;padding:8px 10px 8px 18px;cursor:move;user-select:none;border-bottom:1px solid var(--line);flex:none}
.head b{font-size:13px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.head button{all:unset;cursor:pointer;color:var(--mut);font-size:15px;padding:2px 7px;border-radius:5px}.head button:hover{background:var(--row);color:var(--fg)}
.tabs{display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px 2px;flex:none}.tabs:empty{display:none}
.tab{all:unset;cursor:pointer;font:600 11px/1 Inter,Roobert,system-ui,sans-serif;padding:5px 10px;border-radius:12px;background:var(--chip);color:var(--mut);white-space:nowrap;transition:background .15s,color .15s}
.tab:hover{color:var(--fg)}.tab.on{background:#9147ff;color:#fff}
.tab.here::after{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--cur);margin-left:6px;vertical-align:1px}
.tab.lvt::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--cur);margin-right:6px;vertical-align:1px;animation:blink 1s infinite}.tab.lvt.here::after{display:none}
.body{flex:1;display:flex;overflow:auto;padding:6px 14px 4px;min-width:260px;min-height:60px}
.zoom{margin:auto;flex:none;width:max-content}
.foot{flex:none;padding:5px 18px 7px 14px;color:var(--mut);font-size:10px;border-top:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.foot a{color:var(--mut)}
.rz{position:absolute;width:16px;height:16px;z-index:3;cursor:nwse-resize;touch-action:none}
.rz.tl{left:0;top:0;background:linear-gradient(135deg,var(--line) 0 38%,transparent 38%)}
.rz.br{right:0;bottom:0;background:linear-gradient(135deg,transparent 62%,var(--line) 62%)}
.rz.tl:hover{background:linear-gradient(135deg,var(--live) 0 38%,transparent 38%)}.rz.br:hover{background:linear-gradient(135deg,transparent 62%,var(--live) 62%)}
.msg{padding:18px 4px;color:var(--mut);font-size:12px;max-width:340px}
.br{position:relative;display:flex;flex-direction:column;align-items:flex-end;width:max-content;padding:0 2px 18px 0}
.br svg{position:absolute;left:0;top:0;pointer-events:none}
.hrow{display:flex;justify-content:flex-end;margin:12px 0 8px}
.hd{width:${COL}px;padding-left:28px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.node{display:flex;align-items:center;justify-content:flex-end}
.kids{display:flex;flex-direction:column;align-items:flex-end;gap:18px}
.m{position:relative;flex:none;width:178px;margin-left:28px;background:var(--box);border:1px solid var(--line);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.18);opacity:0;transform:translateX(-14px) scale(.96);animation:in .5s cubic-bezier(.2,.9,.3,1.2) forwards;transition:opacity .2s,transform .2s}
@keyframes in{to{opacity:1;transform:none}}
.noanim .m,.noanim .card,.noanim .gcard{animation:none;opacity:1;transform:none}.noanim .c{animation:none;stroke-dashoffset:0}
.t{display:flex;align-items:center;gap:7px;height:26px;padding:0 8px 0 5px;position:relative;transition:background .2s}
.t+.t{border-top:1px solid var(--row)}.t:first-child{border-radius:7px 7px 0 0}.t:nth-child(2){border-radius:0 0 7px 7px}
.lg{width:20px;height:20px;border-radius:5px;background:var(--chip);display:grid;place-items:center;flex:none;font-size:9px;font-weight:700;color:var(--mut);overflow:hidden}
.lg img{max-width:16px;max-height:16px;display:block}
.n{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s{font-weight:700;font-variant-numeric:tabular-nums;min-width:10px;text-align:right}
.w .n{font-weight:700}.w .s{color:var(--win)}.t.w::before{content:"";position:absolute;left:0;top:4px;bottom:4px;width:3px;border-radius:2px;background:var(--win)}
.l .n,.l .s,.ph .n{color:var(--mut)}.l .lg{opacity:.55}
.tbd{border-style:dashed}
.live{border-color:var(--live);animation:in .5s cubic-bezier(.2,.9,.3,1.2) forwards,pulse 1.6s 1s ease-in-out infinite}.noanim .live{animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(145,71,255,.55)}50%{box-shadow:0 0 0 7px rgba(145,71,255,0),0 0 18px rgba(145,71,255,.55)}}
.pill{position:absolute;right:8px;top:-8px;background:#9147ff;color:#fff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:8px;letter-spacing:.06em}
.pill::before,.lp::before{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:#fff;margin-right:4px;animation:blink 1s infinite}
@keyframes blink{50%{opacity:.2}}
.note{position:absolute;left:2px;top:55px;font-size:10px;color:var(--mut);white-space:nowrap}
.cur{outline:2px solid var(--cur);outline-offset:2px}
.clk{cursor:pointer}.m.clk:hover,.gm.clk:hover{box-shadow:0 0 0 1px var(--live),0 0 14px rgba(145,71,255,.35)}
.gf{border-color:var(--gold);box-shadow:0 0 16px rgba(255,190,60,.28)}
.gf::after{content:"";position:absolute;inset:0;border-radius:8px;background:linear-gradient(110deg,transparent 35%,rgba(255,220,130,.25) 50%,transparent 65%);background-size:250% 100%;animation:sh 3s linear infinite;pointer-events:none}
@keyframes sh{from{background-position:120% 0}to{background-position:-130% 0}}
.cup{position:absolute;right:-6px;top:-20px;font-size:20px;animation:bob 2s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(-4px) rotate(8deg)}}
.c{fill:none;stroke:var(--line);stroke-width:1.5;stroke-dasharray:500;stroke-dashoffset:500;animation:draw .7s ease-out forwards;transition:opacity .2s}
@keyframes draw{to{stroke-dashoffset:0}}
.grp{display:flex;gap:16px;align-items:flex-start;padding:10px 2px 12px}
.card{background:var(--box);border:1px solid var(--line);border-radius:10px;padding:9px 0 4px;box-shadow:0 2px 8px rgba(0,0,0,.18);opacity:0;transform:translateY(10px);animation:in .45s ease-out forwards}
.ct{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);padding:0 12px 7px}
.sr{display:grid;align-items:center;column-gap:8px;height:30px;padding:0 12px;position:relative;border-top:1px solid var(--row);transition:opacity .2s,background .2s}
.sr.hdr{height:20px;border:0;font-size:10px;font-weight:700;color:var(--mut)}
.sr .p{color:var(--mut);font-weight:700;text-align:center;font-variant-numeric:tabular-nums}
.sr .tm{display:flex;align-items:center;gap:7px;min-width:0}
.sr .v{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.sr .v.b{font-weight:700}
.sr.up::before,.sr.down::before,.sr.drop::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:3px;border-radius:2px;background:var(--win)}
.sr.down::before,.sr.drop::before{background:var(--lose)}
.mlh{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);padding:9px 12px 5px}
.gm{display:grid;grid-template-columns:118px 20px 20px 118px 64px;align-items:center;column-gap:6px;height:32px;padding:0 10px;position:relative;border-top:1px solid var(--row);transition:opacity .2s,background .2s,box-shadow .2s}
.gm.cur{outline-offset:-2px;border-radius:6px}
.gm .sd{display:flex;align-items:center;gap:6px;min-width:0}.gm .sd.a{flex-direction:row-reverse;text-align:right}
.gm .sc{text-align:center;font-weight:700;font-variant-numeric:tabular-nums;background:var(--chip);border-radius:4px;height:20px;line-height:20px}
.gm .sd.w .n{font-weight:700}.gm .sc.w{color:var(--win)}.gm .sd.l .n{color:var(--mut)}.gm .sd.l .lg{opacity:.55}
.gm .wh{font-size:10px;color:var(--mut);text-align:right;white-space:nowrap}
.gm.live{background:rgba(145,71,255,.14)}
.lp{display:inline-block;background:#9147ff;color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:8px;letter-spacing:.06em}
.dim .m,.dim .gm,.dim .sr:not(.hdr){opacity:.3!important}.dim .m.on,.dim .gm.on,.dim .sr.on{opacity:1!important}
.dim .m.on{transform:scale(1.03)}.dim .t.on,.dim .sr.on{background:var(--row)}.dim .c{opacity:.25}
.det{padding:8px 2px 10px;width:720px}
.back{all:unset;cursor:pointer;font:600 11px/1 Inter,Roobert,system-ui,sans-serif;color:var(--mut);padding:5px 9px;border-radius:8px;background:var(--chip)}.back:hover{color:var(--fg)}
.dh{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;margin:12px 0 14px;font-size:15px;font-weight:700}
.dh .tm{display:flex;align-items:center;gap:8px;min-width:0}.dh .tm.b{flex-direction:row-reverse;text-align:right}
.dh .sc{font-size:18px;font-variant-numeric:tabular-nums;padding:3px 12px;border-radius:8px;background:var(--chip)}
.gcard{background:var(--box);border:1px solid var(--line);border-radius:10px;padding:8px 12px 8px;margin-bottom:10px;opacity:0;transform:translateY(8px);animation:in .4s ease-out forwards}
.gt{display:flex;gap:10px;align-items:baseline;font-size:11px;color:var(--mut);margin-bottom:6px}.gt b{color:var(--fg);font-size:12px}
.gr{display:grid;grid-template-columns:130px auto 1fr;align-items:center;gap:10px;padding:4px 0}
.gr+.gr{border-top:1px solid var(--row)}
.gr .who{display:flex;align-items:center;gap:6px;min-width:0;font-weight:600}
.side{font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:6px;flex:none}
.side.radiant{background:rgba(61,220,132,.18);color:var(--win)}.side.dire{background:rgba(255,107,107,.18);color:var(--lose)}
.won{font-size:9px;font-weight:800;color:var(--gold);flex:none}
.heroes{display:flex;gap:4px}.hero{width:48px;height:27px;border-radius:4px;overflow:hidden;background:var(--chip);flex:none}.hero img{width:100%;height:100%;object-fit:cover;display:block}
.bans{display:flex;gap:3px;align-items:center;justify-content:flex-end;min-width:0}.bans .hero{width:28px;height:16px;filter:grayscale(1);opacity:.6}
.bl{font-size:9px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;margin-right:3px}
.lv{padding:8px 2px 12px;width:672px}
.lh{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:14px;margin:4px 0 6px}
.lh .tm{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;min-width:0}.lh .tm.b{flex-direction:row-reverse;text-align:right}
.lh .k{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.ka{color:var(--ta)}.kb{color:var(--tb)}
.lead{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--mut);margin:6px 0 2px}
.lead b{color:var(--fg);white-space:nowrap}
.bar{flex:1;height:8px;border-radius:4px;background:var(--chip);position:relative;overflow:hidden}
.bar i{position:absolute;top:0;bottom:0;transition:all .6s ease}.bar::after{content:"";position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--line)}
.spark{display:block;width:100%;height:58px;margin:4px 0 10px}
.ltab{background:var(--box);border:1px solid var(--line);border-radius:10px;padding:2px 0 4px;margin-bottom:10px;border-left:3px solid var(--ta)}.ltab.tb{border-left-color:var(--tb)}
.lt{display:flex;justify-content:space-between;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);padding:7px 10px 4px}
.lr{display:grid;grid-template-columns:24px 38px minmax(90px,1fr) 22px 66px 54px 46px 46px 142px;align-items:center;column-gap:8px;height:30px;padding:0 10px;border-top:1px solid var(--row);font-variant-numeric:tabular-nums;transition:background .3s}
.lr.hdr{height:18px;border:0;font-size:10px;font-weight:700;color:var(--mut)}
.lr .hi{width:38px;height:21px;border-radius:3px;object-fit:cover;display:block;background:var(--chip)}
.lr .r{text-align:right;white-space:nowrap}.lr .pl{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lr .ps{text-align:center;font-size:11px;font-weight:800;border-radius:4px;background:var(--chip);height:18px;line-height:18px}.lr .ps.unk{color:var(--mut);font-weight:600}.lr .ps0{text-align:center}
.lr.sel{background:rgba(145,71,255,.16)}.lr.sel .pl::after{content:" 👁";font-size:10px}
.its{display:flex;gap:2px}.its img,.its span{width:22px;height:16px;border-radius:2px;background:var(--chip);object-fit:cover;display:block;flex:none}
.lsrc{font-size:10px;color:var(--mut);margin-top:2px}
`;
  const S = { key: null, tour: null, title: '', open: ls.get('open') === 1, timer: 0, view: null, detail: null, data: null, live: null, hist: null, shown: null, liveTab: false };
  let btnHost, btn, panelHost, panel, titleEl, tabsEl, body, foot;
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
  // When the window has been resized by the user, scale the content to fit. Content much taller than
  // the window (live stats, long match lists) scrolls instead of shrinking below a readable size.
  function fit() {
    const z = body && body.querySelector('.zoom');
    if (!z) return;
    if (!G || !G.w || !natW || !natH) { z.style.zoom = ''; return; }
    const wr = (body.clientWidth - 28) / natW, hr = (body.clientHeight - 12) / natH;
    let s = Math.min(wr, hr);
    if (s < 0.85) s = Math.min(wr, 0.85);
    z.style.zoom = String(Math.max(0.35, Math.min(2.5, s)));
  }
  function ensurePanel() {
    if (panelHost) return;
    panelHost = makeHost('ttb-panel'); panelHost.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999';
    panel = el('div', 'panel'); const head = el('div', 'head'); titleEl = el('b', null, 'Bracket');
    head.title = 'Drag to move. Drag a corner to resize. Double-click to reset size and position.';
    const rf = el('button', null, '↻'); rf.title = 'Refresh now'; rf.addEventListener('click', () => refresh(true));
    const x = el('button', null, '✕'); x.title = 'Hide bracket'; x.addEventListener('click', () => setOpen(false));
    head.append(titleEl, rf, x); tabsEl = el('div', 'tabs'); body = el('div', 'body'); foot = el('div', 'foot');
    panel.append(head, tabsEl, body, foot);
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
    // Hovering a team highlights it everywhere in the view: bracket, standings and match list.
    body.addEventListener('mouseover', e => {
      const t = e.target.closest ? e.target.closest('[data-t]') : null;
      body.querySelectorAll('.on').forEach(o => o.classList.remove('on'));
      if (t && t.dataset.t) {
        body.classList.add('dim');
        body.querySelectorAll('[data-t]').forEach(o => { if (o.dataset.t === t.dataset.t) { o.classList.add('on'); const box = o.closest('.m, .gm'); if (box) box.classList.add('on'); } });
      } else body.classList.remove('dim');
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
  function logoEl(o) { const lg = el('span', 'lg'); if (o.logo) logoImg(o, lg); else lg.textContent = o.tbd ? '?' : (o.name || '?')[0]; return lg; }
  function img(src, cls, title) {
    const i = el('img', cls); i.alt = ''; i.referrerPolicy = 'no-referrer'; i.decoding = 'async';
    if (title) i.title = title;
    i.addEventListener('error', () => { i.style.visibility = 'hidden'; });
    if (src) i.src = src; else i.style.visibility = 'hidden';
    return i;
  }
  // Matches with draft details on Liquipedia open the match view when clicked.
  function clickable(node, m) {
    if (!m.games || !m.games.length) return;
    node.classList.add('clk');
    node.title = (node.title ? node.title + ' · ' : '') + 'Click for drafts';
    node.addEventListener('click', () => { S.detail = mkey(m); render(S.data, true); body.scrollTop = 0; });
  }
  function rMatch(m, isRoot) {
    const cur = isCur(m);
    const d = el('div', 'm' + (m.live ? ' live' : '') + (!m.done && !m.live ? ' tbd' : '') + (isRoot ? ' gf' : '') + (cur ? ' cur' : ''));
    if (cur) d.title = 'On this stream';
    const anyWin = m.o.some(x => x.win);
    m.o.slice(0, 2).forEach(o => {
      const r = el('div', 't' + (anyWin ? (o.win ? ' w' : ' l') : '') + (o.tbd ? ' ph' : '')); r.dataset.t = o.tbd ? '' : o.name;
      r.append(logoEl(o), el('span', 'n', o.name), el('span', 's', o.score)); d.append(r);
    });
    if (m.live) d.append(el('span', 'pill', 'LIVE')); else if (!m.done && m.ts) d.append(el('span', 'note', fmt(m.ts)));
    if (isRoot) d.append(el('span', 'cup', '🏆'));
    clickable(d, m);
    return d;
  }
  function rItem(it, links, isRoot) {
    if (it.h) { const r = el('div', 'hrow'); it.h.forEach(t => r.append(el('div', 'hd', t))); return { node: r }; }
    const node = el('div', 'node'), kidEls = [];
    if (it.kids.length) { const k = el('div', 'kids'); it.kids.forEach(c => { const r = rItem(c, links, false); k.append(r.node); if (r.m) kidEls.push(r.m); }); node.append(k); }
    const m = rMatch(it.m, isRoot); node.append(m); links.push([m, kidEls]);
    return { node, m };
  }
  function rBracket(items, animate) {
    const wrap = el('div', 'br' + (animate ? '' : ' noanim')), links = [];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); wrap.append(svg);
    const total = JSON.stringify(items).split('"o":').length - 1;
    const bodies = items.filter(i => i.m);
    items.forEach(it => wrap.append(rItem(it, links, total >= 3 && bodies.length === 1 && it === bodies[0]).node));
    // Lines are drawn once the bracket is in the document and has a size.
    return { wrap, draw() {
      svg.setAttribute('width', wrap.scrollWidth); svg.setAttribute('height', wrap.scrollHeight);
      links.forEach(([m, kids]) => {
        const col = Math.round(m.offsetLeft / COL); m.style.animationDelay = col * 0.3 + 's';
        kids.forEach(k => {
          const x1 = k.offsetLeft + k.offsetWidth, y1 = k.offsetTop + k.offsetHeight / 2, x2 = m.offsetLeft, y2 = m.offsetTop + m.offsetHeight / 2;
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('class', 'c');
          p.setAttribute('d', 'M' + x1 + ' ' + y1 + 'H' + (x2 - 14) + 'V' + y2 + 'H' + x2); p.style.animationDelay = (col - 0.4) * 0.3 + 's'; svg.append(p);
        });
      });
    } };
  }
  function rStandings(p, delay) {
    const card = el('div', 'card'); card.style.animationDelay = delay + 's';
    card.append(el('div', 'ct', p.title));
    const grid = '20px minmax(130px,1fr)' + p.cols.map(() => ' 52px').join('');
    const hdr = el('div', 'sr hdr'); hdr.style.gridTemplateColumns = grid;
    hdr.append(el('span', 'p', '#'), el('span', null, 'Team')); p.cols.forEach(c => hdr.append(el('span', 'v', c)));
    card.append(hdr);
    p.rows.forEach(r => {
      const row = el('div', 'sr' + (r.st ? ' ' + r.st : '')); row.style.gridTemplateColumns = grid; row.dataset.t = r.tbd ? '' : r.name;
      if (r.st === 'up') row.title = 'Advancing'; else if (r.st === 'down' || r.st === 'drop') row.title = 'In the elimination zone';
      const tm = el('span', 'tm'); tm.append(logoEl(r), el('span', 'n', r.name));
      row.append(el('span', 'p', r.pos), tm); r.vals.forEach((v, i) => row.append(el('span', 'v' + (i === 0 ? ' b' : ''), v)));
      card.append(row);
    });
    return card;
  }
  function rList(p, delay) {
    const card = el('div', 'card'); card.style.animationDelay = delay + 's';
    card.append(el('div', 'ct', p.title));
    p.rows.forEach(r => {
      if (r.h) { card.append(el('div', 'mlh', r.h)); return; }
      const m = r.m, cur = isCur(m), anyWin = m.o.some(x => x.win);
      const g = el('div', 'gm' + (m.live ? ' live' : '') + (cur ? ' cur' : '')); if (cur) g.title = 'On this stream';
      const side = (o, cls) => { const s = el('div', 'sd ' + cls + (anyWin ? (o.win ? ' w' : ' l') : '')); s.dataset.t = o.tbd ? '' : o.name; s.append(logoEl(o), el('span', 'n', o.name)); return s; };
      const sc = o => el('div', 'sc' + (o.win ? ' w' : ''), o.score || (m.done ? '-' : ''));
      const wh = el('div', 'wh');
      if (m.live) wh.append(el('span', 'lp', 'LIVE')); else if (!m.done && m.ts) wh.textContent = fmt(m.ts); else if (m.done) wh.textContent = 'Final';
      g.append(side(m.o[0], 'a'), sc(m.o[0]), sc(m.o[1]), side(m.o[1], 'b'), wh);
      clickable(g, m);
      card.append(g);
    });
    return card;
  }
  // Match view: the drafts of every game played (picks with Radiant/Dire, bans, length, winner).
  function rDetail(m, backTo) {
    const w = el('div', 'det');
    const back = el('button', 'back', '← ' + backTo);
    back.addEventListener('click', () => { S.detail = null; render(S.data, true); });
    w.append(back);
    const [A, B] = m.o;
    const dh = el('div', 'dh');
    const tm = (o, cls) => { const t = el('div', 'tm ' + cls); t.append(logoEl(o), el('span', 'n', o.name)); return t; };
    dh.append(tm(A, 'a'), el('div', 'sc', (A.score || '0') + ' : ' + (B.score || '0')), tm(B, 'b'));
    w.append(dh);
    const heroes = list => { const h = el('div', 'heroes'); list.forEach(x => { const t = el('div', 'hero'); t.title = x.n; t.append(img(x.img, null, x.n)); h.append(t); }); return h; };
    m.games.forEach((g, i) => {
      const c = el('div', 'gcard'); c.style.animationDelay = i * 0.1 + 's';
      const gt = el('div', 'gt'); gt.append(el('b', null, 'Game ' + (i + 1)));
      if (g.len) gt.append(el('span', null, g.len));
      if (g.w) gt.append(el('span', null, (g.w === 'a' ? A.name : B.name) + ' won'));
      c.append(gt);
      [[A, g.a, g.ba, 'a'], [B, g.b, g.bb, 'b']].forEach(([o, picks, bans, k]) => {
        const r = el('div', 'gr'), who = el('div', 'who');
        const sd = (picks[0] && picks[0].side) || '';
        if (sd) who.append(el('span', 'side ' + sd, sd));
        who.append(el('span', 'n', o.name));
        if (g.w === k) who.append(el('span', 'won', '🏆'));
        const bn = el('div', 'bans');
        if (bans.length) { bn.append(el('span', 'bl', 'Bans')); bans.forEach(x => { const t = el('div', 'hero'); t.title = 'Banned: ' + x.n; t.append(img(x.img, null, x.n)); bn.append(t); }); }
        r.append(who, heroes(picks), bn); c.append(r);
      });
      w.append(c);
    });
    if (!m.games.length) w.append(el('div', 'msg', 'Liquipedia has no draft details for this match yet.'));
    return w;
  }
  // Live game: score, net worth lead and its history, and per player position, level, K/D/A, last hits, net worth, damage and items.
  function rLive(L, rosters) {
    const w = el('div', 'lv');
    const sides = [L.heroes.slice(0, 5), L.heroes.slice(5, 10)];
    const teams = liveTeams(sides, rosters || []);
    const kA = sum(sides[0], h => h.kd[0] || 0), kB = sum(sides[1], h => h.kd[0] || 0);
    const nwA = sum(sides[0], h => h.nw), nwB = sum(sides[1], h => h.nw), lead = nwA - nwB;
    const lh = el('div', 'lh');
    const tm = (o, cls) => { const t = el('div', 'tm ' + cls); t.append(logoEl(o), el('span', 'n', o.name)); return t; };
    const ks = el('div', 'k'); ks.append(el('span', 'ka', String(kA)), document.createTextNode(' – '), el('span', 'kb', String(kB)));
    ks.title = 'Kills';
    lh.append(tm(teams[0], 'a'), ks, tm(teams[1], 'b'));
    w.append(lh);
    const ld = el('div', 'lead');
    ld.append(el('span', null, 'Net worth'));
    const bar = el('div', 'bar'), fill = el('i');
    const frac = Math.min(Math.abs(lead) / 20000, 1) * 50;
    fill.style.cssText = (lead >= 0 ? 'right:50%;background:var(--ta);' : 'left:50%;background:var(--tb);') + 'width:' + frac + '%';
    bar.append(fill); ld.append(bar);
    ld.append(el('b', null, lead === 0 ? 'even' : (lead > 0 ? teams[0].name : teams[1].name) + ' +' + fmtK(Math.abs(lead))));
    w.append(ld);
    // Lead history (only numbers go into this SVG).
    const pts = S.hist && S.hist.id === L.id ? S.hist.pts : [];
    if (pts.length >= 2) {
      const W = 640, H = 58, mid = H / 2, t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
      const mx = Math.max(2000, ...pts.map(p => Math.abs(p[1])));
      const xy = pts.map(p => [((p[0] - t0) / Math.max(1, t1 - t0) * W).toFixed(1), (mid - p[1] / mx * (mid - 3)).toFixed(1)]);
      const line = xy.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join('');
      const area = line + 'L' + W + ' ' + mid + 'L0 ' + mid + 'Z';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'spark'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('preserveAspectRatio', 'none');
      svg.innerHTML = '<defs><clipPath id="ttbA"><rect x="0" y="0" width="' + W + '" height="' + mid + '"/></clipPath><clipPath id="ttbB"><rect x="0" y="' + mid + '" width="' + W + '" height="' + mid + '"/></clipPath></defs>' +
        '<path d="' + area + '" fill="var(--ta)" opacity=".28" clip-path="url(#ttbA)"/><path d="' + area + '" fill="var(--tb)" opacity=".28" clip-path="url(#ttbB)"/>' +
        '<line x1="0" x2="' + W + '" y1="' + mid + '" y2="' + mid + '" stroke="var(--line)" stroke-dasharray="4 4"/>' +
        '<path d="' + line + '" fill="none" stroke="var(--fg)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
      w.append(svg);
    }
    sides.forEach((side, si) => {
      const team = teams[si];
      const t = el('div', 'ltab' + (si ? ' tb' : ''));
      const tt = el('div', 'lt'); tt.append(el('span', null, team.name), el('span', null, fmtK(si ? nwB : nwA) + ' net worth'));
      t.append(tt);
      const hdr = el('div', 'lr hdr');
      ['Pos', '', 'Player', 'Lv', 'K/D/A', 'LH/DN', 'NW', 'Dmg', 'Items'].forEach((x, i) => hdr.append(el('span', i === 0 ? 'ps0' : i >= 3 && i <= 7 ? 'r' : null, x)));
      hdr.firstChild.title = 'Position, from the team\'s roster for this tournament on Liquipedia';
      t.append(hdr);
      side.forEach(h => {
        const r = el('div', 'lr' + (h.k === L.sel ? ' sel' : ''));
        const pos = roleOf(team, h.p);
        r.title = heroName(h.k) + (pos ? ' · ' + POS[pos] : '') + (h.k === L.sel ? ' (the observer is following this hero)' : '');
        const ps = el('span', 'ps' + (pos ? '' : ' unk'), pos || (team.players ? '?' : '–'));
        ps.title = pos ? POS[pos] : team.players ? 'Not on ' + team.name + '\'s roster for this tournament (a stand-in?)' : 'Team not recognised, so no position';
        const its = el('div', 'its');
        h.items.forEach(id => {
          const nm = id && ITEMS && ITEMS[id];
          its.append(nm ? img(cdn('items', nm), null, tcase(nm)) : el('span'));
        });
        r.append(ps, img(cdn('heroes', h.k), 'hi', heroName(h.k)), el('span', 'pl', h.p || heroName(h.k)), el('span', 'r', String(h.lvl)),
          el('span', 'r', h.kd.join('/')), el('span', 'r', h.cs.join('/')), el('span', 'r', fmtK(h.nw)), el('span', 'r', fmtK(h.hd)), its);
        t.append(r);
      });
      w.append(t);
    });
    w.append(el('div', 'lsrc', 'Live from the stream\'s Dota 2 Tooltips extension · match ' + (L.id || '?') + ' · team colours: ' + teams[0].name + ' blue, ' + teams[1].name + ' orange · positions from Liquipedia rosters'));
    return w;
  }
  function render(data, animate) {
    S.data = data;
    panelHost.dataset.theme = isDark() ? 'dark' : 'light';
    titleEl.textContent = data.title || (S.tour ? S.tour.name : 'Bracket');
    body.textContent = ''; tabsEl.textContent = '';
    const z = el('div', 'zoom'); body.append(z);
    const fresh = S.liveTab = liveFresh();
    const views = (fresh ? [{ id: LIVE, title: 'This game', parts: [] }] : []).concat(data.views);
    let sel = null;
    if (!views.length) z.append(el('div', 'msg', 'Liquipedia has no bracket or group tables on this tournament page (yet).'));
    else {
      // Follow the stream: a game in progress first, else the stage being played. When that changes,
      // the user's manual tab choice is dropped.
      const auto = fresh ? views[0] : pickView(data.views, S.tour);
      if (S.tour.auto !== vkey(auto)) { S.tour.auto = vkey(auto); S.view = null; }
      sel = (S.view && views.find(v => vkey(v) === S.view)) || auto;
      if (views.length > 1) views.forEach(v => {
        const b = el('button', 'tab' + (v === sel ? ' on' : '') + (v === auto ? ' here' : '') + (v.id === LIVE ? ' lvt' : ''), v.title);
        b.title = v.id === LIVE ? 'Live stats of the game on stream' : v === auto ? 'The stage this stream is on' : '';
        b.addEventListener('click', () => { S.view = vkey(v); S.detail = null; render(data, true); });
        tabsEl.append(b);
      });
      S.shown = vkey(sel);
      const det = S.detail && sel.id !== LIVE ? data.views.flatMap(viewMatches).find(m => mkey(m) === S.detail) : null;
      if (sel.id === LIVE) { z.append(rLive(S.live, data.rosters)); lastLiveDraw = Date.now(); }
      else if (det) z.append(rDetail(det, sel.title));
      else {
        S.detail = null;
        const draws = [];
        const brs = sel.parts.filter(p => p.k === 'b'), grp = sel.parts.filter(p => p.k !== 'b');
        brs.forEach(p => { const r = rBracket(p.items, animate); z.append(r.wrap); draws.push(r.draw); });
        if (grp.length) {
          const g = el('div', 'grp' + (animate ? '' : ' noanim'));
          grp.forEach((p, i) => g.append(p.k === 's' ? rStandings(p, i * 0.12) : rList(p, i * 0.12)));
          z.append(g);
        }
        draws.forEach(f => f());
      }
      if (!animate) z.querySelectorAll('.gcard').forEach(c => { c.style.animation = 'none'; c.style.opacity = '1'; c.style.transform = 'none'; });
    }
    natW = z.offsetWidth; natH = z.offsetHeight; fit();
    foot.textContent = '';
    const a = el('a', null, 'Liquipedia');
    a.href = 'https://liquipedia.net/' + S.tour.wiki + '/' + S.tour.page.split('/').map(encodeURIComponent).join('/') + (sel && sel.id && sel.id !== LIVE ? '#' + encodeURIComponent(sel.id) : '');
    a.target = '_blank'; a.rel = 'noopener';
    foot.append('Data: ', a, ' (CC BY-SA 3.0) · updated ' + new Date(data.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · red outline: on this stream · click a played match for drafts');
  }
  function message(text) { body.textContent = ''; body.append(el('div', 'msg', text)); }
  function refresh(force, animate) {
    const t = S.tour; if (!t || !S.open) return;
    if (!bcache.get(t.wiki + '|' + t.page)) { tabsEl.textContent = ''; message('Loading the tournament from Liquipedia… It allows one request every 30 seconds, so this can take a moment.'); }
    loadTour(t, force).then(d => { if (S.tour === t && S.open) { const st = body.scrollTop; render(d, !!animate); if (!animate) body.scrollTop = st; } },
      e => { if (S.tour === t && S.open && !bcache.get(t.wiki + '|' + t.page)) message('Could not load the tournament: ' + e.message); });
  }
  function setOpen(open) {
    S.open = open; ls.set('open', open ? 1 : 0);
    if (btn) btn.classList.toggle('on', open);
    clearInterval(S.timer); clearInterval(S.ltimer);
    if (open && S.tour) {
      ensurePanel(); panelHost.style.display = ''; titleEl.textContent = S.tour.name; applyGeo();
      refresh(false, true);
      S.timer = setInterval(() => { if (!document.hidden) refresh(true, false); }, BRACKET_TTL);
      S.ltimer = setInterval(liveTick, 5000);
    } else if (panelHost) panelHost.style.display = 'none';
  }
  function hideAll() { clearInterval(S.timer); clearInterval(S.ltimer); if (btnHost) btnHost.remove(); if (panelHost) panelHost.style.display = 'none'; }
  function titleText() { const t = document.querySelector('[data-a-target="stream-title"]'); return t ? t.textContent : ''; }
  // Match this stream against a list of current matches. Shows the button when a tournament is found
  // and takes it away again when the stream no longer matches one (Twitch keeps showing the previous
  // channel's title for a moment after switching channels, and streamers change titles between matches).
  function tryList(list, chan, wiki) {
    S.title = titleText();
    const hit = pick(list, chan, S.title);
    if (!hit) { if (S.tour) { S.tour = null; hideAll(); } return; }
    if (S.tour && S.tour.page === hit.p) {
      // Same tournament, but maybe a different match or stage: update and redraw from the cache.
      const sig = JSON.stringify([hit.f, hit.g, hit.o]);
      if (S.tour.sig !== sig) { Object.assign(S.tour, { f: hit.f, g: hit.g, o: hit.o, sig }); if (S.open) refresh(false, false); }
      placeButton(); return;
    }
    S.tour = { wiki, page: hit.p, name: hit.n.split(' - ')[0], f: hit.f, g: hit.g, o: hit.o, sig: JSON.stringify([hit.f, hit.g, hit.o]) };
    S.view = null; S.detail = null; S.data = null;
    placeButton();
    if (S.open) setOpen(true); else loadTour(S.tour, false).catch(() => {});
  }
  // Use the saved match list straight away (even if it is a little old) so the button appears at once,
  // then fetch a fresh list in the background when the saved one has expired or is empty.
  async function detect(key, chan, wiki) {
    try {
      const c = ls.get('m:' + wiki);
      if (c && c.list) { tryList(c.list, chan, wiki); if (c.list.length && Date.now() - c.t < MATCH_TTL) return; }
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
    const tt = titleText();
    if (key !== S.key) { S.key = key; S.tour = null; S.title = ''; S.live = null; S.hist = null; hideAll(); if (key) detect(key, m[1], wiki); }
    else if (key && tt && tt !== S.title) {
      // The stream title arrived or changed since the last check: decide again from the saved list.
      const c = ls.get('m:' + wiki);
      if (c && c.list) tryList(c.list, m[1], wiki); else S.title = tt;
    }
    else if (S.tour) placeButton();
  }
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; setTimeout(() => { queued = false; tick(); }, 1000); })
    .observe(document.documentElement, { childList: true, subtree: true });
  tick();
})();
