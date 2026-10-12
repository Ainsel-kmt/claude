#!/usr/bin/env node
/* 戦闘を回して結果をまとめる。
 *
 *   node tools/battle.js <プリセット名 | シナリオ.json> [オプション]
 *
 * 例:
 *   node tools/battle.js sB
 *   node tools/battle.js sB --runs 50 --set types.quiet.shield=4000
 *   node tools/battle.js basic --seed 3 --events
 *   node tools/battle.js scenarios/sA.json --set "units[type=narm,side=1].ai=hold" --save 試し.json
 *
 * 単位は内部の単位（秒・光秒・c・0〜1 の割合）。画面の「分」「%」とは違うので注意。
 */
'use strict';
const fs = require('fs');
const L = require('./lib.js');
const { E } = L;

const USAGE = `使い方: node tools/battle.js <シナリオ> [オプション]

シナリオ  プリセット名（${L.PRESET_IDS.join(' / ')}）か、シナリオの JSON ファイル

オプション
  --runs N          N 回戦わせる（既定 20。シードはシナリオの seed から順に）
  --seeds 1-50      使うシードを直接指定（1,4,9 のような書き方も可）
  --seed N          1回だけ、シード N で戦わせる
  --set キー=値     シナリオの値を書き換える（何度でも書ける）
                      types.narm.hp=600            艦種の値
                      sides.1.reaction=300         陣営の値（0 が人類側、1 が相手側）
                      settings.timeLimit=7200      全体の設定
                      "units[type=narm].ai=hold"   条件に合う艦すべて（[3] なら4番目の艦、[*] なら全部）
  --events          出来事を時刻順に表示（複数回のときは最初のシード）
  --all-events      ジャンプやレーン移動など細かい出来事も表示
  --each            1回ごとの結果も表示
  --json            結果を JSON で出す（ほかのプログラムで読むとき）
  --csv 出力.csv    1回ごとの結果を CSV に書く
  --save 出力.json  書き換えたシナリオを JSON に保存（画面の「保存・読込」→「ファイルを開く」で読める）
  --list            プリセットの一覧

単位: 時間は秒、距離は光秒、速さは c、割合は 0〜1（画面の % は 100 で割る）`;

function main() {
  const a = L.parseArgs(process.argv.slice(2), ['events', 'all-events', 'each', 'json', 'list', 'help', 'h']);
  if (a.help || a.h) { console.log(USAGE); return; }
  if (a.list) {
    for (const s of L.P.SCENARIOS) console.log(s.id.padEnd(6) + ' ' + s.label);
    return;
  }
  if (!a._.length) { console.log(USAGE); process.exitCode = 1; return; }

  const { scn, label } = L.loadScenario(a._[0]);
  const changes = L.applySets(scn, a.set);
  const norm = E.normalizeScenario(scn);

  if (a.save) {
    fs.writeFileSync(a.save, JSON.stringify(norm, null, 1), 'utf8');
    if (!a.json) console.log('シナリオを保存しました: ' + a.save);
    if (a.runs === '0') return;
  }

  const seeds = a.seed ? [parseInt(a.seed, 10)] : L.parseSeeds(a.seeds, a.runs, norm.settings.seed);
  const results = L.runMany(norm, seeds, a.json ? null : L.progress);
  const sum = L.summarize(results, norm);

  let firstEvents = null;
  if (a.events || a['all-events']) {
    const S = E.createSim(norm, { seed: seeds[0] });
    E.runToEnd(S);
    firstEvents = S.events.filter((e) => a['all-events'] || !e.minor).map((e) => ({ t: e.t, time: E.fmtTime(e.t), text: e.text }));
  }

  if (a.csv) {
    const tids = [...new Set(results.flatMap((r) => r.sides.flatMap((s) => Object.keys(s.byType))))];
    const header = ['seed', 'winner', 'reason', 'time_s', 'time', 'kept_0', 'kept_1'];
    for (const k of [0, 1]) for (const tid of tids) header.push('lost_' + k + '_' + tid);
    const rows = results.map((r) => {
      const row = [r.seed, r.winner < 0 ? 'draw' : norm.sides[r.winner].name, r.reason, r.t, E.fmtTime(r.t), r.sides[0].kept.toFixed(3), r.sides[1].kept.toFixed(3)];
      for (const k of [0, 1]) for (const tid of tids) row.push(r.sides[k].byType[tid] ? r.sides[k].byType[tid].lost : '');
      return row;
    });
    L.writeCsv(a.csv, header, rows);
  }

  if (a.json) {
    console.log(JSON.stringify({
      scenario: label, changes, seeds, summary: sum,
      runs: results.map((r) => ({ seed: r.seed, winner: r.winner, reason: r.reason, text: r.text, t: r.t, sides: r.sides })),
      events: firstEvents,
    }, null, 1));
    return;
  }

  console.log('シナリオ: ' + label);
  if (changes.length) console.log('変更: ' + changes.join(' / '));
  console.log(seeds.length === 1 ? 'シード ' + seeds[0] + ' で1回' : seeds.length + '回（シード ' + seeds[0] + '〜' + seeds[seeds.length - 1] + '）');
  if (seeds.length === 1) console.log('結果: ' + results[0].text + '（' + E.fmtTime(results[0].t) + '）');
  console.log(L.formatSummary(sum, seeds.length === 1));
  if (a.each && seeds.length > 1) {
    console.log('1回ごと:');
    for (const r of results) console.log('  シード ' + String(r.seed).padStart(3) + ': ' + r.text + '（' + E.fmtTime(r.t) + '）');
  }
  if (firstEvents) {
    console.log('出来事（シード ' + seeds[0] + '）:');
    for (const e of firstEvents) console.log('  ' + e.time + '  ' + e.text);
  }
  if (a.csv) console.log('CSV を書きました: ' + a.csv);
}

try { main(); } catch (e) { console.error('エラー: ' + e.message); process.exitCode = 1; }
