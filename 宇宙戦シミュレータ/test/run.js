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
  const st = clone(T.base); st.wDamage = 0; st.fieldOn = false; st.hp = 1e7;
  const g = clone(T.guard); g.lockTime = 0;
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
  const st = clone(T.base); st.wDamage = 0; st.fieldOn = false; st.hp = 50; st.shield = 0; st.shieldRegen = 0;
  const g = clone(T.guard); g.wDamage = 0; g.hp = 1e6;
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
  const fort = clone(T.base); fort.fieldOn = false; fort.wAccuracy = 1; fort.wFalloff = 0; fort.wRange = 6; fort.wInterval = 20; fort.wDamage = 10;
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
