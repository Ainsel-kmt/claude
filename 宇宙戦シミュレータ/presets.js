/* 宇宙戦シミュレータ プリセット（艦種の初期値とシナリオ）
 *
 * 艦種の数値はすべて仮置き。設定（思考実験まとめ.md）で決まっているのは
 * 通常航行 0.05c、ロックタイム（リンク時）45分、通信艦の再同期 15分、
 * 静穏場の展開 15分・維持 3時間、レーン敷設 1光分あたり40分、まで。
 */
(function (global) {
  'use strict';

  const H = 3600, M = 60;

  const TYPES = {
    node: {
      name: 'ノード艦', abbr: 'N', shape: 'diamond', size: 1.5, cost: 12, origin: 0,
      hp: 1500, shield: 1200, shieldRegen: 1.5, evasion: 0,
      wDamage: 60, wRange: 3.5, wInterval: 30, wAccuracy: 0.95, wFalloff: 0.1,
      speed: 0.05, sensor: 60, jump: 'free', lockTime: 3 * H,
      ai: 'assault', priority: 'nearest', retreatAt: 0,
      linkOn: true, linkRadius: 5, linkCapacity: 12, linkLock: 45 * M, linkBonus: 0.3,
    },
    guard: {
      name: 'ガード級', abbr: 'G', shape: 'circle', size: 1, cost: 3, origin: 0,
      hp: 400, shield: 300, shieldRegen: 0.3, evasion: 0,
      wDamage: 20, wRange: 3, wInterval: 30, wAccuracy: 0.9, wFalloff: 0.1,
      speed: 0.05, sensor: 30, jump: 'free', lockTime: 3 * H,
      ai: 'escort', priority: 'nearest', retreatAt: 0,
    },
    comms: {
      name: '通信艦', abbr: 'C', shape: 'square', size: 1.1, cost: 4, origin: 0,
      hp: 300, shield: 300, shieldRegen: 0.3, evasion: 0,
      wDamage: 0, wRange: 0, wInterval: 30, wAccuracy: 0, wFalloff: 0,
      speed: 0.05, sensor: 60, jump: 'free', lockTime: 3 * H,
      ai: 'follow', priority: 'nearest', retreatAt: 0,
      commsOn: true, commsResync: 15 * M,
    },
    quiet: {
      name: '静穏場艦', abbr: 'Q', shape: 'hexagon', size: 1.3, cost: 6, origin: 0,
      hp: 600, shield: 2500, shieldRegen: 2, evasion: 0,
      wDamage: 0, wRange: 0, wInterval: 30, wAccuracy: 0, wFalloff: 0,
      speed: 0.05, sensor: 30, jump: 'free', lockTime: 3 * H,
      ai: 'follow', priority: 'nearest', retreatAt: 0,
      fieldOn: true, fieldRadius: 78, fieldDeploy: 15 * M, fieldDuration: 3 * H, fieldMode: 'arrive',
    },
    picket: {
      name: '哨戒艦', abbr: 'P', shape: 'triangle', size: 0.9, cost: 1, origin: 0,
      hp: 150, shield: 50, shieldRegen: 0.1, evasion: 0.1,
      wDamage: 5, wRange: 2, wInterval: 30, wAccuracy: 0.8, wFalloff: 0.2,
      speed: 0.08, sensor: 300, jump: 'free', lockTime: 3 * H,
      ai: 'follow', priority: 'nearest', retreatAt: 0,
    },
    base: {
      name: '人類拠点', abbr: '拠', shape: 'star', size: 2, cost: 20, origin: 0,
      hp: 6000, shield: 4000, shieldRegen: 3, evasion: 0,
      wDamage: 50, wRange: 3, wInterval: 20, wAccuracy: 0.9, wFalloff: 0.1,
      speed: 0, sensor: 120, jump: 'none', lockTime: 0,
      ai: 'static', priority: 'nearest', retreatAt: 0,
      fieldOn: true, fieldRadius: 180, fieldDeploy: 0, fieldDuration: 0, fieldMode: 'immediate',
    },
    narm: {
      name: 'ナーム級', abbr: 'ナ', shape: 'triangle', size: 0.9, cost: 1, origin: 1,
      hp: 500, shield: 100, shieldRegen: 0.1, evasion: 0.3,
      wDamage: 10, wRange: 4, wInterval: 30, wAccuracy: 0.7, wFalloff: 0.3,
      speed: 0.05, sensor: 200, jump: 'lane', lockTime: 30,
      ai: 'assault', priority: 'key', retreatAt: 0,
    },
    garmes: {
      name: 'ガルメス級', abbr: 'ガ', shape: 'square', size: 1.6, cost: 8, origin: 1,
      hp: 2500, shield: 500, shieldRegen: 0.5, evasion: 0.05,
      wDamage: 40, wRange: 4.5, wInterval: 30, wAccuracy: 0.8, wFalloff: 0.2,
      speed: 0.04, sensor: 200, jump: 'lane', lockTime: 60,
      ai: 'assault', priority: 'nearest', retreatAt: 0,
    },
    elda: {
      name: 'エルダ級', abbr: 'エ', shape: 'diamond', size: 1.2, cost: 5, origin: 1,
      hp: 800, shield: 100, shieldRegen: 0.1, evasion: 0.1,
      wDamage: 0, wRange: 0, wInterval: 30, wAccuracy: 0, wFalloff: 0,
      speed: 0.05, sensor: 200, jump: 'lane', lockTime: 30,
      ai: 'hold', priority: 'nearest', retreatAt: 0,
      layerOn: true, layerSpeed: 60 / (40 * M), layerMax: 300,
    },
    generic: {
      name: '汎用艦', abbr: '汎', shape: 'circle', size: 1, cost: 1, origin: 0,
      hp: 300, shield: 0, shieldRegen: 0, evasion: 0,
      wDamage: 10, wRange: 3, wInterval: 20, wAccuracy: 0.8, wFalloff: 0,
      speed: 0.05, sensor: 100, jump: 'none', lockTime: 0,
      ai: 'assault', priority: 'nearest', retreatAt: 0,
    },
  };

  // 隊形で n 隻を並べる（中心 cx, cy、間隔 gap 光秒）
  function formation(n, cx, cy, gap, kind) {
    const pts = [];
    if (kind === 'line') {
      for (let i = 0; i < n; i++) pts.push([cx, cy + (i - (n - 1) / 2) * gap]);
    } else if (kind === 'column') {
      for (let i = 0; i < n; i++) pts.push([cx + (i - (n - 1) / 2) * gap, cy]);
    } else if (kind === 'ring') {
      const r = n > 1 ? Math.max(gap, (n * gap) / (2 * Math.PI)) : 0;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    } else {
      // 塊（ひまわり状に詰める）
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996, r = gap * 0.55 * Math.sqrt(i);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    }
    return pts.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
  }

  function group(type, side, n, cx, cy, gap, kind, extra) {
    return formation(n, cx, cy, gap, kind).map((p) => Object.assign({ type, side, x: p[0], y: p[1] }, extra || {}));
  }

  // 目標地点を、隊形の形を保ったまま与える
  function withGoal(units, gx, gy) {
    if (!units.length) return units;
    const cx = units.reduce((a, u) => a + u.x, 0) / units.length;
    const cy = units.reduce((a, u) => a + u.y, 0) / units.length;
    return units.map((u) => Object.assign(u, { goal: [Math.round((gx + (u.x - cx)) * 100) / 100, Math.round((gy + (u.y - cy)) * 100) / 100] }));
  }

  const pick = (ids) => {
    const o = {};
    for (const id of ids) o[id] = JSON.parse(JSON.stringify(TYPES[id]));
    return o;
  };
  const ALL = Object.keys(TYPES).filter((k) => k !== 'generic');

  // ---------------------------------------------------------------- シナリオ

  function basic() {
    return {
      name: '正面衝突',
      note: '人類（ノード艦2・ガード級16）とザイレン（ナーム級30・ガルメス級1）が約2光分離れて向き合う。人類は任意座標にジャンプして飛び込むが、着いたらロックタイムで逃げられない。ザイレンはレーンの先端までは一瞬で来られる。',
      settings: { timeLimit: 3 * H },
      sides: [
        { name: '人類統合機構', color: 'blue', reaction: 2 * M, sharing: 'comms', retreatBelow: 0.3 },
        { name: 'ザイレン', color: 'orange', reaction: 5 * M, sharing: 'always', retreatBelow: 0 },
      ],
      types: pick(ALL),
      units: [].concat(
        group('node', 0, 2, 30, 50, 2, 'line'),
        group('guard', 0, 16, 26, 50, 0.6, 'cluster'),
        group('comms', 0, 1, 22, 50, 1, 'cluster'),
        group('picket', 0, 2, 24, 44, 2, 'column'),
        group('narm', 1, 30, 170, 50, 0.7, 'cluster'),
        group('garmes', 1, 1, 176, 50, 1, 'cluster'),
      ),
      lanes: [{ side: 1, pts: [[230, 50], [150, 50]] }],
      marks: [],
    };
  }

  function sSystem(variant) {
    const H2 = [300, 0], P0 = [300, -120], H3 = [620, 40];
    const human = [].concat(
      group('node', 0, 3, P0[0], P0[1], 1.2, 'line'),
      group('guard', 0, 24, P0[0] - 1.5, P0[1], 0.5, 'cluster'),
      group('comms', 0, 1, P0[0] - 3.5, P0[1], 1, 'cluster'),
      group('quiet', 0, 1, P0[0] + 1.2, P0[1] + 1.4, 1, 'cluster'),
      group('picket', 0, 6, P0[0] - 2.5, P0[1] - 2.5, 0.8, 'column'),
    ).map((u) => Object.assign(u, { locked: true, move: 'jump' }));
    withGoal(human, H2[0] + 0.3, H2[1] - 2.2);
    const units = [].concat(
      [{ type: 'base', side: 0, x: 0, y: 0 }],
      group('guard', 0, 6, 0, 0, 1.2, 'ring', { ai: 'hold' }),
      human,
      group('narm', 1, 30, H2[0], H2[1], 0.6, 'cluster', { ai: 'hold' }),
      group('garmes', 1, 1, H2[0] + 1, H2[1] + 1, 1, 'cluster', { ai: 'hold' }),
      group('elda', 1, 2, H2[0] - 1, H2[1] + 1, 1, 'column'),
      variant === 'A'
        ? group('narm', 1, 50, H3[0], H3[1], 0.6, 'cluster')
        : group('narm', 1, 50, H2[0] + 1.5, H2[1] + 0.5, 0.6, 'cluster', { ai: 'hold' }),
    );
    return {
      name: variant === 'A' ? 'S星系外縁 A（後続が後方のハブ）' : 'S星系外縁 B（後続をH2に温存）',
      note: variant === 'A'
        ? '会戦_S星系外縁.md の第7段階。人類増援はH2から2光分の地点に着いたばかり（ロックタイム45分）。ロック明けにH2の至近へ跳び、静穏場艦が妨害場を張る。ザイレンの後続50隻は後方のハブH3にいて、人類を見つけてから動くまで20分かかる。'
        : '会戦_S星系外縁.md のザイレン勝ち版。後続50隻をH2に温存し、約80隻で待ち構える。人類が跳び込むと、展開中の静穏場艦が集中攻撃を受ける。',
      settings: { timeLimit: 4 * H },
      sides: [
        { name: '人類統合機構', color: 'blue', reaction: 2 * M, sharing: 'comms', retreatBelow: 0.4 },
        { name: 'ザイレン', color: 'orange', reaction: 20 * M, sharing: 'always', retreatBelow: 0 },
      ],
      types: pick(ALL),
      units,
      lanes: [
        { side: 1, pts: [[-100, -60], [H2[0], H2[1]]] },
        { side: 1, pts: [[H2[0], H2[1]], [460, 10], [H3[0], H3[1]]] },
        { side: 1, pts: [[H2[0], H2[1]], [380, 200]] },
      ],
      marks: [
        { x: H2[0] + 6, y: H2[1] + 4, text: 'H2（ザイレンのハブ）' },
        { x: -100, y: -60, text: 'H1（寸断済み）' },
        { x: H3[0], y: H3[1], text: 'H3（後方のハブ）' },
        { x: P0[0] - 8, y: P0[1] - 4, text: '人類増援の到着点' },
        { x: 0, y: 4, text: '人類拠点' },
      ],
    };
  }

  function lanchester() {
    const t = JSON.parse(JSON.stringify(TYPES.generic));
    return {
      name: '数の差の確認（同性能 20 対 30）',
      note: '性能が同じ艦どうしで数だけ変える。ジャンプもレーンもない、いちばん単純な撃ち合い。狙う敵が「最寄り」だと射撃が散って、数の多い側はほぼ無傷で勝つ。青軍を選んで「弱った敵」に変えると集中射撃になり、橙軍の残りはランチェスターの二乗則（√(30²−20²) ≈ 22隻）に近づく。',
      settings: { timeLimit: 2 * H },
      sides: [
        { name: '青軍', color: 'blue', reaction: 0, sharing: 'always', retreatBelow: 0 },
        { name: '橙軍', color: 'orange', reaction: 0, sharing: 'always', retreatBelow: 0 },
      ],
      types: { generic: t },
      units: [].concat(
        group('generic', 0, 20, 40, 40, 0.8, 'line'),
        group('generic', 1, 30, 80, 40, 0.8, 'line'),
      ),
      lanes: [],
      marks: [],
    };
  }

  function empty() {
    return {
      name: '空のマップ',
      note: '',
      settings: {},
      sides: [
        { name: '人類統合機構', color: 'blue', reaction: 2 * M, sharing: 'comms', retreatBelow: 0 },
        { name: 'ザイレン', color: 'orange', reaction: 10 * M, sharing: 'always', retreatBelow: 0 },
      ],
      types: pick(Object.keys(TYPES)),
      units: [], lanes: [], marks: [],
    };
  }

  const SCENARIOS = [
    { id: 'basic', label: '正面衝突', make: basic },
    { id: 'sA', label: 'S星系外縁 A（後続が後方）', make: () => sSystem('A') },
    { id: 'sB', label: 'S星系外縁 B（後続をH2に温存）', make: () => sSystem('B') },
    { id: 'lan', label: '数の差の確認（同性能 20 対 30）', make: lanchester },
    { id: 'empty', label: '空のマップ', make: empty },
  ];

  const api = { TYPES, SCENARIOS, formation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SimPresets = api;
})(typeof window !== 'undefined' ? window : globalThis);
