/* 宇宙戦シミュレータ 画面の制御
 * シナリオ（配置・艦種・設定）の編集、地図の描画、再生、結果の表示を受け持つ。
 * 計算そのものは engine.js（SimEngine）に任せる。
 */
(function () {
  'use strict';

  const E = window.SimEngine, P = window.SimPresets;
  const FL = E.FLAGS, FW = E.FRAME_W;
  const $ = (id) => document.getElementById(id);
  const STORE = 'uchusen-sim-v1';
  const COLORS = ['blue', 'orange', 'aqua', 'violet', 'red', 'yellow'];
  const COLOR_NAMES = { blue: '青', orange: '橙', aqua: '青緑', violet: '紫', red: '赤', yellow: '黄' };
  const LS_KM = 299792.458;

  const app = {
    scn: null, sim: null, fi: 0, simT: 0, playing: false, last: 0,
    tool: 'select', sel: new Set(), selLane: -1, selMark: -1,
    view: { cx: 0, cy: 0, s: 4 },
    pal: { side: 0, type: null, count: 10, gap: 0.6, form: 'cluster' },
    opts: { shots: true, goals: true, links: false, dead: true, labels: false, follow: true },
    laneDraft: null, drag: null, hover: -1, mouse: null,
    undo: [], typeSel: null, tab: 'place', batch: null, batchRes: null,
    C: {}, delArm: null, logAt: 0, lastLogKey: '',
  };

  // ---------------------------------------------------------------- 小道具

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => {
    if (!isFinite(v)) return '';
    const p = Math.pow(10, d == null ? 2 : d);
    return String(Math.round(v * p) / p);
  };
  const pct = (v) => Math.round(v * 100) + '%';
  const fmtT = E.fmtTime;
  function fmtKm(ls) {
    const km = ls * LS_KM;
    if (km >= 1e8) return num(km / 1e8, 1) + '億km';
    if (km >= 1e4) return num(km / 1e4, km >= 1e5 ? 0 : 1) + '万km';
    return Math.round(km) + 'km';
  }
  function fmtLs(v) {
    const a = Math.abs(v);
    return a >= 100 ? String(Math.round(v)) : num(v, a >= 1 ? 1 : 2);
  }
  const sideName = (k) => (app.scn.sides[k] ? app.scn.sides[k].name : '');
  const typeOf = (id) => app.scn.types[id];
  const sideColor = (k) => app.C[app.scn.sides[k] ? app.scn.sides[k].color : 'blue'] || '#888';
  function rgba(hex, a) {
    const h = String(hex).trim().replace('#', '');
    if (h.length < 6) return hex;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    const C = app.C;
    for (const c of COLORS) C[c] = g('--c-' + c);
    C.board = g('--board'); C.ink = g('--ink'); C.ink2 = g('--ink-2'); C.ink3 = g('--ink-3');
    C.rule = g('--rule'); C.grid = g('--grid'); C.grid2 = g('--grid-2'); C.field = g('--field'); C.panel = g('--panel');
  }

  // 形（キャンバスと SVG で共通の点列）
  function shapePoints(shape, x, y, r) {
    const pts = [];
    const poly = (n, rot, rr) => { for (let k = 0; k < n; k++) { const a = rot + (k / n) * Math.PI * 2; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); } };
    switch (shape) {
      case 'diamond': pts.push([x, y - r * 1.3], [x + r * 1.05, y], [x, y + r * 1.3], [x - r * 1.05, y]); break;
      case 'triangle': pts.push([x, y - r * 1.25], [x + r * 1.15, y + r * 0.8], [x - r * 1.15, y + r * 0.8]); break;
      case 'square': pts.push([x - r * 0.9, y - r * 0.9], [x + r * 0.9, y - r * 0.9], [x + r * 0.9, y + r * 0.9], [x - r * 0.9, y + r * 0.9]); break;
      case 'hexagon': poly(6, Math.PI / 6, r * 1.1); break;
      case 'star':
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k / 10) * Math.PI * 2, rr = k % 2 ? r * 0.55 : r * 1.35;
          pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
        }
        break;
      default: return null;
    }
    return pts;
  }
  function pathShape(ctx, shape, x, y, r) {
    ctx.beginPath();
    const pts = shapePoints(shape, x, y, r);
    if (!pts) { ctx.arc(x, y, r, 0, Math.PI * 2); return; }
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
  function shapeSVG(shape, colorVar, size, hollow) {
    const s = size || 16, c = s / 2, r = s * 0.3;
    const pts = shapePoints(shape, c, c, r);
    const st = hollow
      ? 'fill:none;stroke:' + colorVar + ';stroke-width:1.5'
      : 'fill:' + colorVar + ';stroke:var(--board);stroke-width:1';
    const body = pts
      ? '<polygon points="' + pts.map((p) => num(p[0], 1) + ',' + num(p[1], 1)).join(' ') + '" style="' + st + '"/>'
      : '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" style="' + st + '"/>';
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '" aria-hidden="true">' + body + '</svg>';
  }
  const colorVar = (k) => 'var(--c-' + (app.scn.sides[k] ? app.scn.sides[k].color : 'blue') + ')';

  // ---------------------------------------------------------------- 保存

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify({ scn: app.scn, view: app.view, pal: app.pal, opts: app.opts })); } catch (e) { /* 保存できない環境では何もしない */ }
    }, 400);
  }
  function restore() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return false;
      const o = JSON.parse(raw);
      if (!o || !o.scn || !o.scn.types) return false;
      app.scn = E.normalizeScenario(o.scn);
      if (o.view && isFinite(o.view.s)) app.view = o.view;
      if (o.pal) Object.assign(app.pal, o.pal);
      if (o.opts) Object.assign(app.opts, o.opts);
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- 編集の入口

  function pushUndo() {
    app.undo.push(JSON.stringify(app.scn));
    if (app.undo.length > 80) app.undo.shift();
  }
  // 配置や性能を変える編集。計算は捨てて T=0 に戻る
  function edit(fn) {
    if (app.sim) resetSim();
    pushUndo();
    fn(app.scn);
    app.scn = E.normalizeScenario(app.scn);
    pruneSelection();
    save();
    refreshAll();
  }
  // 名前・色・メモなど、計算に関係しない編集
  function editMeta(fn) {
    pushUndo();
    fn(app.scn);
    save();
    refreshAll();
  }
  function undo() {
    if (!app.undo.length) { toast('これ以上は戻せません'); return; }
    resetSim();
    app.scn = E.normalizeScenario(JSON.parse(app.undo.pop()));
    app.sel.clear(); app.selLane = -1; app.selMark = -1;
    save();
    refreshAll();
    toast('ひとつ前に戻しました');
  }
  function pruneSelection() {
    const n = app.scn.units.length;
    for (const i of [...app.sel]) if (i >= n) app.sel.delete(i);
    if (app.selLane >= app.scn.lanes.length) app.selLane = -1;
    if (app.selMark >= app.scn.marks.length) app.selMark = -1;
    if (!app.scn.types[app.pal.type]) app.pal.type = Object.keys(app.scn.types)[0] || null;
    if (!app.scn.types[app.typeSel]) app.typeSel = app.pal.type;
  }

  function loadScenario(scn, msg) {
    resetSim();
    app.scn = E.normalizeScenario(scn);
    app.sel.clear(); app.selLane = -1; app.selMark = -1; app.laneDraft = null;
    app.batchRes = null;
    pruneSelection();
    const ids = Object.keys(app.scn.types);
    if (!app.scn.types[app.pal.type]) app.pal.type = ids[0] || null;
    app.typeSel = app.pal.type;
    fitView(false);
    save();
    refreshAll();
    if (msg) toast(msg);
  }

  // ---------------------------------------------------------------- 計算の管理

  function resetSim() {
    app.playing = false;
    app.sim = null; app.fi = 0; app.simT = 0;
  }
  function ensureSim() {
    if (!app.sim) {
      app.sim = E.createSim(app.scn, { record: true });
      app.fi = 0; app.simT = 0;
    }
    return app.sim;
  }
  function compute(t, budgetMs) {
    const S = app.sim, t0 = performance.now();
    while (!S.done && S.t < t - 1e-9) {
      E.step(S);
      if (budgetMs != null && performance.now() - t0 > budgetMs) break;
    }
  }
  function frameAt(t) {
    const F = app.sim.frames;
    let lo = 0, hi = F.length - 1;
    if (t >= F[hi].t) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (F[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  function seekTo(t) {
    if (!app.scn.units.length) return;
    ensureSim();
    compute(t);
    app.fi = frameAt(t);
    app.simT = app.sim.frames[app.fi].t;
    renderFrame(true);
  }
  function play() {
    if (!app.scn.units.length) { toast('先に艦を配置してください'); return; }
    ensureSim();
    const F = app.sim.frames;
    if (app.sim.done && app.fi >= F.length - 1) { app.fi = 0; app.simT = 0; }
    app.playing = true;
    app.last = performance.now();
    renderTimeline();
    requestAnimationFrame(tick);
  }
  function pause() { app.playing = false; renderTimeline(); renderFrame(true); }
  function tick(now) {
    if (!app.playing || !app.sim) return;
    const S = app.sim;
    const dt = Math.min(0.1, (now - app.last) / 1000);
    app.last = now;
    app.simT += dt * (+$('speedSel').value);
    compute(app.simT, 14);
    // 再生の時刻は「計算が済んだ時刻」で止める。記録フレームは大きなシナリオでは数刻みおきなので、
    // 最新フレームの時刻で止めると、1コマで進む時間が記録の間隔より短いとき毎回巻き戻って進まなくなる
    if (app.simT > S.t) app.simT = S.t;
    app.fi = frameAt(app.simT);
    if (S.done && app.fi >= S.frames.length - 1) { app.playing = false; renderTimeline(); }
    renderFrame(false);
    if (app.playing) requestAnimationFrame(tick);
  }
  function toEnd() {
    if (!app.scn.units.length) { toast('先に艦を配置してください'); return; }
    ensureSim();
    app.playing = false;
    $('endBtn').disabled = true;
    $('endBtn').textContent = '計算中…';
    setTimeout(() => {
      E.runToEnd(app.sim);
      app.fi = app.sim.frames.length - 1;
      app.simT = app.sim.frames[app.fi].t;
      $('endBtn').textContent = '結果まで計算';
      showTab('result');
      renderFrame(true);
    }, 20);
  }

  // ---------------------------------------------------------------- 場面（描画用の共通形）

  function scene() {
    const scn = app.scn;
    if (!app.sim) {
      const units = scn.units.map((u, i) => {
        const d = scn.types[u.type];
        return {
          i, side: u.side, def: d, x: u.x, y: u.y, hp: 1, sh: 1,
          fl: FL.alive | ((u.appear || 0) > 0 ? 0 : FL.present) | (u.locked ? FL.lock : 0),
          lockS: 0, lockF: u.locked ? 1 : 0, fieldV: 0, jx: 0, jy: 0, tgt: -1, goal: u.goal, appear: u.appear || 0,
        };
      });
      const fields = [], previews = [];
      for (const u of units) {
        const d = u.def;
        if (!d.fieldOn) continue;
        if (d.fieldMode === 'immediate' && d.fieldDeploy <= 0 && !u.appear) fields.push({ x: u.x, y: u.y, r: d.fieldRadius, side: u.side });
        else {
          const at = u.goal && d.fieldMode === 'arrive' ? { x: u.goal[0], y: u.goal[1] } : u;
          previews.push({ x: at.x, y: at.y, r: d.fieldRadius, side: u.side });
        }
      }
      return { t: 0, edit: true, units, fields, previews, lanes: scn.lanes.map((l) => ({ side: l.side, grow: false, pts: l.pts })), shots: null };
    }
    const S = app.sim, f = S.frames[app.fi], a = f.u;
    const units = S.units.map((su, i) => {
      const o = i * FW;
      return {
        i, side: su.side, def: su.def, x: a[o], y: a[o + 1], hp: a[o + 2], sh: a[o + 3], fl: a[o + 4],
        lockS: a[o + 5], jx: a[o + 6], jy: a[o + 7], lockF: a[o + 8], fieldV: a[o + 9], tgt: f.tg[i],
        goal: S.scn.units[i].goal, appear: su.appear,
      };
    });
    return { t: f.t, edit: false, units, fields: f.fields, previews: [], lanes: f.lanes, shots: f.shots, frame: f };
  }

  // ---------------------------------------------------------------- 地図

  const board = $('board'), cv = $('map'), ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const sx = (x) => (x - app.view.cx) * app.view.s + W / 2;
  const sy = (y) => (y - app.view.cy) * app.view.s + H / 2;
  const wx = (px) => (px - W / 2) / app.view.s + app.view.cx;
  const wy = (py) => (py - H / 2) / app.view.s + app.view.cy;

  function resizeMap() {
    const r = board.getBoundingClientRect();
    DPR = window.devicePixelRatio || 1;
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    draw();
  }

  function unitR(d) {
    const z = clamp(Math.sqrt(app.view.s / 8), 0.8, 1.7);
    return clamp(4 * (d.size || 1) * z, 2.5, 16);
  }
  function inFieldList(fields, x, y) {
    for (const f of fields) if ((x - f.x) * (x - f.x) + (y - f.y) * (y - f.y) < f.r * f.r) return true;
    return false;
  }

  function niceStep(minPx) {
    const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (const st of steps) if (st * app.view.s >= minPx) return st;
    return 20000;
  }

  function drawGrid() {
    const st = niceStep(56);
    const C = app.C;
    const x0 = Math.floor(wx(0) / st), x1 = Math.ceil(wx(W) / st);
    const y0 = Math.floor(wy(0) / st), y1 = Math.ceil(wy(H) / st);
    ctx.lineWidth = 1;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? C.grid2 : C.grid;
      ctx.beginPath();
      for (let k = x0; k <= x1; k++) {
        if ((k % 5 === 0) !== !!pass) continue;
        const px = Math.round(sx(k * st)) + 0.5;
        ctx.moveTo(px, 0); ctx.lineTo(px, H);
      }
      for (let k = y0; k <= y1; k++) {
        if ((k % 5 === 0) !== !!pass) continue;
        const py = Math.round(sy(k * st)) + 0.5;
        ctx.moveTo(0, py); ctx.lineTo(W, py);
      }
      ctx.stroke();
    }
    ctx.fillStyle = C.ink3;
    ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--font-num');
    ctx.textBaseline = 'top';
    // 目盛りの数字（右端の縦の数字と下端の横の数字が重ならないよう、角は空ける）
    for (let k = x0; k <= x1; k++) {
      if (k % 5) continue;
      const px = sx(k * st);
      if (px > W - 44) continue;
      ctx.fillText(fmtLs(k * st), px + 3, H - 14);
    }
    ctx.textBaseline = 'middle';
    for (let k = y0; k <= y1; k++) {
      if (k % 5) continue;
      const py = sy(k * st) - 7;
      if (py > H - 26 || py < 12) continue;
      ctx.fillText(fmtLs(k * st), W - 34, py);
    }
    $('scale').textContent = '1目盛り ' + fmtLs(st) + '光秒（約' + fmtKm(st) + '）';
  }

  // 地名などの文字: 位置に小さな点、文字はその少し上
  const MARK_DY = 13;
  function drawMarks() {
    const C = app.C;
    ctx.font = '12px ' + getComputedStyle(document.body).getPropertyValue('--font-ui');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    app.scn.marks.forEach((m, i) => {
      const x = sx(m.x), y = sy(m.y);
      if (x < -200 || x > W + 200 || y < -40 || y > H + 40) return;
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fillStyle = C.ink3; ctx.fill();
      const ty = y - MARK_DY;
      if (i === app.selMark && !app.sim) {
        const w = ctx.measureText(m.text).width + 10;
        ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.strokeRect(x - w / 2, ty - 10, w, 20); ctx.setLineDash([]);
      }
      ctx.lineWidth = 3; ctx.strokeStyle = C.board; ctx.strokeText(m.text, x, ty);
      ctx.fillStyle = C.ink2; ctx.fillText(m.text, x, ty);
    });
    ctx.textAlign = 'left';
  }

  function drawFields(sc) {
    const C = app.C;
    const lab = (f, txt) => {
      const rp = f.r * app.view.s;
      if (rp < 26) return;
      ctx.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--font-ui');
      ctx.fillStyle = C.field; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(txt, sx(f.x), sy(f.y) - rp - 3);
      ctx.textAlign = 'left';
    };
    for (const f of sc.fields) {
      ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), Math.max(1, f.r * app.view.s), 0, Math.PI * 2);
      ctx.fillStyle = rgba(C.field, 0.08); ctx.fill();
      ctx.strokeStyle = rgba(C.field, 0.8); ctx.lineWidth = 1.5; ctx.setLineDash([7, 4]); ctx.stroke(); ctx.setLineDash([]);
      lab(f, '妨害場（' + sideName(f.side) + '）');
    }
    for (const f of sc.previews || []) {
      ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), Math.max(1, f.r * app.view.s), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(C.field, 0.45); ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.stroke(); ctx.setLineDash([]);
      lab(f, '妨害場の予定範囲');
    }
    if (!sc.edit) {
      for (const u of sc.units) {
        if (!(u.fl & FL.deploy)) continue;
        ctx.beginPath(); ctx.arc(sx(u.x), sy(u.y), Math.max(1, u.def.fieldRadius * app.view.s), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(C.field, 0.5); ctx.lineWidth = 1; ctx.setLineDash([2, 5]); ctx.stroke(); ctx.setLineDash([]);
        const r = unitR(u.def) + 7;
        ctx.beginPath(); ctx.arc(sx(u.x), sy(u.y), r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(u.fieldV, 0, 1));
        ctx.strokeStyle = C.field; ctx.lineWidth = 3; ctx.stroke();
      }
    }
  }

  function drawLanes(sc) {
    const C = app.C;
    sc.lanes.forEach((L, li) => {
      const col = sideColor(L.side);
      const ok = new Path2D(), cut = new Path2D();
      for (let i = 1; i < L.pts.length; i++) {
        const a = L.pts[i - 1], b = L.pts[i];
        const lenPx = Math.hypot(b[0] - a[0], b[1] - a[1]) * app.view.s;
        const n = clamp(Math.ceil(lenPx / 6), 1, 400);
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n, tm = (t0 + t1) / 2;
          const mx = a[0] + (b[0] - a[0]) * tm, my = a[1] + (b[1] - a[1]) * tm;
          const p = inFieldList(sc.fields, mx, my) ? cut : ok;
          p.moveTo(sx(a[0] + (b[0] - a[0]) * t0), sy(a[1] + (b[1] - a[1]) * t0));
          p.lineTo(sx(a[0] + (b[0] - a[0]) * t1), sy(a[1] + (b[1] - a[1]) * t1));
        }
      }
      const selected = sc.edit && li === app.selLane;
      ctx.lineCap = 'round';
      if (selected) { ctx.strokeStyle = rgba(C.ink, 0.35); ctx.lineWidth = 7; ctx.stroke(ok); ctx.stroke(cut); }
      ctx.strokeStyle = rgba(col, 0.75); ctx.lineWidth = 2.2; ctx.stroke(ok);
      ctx.strokeStyle = rgba(C.ink3, 0.8); ctx.lineWidth = 1.5; ctx.setLineDash([2, 4]); ctx.stroke(cut); ctx.setLineDash([]);
      ctx.lineCap = 'butt';
      for (const p of [L.pts[0], L.pts[L.pts.length - 1]]) {
        ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 2.5, 0, Math.PI * 2); ctx.fillStyle = rgba(col, 0.9); ctx.fill();
      }
      if (L.grow) {
        const p = L.pts[L.pts.length - 1];
        ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 5, 0, Math.PI * 2); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
      }
    });
  }

  function drawGoals(sc) {
    const C = app.C;
    // 線が多いと重なって黒い帯になるので、本数に応じて薄くする
    let nGoal = 0;
    for (const u of sc.units) if (u.goal && (sc.edit || app.sel.has(u.i))) nGoal++;
    ctx.strokeStyle = rgba(C.ink2, nGoal > 20 ? Math.max(0.08, 0.45 * Math.sqrt(20 / nGoal)) : 0.45); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    const marks = [];
    for (const u of sc.units) {
      if (!u.goal) continue;
      if (!sc.edit && !app.sel.has(u.i)) continue;
      if (!sc.edit && !(u.fl & FL.alive)) continue;
      ctx.moveTo(sx(u.x), sy(u.y)); ctx.lineTo(sx(u.goal[0]), sy(u.goal[1]));
      marks.push(u.goal);
    }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = rgba(C.ink2, 0.8); ctx.beginPath();
    for (const g of marks) {
      const x = sx(g[0]), y = sy(g[1]);
      ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3);
    }
    ctx.stroke();
  }

  function drawLinks(sc) {
    const nodes = sc.units.filter((u) => u.def.linkOn && (u.fl & FL.alive) && (u.fl & FL.present) && !(u.fl & FL.jump) && !(u.fl & FL.escaped));
    if (!nodes.length) return;
    for (const u of sc.units) {
      if (!(u.fl & FL.linked) || u.def.linkOn) continue;
      let best = null, bd = Infinity;
      for (const n of nodes) {
        if (n.side !== u.side) continue;
        const d = Math.hypot(n.x - u.x, n.y - u.y);
        if (d < bd && d <= n.def.linkRadius + 0.01) { bd = d; best = n; }
      }
      if (!best) continue;
      ctx.strokeStyle = rgba(sideColor(u.side), 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx(u.x), sy(u.y)); ctx.lineTo(sx(best.x), sy(best.y)); ctx.stroke();
    }
  }

  function drawShots(sc) {
    const s = sc.shots;
    if (!s) return;
    for (let side = 0; side < 2; side++) {
      const col = sideColor(side);
      for (let hit = 0; hit < 2; hit++) {
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < s.length; i += 6) {
          if (s[i + 5] !== side || s[i + 4] !== hit) continue;
          ctx.moveTo(sx(s[i]), sy(s[i + 1])); ctx.lineTo(sx(s[i + 2]), sy(s[i + 3])); any = true;
        }
        if (!any) continue;
        ctx.strokeStyle = rgba(col, hit ? 0.8 : 0.22); ctx.lineWidth = hit ? 1.3 : 1;
        ctx.stroke();
      }
    }
  }

  function drawUnits(sc) {
    const C = app.C;
    const font = getComputedStyle(document.body).getPropertyValue('--font-ui');
    const showBars = app.view.s >= 10;
    // 撃沈艦
    if (app.opts.dead && !sc.edit) {
      ctx.strokeStyle = rgba(C.ink3, 0.75); ctx.lineWidth = 1.3; ctx.beginPath();
      for (const u of sc.units) {
        if ((u.fl & FL.alive) || !(u.fl & FL.present)) continue;
        const x = sx(u.x), y = sy(u.y), r = unitR(u.def) * 0.75;
        ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
      }
      ctx.stroke();
    }
    for (const u of sc.units) {
      const fl = u.fl;
      if (!(fl & FL.alive) || (fl & FL.escaped)) continue;
      const x = sx(u.x), y = sy(u.y);
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) {
        if (!(fl & FL.jump)) continue;
      }
      const d = u.def, r = unitR(d), col = sideColor(u.side);
      if (!(fl & FL.present)) {
        // 後から出現する艦
        pathShape(ctx, d.shape, x, y, r);
        ctx.strokeStyle = rgba(col, 0.6); ctx.lineWidth = 1.2; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
        if (app.view.s >= 3 || sc.edit) {
          const rest = sc.edit ? u.appear : u.appear - sc.t;
          ctx.font = '10px ' + font; ctx.fillStyle = C.ink3; ctx.textBaseline = 'middle';
          ctx.fillText('+' + num(rest / 60, 0) + '分', x + r + 3, y);
        }
        continue;
      }
      if (fl & FL.jump) {
        pathShape(ctx, d.shape, x, y, r);
        ctx.strokeStyle = rgba(col, 0.45); ctx.lineWidth = 1; ctx.stroke();
        const tx = sx(u.jx), ty = sy(u.jy);
        ctx.strokeStyle = rgba(col, 0.6); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(tx, ty, r + 2, 0, Math.PI * 2); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
        continue;
      }
      if (fl & FL.lay) {
        ctx.strokeStyle = rgba(col, 0.35); ctx.setLineDash([1, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(sx(u.jx), sy(u.jy)); ctx.stroke(); ctx.setLineDash([]);
      }
      pathShape(ctx, d.shape, x, y, r);
      ctx.fillStyle = (fl & FL.retreat) ? rgba(col, 0.45) : col;
      ctx.fill();
      ctx.strokeStyle = C.board; ctx.lineWidth = 1.2; ctx.stroke();
      if (fl & FL.lock) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(u.lockF, 0.02, 1));
        ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.4; ctx.stroke();
      }
      if (showBars && !sc.edit && (u.hp < 0.999 || u.sh < 0.999)) {
        const w = r * 2 + 4, bx = x - w / 2, by = y + r + 4;
        ctx.fillStyle = C.grid2; ctx.fillRect(bx, by, w, 2); ctx.fillRect(bx, by + 3, w, 2);
        ctx.fillStyle = C.ink2; ctx.fillRect(bx, by, w * clamp(u.sh, 0, 1), 2);
        ctx.fillStyle = col; ctx.fillRect(bx, by + 3, w * clamp(u.hp, 0, 1), 2);
      }
      const label = app.opts.labels || (E.isKey(d) && app.view.s >= 6);
      if (label) {
        ctx.font = '10.5px ' + font; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = C.board; ctx.strokeText(d.abbr, x + r + 3, y - r);
        ctx.fillStyle = C.ink; ctx.fillText(d.abbr, x + r + 3, y - r);
      }
    }
    // 選択
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6;
    for (const i of app.sel) {
      const u = sc.units[i];
      if (!u || ((!(u.fl & FL.alive) || (u.fl & FL.escaped)) && !sc.edit)) continue;
      ctx.beginPath(); ctx.arc(sx(u.x), sy(u.y), unitR(u.def) + 5, 0, Math.PI * 2); ctx.stroke();
    }
    if (app.hover >= 0 && sc.units[app.hover]) {
      const u = sc.units[app.hover];
      ctx.strokeStyle = rgba(C.ink, 0.5); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx(u.x), sy(u.y), unitR(u.def) + 4, 0, Math.PI * 2); ctx.stroke();
      if (!sc.edit && u.tgt >= 0 && sc.units[u.tgt] && (u.fl & FL.alive)) {
        const t = sc.units[u.tgt];
        ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(sx(u.x), sy(u.y)); ctx.lineTo(sx(t.x), sy(t.y)); ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  function drawOverlays() {
    const C = app.C, m = app.mouse;
    if (app.laneDraft) {
      const col = sideColor(app.laneDraft.side);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      app.laneDraft.pts.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))));
      if (m) ctx.lineTo(m.x, m.y);
      ctx.stroke(); ctx.setLineDash([]);
      for (const p of app.laneDraft.pts) { ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 3, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
    }
    const dr = app.drag;
    if (dr && dr.kind === 'band') {
      ctx.strokeStyle = C.ink2; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(dr.x0, dr.x1) + 0.5, Math.min(dr.y0, dr.y1) + 0.5, Math.abs(dr.x1 - dr.x0), Math.abs(dr.y1 - dr.y0));
      ctx.setLineDash([]);
    }
    if (!m || app.sim || dr) return;
    if (app.tool === 'place' && typeOf(app.pal.type)) {
      const d = typeOf(app.pal.type), col = sideColor(app.pal.side), r = unitR(d);
      const pts = P.formation(clamp(app.pal.count | 0, 1, 300), wx(m.x), wy(m.y), app.pal.gap, app.pal.form);
      ctx.strokeStyle = rgba(col, 0.7); ctx.lineWidth = 1;
      for (const p of pts) { pathShape(ctx, d.shape, sx(p[0]), sy(p[1]), r); ctx.stroke(); }
    }
    if (app.tool === 'goal' && app.sel.size) {
      const c = selCentroid();
      if (c) {
        ctx.strokeStyle = rgba(C.ink, 0.6); ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx(c.x), sy(c.y)); ctx.lineTo(m.x, m.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  function draw() {
    if (!app.scn || !W) return;
    const C = app.C;
    ctx.fillStyle = C.board; ctx.fillRect(0, 0, W, H);
    const sc = scene();
    app.lastScene = sc;
    drawGrid();
    drawFields(sc);
    drawLanes(sc);
    drawMarks();
    if (app.opts.goals) drawGoals(sc);
    if (app.opts.links && !sc.edit) drawLinks(sc);
    if (app.opts.shots && !sc.edit) drawShots(sc);
    drawUnits(sc);
    drawOverlays();
  }

  // 世界座標の箱を、左上の表示と凡例を避けて画面に収める視点
  function viewForBox(x0, y0, x1, y1, maxS) {
    const w0 = W || 800, h0 = H || 500;
    const w = Math.max(x1 - x0, 4), h = Math.max(y1 - y0, 4);
    const lg = $('legendBox');
    const padL = lg.open && w0 > 640 ? lg.offsetWidth + 16 : 16;
    const padT = $('hud').offsetHeight + 14, padR = 40, padB = 28;
    const aw = Math.max(80, w0 - padL - padR), ah = Math.max(80, h0 - padT - padB);
    const s = clamp(Math.min(aw / (w * 1.08), ah / (h * 1.12)), 0.02, maxS || 400);
    const scx = padL + aw / 2, scy = padT + ah / 2;
    return { cx: (x0 + x1) / 2 - (scx - w0 / 2) / s, cy: (y0 + y1) / 2 - (scy - h0 / 2) / s, s };
  }

  // 交戦を追う: 直近の射線を囲む範囲へ視点を寄せる
  function followCombat(instant) {
    const S = app.sim;
    if (!S || !app.opts.follow) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    for (let k = Math.max(0, app.fi - 12); k <= app.fi; k++) {
      const sh = S.frames[k].shots;
      if (!sh) continue;
      for (let i = 0; i < sh.length; i += 6) {
        for (const [x, y] of [[sh[i], sh[i + 1]], [sh[i + 2], sh[i + 3]]]) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        n++;
      }
    }
    if (!n) return;
    const m = Math.max(4, S.maxRange * 1.5);
    const tv = viewForBox(x0 - m, y0 - m, x1 + m, y1 + m, 80);
    const v = app.view, k = instant ? 1 : 0.12;
    v.cx += (tv.cx - v.cx) * k;
    v.cy += (tv.cy - v.cy) * k;
    v.s = Math.exp(Math.log(v.s) + (Math.log(tv.s) - Math.log(v.s)) * k);
  }
  function stopFollow() {
    if (!app.opts.follow) return;
    app.opts.follow = false;
    $('optFollow').checked = false;
  }

  function fitView(onlySel) {
    const pts = [];
    const scn = app.scn;
    const useSel = onlySel && app.sel.size;
    const sc = app.sim ? scene() : null;
    scn.units.forEach((u, i) => {
      if (useSel && !app.sel.has(i)) return;
      if (sc) { const v = sc.units[i]; if (v && (v.fl & FL.alive) && !(v.fl & FL.escaped)) pts.push([v.x, v.y]); }
      else pts.push([u.x, u.y]);
      if (u.goal && !useSel) pts.push(u.goal);
    });
    if (!useSel) {
      for (const l of scn.lanes) for (const p of l.pts) pts.push(p);
      for (const m of scn.marks) pts.push([m.x, m.y]);
    }
    if (!pts.length) { app.view = { cx: 0, cy: 0, s: 4 }; draw(); return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    app.view = viewForBox(x0, y0, x1, y1, useSel ? 80 : 400);
    save();
    draw();
  }

  // ---------------------------------------------------------------- 当たり判定

  function hitUnit(px, py) {
    const sc = app.lastScene || scene();
    let best = -1, bd = Infinity;
    for (const u of sc.units) {
      if (!sc.edit && (!(u.fl & FL.alive) || (u.fl & FL.escaped))) continue;
      const d = Math.hypot(sx(u.x) - px, sy(u.y) - py);
      const lim = Math.max(7, unitR(u.def) + 3);
      if (d <= lim && d < bd) { bd = d; best = u.i; }
    }
    return best;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? clamp(((px - ax) * dx + (py - ay) * dy) / L, 0, 1) : 0;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }
  function hitLane(px, py) {
    let best = -1, bd = 7;
    app.scn.lanes.forEach((l, li) => {
      for (let i = 1; i < l.pts.length; i++) {
        const d = segDist(px, py, sx(l.pts[i - 1][0]), sy(l.pts[i - 1][1]), sx(l.pts[i][0]), sy(l.pts[i][1]));
        if (d < bd) { bd = d; best = li; }
      }
    });
    return best;
  }
  function hitMark(px, py) {
    let best = -1;
    ctx.font = '12px ' + getComputedStyle(document.body).getPropertyValue('--font-ui');
    app.scn.marks.forEach((m, i) => {
      const w = ctx.measureText(m.text).width / 2 + 5;
      if (Math.abs(sx(m.x) - px) <= w && Math.abs(sy(m.y) - MARK_DY - py) <= 10) best = i;
    });
    return best;
  }
  function snapLanePoint(px, py) {
    let best = null, bd = 10;
    for (const l of app.scn.lanes) for (const p of l.pts) {
      const d = Math.hypot(sx(p[0]) - px, sy(p[1]) - py);
      if (d < bd) { bd = d; best = p; }
    }
    if (app.laneDraft) for (const p of app.laneDraft.pts) {
      const d = Math.hypot(sx(p[0]) - px, sy(p[1]) - py);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? [best[0], best[1]] : [round2(wx(px)), round2(wy(py))];
  }
  const round2 = (v) => Math.round(v * 100) / 100;

  function selCentroid() {
    let x = 0, y = 0, n = 0;
    for (const i of app.sel) { const u = app.scn.units[i]; if (!u) continue; x += u.x; y += u.y; n++; }
    return n ? { x: x / n, y: y / n } : null;
  }

  // ---------------------------------------------------------------- 地図の操作

  const pointers = new Map();
  function ppos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function needEdit() {
    if (!app.sim) return true;
    toast('計算の途中では配置を変えられません。「編集に戻る」を押してください');
    return false;
  }

  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = ppos(e);
    pointers.set(e.pointerId, p);
    hideTip();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      app.drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: app.view.s, wx: wx((a.x + b.x) / 2), wy: wy((a.y + b.y) / 2) };
      return;
    }
    if (e.button === 1 || e.button === 2) { app.drag = { kind: 'pan', x: p.x, y: p.y, cx: app.view.cx, cy: app.view.cy, moved: false }; return; }
    if (e.button !== 0) return;
    const w = { x: wx(p.x), y: wy(p.y) };
    const touch = e.pointerType === 'touch';
    const multi = e.shiftKey || e.ctrlKey || e.metaKey;
    switch (app.tool) {
      case 'select':
      case 'goal': {
        const hit = hitUnit(p.x, p.y);
        if (hit >= 0) {
          if (multi) { if (app.sel.has(hit)) app.sel.delete(hit); else app.sel.add(hit); }
          else if (!app.sel.has(hit)) { app.sel.clear(); app.sel.add(hit); }
          app.selLane = -1; app.selMark = -1;
          if (!app.sim && app.tool === 'select') {
            const orig = new Map();
            for (const i of app.sel) { const u = app.scn.units[i]; orig.set(i, [u.x, u.y]); }
            app.drag = { kind: 'move', x: p.x, y: p.y, orig, moved: false };
          }
          renderSel(); renderToolHint();
          break;
        }
        if (app.tool === 'goal') {
          if (!needEdit()) break;
          if (!app.sel.size) { toast('先に艦を選んでください（クリック、またはドラッグで囲む）'); break; }
          setGoal(w);
          break;
        }
        const mk = !app.sim ? hitMark(p.x, p.y) : -1;
        const ln = !app.sim && mk < 0 ? hitLane(p.x, p.y) : -1;
        if (mk >= 0) {
          app.sel.clear(); app.selLane = -1; app.selMark = mk;
          const m = app.scn.marks[mk];
          app.drag = { kind: 'moveMark', x: p.x, y: p.y, ox: m.x, oy: m.y, moved: false };
        } else if (ln >= 0) {
          app.sel.clear(); app.selMark = -1; app.selLane = ln;
        } else if (touch) {
          app.drag = { kind: 'pan', x: p.x, y: p.y, cx: app.view.cx, cy: app.view.cy, moved: false, tapClear: true };
        } else {
          if (!multi) app.sel.clear();
          app.selLane = -1; app.selMark = -1;
          app.drag = { kind: 'band', x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: multi };
        }
        renderSel(); renderToolHint();
        break;
      }
      case 'place':
        if (needEdit()) placeAt(w);
        break;
      case 'lane':
        if (needEdit()) {
          if (!app.laneDraft) app.laneDraft = { side: app.pal.side, pts: [] };
          const q = snapLanePoint(p.x, p.y);
          const last = app.laneDraft.pts[app.laneDraft.pts.length - 1];
          if (!last || Math.hypot(sx(last[0]) - p.x, sy(last[1]) - p.y) > 4) app.laneDraft.pts.push(q);
          renderToolHint();
        }
        break;
      case 'label':
        if (needEdit()) {
          const mk = hitMark(p.x, p.y);
          if (mk >= 0) editLabel(mk);
          else inlineInput(p.x, p.y - MARK_DY, '', (txt) => { if (txt) edit((s) => { s.marks.push({ x: round2(w.x), y: round2(w.y), text: txt }); }); });
        }
        break;
    }
    draw();
  });
  cv.addEventListener('pointermove', (e) => {
    const p = ppos(e);
    app.mouse = p;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    const dr = app.drag;
    if (dr) {
      if (dr.kind === 'pinch' && pointers.size >= 2) {
        stopFollow();
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        app.view.s = clamp(dr.s0 * d / dr.d0, 0.02, 2000);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        app.view.cx = dr.wx - (mx - W / 2) / app.view.s;
        app.view.cy = dr.wy - (my - H / 2) / app.view.s;
      } else if (dr.kind === 'pan') {
        if (Math.hypot(p.x - dr.x, p.y - dr.y) > 3) { dr.moved = true; stopFollow(); }
        app.view.cx = dr.cx - (p.x - dr.x) / app.view.s;
        app.view.cy = dr.cy - (p.y - dr.y) / app.view.s;
      } else if (dr.kind === 'move') {
        if (!dr.moved && Math.hypot(p.x - dr.x, p.y - dr.y) < 3) return;
        if (!dr.moved) { dr.moved = true; pushUndo(); }
        const dx = (p.x - dr.x) / app.view.s, dy = (p.y - dr.y) / app.view.s;
        for (const [i, o] of dr.orig) { const u = app.scn.units[i]; u.x = round2(o[0] + dx); u.y = round2(o[1] + dy); }
      } else if (dr.kind === 'moveMark') {
        if (!dr.moved && Math.hypot(p.x - dr.x, p.y - dr.y) < 3) return;
        if (!dr.moved) { dr.moved = true; pushUndo(); }
        const m = app.scn.marks[app.selMark];
        if (m) { m.x = round2(dr.ox + (p.x - dr.x) / app.view.s); m.y = round2(dr.oy + (p.y - dr.y) / app.view.s); }
      } else if (dr.kind === 'band') {
        dr.x1 = p.x; dr.y1 = p.y;
      }
      draw();
      return;
    }
    const h = hitUnit(p.x, p.y);
    if (h !== app.hover) app.hover = h;
    if (h >= 0) showTip(h, p); else hideTip();
    draw();
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    const dr = app.drag;
    if (!dr) return;
    if (dr.kind === 'pinch') { if (pointers.size < 2) app.drag = null; save(); return; }
    app.drag = null;
    if (dr.kind === 'band') {
      const x0 = Math.min(dr.x0, dr.x1), x1 = Math.max(dr.x0, dr.x1), y0 = Math.min(dr.y0, dr.y1), y1 = Math.max(dr.y0, dr.y1);
      if (x1 - x0 > 3 || y1 - y0 > 3) {
        const sc = app.lastScene || scene();
        for (const u of sc.units) {
          if (!sc.edit && (!(u.fl & FL.alive) || (u.fl & FL.escaped))) continue;
          const px = sx(u.x), py = sy(u.y);
          if (px >= x0 && px <= x1 && py >= y0 && py <= y1) app.sel.add(u.i);
        }
      }
      renderSel(); renderToolHint();
    } else if (dr.kind === 'move' || dr.kind === 'moveMark') {
      if (dr.moved) { app.scn = E.normalizeScenario(app.scn); save(); refreshAll(); }
    } else if (dr.kind === 'pan') {
      if (!dr.moved && dr.tapClear) { app.sel.clear(); app.selLane = -1; app.selMark = -1; renderSel(); renderToolHint(); }
      save();
    }
    draw();
  }
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('pointerleave', () => { app.mouse = null; app.hover = -1; hideTip(); draw(); });
  cv.addEventListener('dblclick', (e) => {
    if (app.tool === 'lane') { finishLane(); return; }
    const p = ppos(e);
    if (app.tool === 'select' && !app.sim) {
      const mk = hitMark(p.x, p.y);
      if (mk >= 0) editLabel(mk);
    }
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopFollow();
    const p = ppos(e);
    const bx = wx(p.x), by = wy(p.y);
    const k = Math.exp(-clamp(e.deltaY, -300, 300) * 0.0018);
    app.view.s = clamp(app.view.s * k, 0.02, 2000);
    app.view.cx = bx - (p.x - W / 2) / app.view.s;
    app.view.cy = by - (p.y - H / 2) / app.view.s;
    save();
    draw();
  }, { passive: false });

  function placeAt(w) {
    const d = typeOf(app.pal.type);
    if (!d) { toast('置く艦種を選んでください'); return; }
    const n = clamp(app.pal.count | 0, 1, 300);
    const pts = P.formation(n, w.x, w.y, Math.max(0, +app.pal.gap || 0), app.pal.form);
    edit((s) => {
      const start = s.units.length;
      for (const p of pts) s.units.push({ type: app.pal.type, side: app.pal.side, x: p[0], y: p[1] });
      app.sel = new Set(pts.map((_, k) => start + k));
    });
    toast(sideName(app.pal.side) + ' の ' + d.name + ' を' + n + '隻置きました');
  }
  function setGoal(w) {
    const c = selCentroid();
    if (!c) return;
    edit((s) => {
      for (const i of app.sel) {
        const u = s.units[i];
        u.goal = [round2(w.x + (u.x - c.x)), round2(w.y + (u.y - c.y))];
      }
    });
    toast(app.sel.size + '隻の目標地点を決めました');
  }
  function finishLane() {
    const dr = app.laneDraft;
    app.laneDraft = null;
    if (!dr) return;
    const pts = dr.pts.filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6);
    if (pts.length < 2) { toast('レーンには2点以上が必要です'); draw(); renderToolHint(); return; }
    edit((s) => { s.lanes.push({ side: dr.side, pts }); app.selLane = s.lanes.length - 1; });
    toast(sideName(dr.side) + ' のレーンを追加しました');
  }
  function deleteSelection() {
    if (!needEdit()) return;
    if (app.sel.size) {
      const n = app.sel.size;
      edit((s) => { s.units = s.units.filter((_, i) => !app.sel.has(i)); app.sel.clear(); });
      toast(n + '隻を削除しました');
    } else if (app.selLane >= 0) {
      const li = app.selLane;
      edit((s) => { s.lanes.splice(li, 1); app.selLane = -1; });
      toast('レーンを削除しました');
    } else if (app.selMark >= 0) {
      const mi = app.selMark;
      edit((s) => { s.marks.splice(mi, 1); app.selMark = -1; });
    }
  }
  function editLabel(i) {
    const m = app.scn.marks[i];
    if (!m) return;
    inlineInput(sx(m.x), sy(m.y) - MARK_DY, m.text, (txt) => {
      edit((s) => { if (txt) s.marks[i].text = txt; else s.marks.splice(i, 1); });
    });
  }
  function inlineInput(px, py, value, done) {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = value; inp.placeholder = '文字を入力して Enter';
    inp.style.cssText = 'position:absolute;z-index:6;left:' + clamp(px - 90, 4, W - 190) + 'px;top:' + clamp(py - 14, 4, H - 34) + 'px;width:180px';
    board.appendChild(inp);
    inp.focus();
    let closed = false;
    const close = (ok) => {
      if (closed) return;
      closed = true;
      const v = inp.value.trim();
      inp.remove();
      if (ok) done(v);
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(true);
      if (e.key === 'Escape') close(false);
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => close(true));
  }

  // ---------------------------------------------------------------- 説明の吹き出し

  const tip = $('tip');
  function hideTip() { tip.hidden = true; }
  function showTip(i, p) {
    const html = unitInfo(i, true);
    if (!html) { hideTip(); return; }
    tip.innerHTML = html;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = p.x + 14, y = p.y + 14;
    if (x + tw > W - 6) x = p.x - tw - 14;
    if (y + th > H - 6) y = p.y - th - 14;
    tip.style.left = clamp(x, 4, W - tw - 4) + 'px';
    tip.style.top = clamp(y, 4, H - th - 4) + 'px';
  }
  function unitStates(u, sc) {
    const st = [], fl = u.fl, d = u.def;
    if (!(fl & FL.present)) { st.push((sc.edit ? 'T+' + num(u.appear / 60, 1) + '分' : fmtT(u.appear)) + ' に出現'); return st; }
    if (!(fl & FL.alive)) {
      const su = app.sim && app.sim.units[u.i];
      st.push('撃沈' + (su && su.diedAt >= 0 && su.diedAt <= sc.t ? '（' + fmtT(su.diedAt) + '）' : ''));
      return st;
    }
    if (fl & FL.escaped) { st.push('戦場から離脱済み'); return st; }
    if (fl & FL.jump) st.push(fl & FL.laneJump ? 'レーンで移動中' : 'ジャンプ中');
    if (fl & FL.deploy) st.push('妨害場を展開中（' + pct(u.fieldV) + '）');
    if (fl & FL.field) st.push('妨害場を維持中（' + (u.fieldV < 0 ? '無期限' : '残り' + num(u.fieldV / 60, 0) + '分') + '）');
    if (fl & FL.lay) st.push('レーンを延伸中');
    if (fl & FL.retreat) st.push('撤退中');
    if (fl & FL.wait) st.push('ロック明けを待っている');
    if (fl & FL.lock) st.push((d.jump === 'lane' ? '再ジャンプまで' : 'ロックタイム残り') + ' ' + (u.lockS >= 60 ? num(u.lockS / 60, 0) + '分' : num(u.lockS, 0) + '秒'));
    if (fl & FL.linked) st.push(d.linkOn ? 'リンクの中枢' : 'リンク中');
    return st;
  }
  function unitInfo(i, short) {
    const sc = app.lastScene || scene();
    const u = sc.units[i];
    if (!u) return '';
    const d = u.def, su = app.scn.units[i];
    const lines = [];
    lines.push('<b>' + esc(d.name) + '</b> <span class="k">#' + (i + 1) + '・' + esc(sideName(u.side)) + '</span>');
    if (!sc.edit) {
      lines.push('船体 ' + Math.round(u.hp * d.hp) + ' / ' + d.hp + (d.shield > 0 ? '　ウォード ' + Math.round(u.sh * d.shield) + ' / ' + d.shield : ''));
      const st = unitStates(u, sc);
      if (st.length) lines.push('<span class="k">状態</span> ' + esc(st.join('・')));
      if (u.tgt >= 0 && sc.units[u.tgt] && (u.fl & FL.alive)) {
        const t = sc.units[u.tgt];
        lines.push('<span class="k">標的</span> ' + esc(t.def.name) + ' #' + (u.tgt + 1) + '（' + fmtLs(Math.hypot(t.x - u.x, t.y - u.y)) + '光秒）');
      }
      if (!short && app.sim) {
        const S = app.sim.units[i];
        lines.push('<span class="k">戦果（最後まで）</span> 撃沈 ' + S.kills + '・与えた損害 ' + Math.round(S.dealt));
      }
    } else {
      const st = unitStates(u, sc);
      if (st.length) lines.push(esc(st.join('・')));
      if (su && su.locked) lines.push('ジャンプ直後（ロックタイム中）から始める');
      if (su && su.goal) lines.push('<span class="k">目標地点</span> (' + fmtLs(su.goal[0]) + ', ' + fmtLs(su.goal[1]) + ')');
    }
    if (su) {
      lines.push('<span class="k">行動</span> ' + esc(E.AI[su.ai || d.ai].split('（')[0]) + '<span class="k">・狙う</span> ' + esc(E.PRIORITY[su.priority || d.priority]));
      if (su.move) lines.push('<span class="k">移動</span> ' + esc(E.MOVE[su.move].split('（')[0]));
    }
    return lines.join('<br>');
  }

  // ---------------------------------------------------------------- 上部・時間軸

  function renderHud() {
    const hud = $('hud');
    const S = app.sim;
    let html = '';
    if (!S) {
      html += '<div><span class="clock">T+0:00:00</span><span class="mode">編集中</span></div>';
      app.scn.sides.forEach((sd, k) => {
        const us = app.scn.units.filter((u) => u.side === k);
        const cost = us.reduce((a, u) => a + typeOf(u.type).cost, 0);
        html += '<div class="sideline"><span class="dot" style="background:' + colorVar(k) + '"></span><b>' + esc(sd.name) + '</b><span class="num">' + us.length + '隻・コスト' + num(cost, 1) + '</span></div>';
      });
    } else {
      const f = S.frames[app.fi];
      const done = S.done && app.fi === S.frames.length - 1;
      const mode = done ? '決着' : app.playing ? '再生中' : '停止中';
      html += '<div><span class="clock">' + fmtT(f.t) + '</span><span class="mode">' + mode + '</span></div>';
      S.sides.forEach((sd, k) => {
        const str = S.hist.str[k][f.hist] || 0, cnt = S.hist.cnt[k][f.hist] || 0;
        let chips = '';
        if (sd.sharing === 'comms' && f.sharing && !f.sharing[k]) chips += '<span class="chip">情報共有なし</span>';
        if (f.retreat && f.retreat[k]) chips += '<span class="chip">全軍撤退中</span>';
        html += '<div class="sideline"><span class="dot" style="background:' + colorVar(k) + '"></span><b>' + esc(sd.name) + '</b><span class="num">戦力 ' + pct(str) + '・' + cnt + '/' + S.initCount[k] + '隻</span>' + chips + '</div>';
      });
      if (done && S.result) html += '<div class="sideline"><b>' + esc(S.result.text) + '</b></div>';
    }
    hud.innerHTML = html;
  }

  function renderTimeline() {
    const S = app.sim;
    const seek = $('seek');
    const max = S && S.done ? S.t : app.scn.settings.timeLimit;
    seek.max = String(max);
    seek.step = String(app.scn.settings.dt);
    seek.value = String(S ? S.frames[app.fi].t : 0);
    $('clock').textContent = fmtT(S ? S.frames[app.fi].t : 0);
    $('playBtn').textContent = app.playing ? '停止' : '再生';
    $('resetBtn').disabled = !S;
    $('endBtn').disabled = !!(S && S.done && app.fi === S.frames.length - 1);
    $('undoBtn').disabled = !app.undo.length;
  }

  function renderTicker() {
    const tk = $('ticker');
    const S = app.sim;
    if (!S) { tk.innerHTML = app.scn.units.length ? '「再生」で時間が進みます。艦にマウスを重ねると詳しい状態が出ます。' : '右の「置く艦」で艦種を選び、道具の「配置」で地図をクリックしてください。'; return; }
    const f = S.frames[app.fi];
    let e = null;
    for (let k = Math.min(f.ev, S.events.length) - 1; k >= 0; k--) if (!S.events[k].minor) { e = S.events[k]; break; }
    tk.innerHTML = e ? '<span class="t">' + fmtT(e.t) + '</span>' + esc(e.text) : '';
  }

  function renderFrame(full) {
    followCombat(!app.playing);
    draw();
    drawChart();
    renderHud();
    renderTimeline();
    renderTicker();
    const now = performance.now();
    if (full || now - app.logAt > 300) {
      app.logAt = now;
      if (app.tab === 'result') { renderLog(); renderResult(); }
      if (app.tab === 'place' && app.sel.size) renderSel();
    }
  }

  // ---------------------------------------------------------------- 戦力グラフ

  const ccv = $('chart'), cctx = ccv.getContext('2d');
  let CW = 0, CH = 0;
  const CP = { l: 40, r: 12, t: 10, b: 20 };
  function resizeChart() {
    const r = ccv.getBoundingClientRect();
    CW = Math.max(1, r.width); CH = Math.max(1, r.height);
    ccv.width = Math.round(CW * DPR); ccv.height = Math.round(CH * DPR);
    cctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawChart();
  }
  function chartDomain() {
    const S = app.sim;
    return S && S.done ? Math.max(S.t, 60) : app.scn.settings.timeLimit;
  }
  function drawChart(hoverT) {
    if (!CW || !app.scn) return;
    const C = app.C, g = cctx, S = app.sim;
    g.fillStyle = C.board; g.fillRect(0, 0, CW, CH);
    const fontNum = getComputedStyle(document.body).getPropertyValue('--font-num');
    const fontUi = getComputedStyle(document.body).getPropertyValue('--font-ui');
    const x0 = CP.l, x1 = CW - CP.r, y0 = CP.t, y1 = CH - CP.b;
    const T = chartDomain();
    const X = (t) => x0 + (x1 - x0) * clamp(t / T, 0, 1);
    const Y = (v) => y1 - (y1 - y0) * clamp(v, 0, 1.05) / 1.05;
    g.font = '10px ' + fontNum; g.fillStyle = C.ink3; g.textBaseline = 'middle'; g.textAlign = 'right';
    g.strokeStyle = C.grid2; g.lineWidth = 1;
    for (const v of [0, 0.5, 1]) {
      const y = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.fillText(Math.round(v * 100) + '%', x0 - 5, y);
    }
    const stepsMin = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480];
    let st = 60;
    for (const m of stepsMin) { st = m * 60; if ((x1 - x0) * st / T >= 56) break; }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let t = 0; t <= T + 1e-6; t += st) {
      const x = X(t);
      g.fillText(Math.floor(t / 3600) + ':' + String(Math.floor((t % 3600) / 60)).padStart(2, '0'), x, y1 + 4);
    }
    g.textAlign = 'left';
    if (!S) {
      g.font = '12px ' + fontUi; g.fillStyle = C.ink3; g.textBaseline = 'middle';
      g.fillText('再生すると、両陣営の戦力（初期を100%とした残り。到着前の増援も含む）の推移がここに出ます', x0 + 10, (Y(0.5) + Y(1)) / 2);
      return;
    }
    const ht = S.hist.t, n = ht.length;
    const stride = Math.max(1, Math.floor(n / ((x1 - x0) * 1.5)));
    S.sides.forEach((sd, k) => {
      const hs = S.hist.str[k];
      g.beginPath();
      for (let i = 0; i < n; i += stride) { const x = X(ht[i]), y = Y(hs[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.lineTo(X(ht[n - 1]), Y(hs[n - 1]));
      g.strokeStyle = sideColor(k); g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    });
    const f = S.frames[app.fi];
    const cx = Math.round(X(f.t)) + 0.5;
    g.strokeStyle = C.ink2; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx, y1); g.stroke();
    // 現在値の点とラベル（線の色ではなく文字色で書く）
    const labs = S.sides.map((sd, k) => ({ k, v: S.hist.str[k][f.hist] || 0 }));
    labs.forEach((l) => {
      g.beginPath(); g.arc(cx, Y(l.v), 4, 0, Math.PI * 2); g.fillStyle = sideColor(l.k); g.fill();
      g.strokeStyle = C.board; g.lineWidth = 2; g.stroke();
    });
    labs.sort((a, b) => b.v - a.v);
    let lastY = -100;
    g.font = '11px ' + fontUi; g.textBaseline = 'middle';
    const right = cx > x1 - 150;
    labs.forEach((l) => {
      let y = Y(l.v);
      if (y - lastY < 13) y = lastY + 13;
      lastY = y;
      const txt = sideName(l.k) + ' ' + pct(l.v);
      const w = g.measureText(txt).width;
      const tx = right ? cx - 8 - w : cx + 8;
      g.lineWidth = 3; g.strokeStyle = C.board; g.strokeText(txt, tx, clamp(y, y0 + 5, y1 - 5));
      g.fillStyle = C.ink; g.fillText(txt, tx, clamp(y, y0 + 5, y1 - 5));
    });
    if (hoverT != null) {
      const hx = Math.round(X(hoverT)) + 0.5;
      g.setLineDash([3, 3]); g.strokeStyle = C.ink3; g.beginPath(); g.moveTo(hx, y0); g.lineTo(hx, y1); g.stroke(); g.setLineDash([]);
    }
  }
  function chartT(e) {
    const r = ccv.getBoundingClientRect();
    const x = e.clientX - r.left;
    return clamp((x - CP.l) / (CW - CP.l - CP.r), 0, 1) * chartDomain();
  }
  ccv.addEventListener('mousemove', (e) => {
    const S = app.sim, ct = $('chartTip');
    if (!S) { ct.hidden = true; return; }
    const t = chartT(e);
    const ht = S.hist.t;
    if (!ht.length || t > ht[ht.length - 1] + S.set.dt) { ct.hidden = true; drawChart(t); return; }
    let i = Math.min(ht.length - 1, Math.max(0, Math.round(t / S.set.dt)));
    while (i > 0 && ht[i] > t) i--;
    drawChart(ht[i]);
    ct.innerHTML = '<b>' + fmtT(ht[i]) + '</b>' + S.sides.map((sd, k) =>
      '<br><span class="dot" style="background:' + colorVar(k) + ';width:8px;height:8px"></span> ' + esc(sd.name) + ' 戦力 ' + pct(S.hist.str[k][i]) + '・' + S.hist.cnt[k][i] + '隻').join('') + '<br><span class="k">クリックでこの時刻へ</span>';
    ct.hidden = false;
    const r = ccv.getBoundingClientRect();
    const x = e.clientX - r.left;
    ct.style.left = clamp(x + 12, 4, CW - ct.offsetWidth - 4) + 'px';
    ct.style.top = '4px';
  });
  ccv.addEventListener('mouseleave', () => { $('chartTip').hidden = true; drawChart(); });
  ccv.addEventListener('click', (e) => { if (app.sim) seekTo(chartT(e)); });

  // ---------------------------------------------------------------- フォーム部品

  function fieldControl(prefix, f, value) {
    const id = prefix + f.k;
    const help = f.help ? '<p class="help">' + esc(f.help) + '</p>' : '';
    if (f.t === 'bool') {
      return '<label class="check"><input type="checkbox" id="' + id + '" data-k="' + f.k + '"' + (value ? ' checked' : '') + '> ' + esc(f.label) + '</label>' + help;
    }
    let ctl;
    if (f.t === 'text') ctl = '<input type="text" id="' + id + '" data-k="' + f.k + '" value="' + esc(value) + '">';
    else if (f.t === 'select') {
      ctl = '<select id="' + id + '" data-k="' + f.k + '">' + Object.entries(f.opts).map(([k, v]) => '<option value="' + k + '"' + (k === value ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select>';
    } else {
      const shown = f.t === 'pct' ? value * 100 : value / (f.scale || 1);
      const step = f.t === 'pct' ? 1 : (f.step || 1);
      ctl = '<input type="number" id="' + id + '" data-k="' + f.k + '" value="' + num(shown, 4) + '" step="' + step + '"' + (f.min != null ? ' min="' + (f.t === 'pct' ? 0 : f.min / (f.scale && f.scale < 1 ? f.scale : 1)) + '"' : '') + (f.t === 'pct' ? ' max="100"' : '') + '>';
    }
    const unit = f.t === 'pct' ? '%' : (f.unit || '');
    return '<label for="' + id + '">' + esc(f.label) + '</label><div class="in">' + ctl + (unit ? '<span class="u">' + esc(unit) + '</span>' : '') + '</div>' + help;
  }
  function readControl(f, el) {
    if (f.t === 'bool') return el.checked;
    if (f.t === 'text' || f.t === 'select') return el.value;
    let v = parseFloat(el.value);
    if (!isFinite(v)) return null;
    if (f.t === 'pct') v = clamp(v, 0, 100) / 100;
    else {
      v = v * (f.scale || 1);
      if (f.min != null) v = Math.max(f.min, v);
      if (f.max != null) v = Math.min(f.max, v);
    }
    return v;
  }
  // フォームを描き直してもフォーカスを失わないようにする
  function keepFocus(fn) {
    const a = document.activeElement;
    const id = a && a.id;
    fn();
    if (id) { const b = document.getElementById(id); if (b && b !== a) b.focus(); }
  }

  // ---------------------------------------------------------------- 配置タブ

  function renderPalette() {
    const sides = app.scn.sides;
    $('palSide').innerHTML = sides.map((sd, k) =>
      '<button data-side="' + k + '" aria-pressed="' + (app.pal.side === k) + '"><span class="dot" style="background:' + colorVar(k) + '"></span>' + esc(sd.name) + '</button>').join('');
    const ids = Object.keys(app.scn.types).sort((a, b) => {
      const ta = typeOf(a), tb = typeOf(b);
      const pa = ta.origin === app.pal.side ? 0 : 1, pb = tb.origin === app.pal.side ? 0 : 1;
      return pa - pb;
    });
    $('palTypes').innerHTML = ids.map((id) => {
      const d = typeOf(id);
      return '<button data-type="' + esc(id) + '" aria-pressed="' + (app.pal.type === id) + '" title="' + esc(d.name) + '">' + shapeSVG(d.shape, colorVar(app.pal.side), 16) + '<span>' + esc(d.name) + '</span><span class="c">' + num(d.cost, 1) + '</span></button>';
    }).join('');
    $('palCount').value = app.pal.count;
    $('palGap').value = app.pal.gap;
    $('palForm').value = app.pal.form;
  }

  function commonValue(key, def) {
    let v, first = true, mixed = false;
    for (const i of app.sel) {
      const u = app.scn.units[i];
      if (!u) continue;
      const x = u[key] == null ? def : u[key];
      if (first) { v = x; first = false; } else if (JSON.stringify(x) !== JSON.stringify(v)) mixed = true;
    }
    return { v, mixed };
  }

  function renderSel() {
    const box = $('selBox');
    const scn = app.scn;
    if (app.selLane >= 0 && !app.sim) {
      const l = scn.lanes[app.selLane];
      let len = 0;
      for (let i = 1; i < l.pts.length; i++) len += Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]);
      box.innerHTML = '<p class="selsum">レーン（' + esc(sideName(l.side)) + '）: ' + l.pts.length + '点・長さ ' + fmtLs(len) + '光秒</p>' +
        '<div class="row"><button id="laneSide">陣営を入れ替える</button><button id="laneDel" class="danger">削除</button></div>' +
        '<p class="hint">レーンは、その陣営の「レーン上のみ」の艦だけが使えます。</p>';
      $('laneSide').onclick = () => edit((s) => { s.lanes[app.selLane].side = 1 - s.lanes[app.selLane].side; });
      $('laneDel').onclick = deleteSelection;
      return;
    }
    if (app.selMark >= 0 && !app.sim) {
      box.innerHTML = '<p class="selsum">文字「' + esc(scn.marks[app.selMark].text) + '」</p><div class="row"><button id="markEdit">書き換える</button><button id="markDel" class="danger">削除</button></div>';
      $('markEdit').onclick = () => editLabel(app.selMark);
      $('markDel').onclick = deleteSelection;
      return;
    }
    if (!app.sel.size) {
      box.innerHTML = '<p class="hint">地図の艦をクリック（ドラッグで囲むと複数）すると、ここで行動や出現時刻を変えられます。</p>';
      return;
    }
    const counts = {};
    for (const i of app.sel) {
      const u = scn.units[i];
      if (!u) continue;
      const key = u.side + '|' + u.type;
      counts[key] = (counts[key] || 0) + 1;
    }
    const sum = Object.entries(counts).map(([k, n]) => { const [sd, tp] = k.split('|'); return esc(typeOf(tp).name) + ' ×' + n + '（' + esc(sideName(+sd)) + '）'; }).join('、');
    if (app.sim) {
      let html = '<p class="selsum">' + sum + '</p>';
      if (app.sel.size === 1) html += '<div class="verdict" style="font-size:12.5px">' + unitInfo([...app.sel][0], false) + '</div>';
      else {
        const sc = app.lastScene || scene();
        let alive = 0, dead = 0, esc2 = 0;
        for (const i of app.sel) { const u = sc.units[i]; if (!u) continue; if (u.fl & FL.escaped) esc2++; else if (u.fl & FL.alive) alive++; else dead++; }
        html += '<p class="hint">この時刻: 健在 ' + alive + '・撃沈 ' + dead + '・離脱 ' + esc2 + '</p>';
      }
      html += '<p class="hint">行動を変えるには「編集に戻る」を押してください。</p>';
      box.innerHTML = html;
      return;
    }
    const opt = (map, cur, mixed, dflt) => (dflt ? '<option value="">' + esc(dflt) + '</option>' : '') +
      (mixed ? '<option value="__mixed" selected>（ばらばら）</option>' : '') +
      Object.entries(map).map(([k, v]) => '<option value="' + k + '"' + (!mixed && k === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
    const side = commonValue('side', 0), ai = commonValue('ai', ''), pr = commonValue('priority', ''), mv = commonValue('move', 'auto');
    const rt = commonValue('retreatAt', null), ap = commonValue('appear', 0), lk = commonValue('locked', false);
    let goals = 0;
    for (const i of app.sel) if (scn.units[i] && scn.units[i].goal) goals++;
    const sideMap = { 0: sideName(0), 1: sideName(1) };
    box.innerHTML = '<p class="selsum">' + sum + '</p>' +
      '<div class="form">' +
      '<label for="selSide">陣営</label><div class="in"><select id="selSide">' + opt(sideMap, String(side.v), side.mixed) + '</select></div>' +
      '<label for="selAi">行動</label><div class="in"><select id="selAi">' + opt(E.AI, ai.v || '', ai.mixed, '艦種の設定どおり') + '</select></div>' +
      '<label for="selPr">狙う敵</label><div class="in"><select id="selPr">' + opt(E.PRIORITY, pr.v || '', pr.mixed, '艦種の設定どおり') + '</select></div>' +
      '<label for="selMove">移動</label><div class="in"><select id="selMove">' + opt(E.MOVE, mv.v || 'auto', mv.mixed) + '</select></div>' +
      '<label for="selRt">撤退する耐久</label><div class="in"><input id="selRt" type="number" min="0" max="100" step="5" placeholder="' + (rt.mixed ? 'ばらばら' : '艦種どおり') + '" value="' + (!rt.mixed && rt.v != null ? num(rt.v * 100, 1) : '') + '"><span class="u">%</span></div>' +
      '<label for="selAp">出現時刻</label><div class="in"><input id="selAp" type="number" min="0" step="1" placeholder="' + (ap.mixed ? 'ばらばら' : '0') + '" value="' + (!ap.mixed ? num((ap.v || 0) / 60, 2) : '') + '"><span class="u">分後</span></div>' +
      '<label class="check"><input type="checkbox" id="selLock"' + (lk.v && !lk.mixed ? ' checked' : '') + '> ジャンプ直後（ロックタイム中）から始める</label>' +
      '<p class="help">出現時刻を入れると、その時刻にジャンプで到着する増援になります（任意座標ジャンプの艦はロックタイムも始まる）。</p>' +
      '</div>' +
      '<div class="row" style="margin-top:8px"><span class="hint" style="margin:0">目標地点: ' + (goals ? goals + '隻に設定済み' : 'なし') + '</span></div>' +
      '<div class="row"><button id="selGoal">目標地点を指定</button><button id="selGoalClr"' + (goals ? '' : ' disabled') + '>目標を解除</button><button id="selDel" class="danger">削除</button></div>';
    $('selLock').indeterminate = lk.mixed;
    const apply = (fn) => edit((s) => { for (const i of app.sel) if (s.units[i]) fn(s.units[i]); });
    $('selSide').onchange = (e) => { if (e.target.value !== '__mixed') apply((u) => { u.side = +e.target.value; }); };
    $('selAi').onchange = (e) => { const v = e.target.value; if (v !== '__mixed') apply((u) => { if (v) u.ai = v; else delete u.ai; }); };
    $('selPr').onchange = (e) => { const v = e.target.value; if (v !== '__mixed') apply((u) => { if (v) u.priority = v; else delete u.priority; }); };
    $('selMove').onchange = (e) => { const v = e.target.value; if (v !== '__mixed') apply((u) => { if (v && v !== 'auto') u.move = v; else delete u.move; }); };
    $('selRt').onchange = (e) => { const v = e.target.value.trim(); apply((u) => { if (v === '') delete u.retreatAt; else u.retreatAt = clamp(parseFloat(v) || 0, 0, 100) / 100; }); };
    $('selAp').onchange = (e) => { const v = e.target.value.trim(); apply((u) => { const m = parseFloat(v); if (v === '' || !(m > 0)) delete u.appear; else u.appear = Math.round(m * 60); }); };
    $('selLock').onchange = (e) => { const v = e.target.checked; apply((u) => { if (v) u.locked = true; else delete u.locked; }); };
    $('selGoal').onclick = () => setTool('goal');
    $('selGoalClr').onclick = () => apply((u) => { delete u.goal; });
    $('selDel').onclick = deleteSelection;
  }

  function renderOrbat() {
    const scn = app.scn;
    let html = '';
    scn.sides.forEach((sd, k) => {
      const rows = {};
      for (const u of scn.units) if (u.side === k) rows[u.type] = (rows[u.type] || 0) + 1;
      const ids = Object.keys(rows);
      let tn = 0, tc = 0;
      html += '<table class="orbat" style="margin-bottom:8px"><thead><tr><th><span class="dot" style="background:' + colorVar(k) + ';width:8px;height:8px"></span> ' + esc(sd.name) + '</th><th>隻数</th><th>コスト</th></tr></thead><tbody>';
      if (!ids.length) html += '<tr><td colspan="3" class="hint">まだいない</td></tr>';
      for (const id of ids) {
        const d = typeOf(id), n = rows[id];
        tn += n; tc += n * d.cost;
        html += '<tr><td>' + esc(d.name) + '</td><td>' + n + '</td><td>' + num(n * d.cost, 1) + '</td></tr>';
      }
      if (ids.length) html += '<tr class="sum"><td>合計</td><td>' + tn + '</td><td>' + num(tc, 1) + '</td></tr>';
      html += '</tbody></table>';
    });
    $('orbat').innerHTML = html;
  }

  // ---------------------------------------------------------------- 艦種タブ

  function renderTypes() {
    const scn = app.scn;
    const ids = Object.keys(scn.types);
    if (!scn.types[app.typeSel]) app.typeSel = ids[0] || null;
    $('typeList').innerHTML = ids.map((id) => {
      const d = scn.types[id];
      return '<button data-tid="' + esc(id) + '" aria-pressed="' + (id === app.typeSel) + '">' + shapeSVG(d.shape, colorVar(d.origin === 1 ? 1 : 0), 16) + '<span>' + esc(d.name) + '</span></button>';
    }).join('');
    const id = app.typeSel;
    $('typeDup').disabled = !id; $('typeDel').disabled = !id;
    if (app.delArm !== id) { $('typeDel').textContent = '削除'; }
    if (!id) { $('typeForm').innerHTML = '<p class="hint">艦種がありません。「新しい艦種」で作れます。</p>'; $('typeUse').textContent = ''; return; }
    const d = scn.types[id];
    const use = [0, 1].map((k) => scn.units.filter((u) => u.type === id && u.side === k).length);
    $('typeUse').textContent = '地図上: ' + sideName(0) + ' ' + use[0] + '隻・' + sideName(1) + ' ' + use[1] + '隻。変えるとこの艦種の艦すべてに効きます。';
    const groups = [];
    for (const f of E.TYPE_FIELDS) {
      let g = groups.find((x) => x.g === f.g);
      if (!g) { g = { g: f.g, fs: [] }; groups.push(g); }
      g.fs.push(f);
    }
    let html = '';
    for (const g of groups) {
      html += '<fieldset><legend>' + esc(g.g) + '</legend><div class="form">';
      for (const f of g.fs) {
        if (f.on && !d[f.on]) continue;
        html += fieldControl('tf-', f, d[f.k]);
      }
      if (g.g === '基本') {
        html += '<label for="tf-origin">一覧での並び</label><div class="in"><select id="tf-origin" data-k="origin"><option value="0"' + (d.origin !== 1 ? ' selected' : '') + '>' + esc(sideName(0)) + '側</option><option value="1"' + (d.origin === 1 ? ' selected' : '') + '>' + esc(sideName(1)) + '側</option></select></div>';
      }
      if (g.g === '兵装' && d.wDamage > 0) {
        const dps = E.dpsOf(d);
        html += '<p class="help">目安: 1分あたり約 ' + num(dps * 60, 1) + ' の損害（回避0の相手、近距離）。射程は約' + fmtKm(d.wRange) + '。</p>';
      }
      if (g.g === '機動' && d.speed > 0) {
        html += '<p class="help">目安: 10光秒（約' + fmtKm(10) + '）進むのに ' + num(10 / d.speed / 60, 1) + '分。</p>';
      }
      html += '</div></fieldset>';
    }
    keepFocus(() => { $('typeForm').innerHTML = html; });
  }
  $('typeForm').addEventListener('change', (e) => {
    const el = e.target, k = el.dataset.k;
    if (!k || !app.typeSel) return;
    if (k === 'origin') { editMeta((s) => { s.types[app.typeSel].origin = +el.value; }); return; }
    const f = E.TYPE_FIELDS.find((x) => x.k === k);
    if (!f) return;
    const v = readControl(f, el);
    if (v === null) { renderTypes(); return; }
    const meta = k === 'name' || k === 'abbr' || k === 'shape' || k === 'size';
    (meta ? editMeta : edit)((s) => { s.types[app.typeSel][k] = v; });
  });
  $('typeList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tid]');
    if (!b) return;
    app.typeSel = b.dataset.tid; app.delArm = null;
    renderTypes();
  });
  $('typeNew').onclick = () => {
    const id = 't' + Date.now().toString(36);
    edit((s) => { s.types[id] = E.normalizeType({ name: '新しい艦種', abbr: '新', origin: app.pal.side }); });
    app.typeSel = id; app.pal.type = id;
    refreshAll();
  };
  $('typeDup').onclick = () => {
    const src = app.typeSel;
    if (!src) return;
    const id = 't' + Date.now().toString(36);
    edit((s) => { s.types[id] = Object.assign(E.clone(s.types[src]), { name: s.types[src].name + '（複製）' }); });
    app.typeSel = id;
    refreshAll();
  };
  $('typeDel').onclick = () => {
    const id = app.typeSel;
    if (!id) return;
    const n = app.scn.units.filter((u) => u.type === id).length;
    if (app.delArm !== id) {
      app.delArm = id;
      $('typeDel').textContent = n ? '本当に削除（' + n + '隻も消える）' : 'もう一度押すと削除';
      return;
    }
    app.delArm = null;
    edit((s) => { delete s.types[id]; s.units = s.units.filter((u) => u.type !== id); app.sel.clear(); });
    toast('艦種を削除しました（元に戻すで戻せます）');
  };

  // ---------------------------------------------------------------- 陣営と設定タブ

  function renderSides() {
    const scn = app.scn;
    let html = '';
    scn.sides.forEach((sd, k) => {
      html += '<div class="sidecard" data-side="' + k + '"><div class="head"><span class="dot" style="background:' + colorVar(k) + '"></span>' + esc(sd.name) + '</div><div class="form">';
      for (const f of E.SIDE_FIELDS) {
        html += fieldControl('sf' + k + '-', f, sd[f.k]);
        if (f.k === 'name') {
          html += '<label>色</label><div class="in swatches">' + COLORS.map((c) =>
            '<button type="button" data-color="' + c + '" aria-pressed="' + (sd.color === c) + '" title="' + COLOR_NAMES[c] + '" aria-label="' + COLOR_NAMES[c] + '" style="background:var(--c-' + c + ')"></button>').join('') + '</div>';
        }
      }
      html += '</div></div>';
    });
    keepFocus(() => { $('sideCards').innerHTML = html; });
    let sh = '';
    for (const f of E.SETTING_FIELDS) sh += fieldControl('st-', f, scn.settings[f.k]);
    keepFocus(() => { $('settingsForm').innerHTML = sh; });
    if (document.activeElement !== $('scnNoteEdit')) $('scnNoteEdit').value = scn.note || '';
  }
  $('sideCards').addEventListener('change', (e) => {
    const card = e.target.closest('.sidecard');
    if (!card) return;
    const k = +card.dataset.side, key = e.target.dataset.k;
    const f = E.SIDE_FIELDS.find((x) => x.k === key);
    if (!f) return;
    const v = readControl(f, e.target);
    if (v === null) { renderSides(); return; }
    edit((s) => { s.sides[k][key] = v; });
  });
  $('sideCards').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-color]');
    if (!b) return;
    const k = +b.closest('.sidecard').dataset.side;
    editMeta((s) => { s.sides[k].color = b.dataset.color; });
  });
  $('settingsForm').addEventListener('change', (e) => {
    const key = e.target.dataset.k;
    const f = E.SETTING_FIELDS.find((x) => x.k === key);
    if (!f) return;
    const v = readControl(f, e.target);
    if (v === null) { renderSides(); return; }
    edit((s) => { s.settings[key] = v; });
  });
  $('scnNoteEdit').addEventListener('change', (e) => editMeta((s) => { s.note = e.target.value; }));

  // ---------------------------------------------------------------- 結果タブ

  function renderResult() {
    const S = app.sim;
    const v = $('verdict'), tb = $('resultTable');
    if (!S) {
      v.innerHTML = '<div class="verdict"><div class="big">まだ計算していません</div><div class="sub">「再生」か「結果まで計算」を押すと、ここに勝敗と損害が出ます。</div></div>';
      tb.innerHTML = '';
      return;
    }
    if (!S.done) {
      v.innerHTML = '<div class="verdict"><div class="big">計算中（' + fmtT(S.t) + ' まで）</div><div class="sub">決着前です。「結果まで計算」で最後まで進めます。</div></div>';
      tb.innerHTML = '';
      return;
    }
    const R = S.result;
    const col = R.winner >= 0 ? colorVar(R.winner) : 'var(--ink-3)';
    v.innerHTML = '<div class="verdict" style="border-left:4px solid ' + col + '"><div class="big">' + esc(R.text) + '</div><div class="sub">決着 ' + fmtT(R.t) + '・シード ' + S.seed + '</div></div>';
    let html = '';
    R.sides.forEach((rs, k) => {
      html += '<table class="orbat" style="margin-top:10px"><thead><tr><th><span class="dot" style="background:' + colorVar(k) + ';width:8px;height:8px"></span> ' + esc(sideName(k)) + '</th><th>初期</th><th>撃沈</th><th>離脱</th><th>残存</th></tr></thead><tbody>';
      for (const [id, b] of Object.entries(rs.byType)) {
        html += '<tr><td>' + esc(S.scn.types[id].name) + '</td><td>' + b.n + '</td><td>' + b.lost + '</td><td>' + b.escaped + '</td><td>' + (b.left + b.pending) + '</td></tr>';
      }
      html += '<tr class="sum"><td>残存戦力</td><td colspan="4">' + pct(rs.kept) + '（戦場に残る ' + pct(rs.onField) + '）</td></tr></tbody></table>';
    });
    tb.innerHTML = html;
  }

  function renderLog() {
    const S = app.sim, box = $('log');
    if (!S) { box.innerHTML = '<p class="hint">計算を始めると、撃沈・ジャンプ・妨害場などの出来事が時刻つきで並びます。クリックでその時刻へ移ります。</p>'; app.lastLogKey = ''; return; }
    const minor = $('logMinor').checked;
    const t = S.frames[app.fi].t;
    const key = S.events.length + '|' + t + '|' + minor;
    if (key === app.lastLogKey) return;
    app.lastLogKey = key;
    let html = '', lastPast = -1;
    const list = S.events.filter((e) => minor || !e.minor);
    list.forEach((e, i) => { if (e.t <= t) lastPast = i; });
    list.forEach((e, i) => {
      const cls = e.t > t ? 'future' : (i === lastPast ? 'now' : '');
      html += '<div class="' + cls + '" data-t="' + e.t + '"><span class="t">' + fmtT(e.t) + '</span><span>' + esc(e.text) + '</span></div>';
    });
    box.innerHTML = html || '<p class="hint">まだ出来事はありません。</p>';
    const now = box.querySelector('.now');
    if (now && app.playing) now.scrollIntoView({ block: 'nearest' });
  }
  $('log').addEventListener('click', (e) => {
    const d = e.target.closest('div[data-t]');
    if (d) { app.playing = false; seekTo(+d.dataset.t); }
  });
  $('logMinor').addEventListener('change', () => { app.lastLogKey = ''; renderLog(); });

  // 複数回の試行
  function scnKey() { return JSON.stringify(app.scn); }
  async function runBatch() {
    if (!app.scn.units.length) { toast('先に艦を配置してください'); return; }
    if (app.batch) return;
    const n = +$('batchN').value;
    const scn = E.clone(app.scn);
    const base = scn.settings.seed | 0 || 1;
    const token = { stop: false };
    app.batch = token;
    $('batchBtn').disabled = true; $('batchStop').hidden = false;
    const out = $('batchOut');
    const res = [];
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      if (token.stop) break;
      res.push(E.runOnce(scn, base + i));
      out.innerHTML = '<div class="progress"><div style="width:' + ((i + 1) / n * 100) + '%"></div></div><p class="hint">' + (i + 1) + ' / ' + n + ' 回</p>';
      await new Promise((r) => setTimeout(r, 0));
    }
    app.batch = null;
    $('batchBtn').disabled = false; $('batchStop').hidden = true;
    if (!res.length) { out.innerHTML = ''; return; }
    const R = { n: res.length, key: scnKey(), wins: [0, 0], draws: 0, t: 0, kept: [0, 0], lost: [{}, {}], sec: (performance.now() - t0) / 1000, seeds: [base, base + res.length - 1], types: E.clone(scn.types) };
    for (const r of res) {
      if (r.winner < 0) R.draws++; else R.wins[r.winner]++;
      R.t += r.t;
      r.sides.forEach((s, k) => {
        R.kept[k] += s.kept;
        for (const [id, b] of Object.entries(s.byType)) R.lost[k][id] = (R.lost[k][id] || 0) + b.lost;
      });
    }
    app.batchRes = R;
    renderBatch();
  }
  function renderBatch() {
    const R = app.batchRes, out = $('batchOut');
    if (!R) { out.innerHTML = ''; return; }
    const stale = R.key !== scnKey();
    const segs = [
      { n: R.wins[0], c: colorVar(0), l: sideName(0) },
      { n: R.draws, c: 'var(--ink-3)', l: '引き分け' },
      { n: R.wins[1], c: colorVar(1), l: sideName(1) },
    ];
    let html = '<div class="winbar" role="img" aria-label="勝率">' + segs.filter((s) => s.n > 0).map((s) => '<div style="flex:' + s.n + ';background:' + s.c + '" title="' + esc(s.l) + ' ' + s.n + '回"></div>').join('') + '</div>';
    html += '<div class="winlab">' + segs.map((s) => '<span><span class="dot" style="background:' + s.c + ';width:8px;height:8px"></span> ' + esc(s.l) + ' ' + pct(s.n / R.n) + '（' + s.n + '回）</span>').join('') + '</div>';
    html += '<table class="orbat" style="margin-top:8px"><thead><tr><th>陣営</th><th>勝率</th><th>平均残存戦力</th></tr></thead><tbody>';
    [0, 1].forEach((k) => { html += '<tr><td>' + esc(sideName(k)) + '</td><td>' + pct(R.wins[k] / R.n) + '</td><td>' + pct(R.kept[k] / R.n) + '</td></tr>'; });
    html += '</tbody></table>';
    html += '<table class="orbat" style="margin-top:8px"><thead><tr><th>艦種ごとの平均損失</th><th>陣営</th><th>隻</th></tr></thead><tbody>';
    [0, 1].forEach((k) => {
      for (const [id, v] of Object.entries(R.lost[k])) html += '<tr><td>' + esc((R.types[id] || {}).name || id) + '</td><td>' + esc(sideName(k)) + '</td><td>' + num(v / R.n, 1) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<p class="hint">' + R.n + '回（シード ' + R.seeds[0] + '〜' + R.seeds[1] + '）・平均決着 ' + fmtT(R.t / R.n) + '・計算 ' + num(R.sec, 1) + '秒' + (stale ? '。<b>このあと配置や設定を変えたので、いまのシナリオの結果ではありません</b>' : '') + '</p>';
    out.innerHTML = html;
  }
  $('batchBtn').onclick = runBatch;
  $('batchStop').onclick = () => { if (app.batch) app.batch.stop = true; };

  // ---------------------------------------------------------------- 凡例

  function renderLegend() {
    const scn = app.scn;
    const rows = [];
    const seen = new Set();
    for (const u of scn.units) {
      const key = u.side + '|' + u.type;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = typeOf(u.type);
      rows.push([shapeSVG(d.shape, colorVar(u.side), 16), esc(d.name) + '<span style="color:var(--ink-3)">（' + esc(sideName(u.side)) + '）</span>']);
    }
    rows.sort((a, b) => (a[1] < b[1] ? -1 : 1));
    const sym = (inner) => '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' + inner + '</svg>';
    rows.push([sym('<circle cx="8" cy="8" r="6" style="fill:none;stroke:var(--field);stroke-width:1.5;stroke-dasharray:3 2"/>'), '妨害場（中はジャンプ不可）']);
    rows.push([sym('<line x1="1" y1="8" x2="15" y2="8" style="stroke:' + colorVar(1) + ';stroke-width:2.2"/>'), 'レーン']);
    rows.push([sym('<line x1="1" y1="8" x2="15" y2="8" style="stroke:var(--ink-3);stroke-width:1.5;stroke-dasharray:2 3"/>'), '寸断されたレーン']);
    rows.push([sym('<circle cx="8" cy="8" r="3" style="fill:var(--ink-2)"/><path d="M8 2 A6 6 0 1 1 2 8" style="fill:none;stroke:var(--ink-2);stroke-width:1.4"/>'), 'ロックタイム（輪が残り）']);
    rows.push([sym('<circle cx="4" cy="8" r="3" style="fill:none;stroke:var(--ink-2)"/><line x1="7" y1="8" x2="13" y2="8" style="stroke:var(--ink-2);stroke-dasharray:2 2"/><circle cx="13" cy="8" r="2" style="fill:none;stroke:var(--ink-2)"/>'), 'ジャンプ中（点線の先へ）']);
    rows.push([sym('<path d="M4 4 L12 12 M12 4 L4 12" style="stroke:var(--ink-3);stroke-width:1.5"/>'), '撃沈']);
    rows.push([sym('<line x1="2" y1="13" x2="14" y2="3" style="stroke:var(--ink-2);stroke-width:1.3"/>'), '射線（薄いのは外れ）']);
    $('legend').innerHTML = rows.map((r) => '<span>' + r[0] + '</span><span>' + r[1] + '</span>').join('');
  }

  // ---------------------------------------------------------------- 道具・タブ・全体

  const TOOL_HINT = {
    select: () => (app.sim ? '艦にマウスを重ねるか、クリックすると状態が見られます' : ''),
    place: () => { const d = typeOf(app.pal.type); return d ? sideName(app.pal.side) + ' の ' + d.name + ' を' + app.pal.count + '隻、クリックした位置に置きます' : '置く艦種を選んでください'; },
    goal: () => (app.sel.size ? '選んだ' + app.sel.size + '隻の目標地点をクリックで指定（隊形を保つ）' : '艦をクリックで選んでから、目標地点をクリック'),
    lane: () => sideName(app.pal.side) + ' のレーン: クリックで点を打ち、ダブルクリックか Enter で確定（' + (app.laneDraft ? app.laneDraft.pts.length + '点' : '0点') + '）。Esc で取消',
    label: () => 'クリックした位置に文字を置きます。置いた文字はドラッグで動かせます',
  };
  function renderToolHint() { $('toolhint').textContent = TOOL_HINT[app.tool] ? TOOL_HINT[app.tool]() : ''; }
  function setTool(t) {
    if (app.tool === 'lane' && t !== 'lane' && app.laneDraft) finishLane();
    app.tool = t;
    for (const b of document.querySelectorAll('#toolGroup button')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
    renderToolHint();
    draw();
  }
  function showTab(t) {
    app.tab = t;
    for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    for (const id of ['place', 'types', 'sides', 'result']) $('tab-' + id).hidden = id !== t;
    if (t === 'result') { renderResult(); renderLog(); renderBatch(); }
    if (t === 'types') renderTypes();
    if (t === 'sides') renderSides();
    if (t === 'place') { renderSel(); renderOrbat(); }
  }

  let toastTimer = 0;
  function toast(msg) {
    let el = $('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast'; el.className = 'tip'; el.setAttribute('role', 'status');
      el.style.cssText = 'left:50%;transform:translateX(-50%);bottom:12px;top:auto';
      board.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function refreshAll() {
    if (document.activeElement !== $('scnName')) $('scnName').value = app.scn.name;
    $('scnNote').textContent = app.scn.note || '';
    $('scnNote').hidden = !app.scn.note;
    renderPalette();
    renderLegend();
    renderToolHint();
    if (app.tab === 'place') { renderSel(); renderOrbat(); }
    if (app.tab === 'types') renderTypes();
    if (app.tab === 'sides') renderSides();
    if (app.tab === 'result') { renderResult(); renderLog(); renderBatch(); }
    renderFrame(true);
  }

  // ---------------------------------------------------------------- 上部の操作

  function initPresets() {
    $('presetSel').innerHTML = '<option value="">プリセットを開く…</option>' +
      P.SCENARIOS.map((s) => '<option value="' + s.id + '">' + esc(s.label) + '</option>').join('');
  }
  $('presetSel').addEventListener('change', (e) => {
    const p = P.SCENARIOS.find((s) => s.id === e.target.value);
    e.target.value = '';
    if (!p) return;
    pushUndo();
    loadScenario(p.make(), 'プリセット「' + p.label + '」を開きました（元に戻すで前の状態に戻せます）');
  });
  $('scnName').addEventListener('change', (e) => editMeta((s) => { s.name = e.target.value.trim() || '無題のシナリオ'; }));
  $('undoBtn').onclick = undo;
  $('helpBtn').onclick = () => $('helpDlg').showModal();
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }

  // 保存・読込
  $('ioBtn').onclick = () => {
    $('ioText').value = JSON.stringify(app.scn, null, 1);
    $('ioStatus').textContent = '';
    $('ioDlg').showModal();
  };
  $('ioCopy').onclick = () => {
    const txt = $('ioText').value;
    const fallback = () => { $('ioText').select(); $('ioStatus').textContent = '全体を選択しました。Ctrl+C（Mac は ⌘+C）でコピーしてください。'; };
    try {
      navigator.clipboard.writeText(txt).then(() => { $('ioStatus').textContent = 'コピーしました。'; }, fallback);
    } catch (e) { fallback(); }
  };
  // 「ファイルに保存」はローカルで開いたときだけ置く（埋め込み表示ではダウンロードできないため外すことがある）
  if ($('ioSave')) $('ioSave').onclick = () => {
    try {
      const blob = new Blob([$('ioText').value], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (app.scn.name || 'scenario').replace(/[\\/:*?"<>|]/g, '_') + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      $('ioStatus').textContent = 'ファイルとして保存しました。保存されない環境では「コピー」を使ってください。';
    } catch (e) { $('ioStatus').textContent = 'この環境ではファイルに保存できません。「コピー」を使ってください。'; }
  };
  $('ioOpenBtn').onclick = () => $('ioFile').click();
  $('ioFile').onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { $('ioText').value = String(rd.result); loadFromText(); };
    rd.readAsText(f);
    e.target.value = '';
  };
  function loadFromText() {
    let o;
    try { o = JSON.parse($('ioText').value); } catch (e) { $('ioStatus').textContent = 'JSON として読めません。貼り付けた内容が途中で切れていないか確かめてください。'; return; }
    if (!o || typeof o !== 'object' || !o.types || !Array.isArray(o.units)) { $('ioStatus').textContent = 'シナリオの形になっていません（types と units が必要です）。'; return; }
    pushUndo();
    loadScenario(o, 'シナリオを読み込みました');
    $('ioDlg').close();
  }
  $('ioLoad').onclick = loadFromText;

  // 道具・表示
  $('toolGroup').addEventListener('click', (e) => { const b = e.target.closest('button[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('fitBtn').onclick = () => { stopFollow(); fitView(true); };
  function bindOpts() {
    for (const [id, k] of [['optFollow', 'follow'], ['optShots', 'shots'], ['optGoals', 'goals'], ['optLinks', 'links'], ['optDead', 'dead'], ['optLabels', 'labels']]) {
      $(id).checked = app.opts[k];
      $(id).onchange = (e) => { app.opts[k] = e.target.checked; save(); if (k === 'follow' && e.target.checked) followCombat(true); draw(); };
    }
  }
  document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });

  // 配置パレット
  $('palSide').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-side]');
    if (!b) return;
    app.pal.side = +b.dataset.side;
    if (app.laneDraft) app.laneDraft.side = app.pal.side;
    save(); renderPalette(); renderToolHint(); draw();
  });
  $('palTypes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]');
    if (!b) return;
    app.pal.type = b.dataset.type;
    save(); renderPalette();
    setTool('place');
  });
  $('palCount').addEventListener('change', (e) => { app.pal.count = clamp(parseInt(e.target.value, 10) || 1, 1, 300); e.target.value = app.pal.count; save(); renderToolHint(); });
  $('palGap').addEventListener('change', (e) => { app.pal.gap = Math.max(0, parseFloat(e.target.value) || 0); e.target.value = app.pal.gap; save(); });
  $('palForm').addEventListener('change', (e) => { app.pal.form = e.target.value; save(); });

  // 時間軸
  $('playBtn').onclick = () => (app.playing ? pause() : play());
  $('resetBtn').onclick = () => { resetSim(); refreshAll(); toast('T=0 の編集に戻りました'); };
  $('endBtn').onclick = toEnd;
  $('seek').addEventListener('input', (e) => { app.playing = false; seekTo(+e.target.value); });

  // キーボード
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case ' ': e.preventDefault(); if (app.playing) pause(); else play(); break;
      case 'v': case 'V': setTool('select'); break;
      case 'p': case 'P': setTool('place'); break;
      case 'g': case 'G': setTool('goal'); break;
      case 'l': case 'L': setTool('lane'); break;
      case 't': case 'T': setTool('label'); break;
      case 'f': case 'F': stopFollow(); fitView(true); break;
      case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); break;
      case 'Enter': if (app.laneDraft) finishLane(); break;
      case 'Escape':
        if (app.laneDraft) { app.laneDraft = null; renderToolHint(); }
        else { app.sel.clear(); app.selLane = -1; app.selMark = -1; renderSel(); renderToolHint(); }
        draw();
        break;
      default: return;
    }
  });

  // 配色の切り替え（OS の設定・ビューアのテーマ）
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const recolor = () => { readColors(); refreshAll(); };
  if (mq && mq.addEventListener) mq.addEventListener('change', recolor);
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------------------------------------------------------------- 起動

  function start() {
    readColors();
    initPresets();
    const restored = restore();
    if (!restored) app.scn = E.normalizeScenario(P.SCENARIOS[0].make());
    pruneSelection();
    if (!app.pal.type || !app.scn.types[app.pal.type]) app.pal.type = Object.keys(app.scn.types)[0] || null;
    app.typeSel = app.pal.type;
    bindOpts();
    if (board.getBoundingClientRect().width < 700) $('legendBox').open = false;
    resizeMap();
    resizeChart();
    new ResizeObserver(() => { resizeMap(); resizeChart(); }).observe(board);
    new ResizeObserver(resizeChart).observe(ccv);
    if (!restored) fitView(false);
    setTool('select');
    refreshAll();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { draw(); drawChart(); });
  }
  start();

  // テストや開発者ツールから触れるように
  window.SimApp = { app, seekTo, play, pause, toEnd, loadScenario, fitView, setTool, showTab, runBatch, draw };
})();
