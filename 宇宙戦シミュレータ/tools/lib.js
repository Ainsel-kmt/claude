/* コマンド用の共通部品（シナリオの読み込み、値の書き換え、集計、表示） */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');
const P = require('../presets.js');

const PRESET_IDS = P.SCENARIOS.map((s) => s.id);

// 引数を読む。--key value / --key=value / --flag。--set は何度でも書ける
function parseArgs(argv, flags) {
  const out = { _: [], set: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    let key = a.slice(2), val;
    const eq = key.indexOf('=');
    if (eq >= 0 && key !== 'set') { val = key.slice(eq + 1); key = key.slice(0, eq); }
    if (key.startsWith('set=')) { out.set.push(key.slice(4)); continue; }
    if (flags.includes(key)) { out[key] = true; continue; }
    if (val === undefined) {
      val = argv[++i];
      if (val === undefined) throw new Error('--' + key + ' の後に値がありません');
    }
    if (key === 'set') out.set.push(val);
    else out[key] = val;
  }
  return out;
}

// プリセット名か JSON ファイルのパスからシナリオを作る
function loadScenario(arg) {
  if (!arg) throw new Error('シナリオを指定してください（プリセット名: ' + PRESET_IDS.join(', ') + '、または JSON ファイル）');
  const pre = P.SCENARIOS.find((s) => s.id === arg);
  if (pre) return { scn: pre.make(), label: pre.label };
  const file = path.resolve(arg);
  if (!fs.existsSync(file)) throw new Error('見つかりません: ' + arg + '（プリセット名: ' + PRESET_IDS.join(', ') + '）');
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error(arg + ' を JSON として読めません: ' + e.message); }
  if (!o || !o.types || !Array.isArray(o.units)) throw new Error(arg + ' はシナリオの形になっていません（types と units が必要）');
  return { scn: o, label: o.name || path.basename(file) };
}

function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (v !== '' && !isNaN(Number(v))) return Number(v);
  if (/^[\[{]/.test(v)) { try { return JSON.parse(v); } catch (e) { /* 文字列として扱う */ } }
  return v;
}

// "types.narm.hp" や "units[type=narm,side=1].ai" の形のキーに値を入れる。
// units[...] の中は、番号（0 始まり）、* （全部）、項目=値（カンマで AND）が書ける
function splitKey(key) {
  const parts = [];
  const re = /([^.\[\]]+)|\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(key))) parts.push(m[1] !== undefined ? { k: m[1] } : { sel: m[2] });
  return parts;
}
function matchUnit(u, i, sel) {
  sel = sel.trim();
  if (sel === '*' || sel === '') return true;
  if (/^\d+$/.test(sel)) return i === Number(sel);
  return sel.split(',').every((c) => {
    const [k, v] = c.split('=');
    return String(u[k.trim()]) === String(v === undefined ? '' : v.trim());
  });
}
function setPath(obj, key, value) {
  const parts = splitKey(key);
  let targets = [obj];
  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi];
    const last = pi === parts.length - 1;
    const next = [];
    for (const t of targets) {
      if (p.sel !== undefined) {
        if (!Array.isArray(t)) throw new Error(key + ': [' + p.sel + '] は配列にしか使えません');
        t.forEach((u, i) => { if (u && matchUnit(u, i, p.sel)) next.push(u); });
        continue;
      }
      if (last) { t[p.k] = value; continue; }
      if (t[p.k] === undefined || t[p.k] === null) {
        const nx = parts[pi + 1];
        t[p.k] = /^\d+$/.test(nx.k || '') ? [] : {};
      }
      next.push(t[p.k]);
    }
    if (!last) {
      if (!next.length) throw new Error(key + ': 当てはまるものがありません');
      targets = next;
    } else if (p.sel !== undefined) throw new Error(key + ': 最後は項目名にしてください');
  }
}
function applySets(scn, sets) {
  const log = [];
  for (const s of sets) {
    // "units[type=narm].ai=hold" のように角かっこの中にも = があるので、かっこの外の最初の = で区切る
    let cut = -1, depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '[') depth++;
      else if (s[i] === ']') depth--;
      else if (s[i] === '=' && depth === 0) { cut = i; break; }
    }
    if (cut < 0) throw new Error('--set は キー=値 の形で書いてください: ' + s);
    const key = s.slice(0, cut).trim(), val = parseValue(s.slice(cut + 1).trim());
    if (key.startsWith('types.')) {
      const tid = key.split('.')[1];
      if (!scn.types[tid]) throw new Error(key + ': 艦種 ' + tid + ' はありません（あるのは ' + Object.keys(scn.types).join(', ') + '）');
    }
    setPath(scn, key, val);
    log.push(key + ' = ' + JSON.stringify(val));
  }
  return log;
}

// シード指定: "1-20" / "1,4,9" / "7"
function parseSeeds(spec, runs, base) {
  if (spec) {
    const out = [];
    for (const part of String(spec).split(',')) {
      const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) { for (let s = +m[1]; s <= +m[2]; s++) out.push(s); }
      else if (/^\d+$/.test(part.trim())) out.push(+part.trim());
      else throw new Error('--seeds の書き方が違います: ' + spec);
    }
    return out;
  }
  const n = runs == null ? 20 : Math.max(1, parseInt(runs, 10) || 1);
  const b = Math.max(1, base | 0 || 1);
  return Array.from({ length: n }, (_, i) => b + i);
}

function runMany(scn, seeds, onProgress) {
  const out = [];
  seeds.forEach((seed, i) => {
    const r = E.runOnce(scn, seed);
    out.push(Object.assign({ seed }, r));
    if (onProgress) onProgress(i + 1, seeds.length);
  });
  return out;
}

function summarize(results, scn) {
  const s = E.normalizeScenario(scn);
  const n = results.length;
  const sum = {
    runs: n, seeds: results.map((r) => r.seed),
    sides: s.sides.map((sd) => sd.name),
    wins: [0, 0], draws: 0, winRate: [0, 0], drawRate: 0,
    avgTime: 0, avgKept: [0, 0], avgOnField: [0, 0],
    avgLost: [{}, {}], avgEscaped: [{}, {}], initial: [{}, {}],
    avgArms: [{}, {}],
  };
  for (const r of results) {
    if (r.winner < 0) sum.draws++; else sum.wins[r.winner]++;
    sum.avgTime += r.t;
    r.sides.forEach((rs, k) => {
      sum.avgKept[k] += rs.kept; sum.avgOnField[k] += rs.onField;
      for (const [a, v] of Object.entries(rs.arms || {})) sum.avgArms[k][a] = (sum.avgArms[k][a] || 0) + v;
      for (const [tid, b] of Object.entries(rs.byType)) {
        sum.avgLost[k][tid] = (sum.avgLost[k][tid] || 0) + b.lost;
        sum.avgEscaped[k][tid] = (sum.avgEscaped[k][tid] || 0) + b.escaped;
        sum.initial[k][tid] = b.n;
      }
    });
  }
  if (!n) return sum;
  sum.winRate = sum.wins.map((w) => w / n);
  sum.drawRate = sum.draws / n;
  sum.avgTime /= n;
  sum.avgKept = sum.avgKept.map((v) => v / n);
  sum.avgOnField = sum.avgOnField.map((v) => v / n);
  for (const k of [0, 1]) {
    for (const tid of Object.keys(sum.avgLost[k])) sum.avgLost[k][tid] /= n;
    for (const tid of Object.keys(sum.avgEscaped[k])) sum.avgEscaped[k][tid] /= n;
    for (const a of Object.keys(sum.avgArms[k])) sum.avgArms[k][a] /= n;
  }
  sum.typeNames = {};
  for (const [tid, t] of Object.entries(s.types)) sum.typeNames[tid] = t.name;
  return sum;
}

const pct = (v) => Math.round(v * 100) + '%';
const r1 = (v) => String(Math.round(v * 10) / 10);

// 副兵装の数字（使った陣営だけ）
function armsLines(sum, single) {
  const L = [];
  for (const k of [0, 1]) {
    const a = sum.avgArms[k] || {};
    if (!a.fired) continue;
    let t = '  ' + sum.sides[k] + ': ' + (single ? '' : '平均 ') + '発射 ' + r1(a.fired) + '・命中 ' + r1(a.hits || 0);
    if (a.missiles) t += '・うち誘導弾 ' + r1(a.missiles) + '（迎撃された ' + r1(a.missilesDown || 0) + '）';
    if (a.drones) t += '・無人機 ' + r1(a.drones) + '機（落とされた ' + r1(a.dronesDown || 0) + '、無人機の命中 ' + r1(a.droneHits || 0) + '発）';
    L.push(t);
  }
  return L.length ? ['副兵装（発射は無人機の発進も1と数える）:'].concat(L) : [];
}

function formatSummary(sum, single) {
  const L = [];
  const nm = sum.sides;
  if (single) {
    L.push('残存戦力（離脱した艦も含む）: ' + nm[0] + ' ' + pct(sum.avgKept[0]) + ' / ' + nm[1] + ' ' + pct(sum.avgKept[1]));
    L.push('艦種ごとの損失（撃沈 / 離脱 / 初期）:');
    for (const k of [0, 1]) {
      for (const tid of Object.keys(sum.initial[k])) {
        L.push('  ' + nm[k] + ' ' + (sum.typeNames[tid] || tid) + ': ' + r1(sum.avgLost[k][tid] || 0) + ' / ' + r1(sum.avgEscaped[k][tid] || 0) + ' / ' + sum.initial[k][tid]);
      }
    }
    return L.concat(armsLines(sum, true)).join('\n');
  }
  L.push('勝率: ' + nm[0] + ' ' + pct(sum.winRate[0]) + '（' + sum.wins[0] + '回） / 引き分け ' + pct(sum.drawRate) + '（' + sum.draws + '回） / ' + nm[1] + ' ' + pct(sum.winRate[1]) + '（' + sum.wins[1] + '回）');
  L.push('平均決着: ' + E.fmtTime(sum.avgTime));
  L.push('平均残存戦力（離脱した艦も含む）: ' + nm[0] + ' ' + pct(sum.avgKept[0]) + ' / ' + nm[1] + ' ' + pct(sum.avgKept[1]));
  L.push('艦種ごとの平均損失（撃沈 / 離脱 / 初期）:');
  for (const k of [0, 1]) {
    for (const tid of Object.keys(sum.initial[k])) {
      L.push('  ' + nm[k] + ' ' + (sum.typeNames[tid] || tid) + ': ' + r1(sum.avgLost[k][tid] || 0) + ' / ' + r1(sum.avgEscaped[k][tid] || 0) + ' / ' + sum.initial[k][tid]);
    }
  }
  return L.concat(armsLines(sum, false)).join('\n');
}

function csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, header, rows) {
  const text = '﻿' + [header].concat(rows).map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  fs.writeFileSync(file, text, 'utf8');
}

function progress(i, n) {
  if (!process.stderr.isTTY) return;
  process.stderr.write('\r計算中 ' + i + ' / ' + n + '   ');
  if (i === n) process.stderr.write('\r' + ' '.repeat(24) + '\r');
}

module.exports = {
  E, P, PRESET_IDS, parseArgs, loadScenario, parseValue, setPath, applySets, parseSeeds,
  runMany, summarize, formatSummary, writeCsv, progress, pct,
};
