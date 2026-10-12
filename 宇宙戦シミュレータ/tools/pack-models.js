#!/usr/bin/env node
/* models/models.json と GLB をまとめて models/models.js を作る。
 *
 *   node tools/pack-models.js
 *
 * 3Dビューアをファイルとして直接開く（ダブルクリック）と、ブラウザは同じフォルダの GLB を
 * 読ませてくれない。そこで GLB を文字列にして models.js に埋め込み、<script> で読ませる。
 * サーバー経由で開くときは models.json と GLB をそのまま読むので、この手順は要らない。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'models');
const cfgPath = path.join(dir, 'models.json');
const outPath = path.join(dir, 'models.js');

function main() {
  let cfg = { entries: {} };
  if (fs.existsSync(cfgPath)) {
    const text = fs.readFileSync(cfgPath, 'utf8').replace(/^﻿/, '');
    try { cfg = JSON.parse(text); } catch (e) { throw new Error('models.json を JSON として読めません: ' + e.message); }
  }
  const entries = {};
  let bytes = 0;
  for (const [key, e] of Object.entries(cfg.entries || {})) {
    if (!e || !e.file) { console.warn('飛ばしました（file がない）: ' + key); continue; }
    const file = path.join(dir, e.file);
    if (!fs.existsSync(file)) { console.warn('飛ばしました（見つからない）: ' + key + ' → ' + e.file); continue; }
    const buf = fs.readFileSync(file);
    if (buf.slice(0, 4).toString('latin1') !== 'glTF') { console.warn('飛ばしました（GLB ではない）: ' + e.file); continue; }
    const o = { name: e.file, data: buf.toString('base64') };
    for (const k of ['scale', 'length', 'rotation', 'offset']) if (e[k] != null) o[k] = e[k];
    entries[key] = o;
    bytes += buf.length;
    console.log(key.padEnd(16) + ' ← ' + e.file + '（' + (buf.length / 1024).toFixed(0) + 'KB）');
  }
  const js = '/* tools/pack-models.js が作ったファイル。手で書き換えないでください */\n' +
    'window.SHIP_MODELS = ' + JSON.stringify({ version: 1, entries }) + ';\n';
  fs.writeFileSync(outPath, js, 'utf8');
  console.log(Object.keys(entries).length + '件を ' + path.relative(process.cwd(), outPath) + ' にまとめました（' + (bytes / 1e6).toFixed(2) + 'MB）');
}

try { main(); } catch (e) { console.error('エラー: ' + e.message); process.exitCode = 1; }
