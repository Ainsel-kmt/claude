/* 計算エンジンのテスト。実行: node 宇宙戦シミュレータ/test/run.js */
'use strict';
const E = require('../engine.js');
const P = require('../presets.js');

let failed = 0;
function check(name, cond, info) {
  if (cond) console.log('ok   ' + name);
  else { failed++; console.log('FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}

const T = P.TYPES;
const clone = (o) => JSON.parse(JSON.stringify(o));
function scn(types, units, extra) {
  return Object.assign({
    settings: { timeLimit: 2 * 3600 },
    sides: [{ name: 'A', reaction: 0, sharing: 'always' }, { name: 'B', reaction: 0, sharing: 'always' }],
    types, units, lanes: [],
  }, extra || {});
}
function line(type, side, n, x, y, gap, extra) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(Object.assign({ type, side, x, y: y + (i - (n - 1) / 2) * gap }, extra || {}));
  return out;
}
function runFor(s, sec, opt) {
  const S = E.createSim(s, opt || {});
  E.runUntil(S, sec);
  return S;
}

// ---- プリセットがすべて最後まで走る
for (const p of P.SCENARIOS) {
  if (p.id === 'empty') continue;
  let r, err;
  try { r = E.runOnce(p.make(), 1); } catch (e) { err = e; }
  check('プリセット「' + p.label + '」が決着まで走る', !err && r && r.text, err && err.message);
}

// ---- 同じシードなら同じ結果、記録の有無で結果は変わらない
{
  const s = P.SCENARIOS.find((x) => x.id === 'basic').make();
  const a = E.runOnce(s, 7), b = E.runOnce(s, 7);
  check('同じシードなら同じ結果', JSON.stringify(a) === JSON.stringify(b));
  const S = E.createSim(s, { seed: 7, record: true });
  E.runToEnd(S);
  check('フレームを記録しても結果は同じ', JSON.stringify(S.result) === JSON.stringify(a));
  check('フレームが記録される', S.frames.length > 10 && S.frames[0].t === 0, S.frames.length);
}

// ---- 設定資料の筋: A は人類勝ち、B はザイレン勝ち
{
  const a = E.runOnce(P.SCENARIOS.find((x) => x.id === 'sA').make(), 1);
  const b = E.runOnce(P.SCENARIOS.find((x) => x.id === 'sB').make(), 1);
  check('S星系外縁 A は人類の勝ち', a.winner === 0, a.text);
  check('S星系外縁 B はザイレンの勝ち', b.winner === 1, b.text);
  const S = E.createSim(P.SCENARIOS.find((x) => x.id === 'sB').make(), {});
  E.runToEnd(S);
  check('B では展開中の静穏場艦が沈む', S.events.some((e) => e.kind === 'fieldFail'));
}

// ---- 集中射撃ではランチェスターの二乗則に近い残り方をする
{
  const g = clone(T.generic);
  g.priority = 'weakest';
  const s = scn({ g }, [].concat(line('g', 0, 20, 40, 40, 0.8), line('g', 1, 30, 46, 40, 0.8)));
  let left = 0;
  const n = 8;
  for (let seed = 1; seed <= n; seed++) left += E.runOnce(s, seed).sides[1].byType.g.left;
  const avg = left / n;
  check('二乗則: 30対20の残りは約22隻（集中射撃）', avg > 19 && avg < 25.5, avg);
}

// ---- 妨害場の中ではジャンプできない（通常航行で出てから跳ぶ）
{
  const base = clone(T.base); base.wDamage = 0; base.fieldRadius = 20;
  const g = clone(T.guard); g.wDamage = 0; g.lockTime = 0; g.ai = 'static';
  const s = scn({ base, g }, [
    { type: 'base', side: 0, x: 0, y: 0 },
    { type: 'g', side: 0, x: 0, y: 1, goal: [500, 0], move: 'jump' },
    { type: 'base', side: 1, x: 2000, y: 0 },
  ]);
  const S = runFor(s, 60);
  const u = S.units[1];
  check('妨害場の中の艦はすぐには跳べない', !u.jump && Math.hypot(u.x, u.y) < 20 && u.goalDone === false, { x: u.x, y: u.y });
  E.runUntil(S, 600);
  check('妨害場を出たあとはジャンプで目標に着く', u.goalDone && Math.abs(u.x - 500) < 1, { x: u.x, y: u.y });
  const s2 = scn({ base, g }, [
    { type: 'base', side: 0, x: 0, y: 0 },
    { type: 'g', side: 0, x: -200, y: 0, goal: [0, 0], move: 'jump' },
    { type: 'base', side: 1, x: 2000, y: 0 },
  ]);
  const S2 = runFor(s2, 60);
  const u2 = S2.units[1];
  check('妨害場の中へは跳べない（縁の外に着く）', Math.hypot(u2.x, u2.y) >= 20, { x: u2.x, y: u2.y });
}

// ---- ノード艦のリンクでロックタイムが縮み、失うと戻る
{
  const node = clone(T.node); node.wDamage = 0;
  const g = clone(T.guard); g.wDamage = 0;
  const units = [
    { type: 'node', side: 0, x: 0, y: 0, locked: true },
    { type: 'g', side: 0, x: 1, y: 0, locked: true },
    { type: 'g', side: 0, x: 100, y: 0, locked: true },
    { type: 'g', side: 1, x: 5000, y: 0, ai: 'static' },
  ];
  const s = scn({ node, g }, units, { settings: { timeLimit: 4 * 3600, arrivalError: 0 } });
  const S = runFor(s, 46 * 60);
  check('リンク内の艦は45分でロックが明ける', S.units[1].lock === 0, S.units[1].lock);
  check('リンク外の艦はまだロック中', S.units[2].lock > 0, S.units[2].lock);
}

// ---- レーン: 乗れれば一瞬で移動、ハブが妨害場の中だと寸断
{
  const narm = clone(T.narm); narm.wDamage = 0; narm.sensor = 400;
  const base = clone(T.base); base.wDamage = 0; base.fieldRadius = 30;
  const tgt = clone(T.generic); tgt.wDamage = 0; tgt.speed = 0;
  const lanes = [{ side: 1, pts: [[0, 0], [300, 0]] }];
  const s = scn({ narm, tgt }, [
    { type: 'narm', side: 1, x: 0, y: 0 },
    { type: 'tgt', side: 0, x: 300, y: 10 },
  ], { lanes });
  // 300光秒先の敵が見えるのは光の遅れで5分後。その直後にレーンで跳ぶ
  const S = runFor(s, 300);
  check('光の遅れの間はまだ動かない', S.units[0].x === 0, S.units[0].x);
  E.runUntil(S, 330);
  check('レーン上の艦はレーンの先へ一瞬で出る', S.units[0].x > 250, S.units[0].x);
  const s2 = scn({ narm, tgt, base }, [
    { type: 'narm', side: 1, x: 0, y: 0 },
    { type: 'tgt', side: 0, x: 300, y: 10 },
    { type: 'base', side: 0, x: 150, y: 0 },
  ], { lanes });
  const S2 = runFor(s2, 330);
  check('妨害場で寸断されたレーンは越えられない', S2.units[0].x < 130, S2.units[0].x);
}

// ---- 反応時間: 遠くの敵には反応時間が過ぎるまで動かない
{
  const g = clone(T.generic); g.sensor = 200;
  const s = scn({ g }, [
    { type: 'g', side: 0, x: 0, y: 0 },
    { type: 'g', side: 1, x: 100, y: 0, ai: 'static' },
  ], { sides: [{ name: 'A', reaction: 600, sharing: 'always' }, { name: 'B', reaction: 0, sharing: 'always' }] });
  const S = runFor(s, 600);
  check('反応時間の前は動かない', S.units[0].x === 0, S.units[0].x);
  E.runUntil(S, 900);
  check('光の遅れ＋反応時間の後に動き出す', S.units[0].x > 1, S.units[0].x);
}

// ---- 撤退: 耐久が減るとジャンプで離脱する
{
  const g = clone(T.guard); g.lockTime = 0; g.retreatAt = 0.9; g.shield = 0;
  const shooter = clone(T.generic); shooter.wDamage = 60; shooter.wAccuracy = 1; shooter.wRange = 5;
  const s = scn({ g, shooter }, [
    { type: 'g', side: 0, x: 0, y: 0, ai: 'static' },
    { type: 'shooter', side: 1, x: 2, y: 0, ai: 'static' },
  ]);
  const S = E.createSim(s, {});
  E.runToEnd(S);
  check('撤退した艦は離脱扱い', S.units[0].escaped && S.units[0].alive, { esc: S.units[0].escaped, alive: S.units[0].alive });
  check('全艦撤退なら相手の勝ち（撤退）', S.result.winner === 1 && S.result.reason === 'retreat', S.result);
}

// ---- 救援: 手が空いた護衛は、攻められている味方の拠点へ向かう（通信艦が随伴していても待ち合わない）
{
  const st = clone(T.base); st.wDamage = 0; st.sOn = false; st.fieldOn = false; st.hp = 1e7;
  const g = clone(T.guard); g.lockTime = 0; g.sOn = false;
  const c = clone(T.comms); c.lockTime = 0; c.commsResync = 0;
  const foe = clone(T.generic); foe.ai = 'static'; foe.speed = 0;
  const units = [
    { type: 'st', side: 0, x: 0, y: 0 },
    ...line('g', 0, 6, 200, 0, 0.5),
    { type: 'c', side: 0, x: 201, y: 0 },
    { type: 'foe', side: 1, x: 2, y: 0 },
  ];
  const S = runFor(scn({ st, g, c, foe }, units), 30 * 60);
  const d = Math.min(...S.units.filter((u) => u.tid === 'g').map((u) => Math.hypot(u.x, u.y)));
  check('救援: 護衛が攻められている拠点のそばへ来る', d < 15, d);
  check('救援の出来事が出る', S.events.some((e) => e.kind === 'relief'));
  // 情報共有がなければ、救援要請は光の速さで届く（200光秒先なら約200秒後）
  const s2 = scn({ st, g, c, foe }, units, { sides: [{ name: 'A', reaction: 0, sharing: 'local' }, { name: 'B', reaction: 0, sharing: 'always' }] });
  const S2 = runFor(s2, 150);
  check('情報共有なし: 光が届く前は救援に出ない', S2.units[1].reliefId < 0, S2.units[1].reliefId);
  E.runUntil(S2, 400);
  check('情報共有なし: 光が届いたら救援に出る', S2.units[1].reliefId === 0, S2.units[1].reliefId);
}

// ---- 持ち場防衛の艦は、守っていた拠点を失うと護衛に切り替える
{
  const st = clone(T.base); st.wDamage = 0; st.sOn = false; st.fieldOn = false; st.hp = 50; st.shield = 0; st.shieldRegen = 0;
  const g = clone(T.guard); g.wDamage = 0; g.sOn = false; g.hp = 1e6;
  const foe = clone(T.generic); foe.ai = 'static'; foe.speed = 0; foe.wAccuracy = 1; foe.wRange = 4; foe.priority = 'key';
  const S = runFor(scn({ st, g, foe }, [
    { type: 'st', side: 0, x: 0, y: 0 },
    { type: 'g', side: 0, x: -12, y: 0, ai: 'hold' },
    { type: 'foe', side: 1, x: 3, y: 0 },
  ]), 10 * 60);
  check('拠点を失った持ち場防衛の艦は護衛になる', !S.units[0].alive && S.units[1].ai === 'escort', { base: S.units[0].alive, ai: S.units[1].ai });
  check('切り替えの出来事が出る', S.events.some((e) => e.kind === 'stationLost'));
}

// ---- 砲門が複数あれば、射程内の別々の敵を同時に撃つ
{
  const fort = clone(T.base); fort.fieldOn = false; fort.sOn = false; fort.wAccuracy = 1; fort.wFalloff = 0; fort.wRange = 6; fort.wInterval = 20; fort.wDamage = 10;
  const foe = clone(T.generic); foe.wDamage = 0; foe.ai = 'static'; foe.speed = 0; foe.hp = 1000;
  const mk = (mounts) => {
    const f = Object.assign(clone(fort), { wMounts: mounts });
    return runFor(scn({ f, foe }, [{ type: 'f', side: 0, x: 0, y: 0 }, ...line('foe', 1, 4, 3, 0, 1)]), 40);
  };
  const hit = (S) => S.units.filter((u) => u.side === 1 && u.hp < 1000).length;
  check('砲門1: 1隻だけ撃つ', hit(mk(1)) === 1, hit(mk(1)));
  check('砲門4: 4隻を同時に撃つ', hit(mk(4)) === 4, hit(mk(4)));
  const S6 = mk(6);
  check('砲門が敵より多ければ、余りは標的に重ねる', S6.units.filter((u) => u.side === 1).reduce((a, u) => a + (1000 - u.hp), 0) >= 60, S6.units.map((u) => u.hp));
}

// ---- 副兵装
{
  // 撃つ側: 主砲なし、副兵装だけ。標的: 動かない的と、動ける的
  const shooter = (kind, extra) => Object.assign(clone(T.generic), {
    wDamage: 0, ai: 'static', speed: 0, sensor: 100,
    sOn: true, sKind: kind, sDamage: 10, sRange: 5, sInterval: 20, sAccuracy: 1, sFalloff: 0, sMounts: 1, sSpeed: 0.05, sBypass: 0, sLife: 600,
  }, extra || {});
  const still = Object.assign(clone(T.generic), { wDamage: 0, ai: 'static', speed: 0, hp: 1e6, shield: 0 });
  const mover = Object.assign(clone(T.generic), { wDamage: 0, ai: 'static', speed: 0.05, hp: 1e6, shield: 0 });
  const dealt = (S, i) => 1e6 - S.units[i].hp;
  const one = (types, sec) => runFor(scn(types, [{ type: 'a', side: 0, x: 0, y: 0 }, { type: 'b', side: 1, x: 4, y: 0 }]), sec || 600);

  const L = one({ a: shooter('line'), b: still });
  check('副兵装（ライン型）は一瞬で当たる', dealt(L, 1) >= 250, dealt(L, 1));

  const ward = Object.assign(clone(still), { shield: 1e5, shieldRegen: 0 });
  const by = one({ a: shooter('line', { sBypass: 1 }), b: ward });
  check('素通りの割合が100%なら、ウォードは減らず船体が減る', by.units[1].sh === 1e5 && by.units[1].hp < 1e6, { sh: by.units[1].sh, hp: by.units[1].hp });

  const pd = Object.assign(clone(still), { pdOn: true, pdRange: 1, pdChance: 1, pdInterval: 1 });
  const m1 = one({ a: shooter('missile'), b: still });
  const m2 = one({ a: shooter('missile'), b: pd });
  check('誘導弾は迎撃がなければ当たる', dealt(m1, 1) >= 250, dealt(m1, 1));
  check('迎撃率100%なら誘導弾はすべて落とされる', dealt(m2, 1) === 0 && m2.arms[0].missilesDown > 0, { dealt: dealt(m2, 1), down: m2.arms[0].missilesDown });

  const d1 = one({ a: shooter('drone', { sInterval: 600, sMounts: 2, sLife: 300 }), b: still }, 1500);
  check('無人機は標的のそばで撃ち続ける', d1.arms[0].drones >= 4 && d1.arms[0].droneHits >= 40, d1.arms[0]);
  check('稼働時間が尽きた無人機は消える', d1.drones.every((r) => r.until > d1.t) && d1.drones.length < d1.arms[0].drones, { left: d1.drones.length, launched: d1.arms[0].drones });
  const d2 = one({ a: shooter('drone', { sInterval: 600, sMounts: 2, sLife: 300 }), b: pd }, 300);
  check('無人機は迎撃で落とされる', d2.arms[0].dronesDown === 2, d2.arms[0]);

  // 副兵装がない艦種だけのシナリオは、乱数の引き方も含めて前と同じ（記録の有無でも変わらない）
  const s0 = scn({ a: still, b: mover }, [{ type: 'a', side: 0, x: 0, y: 0 }]);
  check('副兵装のない艦は副兵装を撃たない', E.runOnce(s0, 1).sides[0].arms.fired === 0);
}

// ---- シェル: 超遠距離から敵の群れへ見越しで撃ち込む面制圧。爆発・弾数・補充・間隔
{
  // jump: free にしておく（speed 0 で jump: none だと拠点扱いになり、自分で補充してしまう）
  const gun = (extra) => Object.assign(clone(T.generic), {
    wDamage: 0, ai: 'static', speed: 0, sensor: 200, jump: 'free', lockTime: 0,
    sOn: true, sKind: 'shell', sDamage: 600, sRange: 60, sInterval: 600, sAccuracy: 1, sFalloff: 0, sMounts: 1, sSpeed: 0.05, sBypass: 1,
    sBlast: 1, sAmmo: 0, sMinCount: 1, sReturn: false,
  }, extra || {});
  const still = Object.assign(clone(T.generic), { wDamage: 0, ai: 'static', speed: 0, hp: 1e6, shield: 0 });
  const lost = (S, i) => 1e6 - S.units[i].hp;
  const cfg = { settings: { timeLimit: 3 * 3600, spacing: 0 } };

  // 群れへの面制圧: 半径の中の敵すべてに威力いっぱい（減衰なし）、半径の外と味方は無傷
  const B = runFor(scn({ a: gun(), b: still, f: still }, [
    { type: 'a', side: 0, x: 0, y: 0 },
    { type: 'b', side: 1, x: 40, y: 0 },
    { type: 'b', side: 1, x: 40, y: 0.5 },
    { type: 'b', side: 1, x: 40.5, y: -0.6 },
    { type: 'b', side: 1, x: 40, y: 3 },
    { type: 'f', side: 0, x: 40, y: -0.2 },
  ], cfg), 700);
  check('シェル: 着くまでに時間がかかる（0.05cで40光秒なら約800秒）', B.arms[0].fired >= 1 && lost(B, 1) === 0, { fired: B.arms[0].fired, lost: lost(B, 1) });
  E.runUntil(B, 1200);
  check('シェル: 群れの中の敵はどれも威力いっぱい', [1, 2, 3].every((i) => lost(B, i) === 600), [1, 2, 3].map((i) => lost(B, i)));
  check('シェル: 半径の外と味方は無傷', lost(B, 4) === 0 && lost(B, 5) === 0, [lost(B, 4), lost(B, 5)]);

  // 見越し: まっすぐ進む群れは、着弾の時刻にいる点を狙うので当たる
  const mover = Object.assign(clone(still), { speed: 0.05, ai: 'assault' });
  const M = runFor(scn({ a: gun(), b: mover, t: still }, [
    { type: 'a', side: 0, x: 0, y: 0 },
    { type: 'b', side: 1, x: 40, y: -20, goal: [40, 200] },
    { type: 't', side: 0, x: 500, y: 500 },
  ], cfg), 1500);
  check('シェル: まっすぐ進む敵には見越しで当たる', lost(M, 1) === 600, lost(M, 1));

  // 狙う群れ: 範囲に入る敵のコストの合計がいちばん大きい群れ（安い3隻の群れより、高い1隻）
  const rich = Object.assign(clone(still), { cost: 5 });
  const V = runFor(scn({ a: gun(), b: still, r: rich }, [
    { type: 'a', side: 0, x: 0, y: 0 },
    { type: 'b', side: 1, x: 40, y: 0 }, { type: 'b', side: 1, x: 40, y: 0.5 }, { type: 'b', side: 1, x: 40.5, y: -0.4 },
    { type: 'r', side: 1, x: 0, y: 40 },
  ], cfg), 1200);
  check('シェル: コストの合計が大きい群れを狙う（安い3隻より高い1隻）', lost(V, 4) === 600 && [1, 2, 3].every((i) => lost(V, i) === 0), [1, 2, 3, 4].map((i) => lost(V, i)));

  // 撃つのに要る敵の数: 群れが小さければ撃たない
  const C = runFor(scn({ a: gun({ sMinCount: 3 }), b: still }, [
    { type: 'a', side: 0, x: 0, y: 0 }, { type: 'b', side: 1, x: 40, y: 0 }, { type: 'b', side: 1, x: 40, y: 0.5 },
  ], cfg), 1200);
  check('シェル: 群れが「撃つのに要る敵の数」より小さければ撃たない', C.arms[0].fired === 0, C.arms[0].fired);

  // 弾数: 撃ち尽くすと撃てない
  const A = runFor(scn({ a: gun({ sAmmo: 2, sInterval: 60 }), b: still }, [{ type: 'a', side: 0, x: 0, y: 0 }, { type: 'b', side: 1, x: 3, y: 0 }]), 1200);
  check('弾数2なら2発で撃ち止む', A.arms[0].fired === 2 && A.units[0].ammo === 0, { fired: A.arms[0].fired, ammo: A.units[0].ammo });

  // 補充: 味方の拠点の近くにいると、1発ずつ補充されてまた撃つ
  const st = Object.assign(clone(T.base), { wDamage: 0, sOn: false, fieldOn: false, pdOn: false, hp: 1e6 });
  const R1 = runFor(scn({ a: gun({ sAmmo: 2, sInterval: 60 }), b: still, st }, [
    { type: 'a', side: 0, x: 0, y: 0 }, { type: 'b', side: 1, x: 3, y: 0 }, { type: 'st', side: 0, x: -2, y: 0 },
  ], { settings: { timeLimit: 3600, resupplyTime: 60 } }), 1200);
  check('拠点の近くでは補充されて撃ち続ける', R1.arms[0].fired > 4 && R1.arms[0].resupplied > 0, R1.arms[0]);

  // 補充に戻る: 撃ち尽くした艦は拠点へ向かい、満タンで戻る
  const ret = gun({ sAmmo: 1, sReturn: true, ai: 'assault', speed: 0.05, jump: 'none', sRange: 3, sSpeed: 0.05 });
  const R2 = runFor(scn({ a: ret, b: still, st }, [
    { type: 'a', side: 0, x: 40, y: 0 }, { type: 'b', side: 1, x: 42, y: 0 }, { type: 'st', side: 0, x: 0, y: 0 },
  ], { settings: { timeLimit: 3 * 3600, resupplyTime: 60 } }), 3600);
  check('撃ち尽くした艦は補充に戻る', R2.events.some((e) => e.kind === 'resupplyGo'), R2.units[0].x);
  check('補充を終えると戦いに戻る', R2.events.some((e) => e.kind === 'resupplyDone'));

  // 撃つ見込み（誘導弾）: 当たる見込みが足りない敵には撃たない
  const msl = gun({ sKind: 'missile', sMinHit: 0.3, sRange: 5, sInterval: 20 });
  const dodgy = Object.assign(clone(still), { evasion: 0.8 });
  const m1 = runFor(scn({ a: msl, b: dodgy }, [{ type: 'a', side: 0, x: 0, y: 0 }, { type: 'b', side: 1, x: 3, y: 0 }]), 600);
  const m2 = runFor(scn({ a: msl, b: still }, [{ type: 'a', side: 0, x: 0, y: 0 }, { type: 'b', side: 1, x: 3, y: 0 }]), 600);
  check('撃つ見込み: 当たりにくい敵には撃たない', m1.arms[0].fired === 0, m1.arms[0].fired);
  check('撃つ見込み: 当たりやすい敵には撃つ', m2.arms[0].fired > 0, m2.arms[0].fired);
}

// ---- 艦どうしの間隔: 重なった艦は押し離される
{
  const g = Object.assign(clone(T.generic), { wDamage: 0, ai: 'static', speed: 0.05 });
  const S = runFor(scn({ g }, [].concat(line('g', 0, 10, 0, 0, 0), [{ type: 'g', side: 1, x: 500, y: 0 }]), { settings: { spacing: 0.3 } }), 120);
  let minD = Infinity;
  for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) minD = Math.min(minD, Math.hypot(S.units[i].x - S.units[j].x, S.units[i].y - S.units[j].y));
  check('間隔: 同じ点に置いた10隻が0.3光秒近く離れる', minD > 0.25, minD);
  const S0 = runFor(scn({ g }, [].concat(line('g', 0, 10, 0, 0, 0), [{ type: 'g', side: 1, x: 500, y: 0 }]), { settings: { spacing: 0 } }), 120);
  check('間隔0なら重なったまま', Math.hypot(S0.units[0].x - S0.units[1].x, S0.units[0].y - S0.units[1].y) < 1e-9);
}

// ---- 旗艦（オルドラ級）: 貫く線
{
  const lance = (extra) => Object.assign(clone(T.generic), {
    wDamage: 0, ai: 'static', speed: 0.05, sensor: 200, jump: 'none',
    sOn: true, sKind: 'lance', sDamage: 2000, sRange: 30, sInterval: 60, sAccuracy: 1, sFalloff: 0, sMounts: 1, sBypass: 0,
    sAmmo: 0, sCharge: 600, sWidth: 0.3,
  }, extra || {});
  const still = Object.assign(clone(T.generic), { wDamage: 0, ai: 'static', speed: 0, hp: 1e6, shield: 0 });
  const warded = Object.assign(clone(still), { hp: 1e6, shield: 1500 });
  const lost = (S, i) => 1e6 - S.units[i].hp;
  const cfg = { settings: { timeLimit: 3 * 3600, spacing: 0 } };
  // 20光秒先に4隻を一列（x 方向）に、1隻を線から0.5光秒ずらして、味方を1隻線の上に置く
  const units = [
    { type: 'a', side: 0, x: 0, y: 0 },
    { type: 'b', side: 1, x: 20, y: 0 }, { type: 'b', side: 1, x: 22, y: 0.1 }, { type: 'b', side: 1, x: 25, y: -0.1 }, { type: 'w', side: 1, x: 28, y: 0 },
    { type: 'b', side: 1, x: 24, y: 0.5 },
    { type: 'f', side: 0, x: 15, y: 0 },
  ];
  const L = runFor(scn({ a: lance(), b: still, w: warded, f: still }, units, cfg), 300);
  check('貫く線: 溜めている間は撃たない', L.arms[0].fired === 0 && L.units[0].charge > 0, { fired: L.arms[0].fired, charge: L.units[0].charge });
  E.runUntil(L, 700);
  check('貫く線: 溜め（10分）のあとで撃つ', L.arms[0].fired === 1, L.arms[0].fired);
  check('貫く線: 線の上に並ぶ敵すべてに威力いっぱい', [1, 2, 3].every((i) => lost(L, i) === 2000), [1, 2, 3].map((i) => lost(L, i)));
  check('貫く線: ウォードで受けられる（まずウォードが減る）', lost(L, 4) === 500 && L.units[4].sh === 0, { hp: lost(L, 4), sh: L.units[4].sh });
  check('貫く線: 線の太さの外と味方は無傷', lost(L, 5) === 0 && lost(L, 6) === 0, [lost(L, 5), lost(L, 6)]);

  // 溜めている間は動けない（突撃の艦でも止まる）
  const runner = lance({ ai: 'assault' });
  const R = runFor(scn({ a: runner, b: still }, [
    { type: 'a', side: 0, x: 0, y: 0 },
    { type: 'b', side: 1, x: 20, y: 0 }, { type: 'b', side: 1, x: 21, y: 0 }, { type: 'b', side: 1, x: 22, y: 0 },
  ], cfg), 400);
  check('貫く線: 溜めている間は動けない', R.units[0].charge > 0 && Math.hypot(R.units[0].x, R.units[0].y) < 1e-9, { x: R.units[0].x, charge: R.units[0].charge });

  // 向き: 線の上の敵のコストの合計がいちばん大きい向き（安い2隻の列より、高い1隻）
  const rich = Object.assign(clone(still), { cost: 5 });
  const V = runFor(scn({ a: lance(), b: still, r: rich }, [
    { type: 'a', side: 0, x: 0, y: 0 },
    { type: 'b', side: 1, x: 20, y: 0 }, { type: 'b', side: 1, x: 24, y: 0 },
    { type: 'r', side: 1, x: 0, y: 20 },
  ], cfg), 700);
  check('貫く線: コストの合計が大きい向きへ撃つ（安い2隻の列より高い1隻）', V.arms[0].fired === 1 && lost(V, 3) === 2000 && lost(V, 1) === 0 && lost(V, 2) === 0, [lost(V, 1), lost(V, 2), lost(V, 3)]);
  // 敵が1隻でも、射程の中にいれば撃つ
  const N = runFor(scn({ a: lance(), b: still }, [{ type: 'a', side: 0, x: 0, y: 0 }, { type: 'b', side: 1, x: 25, y: 7 }], cfg), 700);
  check('貫く線: 敵が1隻でも撃つ', N.arms[0].fired === 1 && lost(N, 1) === 2000, { fired: N.arms[0].fired, lost: lost(N, 1) });
  // 射程の外なら溜めない
  const O = runFor(scn({ a: lance(), b: still }, [{ type: 'a', side: 0, x: 0, y: 0 }, { type: 'b', side: 1, x: 35, y: 0 }], cfg), 700);
  check('貫く線: 射程の外の敵には溜めない', O.arms[0].fired === 0 && !(O.units[0].charge > 0), { fired: O.arms[0].fired, charge: O.units[0].charge });

  // 持ち場防衛: 貫く線を持つ艦は、持ち場から貫く線の射程までの敵を標的にする（主砲だけなら14.5光秒まで）
  const holder = (extra) => lance(Object.assign({ ai: 'hold', wDamage: 10, wRange: 4.5, sCharge: 0, sInterval: 100000 }, extra));
  const Hd = runFor(scn({ a: holder(), b: still }, [{ type: 'a', side: 0, x: 0, y: 0 }, { type: 'b', side: 1, x: 20, y: 0 }], cfg), 300);
  check('持ち場防衛: 貫く線を持つ艦は射程（30光秒）までの敵を狙って、持ち場から10光秒まで寄る', Hd.units[0].tgt === 1 && Hd.units[0].x > 5 && Hd.units[0].x <= 10.01, { tgt: Hd.units[0].tgt, x: Hd.units[0].x });
  const H0 = runFor(scn({ a: holder({ sOn: false }), b: still }, [{ type: 'a', side: 0, x: 0, y: 0 }, { type: 'b', side: 1, x: 20, y: 0 }], cfg), 300);
  check('持ち場防衛: 主砲だけの艦は14.5光秒より遠い敵を狙わない', H0.units[0].tgt === -1 && H0.units[0].x === 0, { tgt: H0.units[0].tgt, x: H0.units[0].x });
}

// ---- 旗艦: 方舟（積んで運び、敵を見つけたら出す。沈むと積荷も沈む）
{
  const ark = Object.assign(clone(T.generic), {
    wDamage: 0, ai: 'static', speed: 0, jump: 'free', lockTime: 0, sensor: 30, hp: 1000, shield: 0,
    hangarOn: true, hangarCap: 5, hangarInterval: 30, hangarBatch: 2,
  });
  const cargo = Object.assign(clone(T.generic), { wDamage: 0, ai: 'static', speed: 0 });
  const foe = Object.assign(clone(T.generic), { wDamage: 0, ai: 'static', speed: 0, hp: 1e6 });
  const units = [{ type: 'k', side: 1, x: 0, y: 0 }].concat(line('c', 1, 6, 0, 0, 0, { aboard: 0 }), [{ type: 'e', side: 0, x: 100, y: 0 }]);
  const s0 = scn({ k: ark, c: cargo, e: foe }, units, { settings: { spacing: 0 } });
  const norm = E.normalizeScenario(s0);
  check('方舟: 積める数を超えた分は積まれない', norm.units.filter((u) => u.aboard === 0).length === 5, norm.units.map((u) => u.aboard));
  const S = runFor(s0, 120);
  const aboard = (S) => S.units.filter((u) => u.aboard === 0 && u.alive).length;
  check('方舟: 敵が探知距離の外なら出さない（積まれた艦は戦場にいない）', aboard(S) === 5 && S.units.slice(1, 6).every((u) => !u.present), aboard(S));
  // 敵を探知距離の中へ動かす
  S.units[7].x = 20;
  E.runUntil(S, 130);
  check('方舟: 敵を見つけたら1回に2隻ずつ出す', aboard(S) === 3, aboard(S));
  E.runUntil(S, 200);
  check('方舟: 30秒ごとに出して、5隻を出し切る', aboard(S) === 0 && S.units.slice(1, 6).every((u) => u.present && Math.hypot(u.x, u.y) < 1), aboard(S));

  // 沈むと積まれたままの艦も沈む（強い敵を横に置いて沈める。探知距離0なので積荷は出さない）
  const s2 = clone(s0);
  s2.types.e = Object.assign(clone(foe), { wDamage: 5000, wRange: 3, wInterval: 10, wAccuracy: 1, wFalloff: 0 });
  s2.types.k.sensor = 0;
  s2.units[7] = { type: 'e', side: 0, x: 2, y: 0 };
  const D = runFor(s2, 120);
  check('方舟: 沈むと積まれたままの艦も沈む', !D.units[0].alive && D.units.slice(1, 6).every((u) => !u.alive) && D.events.some((e) => e.kind === 'cargoLost'), D.units.slice(0, 6).map((u) => u.alive));
}

// ---- 旗艦: 動くハブ（進みながら後ろにレーンを敷く。網の味方はそばまで跳べる。妨害場で断たれ、沈むと消える）
{
  const hub = Object.assign(clone(T.generic), {
    wDamage: 0, ai: 'assault', speed: 0.02, jump: 'lane', lockTime: 60, sensor: 0, hp: 1e6,
    hubOn: true, hubSpeed: 0.025,
  });
  const narm = Object.assign(clone(T.narm), { wDamage: 0, ai: 'assault', sensor: 0, pdOn: false });
  const foe = Object.assign(clone(T.generic), { wDamage: 0, ai: 'static', speed: 0, hp: 1e6, known: true });
  const s0 = scn({ h: hub, n: narm, e: foe }, [
    { type: 'h', side: 1, x: 0, y: 0, goal: [-60, 0] },
    { type: 'n', side: 1, x: 100, y: 0, appear: 1800 },
    { type: 'e', side: 0, x: -70, y: 0 },
  ], { lanes: [{ side: 1, pts: [[0, 0], [100, 0]] }], settings: { spacing: 0 } });
  const S = runFor(s0, 1500);
  const hl = S.lanes.filter((l) => l.hub === 0 && !l.gone);
  const tip = hl.length ? hl[0].pts[hl[0].pts.length - 1] : null;
  check('動くハブ: 後ろにレーンを敷きながら進む（レーンの端は艦のところ）', tip && Math.hypot(tip.x - S.units[0].x, tip.y - S.units[0].y) < 0.6 && S.units[0].x < -25, { tip, x: S.units[0].x });
  E.runUntil(S, 1830);
  const n = S.units[1];
  check('動くハブ: 網の味方はそばまでレーンで跳べる', n.present && Math.hypot(n.x - S.units[0].x, n.y - S.units[0].y) < 3, { n: [n.x, n.y], h: [S.units[0].x, S.units[0].y] });

  // 妨害場が途中に掛かると断たれ、味方はそばまで跳べない
  const q = Object.assign(clone(T.quiet), { wDamage: 0, fieldRadius: 8, fieldDeploy: 0, fieldMode: 'immediate', speed: 0, jump: 'none', hp: 1e6, known: false });
  const s1 = clone(s0);
  s1.types.q = q;
  s1.units.push({ type: 'q', side: 0, x: -10, y: 0 });
  const C = runFor(s1, 1830);
  const n2 = C.units[1];
  check('動くハブ: 妨害場が途中に掛かると、そばまで跳べない', n2.present && Math.hypot(n2.x - C.units[0].x, n2.y - C.units[0].y) > 20, { n: [n2.x, n2.y], h: [C.units[0].x, C.units[0].y] });

  // 沈むと敷いたレーンが消える
  const s2 = clone(s0);
  s2.types.e = Object.assign(clone(foe), { wDamage: 1e7, wRange: 5, wInterval: 10, wAccuracy: 1, wFalloff: 0 });
  s2.units[2] = { type: 'e', side: 0, x: -30, y: 0 };
  s2.units[0].goal = [-40, 0];
  const K = runFor(s2, 1700);
  check('動くハブ: 沈むと、敷いたレーンが消える', !K.units[0].alive && K.lanes.filter((l) => l.hub === 0).every((l) => l.gone) && K.events.some((e) => e.kind === 'hubLost'), { alive: K.units[0].alive, lanes: K.lanes.map((l) => !!l.gone) });
}

// ---- 時間切れの判定
{
  const g = clone(T.generic); g.wDamage = 0;
  const s = scn({ g }, [{ type: 'g', side: 0, x: 0, y: 0 }, { type: 'g', side: 1, x: 900, y: 0 }], { settings: { timeLimit: 600 } });
  const r = E.runOnce(s, 1);
  check('撃ち合いがなければ時間切れで引き分け', r.winner === -1 && r.reason === 'time', r);
}

// ---- 壊れた入力でも落ちない
{
  const s = E.normalizeScenario({ types: { a: { hp: 'x', jump: '??' } }, units: [{ type: 'a', x: 'q' }, { type: 'missing' }, null], lanes: [{ pts: [[0, 0]] }, null], settings: { dt: 0 } });
  check('不正な値は既定値に直る', s.units.length === 1 && s.types.a.hp === E.DEFAULT_TYPE.hp && s.types.a.jump === 'none' && s.settings.dt >= 1 && s.lanes.length === 0, s);
  let ok = true;
  try { E.runOnce({ types: {}, units: [] }, 1); } catch (e) { ok = false; }
  check('空のシナリオでも落ちない', ok);
}

console.log(failed ? '\n' + failed + ' 件失敗' : '\nすべて成功');
process.exit(failed ? 1 : 0);
