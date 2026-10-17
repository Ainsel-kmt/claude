#!/usr/bin/env node
/* 地球攻略（プリセット earth）の調べ。地球拠点がどこまで攻められたかを数える。
 *
 *   node tools/earth.js [条件 ...] [オプション]
 *
 * 条件は presets.js の earthSiege(o) の引数。r1=200,r2=140 のように書く（{"r1":200,"r2":140} の JSON でもよい）。
 * 条件を並べると、それぞれを同じシードで回して表にする。条件を書かなければ既定のまま。
 *
 * 例:
 *   node tools/earth.js                                   # 既定で20回
 *   node tools/earth.js r1=160,r2=110 r1=200,r2=140 r1=240,r2=170 --runs 20
 *   node tools/earth.js retreat=0,retreatCost=220 retreat=0.3,retreatCost=235,retreatMode=both
 *   node tools/earth.js --trace --seed 1                  # 1回分の戦力の推移（30分ごと）
 *   node tools/earth.js r1=300,r2=200 --losses --seed 1   # ザイレンがどこで沈んだか
 *
 * 1回に20〜40秒かかるので、いくつかの計算を同時に走らせる（--jobs）。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const L = require('./lib.js');
const { E, P } = L;

const USAGE = `使い方: node tools/earth.js [条件 ...] [オプション]

条件      earthSiege(o) の引数。r1=200,r2=140 のように書く（JSON でもよい）。主なもの:
            r1 r2            ザイレンの後続の波（第2波・第3波）のナーム級（既定 200・140）
            r1At r2At        その時刻（分。既定 90・180）
            retreat          ザイレンの全軍撤退ライン（割合。既定 0.3）
            retreatCost      ザイレンの全軍撤退ライン（残りの戦力。既定 235）
            retreatMode      その組み合わせ（either / both。既定 both）
            groups cargo escort hub goal field   攻撃群の数・積荷・護衛・進出点と目標の距離・地球の妨害場
            n g d m c        本国艦隊（ノード艦・ガード級・砲撃艦・ミサイル艦・無人機母艦）
          全部は README の「地球攻略」

オプション
  --runs N          それぞれ N 回（既定 20。シードは 1 から）
  --seeds 1-20      使うシードを直接指定（1,4,9 のような書き方も可）
  --jobs N          同時に走らせる計算の数（既定は CPU の数。最大 8）
  --set キー=値     シナリオの値の書き換え（battle.js と同じ。全部の条件に効く）
  --out 結果.jsonl  1回ごとの結果を書き出す
  --from 結果.jsonl 書き出した結果をまとめ直す（計算はしない）
  --trace           1回分の、ザイレンの戦力と地球の耐久の推移（--seed N、--every 分。既定 30）
  --losses          1回分の、ザイレンが沈んだ時刻・場所・そばの人類の艦種（--seed N、--until 秒）

表の見方
  ウォードが削られた   地球拠点のウォードが一度でも減った回数（貫く線などが地球に届いた）
  ウォード最小         いちばん減ったときのウォードの残り（平均。沈んだ回は 0%）
  船体に損害           地球拠点の船体（耐久）が減った回数
  ザイレン撤退         ザイレンが全軍撤退に移った回数と平均時刻`;

const DEFAULT_RUNS = 20;

// ---------------------------------------------------------------- 条件の読み書き

function parseCond(s) {
  s = String(s).trim();
  if (!s || s === '既定' || s === '{}') return {};
  if (s.startsWith('{')) {
    try { return JSON.parse(s); } catch (e) { throw new Error('条件を JSON として読めません: ' + s); }
  }
  const o = {};
  for (const part of s.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) throw new Error('条件は キー=値,キー=値 の形で書いてください: ' + s);
    o[part.slice(0, eq).trim()] = L.parseValue(part.slice(eq + 1).trim());
  }
  return o;
}
const condLabel = (o) => Object.keys(o).length ? Object.entries(o).map(([k, v]) => k + '=' + v).join(', ') : '既定';

function build(cond, sets) {
  const scn = P.builders.earthSiege(cond);
  L.applySets(scn, sets);
  return scn;
}
const earthOf = (S) => S.units.find((u) => u.side === 0 && u.tid === 'base');

// 戦場にいる戦力（engine.js の全軍撤退ライン「残りの戦力」と同じ数え方）
function fieldStrength(S, k) {
  let s = 0;
  for (const u of S.units) {
    if (u.side !== k || !u.alive || u.escaped) continue;
    if (!u.present && !(u.aboard >= 0 && S.units[u.aboard].present)) continue;
    s += u.def.cost * Math.max(0, u.hp) / u.def.hp;
  }
  return s;
}
// まだ着いていない援軍も含めた戦力（「割合」の数え方）
function totalStrength(S, k) {
  let s = 0;
  for (const u of S.units) if (u.side === k && u.alive && !u.escaped) s += u.def.cost * Math.max(0, u.hp) / u.def.hp;
  return s;
}

// ---------------------------------------------------------------- 1回分

function runOne(seed, cond, sets) {
  const S = E.createSim(build(cond, sets), { seed });
  const earth = earthOf(S);
  let minSh = 1, firstHull = -1, peakNear = 0;
  while (!S.done) {
    E.step(S);
    if (earth.alive) minSh = Math.min(minSh, earth.sh / earth.def.shield); else minSh = 0;
    if (firstHull < 0 && earth.hp < earth.def.hp) firstHull = S.t;
    if (S.n % 6 === 0) {
      let near = 0;
      for (const u of S.units) if (u.side === 1 && u.alive && u.present && !u.escaped && Math.hypot(u.x - earth.x, u.y - earth.y) < 10) near++;
      peakNear = Math.max(peakNear, near);
    }
  }
  const r = S.result;
  const retreat = S.events.find((e) => e.kind === 'retreatAll' && e.side === 1);
  return {
    seed, cond, winner: r.winner, reason: r.reason, t: r.t, kept: r.sides.map((x) => x.kept),
    earthDead: !earth.alive, earthHp: earth.alive ? earth.hp / earth.def.hp : 0, minSh: Math.round(minSh * 1000) / 1000, firstHull, peakNear,
    moonDead: S.units.some((u) => u.tid === 'moon' && !u.alive), forts: S.units.filter((u) => u.tid === 'base2' && u.alive).length,
    ordraLost: S.units.filter((u) => u.tid === 'flagship' && !u.alive).length,
    lance: S.events.filter((e) => e.kind === 'lanceFire').length,
    retreatAt: retreat ? retreat.t : -1,
  };
}

// ---------------------------------------------------------------- 並べて回す

function runAll(conds, seeds, sets, jobs) {
  const queue = [];
  for (const c of conds) for (const s of seeds) queue.push([s, c]);
  const rows = [];
  let next = 0, running = 0, done = 0;
  return new Promise((resolve, reject) => {
    const kick = () => {
      if (done === queue.length) { resolve(rows); return; }
      while (running < jobs && next < queue.length) {
        const [s, c] = queue[next++];
        running++;
        execFile(process.execPath, [__filename, '--one', String(s), JSON.stringify(c), JSON.stringify(sets)], { maxBuffer: 1 << 24 }, (err, out) => {
          running--;
          if (err) { reject(new Error('シード ' + s + '（' + condLabel(c) + '）の計算に失敗: ' + err.message.split('\n')[0])); return; }
          rows.push(JSON.parse(out));
          L.progress(++done, queue.length);
          kick();
        });
      }
    };
    kick();
  });
}

// ---------------------------------------------------------------- 表

// 全角文字は2桁ぶんとして幅を数える（表をそろえるため）
function width(s) {
  let n = 0;
  for (const ch of String(s)) n += /[　-鿿＀-￯]/.test(ch) ? 2 : 1;
  return n;
}
function printTable(head, body) {
  const w = head.map((h, i) => Math.max(width(h), ...body.map((b) => width(b[i]))));
  const line = (cells) => cells.map((c, i) => c + ' '.repeat(w[i] - width(c))).join('  ');
  console.log(line(head));
  for (const b of body) console.log(line(b));
}

function summarize(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = JSON.stringify(r.cond);
    if (!by.has(k)) by.set(k, { cond: r.cond, rs: [] });
    by.get(k).rs.push(r);
  }
  const head = ['条件', '回数', 'ウォードが削られた', 'ウォード最小', '船体に損害', '沈んだ', 'ザイレン撤退', '人類/引分/ザイレン', '時間切れ', '決着', '月面基地が沈んだ', '軌道要塞の残り', 'オルドラ級の損失', '貫く線'];
  const body = [];
  for (const { cond, rs } of by.values()) {
    const n = rs.length, avg = (f) => rs.reduce((a, r) => a + f(r), 0) / n, cnt = (f) => rs.filter(f).length;
    const ret = rs.filter((r) => r.retreatAt >= 0);
    const w = [cnt((r) => r.winner === 0), cnt((r) => r.winner < 0), cnt((r) => r.winner === 1)];
    body.push([
      condLabel(cond), String(n),
      String(cnt((r) => r.minSh < 0.99 || r.firstHull >= 0)), L.pct(avg((r) => r.minSh)),
      String(cnt((r) => r.firstHull >= 0)), String(cnt((r) => r.earthDead)),
      ret.length + '回' + (ret.length ? '（' + E.fmtTime(ret.reduce((a, r) => a + r.retreatAt, 0) / ret.length).replace('T+', '') + '）' : ''),
      w.join('/'), String(cnt((r) => r.reason === 'time')), E.fmtTime(avg((r) => r.t)),
      String(cnt((r) => r.moonDead)), avg((r) => r.forts).toFixed(1), avg((r) => r.ordraLost).toFixed(1), avg((r) => r.lance).toFixed(0),
    ]);
  }
  printTable(head, body);
}

// ---------------------------------------------------------------- 1回分の推移・損失

function trace(seed, cond, sets, every) {
  const S = E.createSim(build(cond, sets), { seed });
  const earth = earthOf(S), sd = S.sides[1];
  console.log('地球攻略（' + condLabel(cond) + '）シード ' + seed + '。ザイレンの全軍撤退ライン: 割合 ' + L.pct(sd.retreatBelow) + '・残りの戦力 ' + sd.retreatCost + '・' + E.RETREAT_MODE[sd.retreatMode]);
  const body = [];
  let at = 0;
  const snap = () => body.push([
    E.fmtTime(S.t), String(Math.round(fieldStrength(S, 1))), L.pct(totalStrength(S, 1) / S.init[1]),
    String(S.units.filter((u) => u.tid === 'flagship' && u.alive && !u.escaped).length),
    String(S.units.filter((u) => u.side === 1 && u.alive && u.present && !u.escaped && Math.hypot(u.x - earth.x, u.y - earth.y) < 60).length),
    Math.round(earth.sh) + ' / ' + Math.round(earth.hp), S.sideRetreat[1] ? '全軍撤退中' : '',
  ]);
  while (!S.done) {
    E.step(S);
    if (S.t >= at) { snap(); at += every; }
  }
  snap();
  printTable(['時刻', 'ザ 戦場の戦力', 'ザ 割合（援軍含む）', 'オルドラ級', '地球から60光秒以内のザ', '地球 ウォード / 船体', ''], body);
  console.log(S.result.text + '（' + E.fmtTime(S.result.t) + '）');
  for (const e of S.events) if (e.kind === 'retreatAll' || e.kind === 'stationLost') console.log(E.fmtTime(e.t) + ' ' + e.text);
}

function losses(seed, cond, sets, until) {
  const S = E.createSim(build(cond, sets), { seed });
  const earth = earthOf(S);
  const alive = S.units.map((u) => u.alive);
  const bins = new Map();
  while (!S.done && S.t < until) {
    E.step(S);
    for (const u of S.units) {
      if (u.side !== 1 || !alive[u.id] || u.alive) continue;
      alive[u.id] = false;
      let near = null, nd = Infinity;
      for (const h of S.units) {
        if (h.side !== 0 || !h.alive || !h.present) continue;
        const d = Math.hypot(h.x - u.x, h.y - u.y);
        if (d < nd) { nd = d; near = h.def.name; }
      }
      const t = Math.floor(S.t / 1800) * 30, r = Math.floor(Math.hypot(u.x - earth.x, u.y - earth.y) / 25) * 25;
      const k = JSON.stringify([t, r, nd < 8 ? near : '8光秒以内になし']);
      bins.set(k, (bins.get(k) || 0) + u.def.cost);
    }
  }
  console.log('地球攻略（' + condLabel(cond) + '）シード ' + seed + '。ザイレンが沈んだ時刻・場所（地球からの距離）・いちばん近くの人類の艦種ごとの、失ったコスト');
  const body = [...bins].map(([k, v]) => [JSON.parse(k), v]).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1])
    .map(([[t, r, near], v]) => ['T+' + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') + '〜', r + '〜' + (r + 25) + '光秒', near, String(Math.round(v))]);
  printTable(['時刻', '地球からの距離', '近くの人類', '失ったコスト'], body);
  console.log(S.done ? S.result.text + '（' + E.fmtTime(S.result.t) + '）' : E.fmtTime(S.t) + ' で止めた');
}

// ---------------------------------------------------------------- 入口

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--one') { console.log(JSON.stringify(runOne(+argv[1], JSON.parse(argv[2]), JSON.parse(argv[3])))); return; }
  const a = L.parseArgs(argv, ['trace', 'losses', 'help', 'h']);
  if (a.help || a.h) { console.log(USAGE); return; }
  const conds = a._.length ? a._.map(parseCond) : [{}];
  if (a.trace || a.losses) {
    const seed = parseInt(a.seed, 10) || 1;
    if (a.trace) trace(seed, conds[0], a.set, Math.max(1, Number(a.every) || 30) * 60);
    else losses(seed, conds[0], a.set, Number(a.until) || Infinity);
    return;
  }
  let rows;
  if (a.from) rows = fs.readFileSync(a.from, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  else {
    const seeds = L.parseSeeds(a.seeds, a.runs == null ? DEFAULT_RUNS : a.runs, 1);
    const jobs = Math.max(1, Math.min(8, parseInt(a.jobs, 10) || os.cpus().length || 1));
    console.log('地球攻略 ' + conds.length + '条件 × ' + seeds.length + '回（シード ' + seeds[0] + '〜' + seeds[seeds.length - 1] + '）・同時に ' + jobs + ' 本' + (a.set.length ? '・書き換え: ' + a.set.join(' / ') : ''));
    rows = await runAll(conds, seeds, a.set, jobs);
    rows.sort((x, y) => conds.findIndex((c) => JSON.stringify(c) === JSON.stringify(x.cond)) - conds.findIndex((c) => JSON.stringify(c) === JSON.stringify(y.cond)) || x.seed - y.seed);
    if (a.out) { fs.writeFileSync(a.out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); }
  }
  summarize(rows);
  if (a.out) console.log('1回ごとの結果を書きました: ' + a.out);
}

main().catch((e) => { console.error('エラー: ' + e.message); process.exitCode = 1; });
