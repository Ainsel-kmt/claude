#!/usr/bin/env node
/* プリセットを scenarios/<ID>.json に書き出す。presets.js を変えたら実行する */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../engine.js');
const P = require('../presets.js');

const dir = path.join(__dirname, '..', 'scenarios');
fs.mkdirSync(dir, { recursive: true });
for (const s of P.SCENARIOS) {
  const file = path.join(dir, s.id + '.json');
  fs.writeFileSync(file, JSON.stringify(E.normalizeScenario(s.make()), null, 1) + '\n', 'utf8');
  console.log(path.relative(process.cwd(), file) + '  ' + s.label);
}
