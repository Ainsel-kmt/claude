/* 宇宙戦シミュレータ 計算エンジン
 *
 * 単位: 距離 = 光秒、時間 = 秒、速度 = c（光秒/秒と同じ値）。
 * DOM に依存しないので、ブラウザでも Node でも動く（test/run.js 参照）。
 * 乱数はシード付きなので、同じシナリオ・同じシードなら結果は毎回同じになる。
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- 選択肢

  const AI = {
    assault: '突撃（敵に近づいて撃つ）',
    kite: '射程維持（射程ぎりぎりを保つ）',
    hold: '持ち場防衛（持ち場の近くだけで戦う）',
    escort: '要艦の護衛（近くの要艦に付き添う）',
    follow: '艦隊に随伴（近くの味方の塊に付いていく）',
    static: '静止（動かずに撃つ）',
  };
  const PRIORITY = {
    nearest: '最寄りの敵',
    weakest: '弱った敵',
    threat: '火力の高い敵',
    key: '要艦（特殊能力を持つ艦）',
    cost: '高価な敵',
  };
  const MOVE = {
    auto: '自動（早く着くほう）',
    jump: 'ジャンプ優先（ロック明けを待つ）',
    cruise: '通常航行のみ',
  };
  const JUMP = {
    free: '任意座標へ（幽子型）',
    lane: 'レーン上のみ（レーン型）',
    none: 'ジャンプしない',
  };
  const SHAPES = {
    circle: '丸', diamond: 'ひし形', triangle: '三角', square: '四角', hexagon: '六角', star: '星',
  };
  const SHARING = {
    always: '常に共有（レーン網など）',
    comms: '通信艦がいるときだけ共有',
    local: '共有しない（各艦が自分で見る）',
  };
  const FIELD_MODE = {
    arrive: '目標地点に着いたら（目標なしなら開始直後）',
    immediate: '開始直後',
  };
  const S_KIND = {
    line: 'ライン型（光速で一瞬に届く）',
    shell: 'シェル型（実体弾。敵の群れの進む先を見越して撃ち込み、着いた点で爆発する）',
    missile: '誘導弾（標的を追う。迎撃で落とされる）',
    drone: '無人機（標的のそばへ飛び、しばらく撃ち続ける。迎撃で落とされる）',
    lance: '貫く線（溜めてから、線の上に並ぶ敵すべてを一度に撃つ）',
  };

  // ---------------------------------------------------------------- 既定値

  const DEFAULT_TYPE = {
    name: '新しい艦種', abbr: '新', shape: 'circle', size: 1, cost: 1, origin: 0, known: false,
    hp: 300, shield: 0, shieldRegen: 0, evasion: 0,
    wDamage: 10, wRange: 3, wInterval: 30, wAccuracy: 0.8, wFalloff: 0.2, wMounts: 1,
    speed: 0.05, sensor: 60, jump: 'none', lockTime: 0,
    ai: 'assault', priority: 'nearest', retreatAt: 0,
    linkOn: false, linkRadius: 5, linkCapacity: 10, linkLock: 2700, linkBonus: 0.3,
    fieldOn: false, fieldRadius: 60, fieldDeploy: 900, fieldDuration: 10800, fieldMode: 'arrive',
    commsOn: false, commsResync: 900,
    layerOn: false, layerSpeed: 0.025, layerMax: 300,
    sOn: false, sKind: 'shell', sDamage: 30, sRange: 3, sInterval: 60, sAccuracy: 0.9, sFalloff: 0, sMounts: 1,
    sSpeed: 0.02, sBypass: 1, sLife: 600, sBlast: 0, sAmmo: 0, sReturn: false, sMinHit: 0, sMinCount: 1,
    sCharge: 600, sWidth: 0.3,
    pdOn: false, pdRange: 1, pdChance: 0.3, pdInterval: 10,
    hubOn: false, hubSpeed: 0.025,
    hangarOn: false, hangarCap: 40, hangarInterval: 30, hangarBatch: 2,
  };

  const DEFAULT_SETTINGS = {
    dt: 5, timeLimit: 4 * 3600, seed: 1,
    jumpTime: 20, jumpMin: 15, arrivalError: 0.1,
    laneAccess: 2, laneJumpTime: 5, laneGap: 3,
    retarget: 15, drawMargin: 0.05, spacing: 0.3, resupplyRange: 10, resupplyTime: 120,
  };

  const DEFAULT_SIDES = [
    { name: '人類統合機構', color: 'blue', reaction: 120, sharing: 'comms', retreatBelow: 0 },
    { name: 'ザイレン', color: 'orange', reaction: 600, sharing: 'always', retreatBelow: 0 },
  ];

  // 編集画面用の項目定義。scale: 表示値 = 保存値 / scale。pct: 表示値 = 保存値 × 100
  const TYPE_FIELDS = [
    { g: '基本', k: 'name', label: '名前', t: 'text' },
    { g: '基本', k: 'abbr', label: '略号', t: 'text', help: '地図と凡例に出す短い名前' },
    { g: '基本', k: 'shape', label: '形', t: 'select', opts: SHAPES },
    { g: '基本', k: 'size', label: '表示の大きさ', step: 0.1, min: 0.5, max: 3 },
    { g: '基本', k: 'cost', label: 'コスト', step: 0.5, min: 0, help: '戦力の重み。戦力グラフと時間切れの判定に使う' },
    { g: '基本', k: 'known', label: '敵に位置を知られている（拠点など）', t: 'bool', help: 'オンにすると、敵は探知しなくても最初からこの艦の位置を知っていて、狙いにくる' },
    { g: '耐久', k: 'hp', label: '船体耐久', min: 1 },
    { g: '耐久', k: 'shield', label: 'ウォード容量', min: 0, help: '被弾するとまずこちらが減る' },
    { g: '耐久', k: 'shieldRegen', label: 'ウォード回復', unit: '/秒', step: 0.1, min: 0 },
    { g: '耐久', k: 'evasion', label: '回避', t: 'pct', help: '敵の命中率をこの割合だけ下げる（機動防御）' },
    { g: '兵装', k: 'wDamage', label: '威力（1発）', min: 0, help: '0 にすると非武装' },
    { g: '兵装', k: 'wRange', label: '射程', unit: '光秒', step: 0.1, min: 0 },
    { g: '兵装', k: 'wInterval', label: '発射間隔', unit: '秒', min: 1 },
    { g: '兵装', k: 'wAccuracy', label: '命中率', t: 'pct' },
    { g: '兵装', k: 'wFalloff', label: '射程端での命中低下', t: 'pct', help: '射程いっぱいの距離で、命中率がこの割合だけ下がる' },
    { g: '兵装', k: 'wMounts', label: '砲門の数', unit: '門', min: 1, help: '発射間隔ごとに、射程内の別々の敵を1門ずつ撃つ（拠点など）。敵が門の数より少なければ、空いた門は標的に重ねて撃つ' },
    { g: '機動', k: 'speed', label: '通常航行の速さ', unit: 'c', step: 0.005, min: 0 },
    { g: '機動', k: 'sensor', label: '探知距離', unit: '光秒', min: 0 },
    { g: '機動', k: 'jump', label: 'ジャンプ', t: 'select', opts: JUMP },
    { g: '機動', k: 'lockTime', label: 'ロックタイム（単艦）', unit: '分', scale: 60, step: 0.5, min: 0, help: 'ジャンプ後、次に跳べるまでの時間。レーン型では再ジャンプまでの間隔' },
    { g: '既定の行動', k: 'ai', label: '行動', t: 'select', opts: AI },
    { g: '既定の行動', k: 'priority', label: '狙う敵', t: 'select', opts: PRIORITY },
    { g: '既定の行動', k: 'retreatAt', label: '撤退する耐久', t: 'pct', help: '船体耐久がこの割合を下回ると戦場からの離脱を図る。0% なら撤退しない' },
    { g: 'リンク', k: 'linkOn', label: 'リンクの中枢になる（ノード艦）', t: 'bool' },
    { g: 'リンク', k: 'linkRadius', label: 'リンク半径', unit: '光秒', step: 0.5, min: 0, on: 'linkOn' },
    { g: 'リンク', k: 'linkCapacity', label: '1隻がつなげる数', unit: '隻', min: 0, on: 'linkOn' },
    { g: 'リンク', k: 'linkLock', label: 'リンク中のロックタイム', unit: '分', scale: 60, step: 0.5, min: 0, on: 'linkOn', help: 'つながった艦は、ロックタイムがこの長さまで縮む。ノード艦を失うと元に戻る' },
    { g: 'リンク', k: 'linkBonus', label: 'リンク中の火力増', t: 'pct', on: 'linkOn' },
    { g: '妨害場', k: 'fieldOn', label: '妨害場を張る（静穏場艦・拠点）', t: 'bool' },
    { g: '妨害場', k: 'fieldRadius', label: '半径', unit: '光秒', min: 0, on: 'fieldOn' },
    { g: '妨害場', k: 'fieldDeploy', label: '展開にかかる時間', unit: '分', scale: 60, step: 0.5, min: 0, on: 'fieldOn' },
    { g: '妨害場', k: 'fieldDuration', label: '維持できる時間', unit: '分', scale: 60, min: 0, on: 'fieldOn', help: '0 なら無期限' },
    { g: '妨害場', k: 'fieldMode', label: '展開を始めるとき', t: 'select', opts: FIELD_MODE, on: 'fieldOn' },
    { g: '通信', k: 'commsOn', label: '通信艦（陣営の情報をつなぐ）', t: 'bool' },
    { g: '通信', k: 'commsResync', label: 'ジャンプ後の再同期', unit: '分', scale: 60, step: 0.5, min: 0, on: 'commsOn', help: 'この間は通信が切れる' },
    { g: 'レーン敷設', k: 'layerOn', label: 'レーンを延ばす（エルダ級）', t: 'bool' },
    { g: 'レーン敷設', k: 'layerSpeed', label: '敷設の速さ', unit: '光秒/分', scale: 1 / 60, step: 0.1, min: 0, on: 'layerOn' },
    { g: 'レーン敷設', k: 'layerMax', label: '1回に延ばす最大長', unit: '光秒', min: 0, on: 'layerOn' },
    { g: '副兵装', k: 'sOn', label: '副兵装を積む', t: 'bool', help: '主砲とは別に撃つ兵器。主砲と別の間隔で撃つ' },
    { g: '副兵装', k: 'sKind', label: '種類', t: 'select', opts: S_KIND, on: 'sOn' },
    { g: '副兵装', k: 'sDamage', label: '威力（1発）', min: 0, on: 'sOn' },
    { g: '副兵装', k: 'sRange', label: '射程', unit: '光秒', step: 0.1, min: 0, on: 'sOn', help: '無人機では、発進させる相手までの距離' },
    { g: '副兵装', k: 'sInterval', label: '発射間隔', unit: '秒', min: 1, on: 'sOn', help: '無人機では発進の間隔。貫く線では、撃ってから次の溜めに入れるまでの時間' },
    { g: '副兵装', k: 'sAccuracy', label: '命中率', t: 'pct', on: 'sOn', help: 'シェル型では、狙った点に届く割合。外れると狙いから爆発半径の1〜2倍ずれた点で爆発する' },
    { g: '副兵装', k: 'sFalloff', label: '射程端での命中低下', t: 'pct', on: 'sOn', kinds: ['line'] },
    { g: '副兵装', k: 'sMounts', label: '1回に撃つ数', unit: '発', min: 1, on: 'sOn', help: '別々の敵へ1発ずつ撃ち、敵が少なければ余りは標的に重ねる。無人機では1回に発進させる機数。貫く線では、別々の向きへ撃つ線の数' },
    { g: '副兵装', k: 'sSpeed', label: '弾の速さ', unit: 'c', step: 0.005, min: 0.001, on: 'sOn', kinds: ['shell', 'missile', 'drone'], help: '届くまでの時間 = 距離 ÷ 速さ。0.01c なら1光秒に100秒' },
    { g: '副兵装', k: 'sBypass', label: 'ウォードを素通りする割合', t: 'pct', on: 'sOn', help: 'この割合の損害はウォードに止められず、船体に直接当たる。ウォードは歪曲（ライン系統など）への防御なので、実体弾は素通りする想定' },
    { g: '副兵装', k: 'sBlast', label: '爆発の半径', unit: '光秒', step: 0.05, min: 0, on: 'sOn', kinds: ['shell', 'missile'], help: '爆発すると、この半径の中の敵すべてに威力いっぱいの損害を与える（味方は巻き込まない）。シェル型は狙った点で、誘導弾は当たった艦の位置で爆発する。0 なら爆発しない' },
    { g: '副兵装', k: 'sMinCount', label: '撃つのに要る敵の数', unit: '隻', min: 1, on: 'sOn', kinds: ['shell'], help: '爆発の範囲に入る見込みの敵がこの数以上いる群れにだけ撃つ' },
    { g: '副兵装', k: 'sCharge', label: '溜めの時間', unit: '分', scale: 60, step: 0.5, min: 0, on: 'sOn', kinds: ['lance'], help: '射程の中に見えている敵がいると溜めに入り、この時間のあとで撃つ。溜めている間は動けない。溜め終わって射程の中に敵がいなければ、溜めたまま待つ（そのあいだは動ける）' },
    { g: '副兵装', k: 'sWidth', label: '線の太さ', unit: '光秒', step: 0.05, min: 0.01, on: 'sOn', kinds: ['lance'], help: '撃った瞬間に、射程いっぱいまで伸びる線の、この太さの中にいる敵すべてに損害を与える（味方は巻き込まない）。向きは、線の上の敵のコストの合計（コスト × 数）がいちばん大きい向きを選ぶ' },
    { g: '副兵装', k: 'sMinHit', label: '撃つ見込み', t: 'pct', on: 'sOn', kinds: ['line', 'missile'], help: '当たる見込みがこれ以上の敵にだけ撃つ（弾を無駄にしない）。0% なら射程に入れば撃つ' },
    { g: '副兵装', k: 'sAmmo', label: '弾数', unit: '発', min: 0, on: 'sOn', help: '撃ち尽くすと撃てない。味方の拠点の近くにいると少しずつ補充される。0 なら無制限。無人機では発進させられる機数' },
    { g: '副兵装', k: 'sReturn', label: '弾が尽きたら補充に戻る', t: 'bool', on: 'sOn', help: 'オンなら、撃ち尽くすといちばん近い味方の拠点へ戻り、満タンになってから戦いに戻る' },
    { g: '副兵装', k: 'sLife', label: '無人機の稼働時間', unit: '分', scale: 60, step: 0.5, min: 0, on: 'sOn', kinds: ['drone'], help: '発進してからこの時間で尽きる。標的のそばでは10秒ごとに1発撃つ' },
    { g: '迎撃', k: 'pdOn', label: '誘導弾・無人機を迎撃する', t: 'bool', help: '自分や近くの味方に向かう誘導弾、近くを飛ぶ無人機を撃ち落とす' },
    { g: '迎撃', k: 'pdRange', label: '迎撃の届く距離', unit: '光秒', step: 0.1, min: 0, on: 'pdOn' },
    { g: '迎撃', k: 'pdChance', label: '迎撃率（1回あたり）', t: 'pct', on: 'pdOn' },
    { g: '迎撃', k: 'pdInterval', label: '迎撃の間隔', unit: '秒', min: 1, on: 'pdOn', help: '1回迎撃を試みると、次はこの秒数のあと。一度に大量に来ると迎撃が追いつかない' },
    { g: '動くハブ', k: 'hubOn', label: '進みながら後ろにレーンを敷く（動くハブ）', t: 'bool', help: 'レーンの端がいつもこの艦のところにあるので、レーン網につながっている味方はこの艦のそばまでレーンで跳べる。妨害場がレーンに掛かるとそこで寸断される。この艦が沈むか離脱すると、この艦が敷いたレーンは消える' },
    { g: '動くハブ', k: 'hubSpeed', label: '敷設の速さ', unit: '光秒/分', scale: 1 / 60, step: 0.1, min: 0.001, on: 'hubOn', help: 'レーンを引きずっているあいだは、通常航行がこの速さまでに抑えられる' },
    { g: '方舟', k: 'hangarOn', label: '艦を積んで運ぶ（方舟）', t: 'bool', help: '積む艦は、配置でその艦の「積まれる艦」にこの艦を選ぶ。積まれている艦は戦場にいない扱い（撃たない・撃たれない）で、一緒に動く。この艦が沈むと、積まれたままの艦も沈む' },
    { g: '方舟', k: 'hangarCap', label: '積める数', unit: '隻', min: 0, on: 'hangarOn' },
    { g: '方舟', k: 'hangarInterval', label: '出す間隔', unit: '秒', min: 1, on: 'hangarOn', help: '探知距離の中に敵を見つけたら（陣営の反応時間のあと）、この間隔で艦を出し始める' },
    { g: '方舟', k: 'hangarBatch', label: '1回に出す数', unit: '隻', min: 1, on: 'hangarOn' },
  ];

  const SETTING_FIELDS = [
    { k: 'timeLimit', label: '制限時間', unit: '時間', scale: 3600, step: 0.5, min: 0.1 },
    { k: 'dt', label: '計算の刻み', unit: '秒', min: 1, max: 60, help: '小さいほど細かいが重い' },
    { k: 'jumpTime', label: 'ジャンプにかかる時間', unit: '秒', min: 0 },
    { k: 'jumpMin', label: 'ジャンプを使う最短距離', unit: '光秒', min: 0, help: 'これより近い移動は通常航行' },
    { k: 'arrivalError', label: '到着誤差（最大）', unit: '光秒', step: 0.01, min: 0, help: '0.1光秒 = 約3万km' },
    { k: 'laneAccess', label: 'レーンに乗れる距離', unit: '光秒', step: 0.5, min: 0.1 },
    { k: 'laneJumpTime', label: 'レーンジャンプにかかる時間', unit: '秒', min: 0 },
    { k: 'retarget', label: '標的を見直す間隔', unit: '秒', min: 1 },
    { k: 'drawMargin', label: '時間切れで引き分けにする差', t: 'pct' },
    { k: 'resupplyRange', label: '弾を補充できる距離', unit: '光秒', min: 0, help: '味方の拠点（動かない艦）からこの距離の中にいる艦は、副兵装の弾が少しずつ補充される' },
    { k: 'resupplyTime', label: '1発の補充にかかる時間', unit: '秒', min: 1 },
    { k: 'spacing', label: '艦どうしの最小間隔', unit: '光秒', step: 0.05, min: 0, help: 'これより近づいた2隻は互いに押し離す（1刻みに動ける距離まで）。0 なら重なってもよい' },
    { k: 'seed', label: '乱数シード', min: 1, help: '命中判定と到着誤差の乱数。複数回試行ではここから順に変える' },
  ];

  const SIDE_FIELDS = [
    { k: 'name', label: '名前', t: 'text' },
    { k: 'reaction', label: '反応時間', unit: '分', scale: 60, step: 0.5, min: 0, help: '遠くの敵を見つけてから陣営として動くまでの遅れ。近く（射程の1.5倍以内）の敵には即座に応戦する' },
    { k: 'sharing', label: '情報共有', t: 'select', opts: SHARING },
    { k: 'retreatBelow', label: '全軍撤退ライン', t: 'pct', help: '戦力がこの割合を下回ると全艦が撤退に移る。0% なら最後まで戦う' },
  ];

  // ---------------------------------------------------------------- 小道具

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const hyp = (x, y) => Math.sqrt(x * x + y * y);
  const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
  const isKey = (d) => d.linkOn || d.fieldOn || d.commsOn || d.layerOn || d.hubOn || d.hangarOn;
  const isStation = (d) => d.speed <= 0 && d.jump === 'none';
  const hasSecondary = (d) => d.sOn && d.sDamage > 0 && d.sRange > 0;
  const isArmed = (d) => d.wDamage > 0 || hasSecondary(d);
  // 行動の距離: 主砲の射程。主砲がない艦は副兵装の射程
  const engageRange = (d) => (d.wDamage > 0 ? d.wRange : hasSecondary(d) ? d.sRange : d.wRange);
  // 副兵装の射程のうち、目の前の敵に撃つもの（シェル型・貫く線は超遠距離の兵器なので含めない）
  const secReach = (d) => (hasSecondary(d) && d.sKind !== 'shell' && d.sKind !== 'lance' ? d.sRange : 0);
  // 届く距離: 主砲と副兵装（シェル型を除く）の射程の長いほう
  const reachOf = (d) => Math.max(d.wDamage > 0 ? d.wRange : 0, secReach(d));
  const mountsOf = (d) => Math.max(1, Math.floor(d.wMounts || 1));
  const dpsOf = (d) => (d.wDamage > 0 ? d.wDamage * d.wAccuracy / Math.max(1, d.wInterval) * mountsOf(d) : 0);

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return 'T+' + h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  const fmtMin = (sec) => (Math.round(sec / 6) / 10) + '分';

  // ---------------------------------------------------------------- シナリオの正規化

  function normalizeType(t) {
    const o = Object.assign({}, DEFAULT_TYPE, t || {});
    for (const k of Object.keys(DEFAULT_TYPE)) {
      if (typeof DEFAULT_TYPE[k] === 'number') { o[k] = Number(o[k]); if (!isFinite(o[k])) o[k] = DEFAULT_TYPE[k]; }
      if (typeof DEFAULT_TYPE[k] === 'boolean') o[k] = !!o[k];
    }
    if (!JUMP[o.jump]) o.jump = 'none';
    if (!AI[o.ai]) o.ai = 'assault';
    if (!PRIORITY[o.priority]) o.priority = 'nearest';
    if (!SHAPES[o.shape]) o.shape = 'circle';
    if (!FIELD_MODE[o.fieldMode]) o.fieldMode = 'arrive';
    if (!S_KIND[o.sKind]) o.sKind = 'shell';
    o.hp = Math.max(1, o.hp);
    return o;
  }

  function normalizeScenario(src) {
    const s = clone(src || {});
    s.version = 1;
    s.name = s.name || '無題のシナリオ';
    s.note = s.note || '';
    s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      s.settings[k] = Number(s.settings[k]);
      if (!isFinite(s.settings[k])) s.settings[k] = DEFAULT_SETTINGS[k];
    }
    s.settings.dt = Math.min(60, Math.max(1, s.settings.dt));
    s.sides = [0, 1].map((i) => {
      const o = Object.assign({}, DEFAULT_SIDES[i], (s.sides || [])[i] || {});
      o.reaction = Math.max(0, Number(o.reaction) || 0);
      o.retreatBelow = Math.max(0, Number(o.retreatBelow) || 0);
      if (!SHARING[o.sharing]) o.sharing = 'always';
      return o;
    });
    s.types = s.types || {};
    for (const k of Object.keys(s.types)) s.types[k] = normalizeType(s.types[k]);
    s.units = (s.units || []).filter((u) => u && s.types[u.type]).map((u) => {
      const o = { type: u.type, side: u.side === 1 ? 1 : 0, x: +u.x || 0, y: +u.y || 0 };
      if (u.ai && AI[u.ai]) o.ai = u.ai;
      if (u.priority && PRIORITY[u.priority]) o.priority = u.priority;
      if (u.move && MOVE[u.move] && u.move !== 'auto') o.move = u.move;
      if (u.retreatAt != null && u.retreatAt !== '') o.retreatAt = Math.max(0, +u.retreatAt || 0);
      if (u.appear) o.appear = Math.max(0, +u.appear || 0);
      if (u.locked) o.locked = true;
      if (u.goal && u.goal.length === 2) o.goal = [+u.goal[0] || 0, +u.goal[1] || 0];
      if (u.aboard != null && u.aboard !== '' && +u.aboard >= 0) o.aboard = Math.floor(+u.aboard);
      return o;
    });
    // 積まれる艦（aboard: 積む艦の units の番号）。積む艦が方舟でない・陣営が違う・積める数を超えた分は外す
    const load = new Map();
    s.units.forEach((o, i) => {
      if (o.aboard == null) return;
      const c = s.units[o.aboard];
      const cd = c && s.types[c.type];
      const n = load.get(o.aboard) || 0;
      if (!c || o.aboard === i || c.aboard != null || !cd.hangarOn || c.side !== o.side || n >= cd.hangarCap || s.types[o.type].hangarOn) { delete o.aboard; return; }
      load.set(o.aboard, n + 1);
    });
    s.lanes = (s.lanes || []).filter((l) => l && l.pts && l.pts.length >= 2).map((l) => ({
      side: l.side === 0 ? 0 : 1,
      pts: l.pts.map((p) => [+p[0] || 0, +p[1] || 0]),
    }));
    s.marks = (s.marks || []).filter((m) => m && m.text).map((m) => ({ x: +m.x || 0, y: +m.y || 0, text: String(m.text) }));
    return s;
  }

  // ---------------------------------------------------------------- 状態の作成

  function createSim(scn, opt) {
    opt = opt || {};
    const s = normalizeScenario(scn);
    const set = s.settings;
    const seed = opt.seed != null ? opt.seed : set.seed;
    const S = {
      scn: s, set, sides: s.sides, seed, rng: mulberry32((seed >>> 0) || 1),
      t: 0, n: 0, done: false, result: null,
      units: [],
      lanes: s.lanes.map((l) => ({ side: l.side, pts: l.pts.map((p) => ({ x: p[0], y: p[1] })), grow: false })),
      laneVer: 1, laneBuilt: 0, fieldSig: '', nodes: [], laneTip: [],
      fields: [],
      contacts: s.sides.map(() => new Map()),
      sharing: s.sides.map(() => true),
      sideRetreat: s.sides.map(() => false),
      events: [], evBuf: new Map(), shots: [],
      hist: { t: [], str: s.sides.map(() => []), cnt: s.sides.map(() => []) },
      record: !!opt.record, frames: [], recEvery: 1, laneSnap: null, laneSnapVer: 0,
      refDps: 1e-9, refCost: 1e-9, maxRange: 1,
      proj: [], drones: [], droneSeq: 0,
      arms: s.sides.map(() => ({ fired: 0, hits: 0, blastHits: 0, missiles: 0, missilesDown: 0, drones: 0, dronesDown: 0, droneHits: 0, resupplied: 0 })),
    };
    for (const k of Object.keys(s.types)) {
      const t = s.types[k];
      t._key = isKey(t); t._dps = dpsOf(t);
      S.refDps = Math.max(S.refDps, t._dps);
      S.refCost = Math.max(S.refCost, t.cost);
    }
    s.units.forEach((p, i) => {
      const d = s.types[p.type];
      const u = {
        id: i, side: p.side, tid: p.type, def: d,
        x: p.x, y: p.y, hx: p.x, hy: p.y, px: p.x, py: p.y,
        hp: d.hp, sh: d.shield,
        alive: true, escaped: false, present: false,
        appear: p.appear || 0, startLocked: !!p.locked,
        ai: p.ai || d.ai, prio: p.priority || d.priority,
        retreatAt: p.retreatAt != null ? p.retreatAt : d.retreatAt,
        move: p.move || 'auto',
        goal: p.goal ? { x: p.goal[0], y: p.goal[1] } : null, goalDone: !p.goal,
        lock: 0, lockMax: 0, jump: null,
        cd: 0, tgt: -1, rt: 0,
        linked: false, linkLock: 0, linkBonus: 0, commsAt: 0,
        fs: 0, ft: 0, lay: null, layCd: 0, retreat: false,
        laneNo: 0, laneNoX: 0, laneNoY: 0, protId: -1, protAt: 0, reliefId: -1, station: -1,
        kills: 0, dealt: 0, diedAt: -1, by: -1, state: '',
        aboard: p.aboard != null ? p.aboard : -1, cargo: null, hangarOpen: false, hangarNext: 0,
        hubLane: -1, hubRx: 0, hubRy: 0, charge: 0, charged: false,
      };
      u.cd = S.rng() * d.wInterval;
      // 副兵装の装填（副兵装のない艦では乱数を引かない。これまでのシナリオの結果を変えないため）
      // シェル型は最初から撃てる（初手の一斉射）
      u.cd2 = hasSecondary(d) ? (d.sKind === 'shell' || d.sKind === 'lance' ? 0 : S.rng() * d.sInterval) : 0;
      u.vx = 0; u.vy = 0; u.ox = u.x; u.oy = u.y; u.scanAt = 0;
      u.pdNext = 0;
      // 副兵装の弾（無制限なら Infinity）と補充の進み
      u.ammo = d.sAmmo > 0 ? Math.floor(d.sAmmo) : Infinity; u.reload = 0; u.resupplying = false;
      u.rt = S.rng() * set.retarget;
      S.units.push(u);
      S.maxRange = Math.max(S.maxRange, d.wRange, hasSecondary(d) ? d.sRange : 0);
    });
    // 方舟に積まれた艦: 積む艦の位置から始め、積む艦の積荷の一覧に入れる
    for (const u of S.units) {
      if (u.aboard < 0) continue;
      const c = S.units[u.aboard];
      u.x = u.hx = u.px = c.x; u.y = u.hy = u.py = c.y; u.appear = 0;
      (c.cargo || (c.cargo = [])).push(u.id);
    }
    // 持ち場防衛の艦は、持ち場の近く（STATION_RANGE 以内）にある味方の拠点（動かない艦）を覚えておく
    for (const u of S.units) {
      if (u.ai !== 'hold') continue;
      let bd = STATION_RANGE;
      for (const p of S.units) {
        if (p === u || p.side !== u.side || !isStation(p.def)) continue;
        const dd = hyp(p.x - u.hx, p.y - u.hy);
        if (dd < bd) { bd = dd; u.station = p.id; }
      }
    }
    S.init = s.sides.map((_, k) => S.units.reduce((a, u) => a + (u.side === k ? u.def.cost : 0), 0));
    S.initCount = s.sides.map((_, k) => S.units.filter((u) => u.side === k).length);
    const steps = Math.ceil(set.timeLimit / set.dt);
    S.recEvery = Math.max(1, Math.ceil((steps * Math.max(1, S.units.length)) / 600000));

    spawn(S);
    updateFields(S);
    updateHubs(S);
    rebuildLanes(S);
    updateSharing(S, true);
    updateContacts(S);
    updateLinks(S);
    flushEvents(S);
    recordHist(S);
    if (S.record) recordFrame(S);
    return S;
  }

  // ---------------------------------------------------------------- 判定の小道具

  const active = (u) => u.alive && u.present && !u.escaped;
  const visible = (u) => active(u) && !u.jump;

  function inField(S, x, y) {
    for (const f of S.fields) if ((x - f.x) * (x - f.x) + (y - f.y) * (y - f.y) < f.r * f.r) return f;
    return null;
  }

  function lockRate(u) {
    if (u.def.jump !== 'free') return 1;
    if (u.linked && u.linkLock > 0) return Math.max(1, u.def.lockTime / u.linkLock);
    return 1;
  }

  function canFreeJump(S, u) {
    return u.def.jump === 'free' && u.lock <= 0 && !u.jump && u.fs !== 1 && u.fs !== 2 && !inField(S, u.x, u.y);
  }

  // 妨害場の中を目的地にしたときは、手前の縁に置き直す
  function clampOutOfFields(S, fromX, fromY, x, y) {
    for (let k = 0; k < 4; k++) {
      const f = inField(S, x, y);
      if (!f) break;
      let dx = fromX - f.x, dy = fromY - f.y, L = hyp(dx, dy);
      if (L < 1e-6) { dx = 1; dy = 0; L = 1; }
      x = f.x + dx / L * (f.r + 0.5);
      y = f.y + dy / L * (f.r + 0.5);
    }
    return { x, y };
  }

  // ---------------------------------------------------------------- 出来事ログ

  function ev(S, kind, side, tid, extra) {
    const key = kind + '|' + side + '|' + tid;
    let e = S.evBuf.get(key);
    if (!e) { e = { kind, side, tid, n: 0, v: extra }; S.evBuf.set(key, e); }
    e.n++;
    if (extra != null) e.v = extra;
  }

  const MINOR = { jump: 1, lane: 1, retreat: 1, appear: 0 };

  function flushEvents(S) {
    if (!S.evBuf.size) return;
    for (const e of S.evBuf.values()) {
      const sd = S.sides[e.side] ? S.sides[e.side].name : '';
      const tp = S.scn.types[e.tid] ? S.scn.types[e.tid].name : '';
      const nm = tp + (e.n > 1 ? ' ×' + e.n : '');
      let text;
      switch (e.kind) {
        case 'arrive': text = sd + ' の ' + nm + ' がジャンプで到着（ロックタイム開始）'; break;
        case 'appear': text = sd + ' の ' + nm + ' が出現'; break;
        case 'jump': text = sd + ' の ' + nm + ' がジャンプ'; break;
        case 'lane': text = sd + ' の ' + nm + ' がレーンで移動'; break;
        case 'kill': text = sd + ' の ' + nm + ' が撃沈された'; break;
        case 'escape': text = sd + ' の ' + nm + ' が戦場から離脱'; break;
        case 'retreat': text = sd + ' の ' + nm + ' が撤退を始めた'; break;
        case 'detect': text = sd + ' が敵の ' + nm + ' を探知（陣営が動くまで約' + e.v + '）'; break;
        case 'fieldStart': text = sd + ' の ' + nm + ' が妨害場の展開を開始（完成まで' + e.v + '）'; break;
        case 'fieldUp': text = sd + ' の妨害場が完成（半径' + e.v + '光秒）。範囲内はジャンプ不可、レーンも寸断'; break;
        case 'fieldFail': text = '展開中の ' + sd + ' ' + nm + ' が撃沈され、妨害場は張れなかった'; break;
        case 'fieldDown': text = sd + ' の妨害場が消えた（' + e.v + '）'; break;
        case 'layStart': text = sd + ' の ' + nm + ' がレーンの延伸を開始（目標まで約' + e.v + '）'; break;
        case 'layEnd': text = sd + ' の ' + nm + ' がレーンの延伸を終えた'; break;
        case 'layStop': text = '延伸中の ' + sd + ' ' + nm + ' が撃沈され、延伸が止まった'; break;
        case 'commsDown': text = sd + ' の情報共有が途切れた（通信艦がいない、または再同期中）'; break;
        case 'commsUp': text = sd + ' の情報共有が復帰'; break;
        case 'retreatAll': text = sd + ' の戦力が' + e.v + 'を下回り、全軍が撤退に移る'; break;
        case 'relief': text = sd + ' の ' + nm + ' が ' + e.v + ' の救援に向かう'; break;
        case 'resupplyGo': text = sd + ' の ' + nm + ' が副兵装を撃ち尽くし、' + e.v + ' へ補充に戻る'; break;
        case 'resupplyDone': text = sd + ' の ' + nm + ' が補充を終えて戦いに戻る'; break;
        case 'stationLost': text = sd + ' の ' + nm + ' が守っていた ' + e.v + ' を失い、護衛に切り替えた'; break;
        case 'hangarOpen': text = sd + ' の ' + nm + ' が敵を見つけ、積んでいた艦（' + e.v + '）を出し始めた'; break;
        case 'launch': text = sd + ' の ' + nm + ' が ' + e.v + ' から出た'; break;
        case 'hangarEmpty': text = sd + ' の ' + nm + ' が積んでいた艦をすべて出した'; break;
        case 'cargoLost': text = sd + ' の ' + nm + ' と一緒に、積まれていた艦（' + e.v + '）が沈んだ'; break;
        case 'hubLost': text = sd + ' の ' + nm + ' の' + e.v + 'で、この艦が敷いたレーンが消えた'; break;
        case 'lanceCharge': text = sd + ' の ' + nm + ' が貫く線の溜めに入った（' + e.v + '）'; break;
        case 'lanceFire': text = sd + ' の ' + nm + ' が貫く線を撃った（' + e.v + '）'; break;
        case 'end': text = e.v; break;
        default: text = e.kind;
      }
      S.events.push({ t: S.t, kind: e.kind, side: e.side, text, minor: !!MINOR[e.kind] });
    }
    S.evBuf.clear();
  }

  // ---------------------------------------------------------------- 出現・ジャンプ

  function spawn(S) {
    for (const u of S.units) {
      if (u.present || !u.alive || u.appear > S.t || u.aboard >= 0) continue;
      u.present = true;
      const d = u.def;
      const byJump = d.jump === 'free' && (u.appear > 0 || u.startLocked);
      if (byJump) {
        const p = clampOutOfFields(S, u.x + 1, u.y, u.x, u.y);
        const a = S.rng() * Math.PI * 2, r = Math.sqrt(S.rng()) * S.set.arrivalError;
        u.x = p.x + Math.cos(a) * r; u.y = p.y + Math.sin(a) * r;
        u.lock = d.lockTime; u.lockMax = d.lockTime;
        if (d.commsOn) u.commsAt = S.t + d.commsResync;
        ev(S, 'arrive', u.side, u.tid);
      } else if (u.appear > 0) {
        ev(S, 'appear', u.side, u.tid);
      }
      u.hx = u.x; u.hy = u.y;
    }
  }

  // ---- 方舟: 積まれた艦を運び、敵を見つけたら少しずつ出す
  function cargoOf(S, c) {
    if (!c.cargo) return [];
    return c.cargo.map((id) => S.units[id]).filter((w) => w.alive && w.aboard === c.id);
  }

  function updateHangars(S) {
    for (const c of S.units) {
      if (!c.cargo || !c.def.hangarOn) continue;
      const list = cargoOf(S, c);
      if (!list.length) continue;
      // 積まれている艦は母艦と一緒に動く（記録と、出すときの位置のため）
      const at = c.jump ? { x: c.px, y: c.py } : c;
      for (const w of list) { w.x = at.x; w.y = at.y; }
      if (!visible(c)) continue;
      if (!c.hangarOpen) {
        // 探知距離の中に、陣営として動ける（反応時間を過ぎた）敵がいれば出し始める
        const C = S.contacts[c.side], R = c.def.sensor;
        for (const e of S.units) {
          if (e.side === c.side || !visible(e)) continue;
          if (Math.abs(e.x - c.x) > R || Math.abs(e.y - c.y) > R || dist(e, c) > R) continue;
          const k = C.get(e.id);
          if (k && k.at <= S.t) { c.hangarOpen = true; c.hangarNext = S.t; ev(S, 'hangarOpen', c.side, c.tid, list.length + '隻'); break; }
        }
        if (!c.hangarOpen) continue;
      }
      if (S.t < c.hangarNext) continue;
      const n = Math.min(list.length, Math.max(1, Math.floor(c.def.hangarBatch)));
      for (let i = 0; i < n; i++) {
        const w = list[i];
        const a = S.rng() * Math.PI * 2, r = 0.4 + S.rng() * 0.4;
        w.x = c.x + Math.cos(a) * r; w.y = c.y + Math.sin(a) * r;
        w.hx = w.x; w.hy = w.y; w.px = w.x; w.py = w.y; w.ox = w.x; w.oy = w.y;
        w.aboard = -1; w.present = true; w.lock = 0;
        ev(S, 'launch', w.side, w.tid, c.def.name);
      }
      c.hangarNext = S.t + Math.max(1, c.def.hangarInterval);
      if (n === list.length) ev(S, 'hangarEmpty', c.side, c.tid);
    }
  }

  function startJump(S, u, x, y, out) {
    hubDetach(S, u);
    let p = { x, y };
    if (!out) {
      p = clampOutOfFields(S, u.x, u.y, x, y);
      const a = S.rng() * Math.PI * 2, r = Math.sqrt(S.rng()) * S.set.arrivalError;
      p.x += Math.cos(a) * r; p.y += Math.sin(a) * r;
    }
    u.jump = { t: S.set.jumpTime, x: p.x, y: p.y, out: !!out, lane: false };
    u.px = u.x; u.py = u.y;
    ev(S, out ? 'retreat' : 'jump', u.side, u.tid);
  }

  function startLaneJump(S, u, x, y, out) {
    hubDetach(S, u);
    u.jump = { t: S.set.laneJumpTime, x, y, out: !!out, lane: true };
    u.px = u.x; u.py = u.y;
    ev(S, out ? 'retreat' : 'lane', u.side, u.tid);
  }

  function finishJumps(S) {
    const dt = S.set.dt;
    for (const u of S.units) {
      if (!u.jump || !u.alive) continue;
      u.jump.t -= dt;
      if (u.jump.t > 0) continue;
      const j = u.jump;
      u.jump = null;
      if (j.out) {
        u.escaped = true; ev(S, 'escape', u.side, u.tid);
        for (const w of cargoOf(S, u)) { w.escaped = true; ev(S, 'escape', w.side, w.tid); }
        hubRemove(S, u, '離脱');
        continue;
      }
      u.x = j.x; u.y = j.y;
      u.lock = u.def.lockTime; u.lockMax = u.def.lockTime;
      if (u.def.commsOn && !j.lane) u.commsAt = S.t + u.def.commsResync;
    }
  }

  // ---------------------------------------------------------------- 妨害場

  function updateFields(S) {
    const dt = S.set.dt;
    for (const u of S.units) {
      const d = u.def;
      if (!d.fieldOn || !active(u) || u.jump) continue;
      if (u.fs === 0) {
        const ready = d.fieldMode === 'immediate' || u.goalDone;
        if (ready && !u.lay) {
          u.fs = 1; u.ft = 0;
          if (d.fieldDeploy > 0) ev(S, 'fieldStart', u.side, u.tid, fmtMin(d.fieldDeploy));
        }
      }
      if (u.fs === 1) {
        if (u.ft >= d.fieldDeploy) {
          u.fs = 2; u.ft = 0;
          ev(S, 'fieldUp', u.side, u.tid, Math.round(d.fieldRadius * 10) / 10);
        } else u.ft += dt;
      } else if (u.fs === 2) {
        u.ft += dt;
        if (d.fieldDuration > 0 && u.ft >= d.fieldDuration) { u.fs = 3; ev(S, 'fieldDown', u.side, u.tid, '維持時間の終わり'); }
      }
    }
    const fl = [];
    for (const u of S.units) if (u.alive && u.fs === 2) fl.push({ x: u.x, y: u.y, r: u.def.fieldRadius, side: u.side, id: u.id });
    S.fields = fl;
    const sig = fl.map((f) => f.id).join(',');
    if (sig !== S.fieldSig) { S.fieldSig = sig; S.laneVer++; }
  }

  // ---------------------------------------------------------------- レーン網

  function rebuildLanes(S) {
    if (S.laneBuilt === S.laneVer) return;
    S.laneBuilt = S.laneVer;
    const gap = Math.max(0.5, S.set.laneGap);
    const nodes = [];
    const edges = [];
    const ends = [];
    S.lanes.forEach((L, li) => {
      if (L.gone) return;
      let prev = -1;
      const first = nodes.length;
      for (let i = 0; i < L.pts.length; i++) {
        const a = L.pts[i];
        if (i === 0) { nodes.push({ x: a.x, y: a.y, side: L.side, li }); prev = nodes.length - 1; continue; }
        const b0 = L.pts[i - 1];
        const len = hyp(a.x - b0.x, a.y - b0.y);
        const k = Math.max(1, Math.ceil(len / gap));
        for (let j = 1; j <= k; j++) {
          nodes.push({ x: b0.x + (a.x - b0.x) * j / k, y: b0.y + (a.y - b0.y) * j / k, side: L.side, li });
          edges.push([prev, nodes.length - 1]);
          prev = nodes.length - 1;
        }
      }
      ends.push(first, nodes.length - 1);
    });
    for (const n of nodes) n.ok = !inField(S, n.x, n.y);
    // 交点・端点のつながり（同じ陣営のレーンどうし）
    const jr = Math.max(1, S.set.laneAccess);
    for (const a of ends) {
      const na = nodes[a];
      for (let b = 0; b < nodes.length; b++) {
        const nb = nodes[b];
        if (nb.li === na.li || nb.side !== na.side) continue;
        if (Math.abs(nb.x - na.x) <= jr && Math.abs(nb.y - na.y) <= jr && hyp(nb.x - na.x, nb.y - na.y) <= jr) edges.push([a, b]);
      }
    }
    const par = nodes.map((_, i) => i);
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (const [a, b] of edges) {
      if (!nodes[a].ok || !nodes[b].ok) continue;
      const mx = (nodes[a].x + nodes[b].x) / 2, my = (nodes[a].y + nodes[b].y) / 2;
      if (inField(S, mx, my)) continue;
      const ra = find(a), rb = find(b);
      if (ra !== rb) par[ra] = rb;
    }
    nodes.forEach((n, i) => { n.comp = n.ok ? find(i) : -1; });
    S.nodes = nodes;
  }

  function nearestNode(S, side, x, y, maxD) {
    let best = -1, bd = maxD;
    const ns = S.nodes;
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      if (!n.ok || n.side !== side) continue;
      const d = hyp(n.x - x, n.y - y);
      if (d <= bd) { bd = d; best = i; }
    }
    return best;
  }

  function bestNodeToward(S, from, x, y) {
    const comp = S.nodes[from].comp;
    let best = from, bd = Infinity;
    const ns = S.nodes;
    for (let i = 0; i < ns.length; i++) {
      if (ns[i].comp !== comp) continue;
      const d = hyp(ns[i].x - x, ns[i].y - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ---- 動くハブ: 進みながら後ろにレーンを敷く。レーンの端はいつも艦のところにある
  const HUB_REBUILD = 0.5;    // 端がこれだけ動いたらレーン網を作り直す（毎刻みは重いので）
  const HUB_BEND = 0.1;       // 進む向きがこれ（sin の値）より曲がったら折れ点を残す
  const HUB_MAXPTS = 400;

  function updateHubs(S) {
    for (const u of S.units) {
      if (!u.def.hubOn || !visible(u)) continue;
      let L = u.hubLane >= 0 ? S.lanes[u.hubLane] : null;
      if (!L) {
        S.lanes.push({ side: u.side, pts: [{ x: u.x, y: u.y }, { x: u.x, y: u.y }], grow: true, hub: u.id });
        u.hubLane = S.lanes.length - 1; u.hubRx = u.x; u.hubRy = u.y;
        S.laneVer++;
        continue;
      }
      const tip = L.pts[L.pts.length - 1], prev = L.pts[L.pts.length - 2];
      const mx = u.x - tip.x, my = u.y - tip.y, moved = hyp(mx, my);
      if (moved < 1e-4) continue;
      const sx = tip.x - prev.x, sy = tip.y - prev.y, seg = hyp(sx, sy);
      let bend = false;
      if (seg > 0.5 && moved > 0.05 && L.pts.length < HUB_MAXPTS) bend = Math.abs(sx * my - sy * mx) / (seg * moved) > HUB_BEND || (sx * mx + sy * my) < 0;
      if (bend) L.pts.push({ x: u.x, y: u.y });
      else { tip.x = u.x; tip.y = u.y; }
      if (bend || hyp(u.x - u.hubRx, u.y - u.hubRy) >= HUB_REBUILD) { u.hubRx = u.x; u.hubRy = u.y; S.laneVer++; }
    }
  }

  // ジャンプするときは、いま引いているレーンをその場に残して切り離す（着いた先から新しく引く）
  function hubDetach(S, u) {
    if (u.hubLane < 0) return;
    const L = S.lanes[u.hubLane];
    L.grow = false;
    const tip = L.pts[L.pts.length - 1];
    tip.x = u.x; tip.y = u.y;
    u.hubLane = -1;
    S.laneVer++;
  }

  // 艦が沈むか離脱すると、その艦が敷いたレーンはすべて消える
  function hubRemove(S, u, why) {
    if (!u.def.hubOn) return;
    let n = 0;
    for (const L of S.lanes) if (L.hub === u.id && !L.gone) { L.gone = true; L.grow = false; n++; }
    u.hubLane = -1;
    if (n) { S.laneVer++; ev(S, 'hubLost', u.side, u.tid, why); }
  }

  // ---------------------------------------------------------------- 情報

  function updateSharing(S, first) {
    S.sides.forEach((sd, k) => {
      let on;
      if (sd.sharing === 'always') on = true;
      else if (sd.sharing === 'local') on = false;
      else on = S.units.some((u) => u.side === k && visible(u) && u.def.commsOn && S.t >= u.commsAt);
      if (!first && sd.sharing === 'comms' && on !== S.sharing[k]) ev(S, on ? 'commsUp' : 'commsDown', k, '');
      S.sharing[k] = on;
    });
  }

  function updateContacts(S) {
    S.sides.forEach((sd, k) => {
      const sensors = S.units.filter((u) => u.side === k && visible(u) && u.def.sensor > 0);
      const C = S.contacts[k];
      for (const e of S.units) {
        if (e.side === k) continue;
        if (!visible(e)) { C.delete(e.id); continue; }
        const c = C.get(e.id);
        // 「敵に位置を知られている」艦（拠点など）は、探知しなくても最初から知っている
        if (e.def.known) { if (!c) C.set(e.id, { at: 0, last: S.t }); else c.last = S.t; continue; }
        let best = Infinity;
        for (const f of sensors) {
          const dx = f.x - e.x, dy = f.y - e.y;
          const r = f.def.sensor;
          if (dx > r || dx < -r || dy > r || dy < -r) continue;
          const dd = hyp(dx, dy);
          if (dd <= r && dd < best) { best = dd; if (c) break; }
        }
        if (best < Infinity) {
          if (!c) {
            const delay = best + sd.reaction;
            C.set(e.id, { at: S.t + delay, last: S.t });
            ev(S, 'detect', k, e.tid, fmtMin(delay));
          } else c.last = S.t;
        } else if (c && S.t - c.last > 60) C.delete(e.id);
      }
    });
  }

  function updateLinks(S) {
    for (const u of S.units) { u.linked = false; u.linkLock = 0; u.linkBonus = 0; }
    for (const n of S.units) {
      if (!n.def.linkOn || !visible(n)) continue;
      const d = n.def;
      if (!n.linked || d.linkLock < n.linkLock) { n.linked = true; n.linkLock = d.linkLock; n.linkBonus = d.linkBonus; }
      const cand = [];
      for (const u of S.units) {
        if (u === n || u.side !== n.side || !visible(u) || u.linked) continue;
        const dd = dist(u, n);
        if (dd <= d.linkRadius) cand.push([dd, u]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < cand.length && i < d.linkCapacity; i++) {
        const u = cand[i][1];
        u.linked = true; u.linkLock = d.linkLock; u.linkBonus = d.linkBonus;
      }
    }
  }

  function strengthOf(S, k, includePending, includeEscaped) {
    let s = 0;
    for (const u of S.units) {
      if (u.side !== k || !u.alive) continue;
      if (u.escaped && !includeEscaped) continue;
      if (!u.present && !includePending) continue;
      s += u.def.cost * Math.max(0, u.hp) / u.def.hp;
    }
    return s;
  }

  function sideRetreatCheck(S) {
    S.sides.forEach((sd, k) => {
      if (S.sideRetreat[k] || !(sd.retreatBelow > 0) || !(S.init[k] > 0)) return;
      if (strengthOf(S, k, true, false) / S.init[k] < sd.retreatBelow) {
        S.sideRetreat[k] = true;
        ev(S, 'retreatAll', k, '', Math.round(sd.retreatBelow * 100) + '%');
      }
    });
  }

  // ---------------------------------------------------------------- 標的選び

  function canSee(S, u, e) {
    if (!visible(e) || e.side === u.side) return false;
    const dd = dist(u, e);
    if (dd <= Math.max(Math.max(u.def.wRange, secReach(u.def)) * 1.5, 5)) return true;
    const c = S.contacts[u.side].get(e.id);
    if (!c || c.at > S.t) return false;
    return S.sharing[u.side] || dd <= u.def.sensor;
  }

  function protectee(S, u) {
    if (u.reliefId >= 0) {
      const r = S.units[u.reliefId];
      if (r && active(r) && S.attacked && S.attacked[u.side].has(r.id)) return r;
      u.reliefId = -1; u.protAt = 0;
    }
    if (u.protAt > S.t) {
      const p = S.units[u.protId];
      if (p && active(p)) return p;
    }
    const p = findProtectee(S, u);
    u.protId = p ? p.id : -1; u.protAt = S.t + S.set.retarget;
    return p;
  }

  // 護衛する要艦は近く（ESCORT_RANGE 以内）から選ぶ。遠くにしかいなければ護衛しない
  const ESCORT_RANGE = 60;
  const GROUP_RANGE = 20;
  // 持ち場防衛の艦が「この拠点を守っている」とみなす距離
  const STATION_RANGE = 15;
  // 護衛が守る艦からこれ以上離れていたら、迎え撃つより先に守る艦のそばへ戻る
  const ESCORT_GAP = 10;

  // 攻められている味方の拠点（動かない艦）: 陣営が知っている敵の武装艦が、その敵の射程の2倍+3光秒以内にいるもの。
  // 刻みごとに数え、攻められはじめた時刻を覚えておく（救援要請が届くまでの遅れに使う）
  function updateAttacked(S) {
    if (!S.attacked) S.attacked = S.sides.map(() => new Map());
    S.sides.forEach((_, side) => {
      const M = S.attacked[side], C = S.contacts[side], now = new Set();
      let foes = null;
      for (const p of S.units) {
        if (p.side !== side || !visible(p) || !isStation(p.def)) continue;
        if (!foes) foes = S.units.filter((e) => e.side !== side && visible(e) && isArmed(e.def) && C.has(e.id) && C.get(e.id).at <= S.t);
        for (const e of foes) {
          const r = reachOf(e.def) * 2 + 3;
          if (Math.abs(e.x - p.x) <= r && Math.abs(e.y - p.y) <= r && dist(e, p) <= r) { now.add(p.id); break; }
        }
      }
      for (const id of [...M.keys()]) if (!now.has(id)) M.delete(id);
      for (const id of now) if (!M.has(id)) M.set(id, S.t);
    });
  }

  // 救援: 手が空いた護衛の艦（標的がなく、自分と守る艦のまわり ESCORT_RANGE 以内に知っている敵の武装艦がいない）は、
  // 攻められている味方の拠点のうちいちばん近いものを守りに行く。拠点の救援要請は、情報共有があればすぐ、
  // なければ光の速さで届く（攻められはじめてから、拠点までの距離の秒数だけ遅れる）。
  // 動く要艦（ノード艦など）は対象にしない（守っている艦を置いて、離れた艦を追いかけてしまうため）
  function reliefFor(S, u, p) {
    const att = S.attacked ? S.attacked[u.side] : null;
    if (!att || !att.size) return null;
    for (const e of S.units) {
      if (e.side === u.side || !visible(e) || !isArmed(e.def)) continue;
      if ((dist(u, e) <= ESCORT_RANGE || (p && dist(p, e) <= ESCORT_RANGE)) && canSee(S, u, e)) return null;
    }
    let best = null, bd = Infinity;
    for (const [id, since] of att) {
      const r = S.units[id];
      const dd = dist(u, r);
      if (!S.sharing[u.side] && S.t - since < dd) continue;
      if (dd < bd) { bd = dd; best = r; }
    }
    return best;
  }

  function findProtectee(S, u) {
    let best = null, bd = ESCORT_RANGE;
    for (const p of S.units) {
      if (p === u || p.side !== u.side || !active(p) || !p.def._key) continue;
      const q = p.jump ? { x: p.jump.x, y: p.jump.y } : p;
      const dd = dist(u, q);
      if (dd < bd) { bd = dd; best = p; }
    }
    return best;
  }

  function anchorOf(S, u) {
    const d = u.def;
    const R = engageRange(d);
    // 持ち場防衛: 持ち場から主砲の射程の2倍（最低10光秒）＋射程まで。貫く線を持つ艦は、貫く線の射程まで
    if (u.ai === 'hold') return { a: { x: u.hx, y: u.hy }, r: Math.max(Math.max(R * 2, 10) + R, hasSecondary(d) && d.sKind === 'lance' ? d.sRange : 0) };
    if (u.ai === 'static') return { a: u, r: Math.max(d.wRange, secReach(d)) };
    if (u.ai === 'escort') {
      const p = protectee(S, u);
      if (p && !p.jump) return { a: p, r: R * 2 + 3 };
    }
    return null;
  }

  function pickTarget(S, u) {
    const d = u.def;
    const local = Math.max(Math.max(d.wRange, secReach(d)) * 1.5, 5);
    const share = S.sharing[u.side];
    const C = S.contacts[u.side];
    const anc = isArmed(d) ? anchorOf(S, u) : null;
    const W = Math.max(30, d.wRange * 6);
    let best = null, bs = Infinity;
    for (const e of S.units) {
      if (e.side === u.side || !visible(e)) continue;
      const dd = dist(u, e);
      if (dd > local) {
        const c = C.get(e.id);
        if (!c || c.at > S.t) continue;
        if (!share && dd > d.sensor) continue;
      }
      if (anc && dist(anc.a, e) > anc.r) continue;
      const ed = e.def;
      let f = 0;
      switch (u.prio) {
        case 'weakest': f = (Math.max(0, e.hp) + e.sh) / (ed.hp + ed.shield); break;
        case 'threat': f = 1 - ed._dps / S.refDps; break;
        case 'key': f = ed._key ? 0 : 1; break;
        case 'cost': f = 1 - ed.cost / S.refCost; break;
        default: f = 0;
      }
      const sc = dd + W * f;
      if (sc < bs) { bs = sc; best = e; }
    }
    return best;
  }

  function nearestThreat(S, u, maxD) {
    let best = null, bd = maxD;
    for (const e of S.units) {
      if (e.side === u.side || !visible(e)) continue;
      const dd = dist(u, e);
      if (dd < bd && canSee(S, u, e)) { bd = dd; best = e; }
    }
    return best;
  }

  // ---------------------------------------------------------------- 移動

  function cruise(S, u, x, y) {
    const sp = u.def.hubOn ? Math.min(u.def.speed, u.def.hubSpeed) : u.def.speed;
    if (sp <= 0) return;
    const dx = x - u.x, dy = y - u.y, L = hyp(dx, dy);
    if (L < 1e-6) return;
    const st = Math.min(L, sp * S.set.dt);
    u.x += dx / L * st; u.y += dy / L * st;
    if (!u.state) u.state = 'move';
  }

  function laneMove(S, u, x, y, L) {
    const set = S.set;
    if (u.lock > 0 || !S.nodes.length) return false;
    const gainMin = Math.max(set.jumpMin, set.laneAccess * 3);
    if (L <= gainMin) return false;
    // 「レーンを使っても得がない」と分かったら、しばらく調べ直さない（重さ対策）
    if (u.laneNo > S.t && hyp(u.laneNoX - x, u.laneNoY - y) < gainMin * 0.5) return false;
    const r = laneMove2(S, u, x, y, L, gainMin);
    if (!r) { u.laneNo = S.t + 20; u.laneNoX = x; u.laneNoY = y; }
    return r;
  }

  function laneMove2(S, u, x, y, L, gainMin) {
    const set = S.set;
    const a = nearestNode(S, u.side, u.x, u.y, set.laneAccess);
    if (a >= 0) {
      const b = bestNodeToward(S, a, x, y);
      const nb = S.nodes[b];
      const rem = hyp(x - nb.x, y - nb.y);
      if (L - rem > gainMin) { startLaneJump(S, u, nb.x, nb.y, false); return true; }
      return false;
    }
    if (u.def.speed <= 0) return false;
    const m = nearestNode(S, u.side, u.x, u.y, Infinity);
    if (m < 0) return false;
    const nm = S.nodes[m];
    const toLane = hyp(nm.x - u.x, nm.y - u.y);
    const nb = S.nodes[bestNodeToward(S, m, x, y)];
    const rem = hyp(x - nb.x, y - nb.y);
    if (toLane + rem + gainMin < L) { cruise(S, u, nm.x, nm.y); return true; }
    return false;
  }

  function moveTo(S, u, x, y) {
    const d = u.def, set = S.set;
    const L = hyp(x - u.x, y - u.y);
    if (L < 1e-3) return;
    if (d.jump === 'free' && u.move !== 'cruise' && L > set.jumpMin) {
      const cruiseEta = d.speed > 0 ? L / d.speed : Infinity;
      if (canFreeJump(S, u)) {
        if (u.move === 'jump' || set.jumpTime < cruiseEta) { startJump(S, u, x, y, false); return; }
      } else if (u.lock > 0 && !inField(S, u.x, u.y) && u.fs !== 1 && u.fs !== 2) {
        const wait = u.lock / lockRate(u) + set.jumpTime;
        if (u.move === 'jump' || wait < cruiseEta) { u.state = 'wait'; return; }
      }
    }
    if (d.jump === 'lane' && u.move !== 'cruise' && laneMove(S, u, x, y, L)) return;
    cruise(S, u, x, y);
  }

  function approach(S, u, e, stand) {
    const dd = dist(u, e);
    if (dd <= stand) return;
    let ux = u.x - e.x, uy = u.y - e.y;
    const L = hyp(ux, uy) || 1;
    ux /= L; uy /= L;
    moveTo(S, u, e.x + ux * stand, e.y + uy * stand);
  }

  function moveAway(S, u, from, amount) {
    let ux = u.x - from.x, uy = u.y - from.y;
    const L = hyp(ux, uy) || 1;
    cruise(S, u, u.x + ux / L * amount, u.y + uy / L * amount);
  }

  // 艦隊に付いていく（中心から、いちばん近い敵と反対へ1.5光秒）。付いていく艦隊がなければ false
  function followFleet(S, u) {
    const c = fleetCenter(S, u);
    if (!c) return false;
    const e = nearestThreat(S, u, Infinity);
    let px = c.x, py = c.y;
    if (e) {
      const dx = c.x - e.x, dy = c.y - e.y, L = hyp(dx, dy) || 1;
      px += dx / L * 1.5; py += dy / L * 1.5;
    }
    if (hyp(px - u.x, py - u.y) > 1) moveTo(S, u, px, py);
    return true;
  }

  // いちばん近い味方の武装艦を見つけ、そのまわり（GROUP_RANGE 以内）の武装艦の中心を返す。
  // 遠くの拠点の守備隊まで平均すると、何もない場所へ向かってしまうため
  function fleetCenter(S, u) {
    const armed = (p) => p !== u && p.side === u.side && active(p) && isArmed(p.def) && p.ai !== 'follow' && (p.def.speed > 0 || p.def.jump !== 'none');
    const at = (p) => (p.jump ? p.jump : p);
    let near = null, nd = Infinity;
    for (const p of S.units) {
      if (!armed(p)) continue;
      const q = at(p), dd = hyp(q.x - u.x, q.y - u.y);
      if (dd < nd) { nd = dd; near = q; }
    }
    if (!near) return null;
    let sx = 0, sy = 0, n = 0;
    for (const p of S.units) {
      if (!armed(p)) continue;
      const q = at(p);
      if (hyp(q.x - near.x, q.y - near.y) > GROUP_RANGE) continue;
      sx += q.x; sy += q.y; n++;
    }
    return { x: sx / n, y: sy / n };
  }

  function doRetreat(S, u) {
    const d = u.def, set = S.set;
    u.state = 'retreat';
    if (d.jump === 'free') {
      if (canFreeJump(S, u)) { startJump(S, u, u.x, u.y, true); return; }
      const f = inField(S, u.x, u.y);
      if (f) { moveAway(S, u, f, f.r); return; }
    } else if (d.jump === 'lane' && u.lock <= 0) {
      const a = nearestNode(S, u.side, u.x, u.y, set.laneAccess);
      if (a >= 0) { startLaneJump(S, u, u.x, u.y, true); return; }
      const m = nearestNode(S, u.side, u.x, u.y, 120);
      if (m >= 0) { cruise(S, u, S.nodes[m].x, S.nodes[m].y); return; }
    }
    const e = nearestThreat(S, u, Infinity);
    if (e) moveAway(S, u, e, 10);
  }

  function layerThink(S, u) {
    const d = u.def, set = S.set;
    if (u.lay) {
      const L = S.lanes[u.lay.li];
      const tip = L.pts[L.pts.length - 1];
      const dx = u.lay.tx - tip.x, dy = u.lay.ty - tip.y, rem = hyp(dx, dy);
      const st = Math.min(rem, d.layerSpeed * set.dt, Math.max(0, d.layerMax - u.lay.len));
      if (rem > 1e-6) { tip.x += dx / rem * st; tip.y += dy / rem * st; }
      u.lay.len += st;
      u.x = tip.x; u.y = tip.y;
      S.laneVer++;
      u.state = 'lay';
      if (rem - st < 0.3 || u.lay.len >= d.layerMax - 1e-6 || d.layerSpeed <= 0) {
        L.grow = false; u.lay = null;
        ev(S, 'layEnd', u.side, u.tid);
        if (u.goal && !u.goalDone && hyp(u.goal.x - u.x, u.goal.y - u.y) < 1) u.goalDone = true;
        u.layCd = S.t + 120;
      }
      return true;
    }
    if (S.t < u.layCd || d.layerSpeed <= 0) return false;
    u.layCd = S.t + 30;
    let tx, ty;
    if (u.goal && !u.goalDone) { tx = u.goal.x; ty = u.goal.y; }
    else {
      const e = nearestThreat(S, u, Infinity);
      if (!e) return false;
      tx = e.x; ty = e.y;
    }
    const a = nearestNode(S, u.side, u.x, u.y, set.laneAccess);
    if (a < 0) return false;
    const b = bestNodeToward(S, a, tx, ty);
    const nb = S.nodes[b];
    const need = hyp(nb.x - tx, nb.y - ty);
    if (need < Math.max(set.jumpMin, 8)) return false;
    if (hyp(nb.x - u.x, nb.y - u.y) > set.laneAccess) {
      if (u.lock <= 0) { startLaneJump(S, u, nb.x, nb.y, false); return true; }
      return false;
    }
    S.lanes.push({ side: u.side, pts: [{ x: nb.x, y: nb.y }, { x: nb.x, y: nb.y }], grow: true, by: u.id });
    u.lay = { li: S.lanes.length - 1, tx, ty, len: 0 };
    S.laneVer++;
    ev(S, 'layStart', u.side, u.tid, fmtMin(Math.min(need, d.layerMax) / d.layerSpeed));
    u.state = 'lay';
    return true;
  }

  // ---------------------------------------------------------------- 思考

  function think(S, u) {
    if (!visible(u)) return;
    const d = u.def;
    u.state = '';
    if (!u.retreat && (S.sideRetreat[u.side] || (u.retreatAt > 0 && u.hp < d.hp * u.retreatAt))) u.retreat = true;

    // 標的は「見直し間隔」ごとに選び直す。いまの標的を見失ったときはすぐ選び直す
    u.rt -= S.set.dt;
    let tg = u.tgt >= 0 ? S.units[u.tgt] : null;
    let lost = false;
    if (tg && !canSee(S, u, tg)) { tg = null; lost = true; }
    if (lost || u.rt <= 0) { tg = pickTarget(S, u); u.rt = S.set.retarget; }
    u.tgt = tg ? tg.id : -1;

    if (u.fs === 1) { u.state = 'deploy'; return; }
    if (u.fs === 2) { u.state = 'field'; return; }
    if (u.retreat) { u.charge = 0; doRetreat(S, u); return; }
    if (u.charge > 0) { u.state = 'charge'; return; }
    if (d.layerOn && layerThink(S, u)) return;

    if (!u.goalDone) {
      if (hyp(u.goal.x - u.x, u.goal.y - u.y) <= Math.max(0.5, S.set.arrivalError * 2)) {
        u.goalDone = true; u.hx = u.x; u.hy = u.y;
      } else { moveTo(S, u, u.goal.x, u.goal.y); return; }
    }
    if (d.fieldOn && u.fs === 0) return; // 展開待ち（この刻みの後で展開に入る）

    // 弾が尽きたら補充に戻る（艦種で「弾が尽きたら補充に戻る」がオンのとき）。満タンになったら戦いに戻る
    if (d.sOn && d.sReturn && d.sAmmo > 0) {
      if (!u.resupplying && u.ammo <= 0) {
        const st = nearestStation(S, u);
        if (st) { u.resupplying = true; u.reliefId = -1; ev(S, 'resupplyGo', u.side, u.tid, st.def.name); }
      }
      if (u.resupplying) {
        const st = u.ammo < d.sAmmo ? nearestStation(S, u) : null;
        if (!st) {
          u.resupplying = false;
          if (u.ammo >= d.sAmmo) ev(S, 'resupplyDone', u.side, u.tid);
        } else {
          u.state = 'resupply';
          const r = Math.max(0.5, S.set.resupplyRange * 0.6);
          if (dist(u, st) > r) approach(S, u, st, r * 0.8);
          return;
        }
      }
    }

    // 守っていた拠点を失った持ち場防衛の艦は、護衛に切り替える（その場で止まり続けないように）
    if (u.ai === 'hold' && u.station >= 0 && !S.units[u.station].alive) {
      ev(S, 'stationLost', u.side, u.tid, S.units[u.station].def.name);
      u.ai = 'escort'; u.station = -1; u.protAt = 0;
    }

    const R = engageRange(d);
    switch (u.ai) {
      case 'static': return;
      case 'assault': {
        if (tg) approach(S, u, tg, Math.max(0.3, R * 0.85));
        return;
      }
      case 'kite': {
        if (!tg) return;
        const dd = dist(u, tg);
        if (dd < R * 0.8) moveAway(S, u, tg, R * 0.92 - dd);
        else if (dd > R * 0.98) approach(S, u, tg, R * 0.92);
        return;
      }
      case 'hold': {
        // 持ち場から leash までは標的へ寄る。標的にできる範囲（貫く線を持つ艦は貫く線の射程まで）は anchorOf と同じ
        const home = { x: u.hx, y: u.hy };
        const leash = Math.max(R * 2, 10), reach = anchorOf(S, u).r;
        if (tg && dist(home, tg) <= reach && dist(u, tg) > R * 0.85) {
          let ux = u.x - tg.x, uy = u.y - tg.y;
          const L = hyp(ux, uy) || 1;
          let px = tg.x + ux / L * R * 0.85, py = tg.y + uy / L * R * 0.85;
          const hd = hyp(px - home.x, py - home.y);
          if (hd > leash) { px = home.x + (px - home.x) / hd * leash; py = home.y + (py - home.y) / hd * leash; }
          moveTo(S, u, px, py);
        } else if (!tg && dist(u, home) > 0.3) moveTo(S, u, home.x, home.y);
        return;
      }
      case 'escort': {
        let p = protectee(S, u);
        if (!tg && isArmed(d) && u.reliefId < 0) {
          const r = reliefFor(S, u, p);
          if (r && r !== p) {
            u.reliefId = r.id; p = r;
            ev(S, 'relief', u.side, u.tid, r.def.name);
          }
        }
        if (!p) { if (tg) approach(S, u, tg, R * 0.85); return; }
        const q = p.jump ? { x: p.jump.x, y: p.jump.y } : p;
        // 守る艦から遠いうちは、まずそこへ向かう（ジャンプも使う）
        if (dist(u, q) > R * 2 + 3 + ESCORT_GAP) { moveTo(S, u, q.x, q.y); return; }
        if (!p.jump && tg && dist(tg, p) < R * 2 + 3) {
          // 要艦に近づく敵を、要艦から離れすぎない範囲で迎え撃つ
          if (dist(u, tg) > R * 0.85) {
            let ux = u.x - tg.x, uy = u.y - tg.y;
            const L = hyp(ux, uy) || 1;
            let px = tg.x + ux / L * R * 0.85, py = tg.y + uy / L * R * 0.85;
            const leash = R * 2 + 2, hd = hyp(px - p.x, py - p.y);
            if (hd > leash) { px = p.x + (px - p.x) / hd * leash; py = p.y + (py - p.y) / hd * leash; }
            cruise(S, u, px, py);
          }
        } else if (dist(u, q) > 1.5) moveTo(S, u, q.x, q.y);
        return;
      }
      case 'follow': {
        if (!followFleet(S, u) && tg) approach(S, u, tg, R * 0.85);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- 艦どうしの間隔

  // S.set.spacing より近い2隻は互いに押し離す。動けない艦（拠点・展開中や維持中の静穏場艦・延伸中のエルダ級）は動かさず、
  // 相手だけを押す。1刻みに押せるのはその艦が通常航行で進める距離まで（大きな塊は数刻みかけてほどける）
  function separate(S) {
    const g = S.set.spacing;
    if (!(g > 0)) return;
    const grid = new Map(), list = [];
    for (const u of S.units) {
      if (!visible(u)) continue;
      u.sepX = 0; u.sepY = 0;
      list.push(u);
      const k = Math.floor(u.x / g) + ',' + Math.floor(u.y / g);
      const l = grid.get(k);
      if (l) l.push(u); else grid.set(k, [u]);
    }
    const movable = (u) => u.def.speed > 0 && u.fs !== 1 && u.fs !== 2 && !u.lay && !(u.charge > 0);
    for (const a of list) {
      const cx = Math.floor(a.x / g), cy = Math.floor(a.y / g);
      for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) {
        const l = grid.get((cx + ax) + ',' + (cy + ay));
        if (!l) continue;
        for (const b of l) {
          if (b.id <= a.id) continue;
          let dx = b.x - a.x, dy = b.y - a.y;
          const d = hyp(dx, dy);
          if (d >= g) continue;
          if (d < 1e-9) {
            // ぴったり重なっているときは、番号で決まる向きへ（乱数は使わない）
            const ang = ((a.id * 7919 + b.id * 104729) % 360) * Math.PI / 180;
            dx = Math.cos(ang); dy = Math.sin(ang);
          } else { dx /= d; dy /= d; }
          const ma = movable(a), mb = movable(b), push = g - d;
          if (ma && mb) { a.sepX -= dx * push / 2; a.sepY -= dy * push / 2; b.sepX += dx * push / 2; b.sepY += dy * push / 2; }
          else if (ma) { a.sepX -= dx * push; a.sepY -= dy * push; }
          else if (mb) { b.sepX += dx * push; b.sepY += dy * push; }
        }
      }
    }
    for (const u of list) {
      if (!u.sepX && !u.sepY) continue;
      const L = hyp(u.sepX, u.sepY), cap = u.def.speed * S.set.dt;
      const k = L > cap ? cap / L : 1;
      u.x += u.sepX * k; u.y += u.sepY * k;
    }
  }

  // ---------------------------------------------------------------- 戦闘

  function kill(S, v, by) {
    v.alive = false; v.hp = 0; v.diedAt = S.t; v.by = by ? by.id : -1;
    if (by) by.kills++;
    ev(S, 'kill', v.side, v.tid);
    if (v.fs === 1) ev(S, 'fieldFail', v.side, v.tid);
    if (v.fs === 2) ev(S, 'fieldDown', v.side, v.tid, '艦が撃沈された');
    if (v.lay) { S.lanes[v.lay.li].grow = false; v.lay = null; S.laneVer++; ev(S, 'layStop', v.side, v.tid); }
    const cargo = cargoOf(S, v);
    if (cargo.length) {
      for (const w of cargo) kill(S, w, by);
      ev(S, 'cargoLost', v.side, v.tid, cargo.length + '隻');
    }
    hubRemove(S, v, '撃沈');
    v.charge = 0; v.charged = false;
  }

  // 射撃の記録（SHOT_W 個ずつ）。kind は SHOT_KIND、flight は届くまでの秒数（記録の時刻は着弾の時刻）
  const SHOT_KIND = { main: 0, line: 1, shell: 2, missile: 3, drone: 4, intercept: 5, lance: 6 };
  function recordShot(S, sx, sy, tx, ty, hit, side, shooter, target, kind, flight, killed) {
    if (S.record) S.shots.push(sx, sy, tx, ty, hit, side, S.t, shooter, target, kind, flight, killed || 0);
  }

  // 損害を与える。bypass の割合はウォードを素通りして船体に当たる。リンク中の艦は火力が上がる
  function damage(S, src, tg, base, bypass) {
    let dmg = base * (src.linked ? 1 + src.linkBonus : 1);
    src.dealt += dmg;
    const through = dmg * (bypass || 0);
    dmg -= through;
    if (tg.sh >= dmg) tg.sh -= dmg;
    else { dmg -= tg.sh; tg.sh = 0; tg.hp -= dmg; }
    tg.hp -= through;
    if (tg.hp <= 0 && tg.alive) kill(S, tg, src);
  }

  function fire(S, u, tg) {
    const d = u.def;
    const dd = dist(u, tg);
    const p = d.wAccuracy * (1 - d.wFalloff * Math.min(1, dd / Math.max(d.wRange, 1e-6))) * (1 - tg.def.evasion);
    const hit = S.rng() < p;
    recordShot(S, u.x, u.y, tg.x, tg.y, hit ? 1 : 0, u.side, u.id, tg.id, SHOT_KIND.main, 0);
    if (hit) damage(S, u, tg, d.wDamage, 0);
  }

  // ---------------------------------------------------------------- 副兵装と迎撃

  // 無人機: 標的の DRONE_REACH 以内まで寄ると、DRONE_TICK 秒ごとに1発撃つ。標的を失ったら DRONE_SEEK 以内の敵へ移る
  const DRONE_REACH = 0.3, DRONE_TICK = 10, DRONE_SEEK = 3;

  function nearestWithin(S, u, R, check) {
    let best = null, bd = R;
    for (const e of S.units) {
      if (e.side === u.side || !visible(e)) continue;
      const dx = Math.abs(e.x - u.x), dy = Math.abs(e.y - u.y);
      if (dx > bd || dy > bd) continue;
      const dd = hyp(dx, dy);
      if (dd <= bd && (!check || canSee(S, u, e))) { bd = dd; best = e; }
    }
    return best;
  }

  function fireSecondary(S, u, tg) {
    const d = u.def, dd = dist(u, tg), A = S.arms[u.side];
    if (u.ammo <= 0) return;
    if (u.ammo !== Infinity) u.ammo--;
    A.fired++;
    if (d.sKind === 'line') {
      const p = d.sAccuracy * (1 - d.sFalloff * Math.min(1, dd / Math.max(d.sRange, 1e-6))) * (1 - tg.def.evasion);
      const hit = S.rng() < p;
      recordShot(S, u.x, u.y, tg.x, tg.y, hit ? 1 : 0, u.side, u.id, tg.id, SHOT_KIND.line, 0);
      if (hit) { A.hits++; damage(S, u, tg, d.sDamage, d.sBypass); }
    } else if (d.sKind === 'drone') {
      A.drones++;
      S.drones.push({
        id: S.droneSeq++, side: u.side, owner: u.id, tg: tg.id, x: u.x, y: u.y, ox: 0, oy: 0,
        until: S.t + d.sLife, next: 0, attack: false, dead: false,
        speed: Math.max(1e-3, d.sSpeed), dmg: d.sDamage, acc: d.sAccuracy, bypass: d.sBypass,
      });
    } else {
      if (d.sKind === 'missile') A.missiles++;
      const flight = dd / Math.max(1e-3, d.sSpeed);
      S.proj.push({ kind: d.sKind, side: u.side, u: u.id, tg: tg.id, sx: u.x, sy: u.y, ax: tg.x, ay: tg.y, d: dd, t0: S.t, t1: S.t + flight });
    }
  }

  // 副兵装の当たる見込み（撃つかどうかの判断に使う。乱数は引かない。迎撃と流れ弾は数えない）
  function secondaryChance(S, u, e) {
    const d = u.def, dd = dist(u, e), ev = 1 - e.def.evasion;
    if (d.sKind === 'drone') return 1;
    if (d.sKind === 'missile') return d.sAccuracy * ev;
    return d.sAccuracy * (1 - d.sFalloff * Math.min(1, dd / Math.max(d.sRange, 1e-6))) * ev;
  }
  // 副兵装で撃ってよい敵: 射程内で見えていて、当たる見込みが「撃つ見込み」以上
  function secondaryOk(S, u, e) {
    return !!e && e.alive && visible(e) && e.side !== u.side && dist(u, e) <= u.def.sRange && canSee(S, u, e)
      && secondaryChance(S, u, e) >= (u.def.sMinHit || 0);
  }
  // 副兵装の標的: いまの標的が撃てればそれ。だめなら撃てる敵のうちいちばん近いもの
  function pickSecondary(S, u) {
    const tg = u.tgt >= 0 ? S.units[u.tgt] : null;
    if (secondaryOk(S, u, tg)) return tg;
    const R = u.def.sRange;
    let best = null, bd = Infinity;
    for (const e of S.units) {
      if (e.side === u.side || !visible(e)) continue;
      if (Math.abs(e.x - u.x) > R || Math.abs(e.y - u.y) > R) continue;
      const dd = dist(u, e);
      if (dd < bd && secondaryOk(S, u, e)) { bd = dd; best = e; }
    }
    return best;
  }

  // 1回の副兵装の斉射。数の配り方は主砲の砲門と同じ（撃てる敵だけ。弾が尽きたらそこまで）
  function volleySecondary(S, u, tg) {
    fireSecondary(S, u, tg);
    const d = u.def, n = Math.max(1, Math.floor(d.sMounts || 1));
    if (n <= 1) return;
    const R = d.sRange, list = [];
    for (const e of S.units) {
      if (e === tg || e.side === u.side || !visible(e)) continue;
      if (Math.abs(e.x - u.x) > R || Math.abs(e.y - u.y) > R) continue;
      if (secondaryOk(S, u, e)) list.push([dist(u, e), e]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < n - 1 && u.ammo > 0; i++) {
      const e = i < list.length ? list[i][1] : tg;
      if (e.alive) fireSecondary(S, u, e);
    }
  }

  // ---- シェル型: 超遠距離から敵の群れへ見越しで撃ち込む面制圧
  // 狙う点: 見えている敵それぞれについて、いまの向きと速さのまま進むとして着弾の時刻にいる点を求め、
  // その敵のまわり（爆発半径の中）にいまいる敵の数（群れはまとまって動く）がいちばん多い点を選ぶ。
  // 撃たれる側は気づかないので、外れるのは針路や速さを変えたときと、命中率の外れだけ
  const SHELL_SCAN = 30;       // 撃てる群れが見つからないとき、次に探すまでの秒数

  // 陣営 side の敵（見えている艦）を、一辺 cell のます目に分けたもの。刻みごとに作り直す
  function foeGrid(S, side, cell) {
    const key = S.t + '|' + side + '|' + cell;
    if (S.foeGridKey === key) return S.foeGrid;
    const g = new Map();
    for (const e of S.units) {
      if (e.side === side || !visible(e)) continue;
      const k = Math.floor(e.x / cell) + ',' + Math.floor(e.y / cell);
      const l = g.get(k);
      if (l) l.push(e); else g.set(k, [e]);
    }
    S.foeGridKey = key; S.foeGrid = g;
    return g;
  }

  // 相対位置 (rx, ry) にいて速さ (vx, vy) で進む相手に、速さ sp の弾が出会うまでの時間（出会えなければ -1）
  function interceptTime(rx, ry, vx, vy, sp) {
    const a = vx * vx + vy * vy - sp * sp, b = 2 * (rx * vx + ry * vy), c = rx * rx + ry * ry;
    if (Math.abs(a) < 1e-12) return b < 0 ? -c / b : -1;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const q = Math.sqrt(disc), t1 = (-b - q) / (2 * a), t2 = (-b + q) / (2 * a);
    const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
    return lo > 0 ? lo : hi > 0 ? hi : -1;
  }

  function shellPlan(S, u, taken) {
    const d = u.def, R = Math.max(0.05, d.sBlast), sp = Math.max(1e-3, d.sSpeed), need = Math.max(1, d.sMinCount || 1);
    const g = foeGrid(S, u.side, R);
    let best = null;
    for (const e of S.units) {
      if (e.side === u.side || !visible(e) || (taken && taken.has(e.id))) continue;
      if (Math.abs(e.x - u.x) > d.sRange * 1.5 || Math.abs(e.y - u.y) > d.sRange * 1.5) continue;
      if (!canSee(S, u, e)) continue;
      // 見越し: いまの向きと速さのまま進む敵と、弾が出会う時刻 t を解く（|r + v t| = 弾速 × t）
      const t = interceptTime(e.x - u.x, e.y - u.y, e.vx, e.vy, sp);
      if (!(t > 0)) continue;
      const px = e.x + e.vx * t, py = e.y + e.vy * t;
      if (hyp(px - u.x, py - u.y) > d.sRange) continue;
      // その群れの数: いま e から爆発半径の中にいる敵（すでに別の弾で狙った艦は数えない）
      let n = 0;
      const cx = Math.floor(e.x / R), cy = Math.floor(e.y / R);
      for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) {
        const l = g.get((cx + ax) + ',' + (cy + ay));
        if (!l) continue;
        for (const f of l) if (!(taken && taken.has(f.id)) && hyp(f.x - e.x, f.y - e.y) <= R) n++;
      }
      if (n < need) continue;
      if (!best || n > best.n || (n === best.n && t < best.t)) best = { x: px, y: py, n, t, e };
    }
    return best;
  }

  // 1回の斉射: 1発目はいちばん大きい群れ、2発目からはまだ狙っていない群れ（なければ同じ点に重ねる）
  function fireShells(S, u) {
    const d = u.def, R = Math.max(0.05, d.sBlast), n = Math.max(1, Math.floor(d.sMounts || 1));
    const taken = new Set();
    let first = null;
    for (let i = 0; i < n && u.ammo > 0; i++) {
      let plan = shellPlan(S, u, taken);
      if (!plan) plan = first;
      if (!plan) return false;
      if (!first) first = plan;
      for (const e of S.units) if (e.side !== u.side && visible(e) && hyp(e.x - plan.e.x, e.y - plan.e.y) <= R) taken.add(e.id);
      if (u.ammo !== Infinity) u.ammo--;
      S.arms[u.side].fired++;
      S.proj.push({ kind: 'shell', side: u.side, u: u.id, tg: plan.e.id, sx: u.x, sy: u.y, ax: plan.x, ay: plan.y, d: plan.t * Math.max(1e-3, d.sSpeed), t0: S.t, t1: S.t + plan.t });
    }
    return !!first;
  }

  function secondaryShell(S, u) {
    const d = u.def;
    if (u.cd2 > 0) u.cd2 -= S.set.dt;
    if (u.cd2 > 0 || u.ammo <= 0 || S.t < u.scanAt) return;
    if (fireShells(S, u)) u.cd2 = Math.max(1, d.sInterval);
    else u.scanAt = S.t + SHELL_SCAN;
  }

  // ---- 貫く線: 溜めてから、射程いっぱいまで伸びる線の上に並ぶ敵すべてを一度に撃つ
  // 向き: 射程内で見えている敵それぞれへ向けた線のうち、線の太さの中に入る敵のコストの合計（コスト × 数）がいちばん大きいもの。
  // 射程内に見えている敵が1隻でもいれば撃つ（並ぶのを待たない）
  const LANCE_SCAN = 30;      // 撃つ向きが見つからないとき、次に探すまでの秒数

  function lancePlan(S, u, taken) {
    const d = u.def, R = d.sRange, W = Math.max(0.01, d.sWidth) / 2;
    const list = [];
    for (const e of S.units) {
      if (e.side === u.side || !visible(e) || (taken && taken.has(e.id))) continue;
      const dx = e.x - u.x, dy = e.y - u.y;
      if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
      const dd = hyp(dx, dy);
      if (dd > R || dd < 1e-6 || !canSee(S, u, e)) continue;
      list.push({ e, dx, dy, dd });
    }
    let best = null;
    for (const a of list) {
      const ux = a.dx / a.dd, uy = a.dy / a.dd;
      let n = 0, v = 0;
      for (const b of list) {
        const along = b.dx * ux + b.dy * uy;
        if (along < 0 || along > R) continue;
        if (Math.abs(b.dx * uy - b.dy * ux) <= W) { n++; v += b.e.def.cost; }
      }
      if (!best || v > best.v || (v === best.v && a.dd < best.dd)) best = { ux, uy, n, v, dd: a.dd, e: a.e };
    }
    return best;
  }

  // 線の上（太さの中）にいる敵すべてに損害。命中率は1隻ずつ（回避で下がる）。損害を受けた数と沈んだ数を返す
  function fireLance(S, u, plan, taken) {
    const d = u.def, R = d.sRange, W = Math.max(0.01, d.sWidth) / 2, A = S.arms[u.side];
    if (u.ammo !== Infinity) u.ammo--;
    A.fired++;
    let hit = 0, killed = 0;
    for (const e of S.units) {
      if (e.side === u.side || !visible(e)) continue;
      const dx = e.x - u.x, dy = e.y - u.y;
      const along = dx * plan.ux + dy * plan.uy;
      if (along < 0 || along > R || Math.abs(dx * plan.uy - dy * plan.ux) > W) continue;
      if (taken) taken.add(e.id);
      if (S.rng() >= d.sAccuracy * (1 - e.def.evasion)) continue;
      hit++;
      damage(S, u, e, d.sDamage, d.sBypass);
      if (!e.alive) killed++;
    }
    if (hit) { A.hits++; A.blastHits += hit; }
    recordShot(S, u.x, u.y, u.x + plan.ux * R, u.y + plan.uy * R, hit, u.side, u.id, plan.e.id, SHOT_KIND.lance, 0, killed);
    ev(S, 'lanceFire', u.side, u.tid, hit + '隻に損害、' + killed + '隻撃沈');
  }

  function secondaryLance(S, u) {
    const d = u.def, dt = S.set.dt;
    if (u.cd2 > 0) { u.cd2 -= dt; return; }
    if (u.ammo <= 0) return;
    if (u.charge > 0) {
      u.charge -= dt;
      if (u.charge > 0) return;
      u.charge = 0; u.charged = true;
      u.scanAt = 0;
    }
    if (S.t < u.scanAt) return;
    const plan = lancePlan(S, u, null);
    if (!plan) { u.scanAt = S.t + LANCE_SCAN; return; }
    if (!u.charged && d.sCharge > 0) {
      u.charge = d.sCharge;
      ev(S, 'lanceCharge', u.side, u.tid, fmtMin(d.sCharge));
      return;
    }
    // 1回に撃つ数だけ、別々の向きへ（2本目からは、まだ撃っていない敵が並ぶ向き）
    const taken = new Set(), n = Math.max(1, Math.floor(d.sMounts || 1));
    let p = plan;
    for (let i = 0; i < n && p && u.ammo > 0; i++) {
      fireLance(S, u, p, taken);
      p = i + 1 < n ? lancePlan(S, u, taken) : null;
    }
    u.charged = false;
    u.cd2 = Math.max(0, d.sInterval);
  }

  // 撃つ相手が現れてから最初の1発までの照準の時間の上限（間隔の長い兵器が何分も待たないように）
  const AIM_MAX = 30;

  function secondary(S, u) {
    const d = u.def, dt = S.set.dt;
    if (d.sKind === 'shell') { secondaryShell(S, u); return; }
    if (d.sKind === 'lance') { secondaryLance(S, u); return; }
    if (u.ammo <= 0) { u.cd2 = IDLE; return; }
    if (u.cd2 === IDLE) {
      if (!pickSecondary(S, u)) return;
      u.cd2 = S.rng() * Math.min(Math.max(1, d.sInterval) * 0.5, AIM_MAX);
    }
    u.cd2 -= dt;
    if (u.cd2 > 0) return;
    let tg = pickSecondary(S, u);
    if (!tg) { u.cd2 = IDLE; return; }
    let guard = 0;
    while (u.cd2 <= 0 && u.ammo > 0 && guard++ < 50) {
      if (!secondaryOk(S, u, tg)) { tg = pickSecondary(S, u); if (!tg) break; }
      volleySecondary(S, u, tg);
      u.cd2 += Math.max(1, d.sInterval);
    }
    if (u.cd2 < 0) u.cd2 = 0;
  }

  // 爆発: (x, y) から半径 sBlast の中の敵に、中心からの距離に応じて減る損害（直撃した艦は除く）
  // 爆発: (x, y) から半径 sBlast の中の敵すべてに威力いっぱいの損害（skip の艦は除く。味方は巻き込まない）。
  // 損害を受けた数と沈んだ数を返す
  function blast(S, src, side, x, y, skip, d) {
    const R = d.sBlast;
    let hit = 0, killed = 0;
    if (!(R > 0)) return { hit, killed };
    for (const e of S.units) {
      if (e === skip || e.side === side || !visible(e)) continue;
      const dx = e.x - x, dy = e.y - y;
      if (Math.abs(dx) > R || Math.abs(dy) > R || hyp(dx, dy) > R) continue;
      hit++;
      S.arms[side].blastHits++;
      damage(S, src, e, d.sDamage, d.sBypass);
      if (!e.alive) killed++;
    }
    return { hit, killed };
  }

  // 味方の拠点（動かない艦）のうち、いちばん近いもの
  function nearestStation(S, u) {
    let best = null, bd = Infinity;
    for (const p of S.units) {
      if (p.side !== u.side || !visible(p) || !isStation(p.def)) continue;
      const dd = dist(u, p);
      if (dd < bd) { bd = dd; best = p; }
    }
    return best;
  }

  // 迎撃: (x, y) の近くにいる side の迎撃艦が、近い順に1回ずつ撃ち落としを試みる。落とせたら true
  function intercept(S, side, x, y) {
    let list = null;
    for (const p of S.units) {
      if (p.side !== side || !p.def.pdOn || !visible(p) || p.pdNext > S.t) continue;
      const r = p.def.pdRange;
      if (Math.abs(p.x - x) > r || Math.abs(p.y - y) > r) continue;
      const dd = hyp(p.x - x, p.y - y);
      if (dd <= r) (list || (list = [])).push([dd, p]);
    }
    if (!list) return false;
    list.sort((a, b) => a[0] - b[0]);
    for (const [, p] of list) {
      p.pdNext = S.t + Math.max(1, p.def.pdInterval);
      const ok = S.rng() < p.def.pdChance;
      recordShot(S, p.x, p.y, x, y, ok ? 1 : 0, p.side, p.id, -1, SHOT_KIND.intercept, 0);
      if (ok) return true;
    }
    return false;
  }

  // 飛んでいるシェルと誘導弾。着く時刻が来たら当たり外れを決める
  function updateProjectiles(S) {
    if (!S.proj.length) return;
    const keep = [];
    for (const p of S.proj) {
      if (p.t1 > S.t) { keep.push(p); continue; }
      const src = S.units[p.u], d = src.def, tg = S.units[p.tg], A = S.arms[p.side];
      const flight = p.t1 - p.t0;
      let ax = p.ax, ay = p.ay, hitU = null;
      const live = visible(tg);
      if (live) { ax = tg.x; ay = tg.y; }
      if (p.kind === 'shell') {
        // 狙った点で爆発する。命中率の外れは、狙いから爆発半径の1〜2倍ずれた点で爆発
        let ix = p.ax, iy = p.ay;
        if (S.rng() >= d.sAccuracy) {
          const a = S.rng() * Math.PI * 2, r = Math.max(0.05, d.sBlast) * (1 + S.rng());
          ix += Math.cos(a) * r; iy += Math.sin(a) * r;
        }
        const res = blast(S, src, p.side, ix, iy, null, d);
        if (res.hit) A.hits++;
        recordShot(S, p.sx, p.sy, ix, iy, res.hit, p.side, src.id, p.tg, SHOT_KIND.shell, flight, res.killed);
        continue;
      }
      if (live && intercept(S, tg.side, ax, ay)) {
        A.missilesDown++;
        recordShot(S, p.sx, p.sy, ax, ay, -1, p.side, src.id, tg.id, SHOT_KIND.missile, flight);
        continue;
      }
      if (live && S.rng() < d.sAccuracy * (1 - tg.def.evasion)) hitU = tg;
      let killed = 0;
      if (hitU) {
        A.hits++;
        const bx = hitU.x, by = hitU.y;
        damage(S, src, hitU, d.sDamage, d.sBypass);
        if (!hitU.alive) killed++;
        if (d.sBlast > 0) killed += blast(S, src, p.side, bx, by, hitU, d).killed;
      }
      recordShot(S, p.sx, p.sy, ax, ay, hitU ? 1 : 0, p.side, src.id, (hitU || tg).id, SHOT_KIND.missile, flight, killed);
    }
    S.proj = keep;
  }

  // 無人機: 標的へ飛び、そばで撃ち続ける。敵の迎撃で落とされ、稼働時間が尽きると消える
  function updateDrones(S) {
    if (!S.drones.length) return;
    const dt = S.set.dt;
    for (const r of S.drones) {
      if (r.dead) continue;
      if (S.t >= r.until) { r.dead = true; continue; }
      let tg = S.units[r.tg];
      if (!visible(tg)) {
        tg = null;
        let bd = DRONE_SEEK;
        for (const e of S.units) {
          if (e.side === r.side || !visible(e)) continue;
          const dd = hyp(e.x - r.x, e.y - r.y);
          if (dd < bd) { bd = dd; tg = e; }
        }
        if (!tg) { r.dead = true; continue; }
        r.tg = tg.id; r.attack = false;
      }
      if (!r.attack) {
        const dx = tg.x - r.x, dy = tg.y - r.y, L = hyp(dx, dy), st = r.speed * dt;
        if (L - st > DRONE_REACH) { r.x += dx / L * st; r.y += dy / L * st; }
        else {
          r.attack = true;
          const k = L > 1e-6 ? DRONE_REACH / L : 0;
          r.ox = -dx * k; r.oy = -dy * k;
          r.next = S.t;
        }
      }
      if (r.attack) {
        r.x = tg.x + r.ox; r.y = tg.y + r.oy;
        if (S.t >= r.next) {
          r.next = S.t + DRONE_TICK;
          const hit = S.rng() < r.acc * (1 - tg.def.evasion);
          recordShot(S, r.x, r.y, tg.x, tg.y, hit ? 1 : 0, r.side, r.owner, tg.id, SHOT_KIND.drone, 0);
          if (hit) { S.arms[r.side].droneHits++; damage(S, S.units[r.owner], tg, r.dmg, r.bypass); }
        }
      }
      if (intercept(S, 1 - r.side, r.x, r.y)) { r.dead = true; S.arms[r.side].dronesDown++; }
    }
    if (S.drones.some((r) => r.dead)) S.drones = S.drones.filter((r) => !r.dead);
  }

  function nearestInRange(S, u) {
    let best = null, bd = u.def.wRange;
    for (const e of S.units) {
      if (e.side === u.side || !visible(e)) continue;
      const dx = Math.abs(e.x - u.x), dy = Math.abs(e.y - u.y);
      if (dx > bd || dy > bd) continue;
      const dd = hyp(dx, dy);
      if (dd <= bd) { bd = dd; best = e; }
    }
    return best;
  }

  const IDLE = -1e9;

  // 1回の斉射。砲門が複数あれば、標的のほかに射程内の敵を近い順に1門ずつ撃ち、余った門は標的に重ねる
  function volley(S, u, tg) {
    fire(S, u, tg);
    const n = mountsOf(u.def);
    if (n <= 1) return;
    const R = u.def.wRange, list = [];
    for (const e of S.units) {
      if (e === tg || e.side === u.side || !visible(e)) continue;
      const dx = Math.abs(e.x - u.x), dy = Math.abs(e.y - u.y);
      if (dx > R || dy > R) continue;
      const dd = hyp(dx, dy);
      if (dd <= R) list.push([dd, e]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < n - 1; i++) {
      const e = i < list.length ? list[i][1] : tg;
      if (e.alive) fire(S, u, e);
    }
  }

  function combat(S) {
    const dt = S.set.dt;
    for (const u of S.units) {
      if (!visible(u)) continue;
      const d = u.def;
      if (hasSecondary(d)) secondary(S, u);
      if (d.wDamage <= 0 || d.wRange <= 0) continue;
      if (u.cd === IDLE) {
        // 撃つ相手がいなかった艦は、相手が射程に入ってから照準の時間を置く（全艦の一斉射を避ける）
        if (!nearestInRange(S, u)) continue;
        u.cd = S.rng() * Math.max(1, d.wInterval) * 0.5;
      }
      u.cd -= dt;
      if (u.cd > 0) continue;
      let tg = u.tgt >= 0 ? S.units[u.tgt] : null;
      if (!tg || !visible(tg) || dist(u, tg) > d.wRange) tg = nearestInRange(S, u);
      if (!tg) { u.cd = IDLE; continue; }
      let guard = 0;
      while (u.cd <= 0 && guard++ < 50) {
        if (!tg.alive) { tg = nearestInRange(S, u); if (!tg) break; }
        volley(S, u, tg);
        u.cd += Math.max(1, d.wInterval);
      }
      if (u.cd < 0) u.cd = 0;
    }
  }

  function upkeep(S) {
    const dt = S.set.dt;
    let stations = null;
    for (const u of S.units) {
      if (!visible(u)) continue;
      const d = u.def;
      if (u.sh < d.shield) u.sh = Math.min(d.shield, u.sh + d.shieldRegen * dt);
      if (u.lock > 0) u.lock = Math.max(0, u.lock - dt * lockRate(u));
      // 弾の補充: 味方の拠点から補充できる距離の中にいるあいだ、1発ずつ
      if (d.sOn && d.sAmmo > 0 && u.ammo < d.sAmmo) {
        if (!stations) stations = S.units.filter((p) => visible(p) && isStation(p.def));
        const R = S.set.resupplyRange;
        if (stations.some((p) => p.side === u.side && Math.abs(p.x - u.x) <= R && Math.abs(p.y - u.y) <= R && dist(p, u) <= R)) {
          u.reload += dt;
          const per = Math.max(1, S.set.resupplyTime);
          while (u.reload >= per && u.ammo < d.sAmmo) { u.ammo++; u.reload -= per; S.arms[u.side].resupplied++; }
        } else u.reload = 0;
      }
    }
  }

  // ---------------------------------------------------------------- 記録・終了

  // 戦力の推移: 初期を100%とした残り（まだ到着していない増援も含め、離脱した艦は除く）
  function recordHist(S) {
    S.hist.t.push(S.t);
    S.sides.forEach((_, k) => {
      S.hist.str[k].push(S.init[k] > 0 ? strengthOf(S, k, true, false) / S.init[k] : 0);
      let c = 0;
      for (const u of S.units) if (u.side === k && u.alive && !u.escaped) c++;
      S.hist.cnt[k].push(c);
    });
  }

  const F = { alive: 1, present: 2, escaped: 4, jump: 8, lock: 16, linked: 32, deploy: 64, field: 128, retreat: 256, lay: 512, wait: 1024, laneJump: 2048, resupply: 4096, charge: 8192, charged: 16384, aboard: 32768, hub: 65536 };

  // 射撃の記録: 1発あたり SHOT_W 個の数値
  //  0-1 撃った位置, 2-3 着いた位置, 4 命中なら1（誘導弾が迎撃されたら -1。シェル型は爆発で損害を受けた敵の数）,
  //  5 撃った側の陣営, 6 時刻（着弾の時刻）, 7 撃った艦の番号, 8 標的の番号（迎撃は -1。シェル型は狙った群れの1隻）,
  //  9 種類（SHOT_KIND）, 10 届くまでの秒数（シェル・誘導弾。ほかは 0）, 11 爆発で沈んだ敵の数
  const SHOT_W = 12;

  // 無人機の記録: 1機あたり DRONE_W 個の数値: 0 番号, 1-2 位置, 3 陣営, 4 攻撃中なら1, 5 標的の番号
  const DRONE_W = 6;

  // 記録フレーム: 1隻あたり FRAME_W 個の数値
  //  0 x, 1 y（ジャンプ中は出発点）, 2 船体耐久の割合, 3 ウォードの割合, 4 フラグ,
  //  5 ロックタイムの実残り秒（リンクで縮んだ値）, 6-7 ジャンプ先または延伸の目標,
  //  8 ロックタイムの残り割合, 9 妨害場（展開中は進み 0〜1、展開後は残り秒。無期限は -1）,
  //  10 副兵装の残弾（弾数の決まりがない、または副兵装がなければ -1）
  const FRAME_W = 11;

  function recordFrame(S) {
    if (S.n % S.recEvery !== 0 && !S.done) { return; }
    const n = S.units.length;
    const a = new Float32Array(n * FRAME_W);
    const tg = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const u = S.units[i], o = i * FRAME_W;
      let fl = 0;
      if (u.alive) fl |= F.alive;
      if (u.present) fl |= F.present;
      if (u.escaped) fl |= F.escaped;
      if (u.jump) { fl |= F.jump; if (u.jump.lane) fl |= F.laneJump; }
      if (u.lock > 0) fl |= F.lock;
      if (u.linked) fl |= F.linked;
      if (u.alive && u.fs === 1) fl |= F.deploy;
      if (u.alive && u.fs === 2) fl |= F.field;
      if (u.retreat) fl |= F.retreat;
      if (u.lay) fl |= F.lay;
      if (u.state === 'wait') fl |= F.wait;
      if (u.resupplying) fl |= F.resupply;
      if (u.charge > 0) fl |= F.charge;
      if (u.charged) fl |= F.charged;
      if (u.aboard >= 0) fl |= F.aboard;
      if (u.hubLane >= 0) fl |= F.hub;
      a[o] = u.jump ? u.px : u.x; a[o + 1] = u.jump ? u.py : u.y;
      a[o + 2] = Math.max(0, u.hp) / u.def.hp;
      a[o + 3] = u.def.shield > 0 ? u.sh / u.def.shield : 0;
      a[o + 4] = fl;
      a[o + 5] = u.lock > 0 ? u.lock / lockRate(u) : 0;
      a[o + 6] = u.jump ? u.jump.x : (u.lay ? u.lay.tx : 0);
      a[o + 7] = u.jump ? u.jump.y : (u.lay ? u.lay.ty : 0);
      a[o + 8] = u.lock > 0 && u.lockMax > 0 ? u.lock / u.lockMax : 0;
      if (u.fs === 1) a[o + 9] = u.def.fieldDeploy > 0 ? Math.min(1, u.ft / u.def.fieldDeploy) : 1;
      else if (u.fs === 2) a[o + 9] = u.def.fieldDuration > 0 ? Math.max(0, u.def.fieldDuration - u.ft) : -1;
      else a[o + 9] = 0;
      a[o + 10] = u.ammo === Infinity ? -1 : u.ammo;
      tg[i] = u.alive ? u.tgt : -1;
    }
    if (S.laneSnapVer !== S.laneVer || !S.laneSnap) {
      S.laneSnap = S.lanes.filter((l) => !l.gone).map((l) => ({ side: l.side, grow: !!l.grow, hub: l.hub != null, pts: l.pts.map((p) => [p.x, p.y]) }));
      S.laneSnapVer = S.laneVer;
    }
    S.shotsFlushed = true;
    S.frames.push({
      t: S.t, u: a, tg,
      fields: S.fields.map((f) => ({ x: f.x, y: f.y, r: f.r, side: f.side })),
      lanes: S.laneSnap,
      shots: S.shots.length ? Float32Array.from(S.shots) : null,   // 前の記録からの射撃すべて（SHOT_W 個ずつ）
      drones: S.drones.length ? Float32Array.from(S.drones.flatMap((r) => [r.id, r.x, r.y, r.side, r.attack ? 1 : 0, r.tg])) : null,
      sharing: S.sharing.slice(),
      retreat: S.sideRetreat.slice(),
      hist: S.hist.t.length - 1,
      ev: S.events.length,
    });
  }

  function sideSummary(S, k) {
    const byType = {};
    for (const u of S.units) {
      if (u.side !== k) continue;
      const b = byType[u.tid] || (byType[u.tid] = { n: 0, lost: 0, escaped: 0, left: 0, pending: 0 });
      b.n++;
      if (!u.alive) b.lost++;
      else if (u.escaped) b.escaped++;
      else if (!u.present) b.pending++;
      else b.left++;
    }
    return {
      byType,
      init: S.init[k],
      onField: S.init[k] > 0 ? strengthOf(S, k, false, false) / S.init[k] : 0,
      kept: S.init[k] > 0 ? strengthOf(S, k, true, true) / S.init[k] : 0,
      dealt: S.units.reduce((a, u) => a + (u.side === k ? u.dealt : 0), 0),
      arms: Object.assign({}, S.arms[k]),
    };
  }

  function finish(S, winner, reason, text) {
    S.done = true;
    const sides = S.sides.map((_, k) => sideSummary(S, k));
    S.result = { winner, reason, text, t: S.t, sides };
    ev(S, 'end', winner < 0 ? 0 : winner, '', text);
    flushEvents(S);
  }

  function checkEnd(S) {
    const standing = S.sides.map((_, k) => S.units.some((u) => u.side === k && u.alive && !u.escaped));
    const nStand = standing.filter(Boolean).length;
    const nm = (k) => S.sides[k].name;
    const why = (k) => {
      const esc = S.units.some((u) => u.side === k && u.escaped);
      return esc ? 'が戦場から撤退' : 'が全滅';
    };
    if (nStand <= 1) {
      const w = standing.indexOf(true);
      if (w < 0) { finish(S, -1, 'mutual', '引き分け（両軍とも戦場に残っていない）'); return; }
      const l = 1 - w;
      const esc = S.units.some((u) => u.side === l && u.escaped);
      finish(S, w, esc ? 'retreat' : 'annihilation', nm(w) + ' の勝ち（' + nm(l) + why(l) + '）');
      return;
    }
    if (S.t >= S.set.timeLimit - 1e-9) {
      const r = S.sides.map((_, k) => (S.init[k] > 0 ? strengthOf(S, k, true, true) / S.init[k] : 0));
      const pct = (v) => Math.round(v * 100) + '%';
      const tail = '（残存戦力 ' + nm(0) + ' ' + pct(r[0]) + ' / ' + nm(1) + ' ' + pct(r[1]) + '）';
      if (Math.abs(r[0] - r[1]) < S.set.drawMargin) finish(S, -1, 'time', '時間切れで引き分け' + tail);
      else {
        const w = r[0] > r[1] ? 0 : 1;
        finish(S, w, 'time', '時間切れ判定で ' + nm(w) + ' の勝ち' + tail);
      }
    }
  }

  // ---------------------------------------------------------------- 1刻み

  function step(S) {
    if (S.done) return;
    S.t += S.set.dt;
    S.n++;
    // 射撃の記録は、フレームに書き出すまで刻みをまたいでためる（記録が数刻みおきでも取りこぼさない）
    if (S.shotsFlushed || !S.record) { S.shots = []; S.shotsFlushed = false; }
    spawn(S);
    finishJumps(S);
    updateHangars(S);
    updateFields(S);
    rebuildLanes(S);
    updateSharing(S, false);
    updateContacts(S);
    updateAttacked(S);
    updateLinks(S);
    sideRetreatCheck(S);
    for (const u of S.units) { u.ox = u.x; u.oy = u.y; }
    for (const u of S.units) think(S, u);
    separate(S);
    // この刻みの速さ（シェルの見越しに使う）
    for (const u of S.units) { u.vx = (u.x - u.ox) / S.set.dt; u.vy = (u.y - u.oy) / S.set.dt; }
    updateHubs(S);
    rebuildLanes(S);
    combat(S);
    updateProjectiles(S);
    updateDrones(S);
    upkeep(S);
    flushEvents(S);
    recordHist(S);
    checkEnd(S);
    if (S.record) recordFrame(S);
  }

  function runUntil(S, t) {
    while (!S.done && S.t < t - 1e-9) step(S);
    return S;
  }

  function runToEnd(S) {
    let guard = 0;
    while (!S.done && guard++ < 1e7) step(S);
    return S.result;
  }

  // 複数回試行（シードを変えて回す）。UI からは少しずつ呼ぶ
  function runOnce(scn, seed) {
    const S = createSim(scn, { seed, record: false });
    runToEnd(S);
    return S.result;
  }

  const api = {
    AI, PRIORITY, MOVE, JUMP, SHAPES, SHARING, FIELD_MODE, S_KIND, SHOT_KIND, FLAGS: F, FRAME_W, SHOT_W, DRONE_W,
    DEFAULT_TYPE, DEFAULT_SETTINGS, DEFAULT_SIDES, TYPE_FIELDS, SETTING_FIELDS, SIDE_FIELDS,
    normalizeType, normalizeScenario, createSim, step, runUntil, runToEnd, runOnce,
    fmtTime, fmtMin, isKey, dpsOf, clone, hasSecondary,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SimEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
