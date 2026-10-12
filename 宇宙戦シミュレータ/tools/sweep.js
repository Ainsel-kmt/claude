#!/usr/bin/env node
/* ひとつ（またはふたつ）の値を振って、勝率がどう変わるかを表にする。
 *
 *   node tools/sweep.js <プリセット名 | シナリオ.json> --param キー --values 値,値,... [オプション]
 *
 * 例:
 *   node tools/sweep.js sB --param types.quiet.shield --values 2500,4000,6000,8000
 *   node tools/sweep.js sA --param sides.1.reaction --range 300:1800:300 --runs 30
 *   node tools/sweep.js basic --param types.narm.hp --values 400,500,600 --param2 types.guard.wRange --values2 3,4
 */
'use strict';
const L = require('./lib.js');
const { E } = L;

const USAGE = `使い方: node tools/sweep.js <シナリオ> --param キー (--values a,b,c | --range 始め:終わり:刻み) [オプション]

オプション
  --param キー        振る値のキー（battle.js の --set と同じ書き方）
  --values a,b,c      試す値
  --range a:b:step    a から b まで step 刻み
  --param2 / --values2 / --range2   ふたつ目の値（組み合わせをすべて試す）
  --runs N            それぞれ N 回（既定 20）
  --seeds 1-50        シードを直接指定
  --set キー=値       振らない値の書き換え（何度でも）
  --csv 出力.csv      表を CSV に書く
  --json              JSON で出す

単位: 時間は秒、距離は光秒、速さは c、割合は 0〜1`;

function listValues(values, range, name) {
  if (values) return String(values).split(',').map((v) => L.parseValue(v.trim()));
  if (range) {
    const [a, b, st] = String(range).split(':').map(Number);
    if (![a, b, st].every(isFinite) || st <= 0) throw new Error(name + ' の --range は 始め:終わり:刻み の形で書いてください');
    const out = [];
    for (let v = a; v <= b + st * 1e-9; v += st) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  throw new Error(name + ' の値を --values か --range で指定してください');
}

function main() {
  const a = L.parseArgs(process.argv.slice(2), ['json', 'help', 'h']);
  if (a.help || a.h || !a._.length || !a.param) { console.log(USAGE); process.exitCode = a.help || a.h ? 0 : 1; return; }
  const base = L.loadScenario(a._[0]);
  const v1 = listValues(a.values, a.range, '--param');
  const v2 = a.param2 ? listValues(a.values2, a.range2, '--param2') : [undefined];
  const rows = [];
  const total = v1.length * v2.length;
  let done = 0;
  for (const x of v1) {
    for (const y of v2) {
      const scn = JSON.parse(JSON.stringify(base.scn));
      L.applySets(scn, a.set);
      const sets = [a.param + '=' + JSON.stringify(x)];
      if (a.param2) sets.push(a.param2 + '=' + JSON.stringify(y));
      L.applySets(scn, sets.map((s) => s.replace(/="(.*)"$/, '=$1')));
      const norm = E.normalizeScenario(scn);
      const seeds = L.parseSeeds(a.seeds, a.runs, norm.settings.seed);
      const res = L.runMany(norm, seeds);
      const sum = L.summarize(res, norm);
      rows.push({ x, y, sum, runs: seeds.length });
      done++;
      if (!a.json && process.stderr.isTTY) process.stderr.write('\r計算中 ' + done + ' / ' + total + '   ');
    }
  }
  if (!a.json && process.stderr.isTTY) process.stderr.write('\r' + ' '.repeat(24) + '\r');

  const names = rows.length ? rows[0].sum.sides : ['A', 'B'];
  if (a.csv) {
    const header = [a.param].concat(a.param2 ? [a.param2] : [], ['runs', 'win_' + names[0], 'draw', 'win_' + names[1], 'avg_time_s', 'kept_' + names[0], 'kept_' + names[1]]);
    L.writeCsv(a.csv, header, rows.map((r) => [r.x].concat(a.param2 ? [r.y] : [], [r.runs, r.sum.winRate[0].toFixed(3), r.sum.drawRate.toFixed(3), r.sum.winRate[1].toFixed(3), Math.round(r.sum.avgTime), r.sum.avgKept[0].toFixed(3), r.sum.avgKept[1].toFixed(3)])));
  }
  if (a.json) {
    console.log(JSON.stringify({ scenario: base.label, param: a.param, param2: a.param2 || null, fixed: a.set, rows: rows.map((r) => ({ value: r.x, value2: r.y, runs: r.runs, summary: r.sum })) }, null, 1));
    return;
  }
  console.log('シナリオ: ' + base.label + (a.set.length ? '（固定の変更: ' + a.set.join(' / ') + '）' : ''));
  console.log('各 ' + (rows[0] ? rows[0].runs : 0) + ' 回');
  const head = [a.param].concat(a.param2 ? [a.param2] : [], [names[0] + ' 勝率', '引き分け', names[1] + ' 勝率', '平均決着', names[0] + ' 残存', names[1] + ' 残存']);
  const body = rows.map((r) => [String(r.x)].concat(a.param2 ? [String(r.y)] : [], [L.pct(r.sum.winRate[0]), L.pct(r.sum.drawRate), L.pct(r.sum.winRate[1]), E.fmtTime(r.sum.avgTime), L.pct(r.sum.avgKept[0]), L.pct(r.sum.avgKept[1])]));
  const w = head.map((h, i) => Math.max(width(h), ...body.map((b) => width(b[i]))));
  const line = (cells) => cells.map((c, i) => c + ' '.repeat(w[i] - width(c))).join('  ');
  console.log(line(head));
  for (const b of body) console.log(line(b));
  if (a.csv) console.log('CSV を書きました: ' + a.csv);
}

// 全角文字は2桁ぶんとして幅を数える（表をそろえるため）
function width(s) {
  let n = 0;
  for (const ch of String(s)) n += /[　-鿿＀-￯]/.test(ch) ? 2 : 1;
  return n;
}

try { main(); } catch (e) { console.error('エラー: ' + e.message); process.exitCode = 1; }
