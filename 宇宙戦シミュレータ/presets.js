/* 宇宙戦シミュレータ プリセット（艦種の初期値とシナリオ）
 *
 * 艦種の数値はすべて仮置き。設定（思考実験まとめ.md）で決まっているのは
 * 通常航行 0.05c、ロックタイム（リンク時）45分、通信艦の再同期 15分、
 * 静穏場の展開 15分・維持 3時間、レーン敷設 1光分あたり40分、まで。
 */
(function (global) {
  'use strict';

  const H = 3600, M = 60, M_ = 60;
  // シェル系統（慣性弾）の副兵装の共通値。戦闘が始まる前に、超遠距離（60光秒）から敵の群れの進む先を見越して撃ち込む先制の一撃。
  // 着いた点で爆発し、半径1光秒の中の敵すべてにナーム級を一撃で沈める損害（減衰なし）。撃たれる側は気づかない。
  // 弾数に限りがあり（味方の拠点の近くで補充）、範囲に3隻以上入る群れにだけ撃つ。
  // ウォードは歪曲への防御なので、実体弾は素通りする想定
  const SHELL = {
    sOn: true, sKind: 'shell', sDamage: 600, sRange: 60, sInterval: 600, sAccuracy: 0.9, sFalloff: 0, sMounts: 1, sSpeed: 0.05, sBypass: 1,
    sBlast: 1, sAmmo: 4, sMinCount: 3, sReturn: false,
  };

  const TYPES = {
    node: {
      name: 'ノード艦', abbr: 'N', shape: 'diamond', size: 1.5, cost: 12, origin: 0,
      hp: 1500, shield: 1200, shieldRegen: 1.5, evasion: 0,
      wDamage: 60, wRange: 3.5, wInterval: 30, wAccuracy: 0.95, wFalloff: 0.1,
      speed: 0.05, sensor: 60, jump: 'free', lockTime: 3 * H,
      ai: 'assault', priority: 'nearest', retreatAt: 0,
      linkOn: true, linkRadius: 5, linkCapacity: 12, linkLock: 45 * M, linkBonus: 0.3,
      pdOn: true, pdRange: 1.5, pdChance: 0.5, pdInterval: 6,
    },
    guard: {
      name: 'ガード級', abbr: 'G', shape: 'circle', size: 1, cost: 3, origin: 0,
      hp: 400, shield: 300, shieldRegen: 0.3, evasion: 0,
      wDamage: 20, wRange: 3, wInterval: 30, wAccuracy: 0.9, wFalloff: 0.1,
      speed: 0.05, sensor: 30, jump: 'free', lockTime: 3 * H,
      ai: 'escort', priority: 'nearest', retreatAt: 0,
      pdOn: true, pdRange: 1, pdChance: 0.3, pdInterval: 10,
    },
    comms: {
      name: '通信艦', abbr: 'C', shape: 'square', size: 1.1, cost: 4, origin: 0,
      hp: 300, shield: 300, shieldRegen: 0.3, evasion: 0,
      wDamage: 5, wRange: 2, wInterval: 30, wAccuracy: 0.8, wFalloff: 0.2,
      speed: 0.05, sensor: 60, jump: 'free', lockTime: 3 * H,
      ai: 'follow', priority: 'nearest', retreatAt: 0,
      commsOn: true, commsResync: 15 * M,
    },
    quiet: {
      name: '静穏場艦', abbr: 'Q', shape: 'hexagon', size: 1.3, cost: 6, origin: 0,
      hp: 600, shield: 2500, shieldRegen: 2, evasion: 0,
      wDamage: 5, wRange: 2, wInterval: 30, wAccuracy: 0.8, wFalloff: 0.2,
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
      wDamage: 50, wRange: 6, wInterval: 20, wAccuracy: 0.9, wFalloff: 0.1, wMounts: 6,
      speed: 0, sensor: 120, jump: 'none', lockTime: 0,
      ai: 'static', priority: 'nearest', retreatAt: 0,
      fieldOn: true, fieldRadius: 180, fieldDeploy: 0, fieldDuration: 0, fieldMode: 'immediate',
      ...SHELL, sDamage: 3000, sInterval: 300, sMounts: 2, sAmmo: 12,
      pdOn: true, pdRange: 2, pdChance: 0.5, pdInterval: 5,
    },
    narm: {
      name: 'ナーム級', abbr: 'ナ', shape: 'triangle', size: 0.9, cost: 1, origin: 1,
      hp: 500, shield: 100, shieldRegen: 0.1, evasion: 0.3,
      wDamage: 10, wRange: 4, wInterval: 30, wAccuracy: 0.7, wFalloff: 0.3,
      speed: 0.05, sensor: 200, jump: 'lane', lockTime: 30,
      ai: 'assault', priority: 'key', retreatAt: 0,
      pdOn: true, pdRange: 0.5, pdChance: 0.1, pdInterval: 20,
    },
    garmes: {
      name: 'ガルメス級', abbr: 'ガ', shape: 'square', size: 1.6, cost: 8, origin: 1,
      hp: 2500, shield: 500, shieldRegen: 0.5, evasion: 0.05,
      wDamage: 40, wRange: 4.5, wInterval: 30, wAccuracy: 0.8, wFalloff: 0.2, wMounts: 4,
      speed: 0.04, sensor: 200, jump: 'lane', lockTime: 60,
      ai: 'assault', priority: 'nearest', retreatAt: 0,
      pdOn: true, pdRange: 1.5, pdChance: 0.4, pdInterval: 8,
    },
    elda: {
      name: 'エルダ級', abbr: 'エ', shape: 'diamond', size: 1.2, cost: 5, origin: 1,
      hp: 800, shield: 100, shieldRegen: 0.1, evasion: 0.1,
      wDamage: 0, wRange: 0, wInterval: 30, wAccuracy: 0, wFalloff: 0,
      speed: 0.05, sensor: 200, jump: 'lane', lockTime: 30,
      ai: 'hold', priority: 'nearest', retreatAt: 0,
      layerOn: true, layerSpeed: 60 / (40 * M), layerMax: 300,
    },
    // シェル系統の特化艦（砲撃艦）。主砲はなく、艦隊の後ろに付いていき、超遠距離から敵の群れへシェルを撃ち込む。
    // 撃ち尽くすと味方の拠点へ補充に戻る。名前と数値は仮置き
    artillery: {
      name: '砲撃艦', abbr: '砲', shape: 'triangle', size: 1.1, cost: 4, origin: 0,
      hp: 400, shield: 300, shieldRegen: 0.3, evasion: 0.1,
      wDamage: 0, wRange: 0, wInterval: 30, wAccuracy: 0, wFalloff: 0,
      speed: 0.05, sensor: 60, jump: 'free', lockTime: 3 * H,
      ai: 'follow', priority: 'nearest', retreatAt: 0,
      ...SHELL, sInterval: 300, sMounts: 2, sAmmo: 6, sReturn: true,
    },
    // 誘導弾・無人機を積む艦種（2026-10-16 に正式な艦種にした。設定資料にはまだない）。数値は仮置き
    missile: {
      name: 'ミサイル艦', abbr: 'ミ', shape: 'triangle', size: 1.2, cost: 6, origin: 0,
      hp: 500, shield: 400, shieldRegen: 0.5, evasion: 0,
      wDamage: 0, wRange: 0, wInterval: 30, wAccuracy: 0, wFalloff: 0,
      speed: 0.05, sensor: 60, jump: 'free', lockTime: 3 * H,
      ai: 'kite', priority: 'nearest', retreatAt: 0,
      sOn: true, sKind: 'missile', sDamage: 120, sRange: 15, sInterval: 120, sAccuracy: 0.85, sFalloff: 0, sMounts: 4, sSpeed: 0.1, sBypass: 0.5, sLife: 600,
      pdOn: true, pdRange: 1, pdChance: 0.3, pdInterval: 10,
    },
    carrier: {
      name: '無人機母艦', abbr: '母', shape: 'square', size: 1.6, cost: 10, origin: 0,
      hp: 1500, shield: 1000, shieldRegen: 1, evasion: 0,
      wDamage: 0, wRange: 0, wInterval: 30, wAccuracy: 0, wFalloff: 0,
      speed: 0.05, sensor: 60, jump: 'free', lockTime: 3 * H,
      ai: 'kite', priority: 'nearest', retreatAt: 0,
      sOn: true, sKind: 'drone', sDamage: 10, sRange: 20, sInterval: 300, sAccuracy: 0.8, sFalloff: 0, sMounts: 4, sSpeed: 0.08, sBypass: 0, sLife: 15 * M,
      pdOn: true, pdRange: 1.5, pdChance: 0.4, pdInterval: 8,
    },
    // ザイレンの巨大旗艦（2026-10-16 に追加。設定資料にはない、シミュレータだけの艦種。級名・数値は仮置き）。
    // 動くハブ（進みながら後ろにレーンを敷き、網の味方がそばまで跳べる）・攻城線砲（5分溜めて、線の上の敵すべてを貫く）・
    // 方舟（ナーム級を積んで運び、敵を見つけたら30秒ごとに2隻ずつ出す）をひとつにまとめた。大きさは拠点くらい
    flagship: {
      name: 'オルドラ級', abbr: 'オ', shape: 'hexagon', size: 2.6, cost: 30, origin: 1,
      hp: 6000, shield: 4000, shieldRegen: 3, evasion: 0,
      wDamage: 40, wRange: 4.5, wInterval: 30, wAccuracy: 0.8, wFalloff: 0.2, wMounts: 8,
      speed: 0.02, sensor: 30, jump: 'lane', lockTime: 60,
      ai: 'hold', priority: 'nearest', retreatAt: 0,
      pdOn: true, pdRange: 1.5, pdChance: 0.4, pdInterval: 8,
      sOn: true, sKind: 'lance', sDamage: 2000, sRange: 30, sInterval: 60, sAccuracy: 1, sFalloff: 0, sMounts: 1, sBypass: 0,
      sAmmo: 0, sMinCount: 3, sCharge: 5 * M, sWidth: 0.3,
      hubOn: true, hubSpeed: 60 / (40 * M),
      hangarOn: true, hangarCap: 40, hangarInterval: 30, hangarBatch: 2,
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
  // 旗艦（flagship）は「巨大艦の試し」だけで使う（ほかのプリセットに艦種を足すと、狙い方の基準が変わって結果が動くため）
  const ALL = Object.keys(TYPES).filter((k) => k !== 'generic' && k !== 'flagship');

  // ---------------------------------------------------------------- シナリオ

  function basic() {
    return {
      name: '正面衝突',
      note: '人類（ノード艦2・ガード級16・ミサイル艦2・無人機母艦1）とザイレン（ナーム級31・ガルメス級1）が約2光分離れて向き合う。人類は任意座標にジャンプして飛び込むが、着いたらロックタイムで逃げられない。ザイレンはレーンの先端までは一瞬で来られる。',
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
        group('missile', 0, 2, 20, 47, 1.2, 'line'),
        group('carrier', 0, 1, 18, 53, 1.5, 'line'),
        group('narm', 1, 31, 170, 50, 0.7, 'cluster'),
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

  // 大規模会戦: 第7段階（ザイレンの波状展開）と第8段階（レーン延伸による迂回）をひとつの会戦にまとめた想定。
  // o で兵力や時刻を変えられる（釣り合いを調べるため）
  function grandBattle(o) {
    o = Object.assign({
      w1: 110, w2: 105, fl: 40,           // ザイレン: 第1波・予備・迂回部隊のナーム級
      w2At: 60,                           // ザイレン予備が後方のハブに着く時刻（分）
      n1: 5, g1: 60, d1: 2, m1: 4, c1: 2, // 人類主力のノード艦・ガード級・砲撃艦・ミサイル艦・無人機母艦
      n2: 3, g2: 32, d2: 0, m2: 2, c2: 1, // 人類増援の同じ艦種
      rAt: 45,                            // 人類増援の到着時刻（分）
    }, o || {});
    const A = [0, 0], B = [40, 230];                 // 人類の主拠点（妨害場 半径2光分）・第2拠点（半径80光秒）
    const H1 = [-60, -40], H2 = [200, 0], H3 = [380, 30], H4 = [320, 200];
    const STUB = [210, 230];                         // H4 から第2拠点へ延ばしかけのレーンの先端
    const T = [B[0] + 95, B[1]];                     // 迂回部隊がレーンを延ばす先（第2拠点の妨害場の手前）
    const M = [140, 70];                             // 人類主力艦隊の待機位置（主拠点の妨害場の外）
    const R = [120, 180];                            // 本国からの増援の到着点（第2拠点の妨害場の外）
    const CUT = [225, 225];                          // 増援の静穏場艦が妨害場を張る地点（迂回部隊のレーンの付け根）
    const reinf = { appear: o.rAt * M_, locked: true };
    const units = [].concat(
      // 人類: 拠点と守備隊
      [{ type: 'base', side: 0, x: A[0], y: A[1] }],
      group('guard', 0, 12, A[0], A[1], 1.5, 'ring', { ai: 'hold' }),
      [{ type: 'base2', side: 0, x: B[0], y: B[1] }],
      group('guard', 0, 8, B[0], B[1], 1.5, 'ring', { ai: 'hold' }),
      // 人類: 主力艦隊。待機位置で第1波を迎え撃つ
      group('node', 0, o.n1, M[0], M[1], 1.5, 'line', { ai: 'hold' }),
      group('guard', 0, o.g1, M[0] - 2, M[1], 0.5, 'cluster'),
      group('comms', 0, 2, M[0] - 6, M[1], 1.2, 'line'),
      group('artillery', 0, o.d1, M[0] - 9, M[1], 1, 'line'),
      group('missile', 0, o.m1, M[0] - 12, M[1] - 3, 1.2, 'line'),
      group('carrier', 0, o.c1, M[0] - 12, M[1] + 4, 1.5, 'line'),
      group('picket', 0, 8, M[0] + 30, M[1] - 20, 8, 'column', { ai: 'static' }),
      // 人類: 本国からの増援。第2拠点を守り、静穏場艦は迂回部隊のレーンの付け根を断つ
      group('node', 0, o.n2, R[0], R[1], 1.5, 'line', reinf),
      group('guard', 0, o.g2, R[0] - 2, R[1], 0.5, 'cluster', reinf),
      group('comms', 0, 1, R[0] - 5, R[1], 1, 'cluster', reinf),
      group('artillery', 0, o.d2, R[0] - 8, R[1], 1, 'line', reinf),
      group('missile', 0, o.m2, R[0] - 10, R[1] - 3, 1.2, 'line', reinf),
      group('carrier', 0, o.c2, R[0] - 10, R[1] + 3, 1.5, 'line', reinf),
      withGoal(group('quiet', 0, 2, R[0] + 1, R[1] + 1, 1.2, 'line', reinf), CUT[0], CUT[1]),
      // ザイレン: 第1波（H2）。人類主力の正面へ向かう
      withGoal(group('narm', 1, o.w1, H2[0], H2[1], 0.6, 'cluster'), M[0] + 8, M[1] - 8),
      withGoal(group('garmes', 1, 4, H2[0] + 3, H2[1], 2, 'line'), M[0] + 12, M[1] - 10),
      group('elda', 1, 2, H2[0] - 3, H2[1] + 2, 2, 'column', { ai: 'hold' }),
      // ザイレン: 予備。少し遅れて後方のハブH3に着く
      group('narm', 1, o.w2, H3[0], H3[1], 0.6, 'cluster', { appear: o.w2At * M_ }),
      group('garmes', 1, 3, H3[0] + 3, H3[1], 2, 'line', { appear: o.w2At * M_ }),
      // ザイレン: 迂回部隊。エルダ級がレーンを第2拠点の手前まで延ばし、ナーム級がその先へ出る
      withGoal(group('elda', 1, 3, STUB[0], STUB[1], 1.5, 'line'), T[0], T[1]),
      withGoal(group('narm', 1, o.fl, H4[0], H4[1], 0.6, 'cluster'), T[0] + 10, T[1]),
      withGoal(group('garmes', 1, 1, H4[0] + 3, H4[1], 2, 'line'), T[0] + 12, T[1]),
    );
    const types = pick(ALL);
    types.base = Object.assign(types.base, { name: '人類主拠点', fieldRadius: 120, known: true });
    types.base2 = Object.assign(JSON.parse(JSON.stringify(TYPES.base)), { name: '人類第2拠点', abbr: '拠2', hp: 4000, shield: 2500, fieldRadius: 80, cost: 15, known: true });
    return {
      name: '大規模会戦: S星系決戦',
      note: '第7段階と第8段階をひとつにした想定（約400隻）。ザイレンはH2の第1波（ナーム級' + o.w1 + '）で人類主力を押し、予備（ナーム級' + o.w2 + '）がT+' + o.w2At + '分に後方のハブH3へ着いて続く。H4の迂回部隊（ナーム級' + o.fl + '）は、エルダ級が延ばすレーンで第2拠点に迫る。人類は主力（ノード艦' + o.n1 + '・ガード級' + o.g1 + (o.d1 ? '・砲撃艦' + o.d1 : '') + (o.m1 ? '・ミサイル艦' + o.m1 : '') + (o.c1 ? '・無人機母艦' + o.c1 : '') + '）が待機位置で迎え撃ち、本国からの増援（ノード艦' + o.n2 + '・ガード級' + o.g2 + (o.d2 ? '・砲撃艦' + o.d2 : '') + (o.m2 ? '・ミサイル艦' + o.m2 : '') + (o.c2 ? '・無人機母艦' + o.c2 : '') + '・静穏場艦2）がT+' + o.rAt + '分に第2拠点の近くへ着く。増援の静穏場艦は迂回部隊のレーンの付け根を妨害場で断つ。拠点の位置は互いに知っている。拠点は6門の砲で応戦し、手の空いた護衛は攻められている拠点の救援に向かう。拠点と砲撃艦は、近づいてくる敵の群れへ超遠距離からシェルを撃ち込む。数値は仮置き。',
      settings: { timeLimit: 6 * H },
      sides: [
        { name: '人類統合機構', color: 'blue', reaction: 3 * M_, sharing: 'comms', retreatBelow: 0.3 },
        { name: 'ザイレン', color: 'orange', reaction: 10 * M_, sharing: 'always', retreatBelow: 0.25 },
      ],
      types,
      units,
      lanes: [
        { side: 1, pts: [H1, H2] },
        { side: 1, pts: [H2, [490, 20], H3] },
        { side: 1, pts: [H3, H4] },
        { side: 1, pts: [H2, H4] },
        { side: 1, pts: [H4, STUB] },
      ],
      marks: [
        { x: A[0], y: A[1] + 4, text: '人類主拠点' },
        { x: B[0], y: B[1] + 4, text: '人類第2拠点' },
        { x: H1[0], y: H1[1], text: 'H1（寸断済み）' },
        { x: H2[0] + 6, y: H2[1] + 4, text: 'H2（第1波）' },
        { x: H3[0], y: H3[1] + 4, text: 'H3（予備）' },
        { x: H4[0], y: H4[1] + 4, text: 'H4（迂回部隊）' },
        { x: M[0], y: M[1] - 6, text: '人類主力' },
        { x: R[0], y: R[1] - 6, text: '増援の到着点（T+' + o.rAt + '分）' },
        { x: CUT[0], y: CUT[1] + 8, text: 'レーンを断つ地点' },
      ],
    };
  }

  function lanchester() {
    const t = JSON.parse(JSON.stringify(TYPES.generic));
    return {
      name: '数の差の確認（同性能 20 対 30）',
      note: '性能が同じ艦どうしで数だけ変える。ジャンプもレーンもない、いちばん単純な撃ち合い。狙う敵が「最寄り」だと射撃が散って、数の多い側の損害は数隻で済む。青軍を選んで「弱った敵」に変えると集中射撃になり、橙軍の残りはランチェスターの二乗則（√(30²−20²) ≈ 22隻）に近づく。',
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

  // 副兵装の試し撃ち: シェル・誘導弾・無人機・迎撃を一度に見るための小さな戦い
  function armsDemo() {
    const types = pick(ALL);
    types.base.fieldRadius = 15;
    // 迎撃を見るため、ガルメス級にも試しに誘導弾を積む（設定にはない）
    Object.assign(types.garmes, { sOn: true, sKind: 'missile', sDamage: 100, sRange: 12, sInterval: 90, sAccuracy: 0.8, sFalloff: 0, sMounts: 3, sSpeed: 0.1, sBypass: 0.5 });
    return {
      name: '副兵装の試し撃ち',
      note: '副兵装を一度に見るための小さな戦い。人類は拠点（シェルと迎撃）・ノード艦とガード級（迎撃）・砲撃艦（シェル）に、ミサイル艦（誘導弾）と無人機母艦（無人機）を加えた。最初に拠点と砲撃艦が、迫ってくるナーム級の群れへ超遠距離からシェルを撃ち込む。ザイレンはナーム級75とガルメス級4で、ガルメス級には試しに誘導弾を積んだ。ミサイル艦と母艦は射程を保って撃ち、ナーム級が寄ってくるとガード級の主砲とシェルの間合いになる。',
      settings: { timeLimit: 3 * H },
      sides: [
        { name: '人類統合機構', color: 'blue', reaction: 2 * M, sharing: 'always', retreatBelow: 0.2 },
        { name: 'ザイレン', color: 'orange', reaction: 2 * M, sharing: 'always', retreatBelow: 0.2 },
      ],
      types,
      units: [].concat(
        [{ type: 'base', side: 0, x: 0, y: 0 }],
        group('node', 0, 1, 14, 0, 1, 'cluster'),
        group('guard', 0, 16, 15, 0, 0.6, 'cluster'),
        group('missile', 0, 4, 10, -3, 1.2, 'line'),
        group('artillery', 0, 3, 6, 3, 1, 'line'),
        group('carrier', 0, 2, 8, 3, 1.5, 'line'),
        group('narm', 1, 75, 60, 0, 0.6, 'cluster'),
        group('garmes', 1, 4, 64, 0, 1.5, 'line'),
      ),
      lanes: [],
      marks: [{ x: 0, y: 3, text: '人類拠点' }, { x: 60, y: 5, text: 'ザイレン' }],
    };
  }

  // 巨大艦の試し: ザイレンの旗艦（オルドラ級）の3つのしくみを見るための場面
  function giantDemo() {
    const B = [0, 0], M = [65, 0], H2 = [200, 0], H3 = [320, 40], GOAL = [95, 0], CUT = [160, 16];
    const types = pick(ALL.concat(['flagship']));
    types.base.fieldRadius = 50;
    types.quiet.fieldRadius = 30;
    const cut = { appear: 70 * M_, locked: true };
    const units = [].concat(
      // 人類: 拠点と守備隊、前に出た主力
      [{ type: 'base', side: 0, x: B[0], y: B[1] }],
      group('guard', 0, 8, B[0], B[1], 1.5, 'ring', { ai: 'hold' }),
      group('node', 0, 3, M[0], M[1], 1.5, 'line'),
      group('guard', 0, 30, M[0] - 2, M[1], 0.5, 'cluster'),
      group('comms', 0, 1, M[0] - 6, M[1], 1, 'cluster'),
      group('artillery', 0, 2, M[0] - 9, M[1], 1, 'line'),
      group('missile', 0, 2, M[0] - 12, M[1], 1.2, 'line'),
      // 人類: 旗艦の引くレーンを断ちにくる静穏場艦と護衛（T+70分）
      group('quiet', 0, 1, CUT[0], CUT[1], 1, 'cluster', cut),
      group('guard', 0, 8, CUT[0] - 1, CUT[1] + 1, 0.6, 'cluster', cut),
    );
    // ザイレン: 旗艦（ナーム級30を積む）と、付き添うガルメス級
    const fi = units.length;
    units.push({ type: 'flagship', side: 1, x: H2[0], y: H2[1], goal: [GOAL[0], GOAL[1]] });
    units.push(...group('narm', 1, 30, H2[0], H2[1], 0.6, 'cluster', { aboard: fi }));
    units.push(...group('garmes', 1, 2, H2[0] + 2, H2[1], 2, 'line', { ai: 'escort' }));
    // ザイレン: 後方のハブH3に着く予備。旗艦のそばまでレーンで跳んでくる
    units.push(...group('narm', 1, 40, H3[0], H3[1], 0.6, 'cluster', { appear: 50 * M_ }));
    return {
      name: '巨大艦の試し',
      note: 'ザイレンの旗艦（オルドラ級。シミュレータだけの仮の艦種）の3つのしくみを見る場面。旗艦はH2から人類の主力へ向かって進みながら、後ろにレーンを敷く（動くハブ）。T+50分に後方のハブH3に着く予備（ナーム級40）は、そのレーンで旗艦のそばまで跳んでくる。旗艦は積んできたナーム級30を、敵を見つけると30秒ごとに2隻ずつ出す（方舟）。人類の主力が30光秒に入ると、5分溜めて、線の上に並ぶ敵すべてを貫く（攻城線砲）。人類はT+70分に静穏場艦を旗艦のレーンの途中へ送り、妨害場でレーンを断つ。旗艦が沈むと、旗艦が敷いたレーンは消え、積まれたままの艦も沈む。数値は仮置き。',
      settings: { timeLimit: 4 * H },
      sides: [
        { name: '人類統合機構', color: 'blue', reaction: 3 * M_, sharing: 'comms', retreatBelow: 0.3 },
        { name: 'ザイレン', color: 'orange', reaction: 10 * M_, sharing: 'always', retreatBelow: 0.25 },
      ],
      types,
      units,
      lanes: [
        { side: 1, pts: [H2, H3] },
        { side: 1, pts: [H2, [260, -90]] },
      ],
      marks: [
        { x: B[0], y: B[1] + 4, text: '人類拠点' },
        { x: M[0], y: M[1] - 6, text: '人類主力' },
        { x: H2[0] + 6, y: H2[1] + 4, text: 'H2（旗艦の出発点）' },
        { x: H3[0], y: H3[1] + 4, text: 'H3（予備。T+50分）' },
        { x: GOAL[0], y: GOAL[1] + 6, text: '旗艦の目標' },
        { x: CUT[0], y: CUT[1] + 6, text: 'レーンを断つ地点（T+70分）' },
      ],
    };
  }

  const SCENARIOS = [
    { id: 'basic', label: '正面衝突', make: basic },
    { id: 'sA', label: 'S星系外縁 A（後続が後方）', make: () => sSystem('A') },
    { id: 'sB', label: 'S星系外縁 B（後続をH2に温存）', make: () => sSystem('B') },
    { id: 'grand', label: '大規模会戦: S星系決戦', make: grandBattle },
    { id: 'lan', label: '数の差の確認（同性能 20 対 30）', make: lanchester },
    { id: 'arms', label: '副兵装の試し撃ち', make: armsDemo },
    { id: 'giant', label: '巨大艦の試し', make: giantDemo },
    { id: 'empty', label: '空のマップ', make: empty },
  ];

  const api = { TYPES, SCENARIOS, formation, builders: { grandBattle } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SimPresets = api;
})(typeof window !== 'undefined' ? window : globalThis);
