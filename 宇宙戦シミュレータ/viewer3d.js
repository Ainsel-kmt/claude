/* 宇宙戦 3Dビューア
 *
 * 2Dの画面と同じ engine.js で戦いを計算し直し（シナリオとシードが同じなら結果も同じ）、
 * 記録フレームを3Dで再生する。three.js は CDN からモジュールで読む（ネット接続が必要）。
 *
 * 座標: 計算の (x, y) を3Dの (x, z) に置く。3Dの y（高さ）は見た目だけのずれ（computeHeights）。
 * 単位は光秒。艦の大きさは見やすさのために誇張している（viewer3d-models.js の BASE_LENGTH）。
 */
(function () {
  'use strict';

  const E = window.SimEngine, P = window.SimPresets;
  const FW = E.FRAME_W, SW = E.SHOT_W, FL = E.FLAGS;
  const HANDOFF = 'uchusen-3d-handoff';
  const OPTS_KEY = 'uchusen-3d-opts';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmtT = E.fmtTime;

  let THREE, A; // three.js 本体と追加部品
  const V = {
    S: null, R: null, src: null,
    vt: 0, playing: false, speed: 60, last: 0, realT: 0,
    cam: 'director', follow: -1, selected: -1,
    opts: { letterbox: true, captions: true, hud: true, autohide: true, beams: true, fields: true, lanes: true, places: true, unitLabels: false, locks: false, nebula: true, film: true, bloom: 1, height: 1, spread: 1, shipScale: 1 },
  };

  // ---------------------------------------------------------------- 起動

  function loading(msg, frac) {
    $('loading').classList.remove('gone');
    if (msg != null) $('loadMsg').textContent = msg;
    if (frac != null) $('loadBar').style.width = Math.round(clamp(frac, 0, 1) * 100) + '%';
  }
  function loaded() { $('loading').classList.add('gone'); }
  function fatal(msg) {
    loading(null, 0);
    $('loadErr').hidden = false;
    $('loadErr').textContent = msg;
  }
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  async function boot() {
    try { Object.assign(V.opts, JSON.parse(localStorage.getItem(OPTS_KEY) || '{}')); } catch (e) { /* 保存できない環境 */ }
    loading('three.js を読み込んでいます…', 0.05);
    try {
      THREE = await import('three');
      const mods = await Promise.all([
        import('three/addons/controls/OrbitControls.js'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/exporters/GLTFExporter.js'),
        import('three/addons/utils/BufferGeometryUtils.js'),
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js'),
        import('three/addons/postprocessing/ShaderPass.js'),
      ]);
      A = Object.assign({}, ...mods);
    } catch (e) {
      fatal('three.js を読み込めませんでした。3Dビューアはインターネットにつながっている必要があります。（' + e.message + '）');
      return;
    }
    initTemps();
    V.models = window.ShipModelKit(THREE, { mergeGeometries: A.mergeGeometries, GLTFLoader: A.GLTFLoader, GLTFExporter: A.GLTFExporter });
    loading('モデルを読み込んでいます…', 0.1);
    V.modelErrors = await loadModelOverrides();
    initRenderer();
    initBackdrop();
    initEffects();
    bindUi();
    applyOpts();
    // サーバー経由（公開ページなど）では、2Dの画面は index.html という名前とは限らない
    if (/^https?:/.test(location.protocol)) $('backLink').href = './';
    const src = pickSource();
    await loadSource(src);
    V.last = performance.now();
    requestAnimationFrame(loop);
  }

  // models/models.js（ファイルを直接開くとき）か、models/models.json（サーバーから開くとき）
  async function loadModelOverrides() {
    if (window.SHIP_MODELS && window.SHIP_MODELS.entries && Object.keys(window.SHIP_MODELS.entries).length) {
      return V.models.loadPacked(window.SHIP_MODELS);
    }
    if (!/^https?:/.test(location.protocol)) return [];
    const errors = [];
    try {
      const res = await fetch('models/models.json', { cache: 'no-cache' });
      if (!res.ok) return [];
      const cfg = await res.json();
      for (const [key, e] of Object.entries(cfg.entries || {})) {
        try {
          const r = await fetch('models/' + e.file);
          if (!r.ok) throw new Error(e.file + ' が見つかりません');
          await V.models.register(key, Object.assign({}, e, { data: await r.arrayBuffer(), name: e.file }));
        } catch (err) { errors.push(key + ': ' + err.message); }
      }
    } catch (e) { /* models.json がなければ既定のモデル */ }
    return errors;
  }

  // ---------------------------------------------------------------- 表示するシナリオ

  function presetSource(id, seed) {
    const p = P.SCENARIOS.find((s) => s.id === id) || P.SCENARIOS.find((s) => s.id === 'grand') || P.SCENARIOS[0];
    const scn = p.make();
    return { scenario: scn, seed: seed || (scn.settings && scn.settings.seed) || 1, t: 0, from: 'プリセット「' + p.label + '」' };
  }
  function handoffSource() {
    try {
      const o = JSON.parse(localStorage.getItem(HANDOFF) || 'null');
      if (o && o.scenario && o.scenario.units) return { scenario: o.scenario, seed: o.seed || 1, t: o.t || 0, from: '2Dの画面から受け取ったシナリオ' };
    } catch (e) { /* なし */ }
    return null;
  }
  function pickSource() {
    const q = new URLSearchParams(location.search);
    if (q.get('preset')) return presetSource(q.get('preset'), +q.get('seed') || 0);
    return handoffSource() || presetSource('grand', 0);
  }

  async function loadSource(src) {
    V.playing = false;
    loading('戦いを計算しています…', 0.15);
    $('loadErr').hidden = true;
    const S = E.createSim(src.scenario, { seed: src.seed, record: true });
    while (!S.done) {
      const t0 = performance.now();
      while (!S.done && performance.now() - t0 < 30) E.step(S);
      loading(null, 0.15 + 0.7 * S.t / S.set.timeLimit);
      await nextFrame();
    }
    loading('場面を組み立てています…', 0.9);
    await nextFrame();
    V.S = S;
    V.src = src;
    V.R = buildReplay(S);
    buildWorld();
    V.vt = clamp(src.t || 0, 0, V.R.end);
    V.follow = -1; V.selected = -1;
    $('card').hidden = true;
    resetDirector();
    setupTimeline();
    showTitle();
    renderSourceInfo();
    renderModelTable();
    loaded();
    if (V.modelErrors && V.modelErrors.length) toast('読めなかったモデル: ' + V.modelErrors.join(' / '));
  }

  // ---------------------------------------------------------------- 再生用のデータ

  // 高さ（見た目だけ）: 同じ陣営・艦種の部隊ごとに、役割で決まる層に2〜3段の段差を付け、艦ごとに乱数のずれを足す
  function computeHeights(S) {
    const n = S.units.length;
    const h = new Float32Array(n);
    const rnd = (i, k) => {
      let a = Math.imul((i + 1) * 2654435761 + k * 97 + S.seed * 7919, 1);
      a ^= a >>> 15; a = Math.imul(a, 2246822519); a ^= a >>> 13; a = Math.imul(a, 3266489917); a ^= a >>> 16;
      return (a >>> 0) / 4294967296;
    };
    const ROLE = { node: 0.1, guard: 0, comms: -0.6, quiet: 0.4, picket: 1.0, narm: 0, garmes: 0.5, elda: -0.5 };
    const role = (u) => {
      if (ROLE[u.tid] != null) return ROLE[u.tid];
      const d = u.def;
      if (d.commsOn) return -0.6; if (d.layerOn) return -0.5; if (d.fieldOn) return 0.4; if (d.linkOn) return 0.1;
      if (d.sensor >= 200 && d.speed > 0.06) return 1.0;
      return 0;
    };
    const groups = new Map();
    S.units.forEach((u, i) => {
      const key = u.side + '|' + u.tid;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    });
    for (const list of groups.values()) {
      const tiers = list.length >= 12 ? 3 : list.length >= 4 ? 2 : 1;
      list.forEach((i, k) => {
        const u = S.units[i];
        if (u.def.speed <= 0 && u.def.jump === 'none') { h[i] = 0; return; }
        const tier = tiers > 1 ? (k % tiers) - (tiers - 1) / 2 : 0;
        h[i] = role(u) + tier * 0.38 + (rnd(i, 1) - 0.5) * 0.3;
      });
    }
    return h;
  }

  function buildReplay(S) {
    const F = S.frames, n = S.units.length;
    const R = { S, F, n, end: S.t, flashes: [], captions: [], marks: S.scn.marks || [] };
    R.h = computeHeights(S);
    // 射撃（時刻順）。シェルと誘導弾は飛んでいる様子を見せるので R.proj に分ける（着弾の時刻順）
    const K = E.SHOT_KIND;
    const isProj = (k) => k === K.shell || k === K.missile;
    let nS = 0, nP = 0;
    for (const f of F) if (f.shots) for (let i = 0; i < f.shots.length; i += SW) { if (isProj(f.shots[i + 9])) nP++; else nS++; }
    R.shots = new Float32Array(nS * SW); R.proj = new Float32Array(nP * SW);
    let oS = 0, oP = 0;
    R.maxFlight = 0;
    for (const f of F) if (f.shots) for (let i = 0; i < f.shots.length; i += SW) {
      const row = f.shots.subarray(i, i + SW);
      if (isProj(row[9])) { R.proj.set(row, oP); oP += SW; R.maxFlight = Math.max(R.maxFlight, row[10]); }
      else { R.shots.set(row, oS); oS += SW; }
    }
    R.nShots = nS; R.nProj = nP;
    // 状態の変わり目から演出の出来事を作る
    const add = (e) => R.flashes.push(e);
    const maxMove = (u, dt) => u.def.speed * dt * 1.6 + 0.6;
    for (let k = 1; k < F.length; k++) {
      const f0 = F[k - 1], f1 = F[k], dt = f1.t - f0.t;
      for (let i = 0; i < n; i++) {
        const u = S.units[i], o0 = i * FW;
        const a = f0.u[o0 + 4], b = f1.u[o0 + 4];
        const x1 = f1.u[o0], y1 = f1.u[o0 + 1];
        if ((a & FL.alive) && !(b & FL.alive) && (b & FL.present)) {
          add({ kind: 'death', t: u.diedAt >= 0 ? u.diedAt : f1.t, i, x: x1, y: y1, big: u.def.cost >= 8 || u.def.size >= 1.5 });
          if (a & FL.field) add({ kind: 'fieldDown', t: f1.t, i, x: x1, y: y1, r: u.def.fieldRadius });
        }
        if (!(b & FL.alive)) continue;
        if (!(a & FL.present) && (b & FL.present)) add({ kind: 'arrive', t: u.appear || f1.t, i, x: x1, y: y1, lane: u.def.jump !== 'free' });
        if (!(a & FL.jump) && (b & FL.jump)) {
          add({ kind: (b & FL.laneJump) ? 'laneDepart' : 'depart', t: f1.t - Math.min(dt, S.set.dt), i, x: x1, y: y1, tx: f1.u[o0 + 6], ty: f1.u[o0 + 7] });
        }
        if ((a & FL.jump) && !(b & FL.jump) && !(b & FL.escaped)) add({ kind: (a & FL.laneJump) ? 'laneArrive' : 'arrive', t: f1.t, i, x: x1, y: y1, lane: !!(a & FL.laneJump) });
        if (!(a & FL.escaped) && (b & FL.escaped)) add({ kind: 'escape', t: f1.t, i, x: f0.u[o0], y: f0.u[o0 + 1] });
        if (!(a & FL.field) && (b & FL.field)) add({ kind: 'fieldUp', t: f1.t, i, x: x1, y: y1, r: u.def.fieldRadius });
        if ((a & FL.field) && !(b & FL.field) && (b & FL.alive)) add({ kind: 'fieldDown', t: f1.t, i, x: x1, y: y1, r: u.def.fieldRadius });
        // 記録の間に済んだレーンジャンプ（フラグが残らない）: 大きく位置が飛んだら閃光でつなぐ
        if ((a & FL.present) && !(a & FL.jump) && !(b & FL.jump) && !(a & FL.escaped)) {
          const x0 = f0.u[o0], y0 = f0.u[o0 + 1];
          if (Math.hypot(x1 - x0, y1 - y0) > maxMove(u, dt)) add({ kind: 'laneDepart', t: f1.t - S.set.dt, i, x: x0, y: y0, tx: x1, ty: y1 });
        }
      }
    }
    R.flashes.sort((p, q) => p.t - q.t);
    // 字幕: 主な出来事（撃沈は要艦・大型艦だけ）
    const KEYKIND = { arrive: 1, appear: 1, fieldStart: 1, fieldUp: 1, fieldFail: 1, fieldDown: 1, layStart: 1, layEnd: 1, layStop: 1, commsDown: 1, commsUp: 1, retreatAll: 1, relief: 1, stationLost: 1, end: 1 };
    const bigType = (name) => Object.values(S.scn.types).some((t) => t.name && name.indexOf(t.name) >= 0 && (E.isKey(t) || t.cost >= 8));
    for (const e of S.events) {
      if (e.minor) continue;
      if (KEYKIND[e.kind] || (e.kind === 'kill' && bigType(e.text))) R.captions.push({ t: e.t, text: e.text, side: e.side, kind: e.kind });
    }
    // 戦場の範囲（俯瞰の視点用）
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const grow = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    for (const f of [F[0], F[F.length - 1]]) for (let i = 0; i < n; i++) if (f.u[i * FW + 4] & FL.present) grow(f.u[i * FW], f.u[i * FW + 1]);
    for (const l of S.scn.lanes || []) for (const p of l.pts) grow(p[0], p[1]);
    for (const m of R.marks) grow(m.x, m.y);
    if (!isFinite(x0)) { x0 = y0 = -50; x1 = y1 = 50; }
    R.bounds = { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0, 20) };
    return R;
  }

  // 時刻 t のフレームの位置（k: 直前のフレーム、a: 次のフレームまでの割合）
  function frameAt(t) {
    const F = V.R.F;
    let lo = 0, hi = F.length - 1;
    if (t >= F[hi].t) return { k: hi, a: 0 };
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (F[mid].t <= t) lo = mid; else hi = mid - 1; }
    const f0 = F[lo], f1 = F[Math.min(lo + 1, F.length - 1)];
    return { k: lo, a: f1.t > f0.t ? clamp((t - f0.t) / (f1.t - f0.t), 0, 1) : 0 };
  }

  // ---------------------------------------------------------------- 描画の土台

  let renderer, scene, camera, composer, bloomPass, filmPass, controls;
  const world = { batches: [], fieldMeshes: [], laneGroup: null, laneKey: '', unitState: [] };

  function initRenderer() {
    const stage = $('stage');
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.02, 8000);
    camera.position.set(0, 40, 80);
    controls = new A.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enabled = false;
    controls.zoomSpeed = 1.2;

    // 光: 恒星（暖色）からの平行光と、冷たい環境光
    const sunDir = new THREE.Vector3(-0.62, 0.32, -0.72).normalize();
    V.sunDir = sunDir;
    const key = new THREE.DirectionalLight(0xfff1dc, 1.6);
    key.position.copy(sunDir).multiplyScalar(100);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6f9cff, 0.9);
    rim.position.set(0.6, -0.2, 0.8).multiplyScalar(100);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0x324a6e, 0x0a0806, 0.45));

    // 後処理: 光のにじみ → 色調 → フィルムの質感
    composer = new A.EffectComposer(renderer);
    composer.addPass(new A.RenderPass(scene, camera));
    bloomPass = new A.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.55, 0.92);
    composer.addPass(bloomPass);
    composer.addPass(new A.OutputPass());
    filmPass = new A.ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.035 }, vignette: { value: 0.9 }, aberration: { value: 0.006 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float vignette; uniform float aberration; varying vec2 vUv;',
        'float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }',
        'void main(){',
        '  vec2 d = vUv - 0.5; float ab = aberration * dot(d, d) * 4.0;',
        '  vec3 c = vec3(texture2D(tDiffuse, vUv + d * ab).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * ab).b);',
        '  float v = smoothstep(0.95, 0.25, length(d * vec2(1.0, 0.8)) * 1.25); c *= mix(1.0, v, vignette);',
        '  c += (rnd(vUv * 731.0 + fract(time) * 97.0) - 0.5) * grain;',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'].join('\n'),
    });
    composer.addPass(filmPass);
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // 背景: 星雲の天球・星・恒星。いずれもカメラと一緒に動き、いつも無限遠に見える
  function initBackdrop() {
    const g = new THREE.Group();
    g.renderOrder = -10;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { sun: { value: V.sunDir }, strength: { value: 1 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform vec3 sun; uniform float strength; varying vec3 vDir;',
        'float h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
        'float n(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),',
        '             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }',
        'float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }',
        'void main(){',
        '  vec3 d = normalize(vDir);',
        '  float band = exp(-pow(d.y * 2.2 + 0.25 * sin(d.x * 3.0), 2.0));',
        '  float neb = fbm(d * 3.2) * 0.65 + fbm(d * 7.0 + 3.1) * 0.35;',
        '  neb = smoothstep(0.42, 0.95, neb) * band;',
        '  vec3 col = mix(vec3(0.05, 0.08, 0.20), vec3(0.32, 0.12, 0.30), smoothstep(0.3, 0.9, fbm(d * 2.0 + 7.0)));',
        '  col = mix(col, vec3(0.55, 0.30, 0.12), smoothstep(0.75, 1.0, dot(d, sun)) * 0.6);',
        '  float glow = pow(max(dot(d, sun), 0.0), 18.0) * 0.6;',
        '  vec3 c = col * neb * 0.55 + vec3(1.0, 0.82, 0.6) * glow + vec3(0.010, 0.014, 0.024);',
        '  gl_FragColor = vec4(c * strength, 1.0);',
        '}'].join('\n'),
    }));
    sky.scale.setScalar(5000);
    sky.renderOrder = -10;
    g.add(sky);
    // 星
    const N = 7000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos[i * 3] = s * Math.cos(th) * 4500; pos[i * 3 + 1] = u * 4500; pos[i * 3 + 2] = s * Math.sin(th) * 4500;
      const tint = Math.random();
      const c = tint < 0.2 ? [0.7, 0.8, 1.2] : tint < 0.35 ? [1.2, 1.0, 0.75] : [1, 1, 1];
      const b = Math.pow(Math.random(), 3) * 1.6 + 0.25;
      col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
      size[i] = Math.random() < 0.02 ? 2.6 : 1 + Math.random() * 0.9;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('gcolor', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('gsize', new THREE.BufferAttribute(size, 1));
    const stars = new THREE.Points(sg, pointMaterial(false));
    stars.renderOrder = -9;
    stars.frustumCulled = false;
    g.add(stars);
    // 恒星
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.flare(), color: new THREE.Color(3.5, 2.8, 2.0), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    sun.position.copy(V.sunDir).multiplyScalar(4000);
    sun.scale.setScalar(380);
    sun.renderOrder = -8;
    g.add(sun);
    scene.add(g);
    V.backdrop = g;
    V.sky = sky;
  }

  // 画面上で一定の大きさの点（星・遠くの艦のきらめき・破片）
  function pointMaterial(attenuate) {
    return new THREE.ShaderMaterial({
      uniforms: { pxRatio: { value: renderer.getPixelRatio() }, scale: { value: 1 } },
      vertexShader: [
        'attribute vec3 gcolor; attribute float gsize; varying vec3 vC; uniform float pxRatio; uniform float scale;',
        'void main(){ vC = gcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;',
        attenuate ? '  gl_PointSize = clamp(gsize * scale * pxRatio * 300.0 / -mv.z, 1.0, 40.0);' : '  gl_PointSize = gsize * pxRatio;',
        '}'].join('\n'),
      fragmentShader: 'varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vC * a * a, a); }',
      transparent: true, depthWrite: false, depthTest: !!attenuate, blending: THREE.AdditiveBlending,
    });
  }

  // 演出用のテクスチャ（canvas で作る）
  const texCache = {};
  const tex = {
    flare: () => texCache.flare || (texCache.flare = canvasTex(128, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.12, 'rgba(255,255,255,0.85)'); r.addColorStop(0.35, 'rgba(255,255,255,0.25)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    })),
    ring: () => texCache.ring || (texCache.ring = canvasTex(256, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, s * 0.36, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.55, 'rgba(255,255,255,0.9)'); r.addColorStop(0.75, 'rgba(255,255,255,0.25)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    })),
    spark: () => texCache.spark || (texCache.spark = canvasTex(128, (g, s) => {
      g.translate(s / 2, s / 2);
      for (let k = 0; k < 8; k++) {
        g.rotate(Math.PI / 4);
        const L = k % 2 ? s * 0.28 : s * 0.48;
        const gr = g.createLinearGradient(0, 0, L, 0);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, -1.5, L, 3);
      }
      const r = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.18);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(-s / 2, -s / 2, s, s);
    })),
    smoke: () => texCache.smoke || (texCache.smoke = canvasTex(128, (g, s) => {
      for (let k = 0; k < 26; k++) {
        const x = s / 2 + (Math.random() - 0.5) * s * 0.42, y = s / 2 + (Math.random() - 0.5) * s * 0.42, rr = s * (0.12 + Math.random() * 0.2);
        const r = g.createRadialGradient(x, y, 0, x, y, rr);
        r.addColorStop(0, 'rgba(255,255,255,0.32)'); r.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = r; g.fillRect(0, 0, s, s);
      }
    })),
  };
  function canvasTex(s, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    draw(c.getContext('2d'), s);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---------------------------------------------------------------- 戦場の組み立て

  const SIDE_BEAM = () => [new THREE.Color(0.55, 0.85, 2.4), new THREE.Color(2.6, 0.95, 0.3)];
  const sideCss = (k) => (k === 0 ? 'var(--human)' : 'var(--zairen)');

  function disposeWorld() {
    for (const b of world.batches) for (const m of b.meshes) { scene.remove(m); m.dispose(); }
    world.batches = [];
    if (world.glints) { scene.remove(world.glints); world.glints.geometry.dispose(); world.glints = null; }
    for (const m of world.fieldMeshes) scene.remove(m);
    world.fieldMeshes = [];
    if (world.laneGroup) { scene.remove(world.laneGroup); world.laneGroup.traverse((o) => o.geometry && o.geometry.dispose()); world.laneGroup = null; }
    world.laneKey = '';
    $('labels').innerHTML = '';
  }

  function buildWorld() {
    disposeWorld();
    const S = V.S, R = V.R;
    // 艦: 陣営×艦種ごとにまとめて描く（InstancedMesh）
    const groups = new Map();
    S.units.forEach((u, i) => {
      const key = u.side + '|' + u.tid;
      if (!groups.has(key)) groups.set(key, { side: u.side, tid: u.tid, def: u.def, units: [] });
      groups.get(key).units.push(i);
    });
    for (const g of groups.values()) {
      const model = V.models.modelFor(g.tid, g.def, g.side);
      const meshes = model.parts.map((p) => {
        const m = new THREE.InstancedMesh(p.geometry, p.material, g.units.length);
        m.count = 0;
        m.frustumCulled = false;
        m.userData.batch = null;
        scene.add(m);
        return m;
      });
      const b = { side: g.side, tid: g.tid, def: g.def, units: g.units, model, meshes, shown: [] };
      for (const m of meshes) m.userData.batch = b;
      world.batches.push(b);
    }
    // 遠くの艦のきらめき
    const n = S.units.length;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    gg.setAttribute('gcolor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    gg.setAttribute('gsize', new THREE.BufferAttribute(new Float32Array(n), 1));
    world.glints = new THREE.Points(gg, pointMaterial(false));
    world.glints.material.depthTest = true;
    world.glints.frustumCulled = false;
    scene.add(world.glints);
    // 艦ごとの向きの記憶
    world.unitState = S.units.map(() => ({ q: new THREE.Quaternion(), init: false, pos: new THREE.Vector3(), vis: false }));
    // 横の散らし: 艦ごとの向きと距離（円盤の中に一様に）と、いまの値
    world.off = new Float32Array(S.units.length * 2);
    world.raw = new Float32Array(S.units.length * 2);
    world.rawOk = new Uint8Array(S.units.length);
    world.spreadDir = new Float32Array(S.units.length * 2);
    S.units.forEach((u, i) => {
      const a = hashf(i, 11) * Math.PI * 2, f = Math.sqrt(0.05 + 0.95 * hashf(i, 12));
      world.spreadDir[i * 2] = Math.cos(a) * f; world.spreadDir[i * 2 + 1] = Math.sin(a) * f;
    });
    world.spreadCut = true;
    // 地名・要艦の名前の札
    const lab = $('labels');
    world.placeLabels = R.marks.map((m) => { const s = document.createElement('span'); s.textContent = m.text; lab.appendChild(s); return { el: s, x: m.x, y: m.y }; });
    world.unitLabels = [];
    S.units.forEach((u, i) => {
      if (!E.isKey(u.def) && u.def.cost < 8) return;
      const s = document.createElement('span');
      s.className = 'unit';
      s.textContent = u.def.name;
      s.style.color = u.side === 0 ? '#9cc8ff' : '#ffb27a';
      lab.appendChild(s);
      world.unitLabels.push({ el: s, i });
    });
  }

  // ---------------------------------------------------------------- 毎コマの更新: 艦

  // 使い回しの作業用（three.js を読み込んだあとに initTemps で作る）
  let tmpM, tmpV, tmpV2, tmpS, dummy, COL;
  function initTemps() {
    tmpM = new THREE.Matrix4(); tmpV = new THREE.Vector3(); tmpV2 = new THREE.Vector3(); tmpS = new THREE.Vector3(); dummy = new THREE.Object3D();
    cam.look = new THREE.Vector3(); cam.pos = new THREE.Vector3();
    COL = {
      flash: C(3.2, 2.8, 2.2), fire: C(2.6, 1.0, 0.25), smoke: C(0.25, 0.2, 0.18), shock: C(1.2, 1.1, 1.0),
      shield: C(0.6, 1.4, 2.6), spark: C(3, 1.6, 0.5), jumpH: C(1.0, 1.7, 3.2), jumpZ: C(3.2, 1.4, 0.4), field: C(0.4, 2.2, 1.5),
    };
  }

  // 艦 i の時刻 vt での位置（見えないときは null）
  // 計算上の位置（平面）。見えない艦は false
  const XY = { x: 0, y: 0 };
  function unitXY(i, fa) {
    const R = V.R, F = R.F, f0 = F[fa.k], f1 = F[Math.min(fa.k + 1, F.length - 1)], o = i * FW, u = R.S.units[i];
    const a = f0.u[o + 4];
    if (!(a & FL.alive) || !(a & FL.present) || (a & FL.escaped) || (a & FL.jump)) return false;
    if (u.diedAt >= 0 && V.vt >= u.diedAt) return false;
    let x = f0.u[o], y = f0.u[o + 1];
    const b = f1.u[o + 4];
    if ((b & FL.present) && !(b & FL.jump) && !(b & FL.escaped)) {
      const x1 = f1.u[o], y1 = f1.u[o + 1];
      if (Math.hypot(x1 - x, y1 - y) <= u.def.speed * (f1.t - f0.t) * 1.6 + 0.6) { x = lerp(x, x1, fa.a); y = lerp(y, y1, fa.a); }
    }
    XY.x = x; XY.y = y;
    return true;
  }

  // 見せる位置: 計算上の位置に、高さと横の散らし（updateSpread）を足したもの
  function unitPos(i, fa, out) {
    if (!unitXY(i, fa)) return null;
    return out.set(XY.x + world.off[i * 2], V.R.h[i] * V.opts.height, XY.y + world.off[i * 2 + 1]);
  }

  // 横の散らし（見た目だけ）: 計算では大群がほぼ一点に寄ることがあり、そのままだと高さの段だけで縦に積み重なって見える。
  // まわり SPREAD_CELL 以内に何隻いるかを数え、多いほど広い水平の円盤に散らす（艦ごとに決まった向きと距離）
  const SPREAD_CELL = 0.4, SPREAD_GAP = 0.22, SPREAD_MAX = 3;
  function updateSpread(fa, dtReal) {
    const R = V.R, n = R.n, off = world.off, raw = world.raw, ok = world.rawOk, dir = world.spreadDir;
    const grid = new Map();
    const cell = (x, y) => Math.floor(x / SPREAD_CELL) + ',' + Math.floor(y / SPREAD_CELL);
    for (let i = 0; i < n; i++) {
      ok[i] = 0;
      if (R.S.units[i].def.speed <= 0 || !unitXY(i, fa)) continue;
      raw[i * 2] = XY.x; raw[i * 2 + 1] = XY.y; ok[i] = 1;
      const k = cell(XY.x, XY.y);
      const l = grid.get(k);
      if (l) l.push(i); else grid.set(k, [i]);
    }
    const k = cut() ? 1 : 1 - Math.exp(-dtReal * 3);
    const amount = SPREAD_GAP * V.opts.spread * Math.sqrt(V.opts.shipScale);
    for (let i = 0; i < n; i++) {
      if (!ok[i]) continue;
      const x = raw[i * 2], y = raw[i * 2 + 1];
      const cx = Math.floor(x / SPREAD_CELL), cy = Math.floor(y / SPREAD_CELL);
      let cnt = 0;
      for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) {
        const l = grid.get((cx + ax) + ',' + (cy + ay));
        if (!l) continue;
        for (const j of l) if (Math.abs(raw[j * 2] - x) <= SPREAD_CELL && Math.abs(raw[j * 2 + 1] - y) <= SPREAD_CELL) cnt++;
      }
      const r = Math.min(SPREAD_MAX, amount * Math.sqrt(Math.max(0, cnt - 1)));
      off[i * 2] += (dir[i * 2] * r - off[i * 2]) * k;
      off[i * 2 + 1] += (dir[i * 2 + 1] * r - off[i * 2 + 1]) * k;
    }
    world.spreadCut = false;
  }
  const cut = () => world.spreadCut;

  function updateShips(fa, dtReal) {
    const R = V.R, F = R.F, f0 = F[fa.k], f1 = F[Math.min(fa.k + 1, F.length - 1)];
    const camPos = camera.position;
    const pxPerUnit = window.innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
    const glPos = world.glints.geometry.attributes.position.array, glCol = world.glints.geometry.attributes.gcolor.array, glSize = world.glints.geometry.attributes.gsize.array;
    const SC = [[0.55, 0.8, 1.6], [1.7, 0.75, 0.3]];
    const smooth = 1 - Math.exp(-dtReal * 5);
    for (const b of world.batches) {
      let c = 0;
      b.shown.length = 0;
      const len = b.model.length * V.opts.shipScale;
      for (const i of b.units) {
        const st = world.unitState[i];
        const p = unitPos(i, fa, st.pos);
        st.vis = !!p;
        const go = i * 3;
        if (!p) { glSize[i] = 0; continue; }
        // 向き: 動いていれば進む向き、止まっていれば標的の向き
        const o = i * FW;
        let dx = f1.u[o] - f0.u[o], dz = f1.u[o + 1] - f0.u[o + 1];
        if (Math.hypot(dx, dz) < 0.02 || Math.hypot(dx, dz) > 30) {
          const tg = f0.tg[i];
          if (tg >= 0 && (f0.u[tg * FW + 4] & FL.alive)) { dx = f0.u[tg * FW] - f0.u[o]; dz = f0.u[tg * FW + 1] - f0.u[o + 1]; }
          else { dx = 0; dz = 0; }
        }
        if (dx || dz) {
          dummy.position.set(0, 0, 0);
          dummy.lookAt(dx, 0, dz);
          if (!st.init) { st.q.copy(dummy.quaternion); st.init = true; } else st.q.slerp(dummy.quaternion, smooth);
        } else if (!st.init) { st.q.identity(); st.init = true; }
        tmpS.setScalar(len);
        tmpM.compose(p, st.q, tmpS);
        for (const m of b.meshes) m.setMatrixAt(c, tmpM);
        b.shown[c] = i;
        c++;
        // 遠くでは光る点で見せる（艦の見かけの大きさが小さいほど明るく）
        const dist = p.distanceTo(camPos);
        const px = len / Math.max(dist, 0.01) * pxPerUnit;
        const g = clamp((10 - px) / 7, 0, 1);
        glPos[go] = p.x; glPos[go + 1] = p.y; glPos[go + 2] = p.z;
        const sc = SC[b.side];
        glCol[go] = sc[0] * g; glCol[go + 1] = sc[1] * g; glCol[go + 2] = sc[2] * g;
        glSize[i] = g > 0 ? 3 + Math.min(3, b.def.size) : 0;
      }
      for (const m of b.meshes) { m.count = c; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
    }
    const ga = world.glints.geometry.attributes;
    ga.position.needsUpdate = true; ga.gcolor.needsUpdate = true; ga.gsize.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 妨害場とレーン

  function fieldMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0.18, 0.82, 0.6) }, time: { value: 0 }, opacity: { value: 1 }, pulse: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: [
        'uniform vec3 color; uniform float time; uniform float opacity; uniform float pulse; varying vec3 vN; varying vec3 vV; varying vec3 vP;',
        'void main(){',
        '  float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = pow(f, 2.2);',
        '  float lat = sin(vP.y * 26.0 - time * 0.7) * 0.5 + 0.5; float lon = sin(atan(vP.z, vP.x) * 18.0 + time * 0.25) * 0.5 + 0.5;',
        '  float grid = smoothstep(0.94, 1.0, max(lat, lon)) * 0.25;',
        '  float rim = pow(f, 2.0);',
        '  float a = (0.008 + rim * 0.16 + grid * rim * 0.5 + pulse * 0.35 * f) * opacity;',
        '  gl_FragColor = vec4(color * (0.5 + rim * 0.9 + pulse * 0.6), a);',
        '}'].join('\n'),
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
  }
  const unitSphere = () => world.sphereGeo || (world.sphereGeo = new THREE.SphereGeometry(1, 64, 32));

  function updateFields(fa) {
    const F = V.R.F, f0 = F[fa.k];
    const list = [];
    if (V.opts.fields) {
      for (const f of f0.fields) list.push({ x: f.x, y: f.y, r: f.r, deploy: 0 });
      // 展開中の妨害場（進み具合で膨らむ）
      V.R.S.units.forEach((u, i) => {
        const o = i * FW;
        if (f0.u[o + 4] & FL.deploy) list.push({ x: f0.u[o], y: f0.u[o + 1], r: u.def.fieldRadius * Math.max(0.03, f0.u[o + 9]), deploy: 1 });
      });
    }
    while (world.fieldMeshes.length < list.length) {
      const m = new THREE.Mesh(unitSphere(), fieldMaterial());
      m.renderOrder = 2;
      scene.add(m);
      world.fieldMeshes.push(m);
    }
    world.fieldMeshes.forEach((m, k) => {
      const f = list[k];
      m.visible = !!f;
      if (!f) return;
      m.position.set(f.x, 0, f.y);
      m.scale.setScalar(f.r);
      m.material.uniforms.time.value = V.realT;
      m.material.uniforms.opacity.value = f.deploy ? 0.45 + 0.25 * Math.sin(V.realT * 4) : 1;
      m.material.uniforms.pulse.value = f.deploy ? 0.12 : 0;
    });
    return list;
  }

  function laneMaterial(side) {
    const c = side === 0 ? new THREE.Color(0.4, 0.75, 2.0) : new THREE.Color(2.2, 0.85, 0.3);
    return new THREE.ShaderMaterial({
      uniforms: { color: { value: c }, time: { value: 0 } },
      vertexShader: 'attribute float dist; attribute float cut; varying float vD; varying float vCut; void main(){ vD = dist; vCut = cut; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform vec3 color; uniform float time; varying float vD; varying float vCut;',
        'void main(){',
        '  float d = fract(vD * 0.06 - time * 0.5);',
        '  float a = 0.28 + 0.9 * smoothstep(0.0, 0.08, d) * smoothstep(0.35, 0.12, d);',
        '  if (vCut > 0.5) a = 0.06 + 0.08 * step(0.5, fract(time * 2.0 + vD * 0.05));',
        '  gl_FragColor = vec4(color * a, a);',
        '}'].join('\n'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  function updateLanes(fa, fields) {
    const f0 = V.R.F[fa.k];
    const key = V.opts.lanes ? (f0.lanes ? f0.lanes.length : 0) + '|' + JSON.stringify(f0.lanes ? f0.lanes.map((l) => l.pts[l.pts.length - 1]) : []) + '|' + f0.fields.map((f) => f.x + ',' + f.y).join(';') : 'off';
    if (key === world.laneKey && world.laneGroup) {
      world.laneGroup.children.forEach((c) => { c.material.uniforms.time.value = V.realT; });
      return;
    }
    world.laneKey = key;
    if (world.laneGroup) { scene.remove(world.laneGroup); world.laneGroup.traverse((o) => o.geometry && o.geometry.dispose()); }
    world.laneGroup = new THREE.Group();
    scene.add(world.laneGroup);
    if (!V.opts.lanes || !f0.lanes) return;
    const inField = (x, y) => f0.fields.some((f) => (x - f.x) * (x - f.x) + (y - f.y) * (y - f.y) < f.r * f.r);
    for (const L of f0.lanes) {
      const pos = [], dist = [], cut = [];
      let acc = 0;
      for (let i = 1; i < L.pts.length; i++) {
        const a = L.pts[i - 1], b = L.pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = clamp(Math.ceil(len / 2), 1, 600);
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n;
          const x0 = lerp(a[0], b[0], t0), y0 = lerp(a[1], b[1], t0), x1 = lerp(a[0], b[0], t1), y1 = lerp(a[1], b[1], t1);
          const c = inField((x0 + x1) / 2, (y0 + y1) / 2) ? 1 : 0;
          pos.push(x0, 0, y0, x1, 0, y1);
          dist.push(acc + len * t0, acc + len * t1);
          cut.push(c, c);
        }
        acc += len;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('dist', new THREE.Float32BufferAttribute(dist, 1));
      g.setAttribute('cut', new THREE.Float32BufferAttribute(cut, 1));
      const line = new THREE.LineSegments(g, laneMaterial(L.side));
      line.frustumCulled = false;
      line.material.uniforms.time.value = V.realT;
      world.laneGroup.add(line);
    }
  }

  // ---------------------------------------------------------------- 演出: 射線・閃光・爆発

  const fx = {};
  const MAX_BEAM = 9000, MAX_SPRITE = 420, MAX_DEBRIS = 6000, MAX_PROJ = 6000;
  function initEffects() {
    // 射線（光速で伸びる線）
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_BEAM * 6), 3));
    bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_BEAM * 6), 3));
    fx.beams = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    fx.beams.frustumCulled = false;
    fx.beams.renderOrder = 5;
    scene.add(fx.beams);
    // 閃光・炎・衝撃波（板ポリ）
    fx.sprites = [];
    for (let k = 0; k < MAX_SPRITE; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.flare(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      s.renderOrder = 6;
      scene.add(s);
      fx.sprites.push(s);
    }
    // 破片（点）
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DEBRIS * 3), 3));
    dg.setAttribute('gcolor', new THREE.BufferAttribute(new Float32Array(MAX_DEBRIS * 3), 3));
    dg.setAttribute('gsize', new THREE.BufferAttribute(new Float32Array(MAX_DEBRIS), 1));
    fx.debris = new THREE.Points(dg, pointMaterial(true));
    fx.debris.frustumCulled = false;
    fx.debris.renderOrder = 6;
    scene.add(fx.debris);
    // 飛んでいる弾と無人機（点）
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PROJ * 3), 3));
    pg.setAttribute('gcolor', new THREE.BufferAttribute(new Float32Array(MAX_PROJ * 3), 3));
    pg.setAttribute('gsize', new THREE.BufferAttribute(new Float32Array(MAX_PROJ), 1));
    fx.proj = new THREE.Points(pg, pointMaterial(true));
    fx.proj.frustumCulled = false;
    fx.proj.renderOrder = 6;
    scene.add(fx.proj);
    // ロックタイムの輪（艦のまわりの板ポリ）は sprites を使う
  }

  // 演出の長さ: 計算上の時間と、画面上の秒数の長いほう（速く再生しても見えるように）
  const simDur = (simBase, realSec) => Math.max(simBase, V.speed * realSec);
  let spriteN = 0;
  function sprite(texName, x, y, z, size, color, opacity, rot) {
    if (spriteN >= MAX_SPRITE) return;
    const s = fx.sprites[spriteN++];
    s.visible = true;
    s.material.map = tex[texName]();
    s.material.color.copy(color);
    s.material.opacity = opacity;
    s.material.rotation = rot || 0;
    s.position.set(x, y, z);
    s.scale.setScalar(size);
  }
  const C = (r, g, b) => new THREE.Color(r, g, b);
  const hashf = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

  function updateEffects(fa) {
    const R = V.R, vt = V.vt, off = world.off, K = E.SHOT_KIND;
    spriteN = 0;
    // 射線
    let nb = 0;
    const bp = fx.beams.geometry.attributes.position.array, bc = fx.beams.geometry.attributes.color.array;
    if (V.opts.beams && R.nShots) {
      const pulse = Math.max(0.8, V.speed * 0.05), fade = Math.max(1.2, V.speed * 0.22), maxLife = 8 + pulse + fade;
      const bcol = SIDE_BEAM();
      let lo = 0, hi = R.nShots;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (R.shots[mid * SW + 6] < vt - maxLife) lo = mid + 1; else hi = mid; }
      for (let k = lo; k < R.nShots && nb < MAX_BEAM; k++) {
        const o = k * SW, t = R.shots[o + 6];
        if (t > vt) break;
        const sid = R.shots[o + 7], tid = R.shots[o + 8], hit = R.shots[o + 4] > 0, kind = R.shots[o + 9];
        // 無人機の射撃は標的のそばから（散らしは標的のぶん）、迎撃は撃った艦の高さで、落とした点へ
        const so = kind === K.drone ? tid : sid, to = tid >= 0 ? tid : sid;
        const sx = R.shots[o] + off[so * 2], sz = R.shots[o + 1] + off[so * 2 + 1], sy = R.h[so] * V.opts.height + (kind === K.drone ? 0.25 : 0);
        let tx = R.shots[o + 2] + off[to * 2], tz = R.shots[o + 3] + off[to * 2 + 1], ty = R.h[to] * V.opts.height;
        const travel = Math.max(0.05, Math.hypot(tx - sx, tz - sz, ty - sy));
        if (!hit) {
          // 外れ: 標的の脇を抜けて先へ
          const ox = (hashf(k, 1) - 0.5) * 0.8, oy = (hashf(k, 2) - 0.5) * 0.8;
          tx = sx + (tx - sx) * 1.35 + ox; tz = sz + (tz - sz) * 1.35 + oy; ty += oy * 0.5;
        }
        const age = vt - t;
        const head = clamp(age / travel, 0, 1), tail = clamp((age - pulse) / travel, 0, 1);
        const after = age - travel;
        let alpha = after > 0 ? clamp(1 - after / fade, 0, 1) : 1;
        if (!hit) alpha *= 0.35;
        if (kind === K.drone) alpha *= 0.55;
        if (kind === K.intercept) {
          alpha *= 0.7;
          if (hit && after >= 0 && after < fade * 0.6) sprite('spark', tx, ty, tz, 0.35, COL.spark, 1 - after / (fade * 0.6), hashf(k, 4) * 6);
        }
        if (alpha <= 0.01 || head <= tail) continue;
        const c = bcol[R.shots[o + 5]];
        const ax = lerp(sx, tx, tail), ay = lerp(sy, ty, tail), az = lerp(sz, tz, tail);
        const hx = lerp(sx, tx, head), hy = lerp(sy, ty, head), hz = lerp(sz, tz, head);
        const p = nb * 6;
        bp[p] = ax; bp[p + 1] = ay; bp[p + 2] = az; bp[p + 3] = hx; bp[p + 4] = hy; bp[p + 5] = hz;
        bc[p] = c.r * alpha * 0.35; bc[p + 1] = c.g * alpha * 0.35; bc[p + 2] = c.b * alpha * 0.35;
        bc[p + 3] = c.r * alpha; bc[p + 4] = c.g * alpha; bc[p + 5] = c.b * alpha;
        nb++;
        // 着弾: ウォードが残っていれば青白い光、なければ火花
        if (hit && kind !== K.intercept && after >= 0 && after < fade * 0.6) {
          const f0 = R.F[fa.k], sh = f0.u[tid * FW + 3];
          const q = 1 - after / (fade * 0.6);
          if (sh > 0.02) sprite('ring', tx, ty, tz, 0.35 + 0.2 * (1 - q), COL.shield, q * 0.6);
          else sprite('spark', tx, ty, tz, 0.45 * q + 0.15, COL.spark, q, hashf(k, 3) * 6);
        }
      }
    }
    // シェルと誘導弾（飛んでいる弾）と無人機: 光る点と短い尾
    let np = 0;
    const pp = fx.proj.geometry.attributes.position.array, pc = fx.proj.geometry.attributes.gcolor.array, ps = fx.proj.geometry.attributes.gsize.array;
    const SCOL = [[0.6, 0.85, 1.8], [1.9, 0.85, 0.35]];
    const head = (x, y, z, c, a, size) => {
      if (np >= MAX_PROJ) return;
      pp[np * 3] = x; pp[np * 3 + 1] = y; pp[np * 3 + 2] = z;
      pc[np * 3] = c[0] * a; pc[np * 3 + 1] = c[1] * a; pc[np * 3 + 2] = c[2] * a;
      ps[np] = size; np++;
    };
    const trail = (ax, ay, az, bx, by, bz, c, a) => {
      if (nb >= MAX_BEAM) return;
      const p = nb * 6;
      bp[p] = ax; bp[p + 1] = ay; bp[p + 2] = az; bp[p + 3] = bx; bp[p + 4] = by; bp[p + 5] = bz;
      bc[p] = 0; bc[p + 1] = 0; bc[p + 2] = 0;
      bc[p + 3] = c[0] * a; bc[p + 4] = c[1] * a; bc[p + 5] = c[2] * a;
      nb++;
    };
    if (V.opts.beams && R.nProj) {
      const fade = Math.max(1.2, V.speed * 0.22);
      let lo = 0, hi = R.nProj;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (R.proj[mid * SW + 6] < vt - fade) lo = mid + 1; else hi = mid; }
      for (let k = lo; k < R.nProj; k++) {
        const o = k * SW, t = R.proj[o + 6];
        if (t - R.maxFlight > vt) break;
        const fl = R.proj[o + 10], t0 = t - fl;
        if (t0 > vt) continue;
        const kind = R.proj[o + 9], hitv = R.proj[o + 4], side = R.proj[o + 5];
        const sid = R.proj[o + 7], tid = R.proj[o + 8];
        const sx = R.proj[o] + off[sid * 2], sz = R.proj[o + 1] + off[sid * 2 + 1], sy = R.h[sid] * V.opts.height;
        const tx = R.proj[o + 2] + off[tid * 2], tz = R.proj[o + 3] + off[tid * 2 + 1], ty = R.h[tid] * V.opts.height;
        const c = SCOL[side] || SCOL[0];
        const L = Math.hypot(tx - sx, tz - sz);
        const arc = kind === K.missile ? Math.min(2.5, L * 0.12) : 0;
        if (vt <= t) {
          const p = fl > 0 ? (vt - t0) / fl : 1;
          const x = lerp(sx, tx, p), z = lerp(sz, tz, p), y = lerp(sy, ty, p) + Math.sin(Math.PI * p) * arc;
          // 尾: 少し前の位置から
          const q = Math.max(0, p - (kind === K.missile ? 0.06 : 0.03));
          const bx = lerp(sx, tx, q), bz = lerp(sz, tz, q), by = lerp(sy, ty, q) + Math.sin(Math.PI * q) * arc;
          trail(bx, by, bz, x, y, z, c, kind === K.missile ? 0.6 : 0.9);
          head(x, y, z, kind === K.missile ? [1.15, 1.0, 0.85] : c, 1, kind === K.missile ? 0.2 : 0.14);
        } else {
          const after = vt - t, q = 1 - after / fade;
          if (q <= 0) continue;
          if (hitv > 0) sprite('spark', tx, ty, tz, 0.5 * q + 0.15, COL.spark, q, hashf(k, 5) * 6);
          else if (hitv < 0) sprite('flare', tx, ty + arc * 0.2, tz, 0.4 * q + 0.1, COL.flash, q * 0.8);
        }
      }
    }
    // 無人機（記録の区間の前後で同じ番号どうしを結んで動かす）
    const f0 = R.F[fa.k], f1 = R.F[Math.min(fa.k + 1, R.F.length - 1)];
    if (f0.drones) {
      const DW = E.DRONE_W;
      const m1 = f1._dmap || (f1._dmap = new Map());
      if (f1.drones && !m1.size) for (let i = 0; i < f1.drones.length; i += DW) m1.set(f1.drones[i], i);
      for (let i = 0; i < f0.drones.length; i += DW) {
        const id = f0.drones[i], j = m1.get(id);
        let x = f0.drones[i + 1], z = f0.drones[i + 2];
        if (j != null && f1 !== f0) { x = lerp(x, f1.drones[j + 1], fa.a); z = lerp(z, f1.drones[j + 2], fa.a); }
        const atk = f0.drones[i + 4] > 0, tg = f0.drones[i + 5];
        if (atk && tg >= 0) { x += off[tg * 2]; z += off[tg * 2 + 1]; }
        const y = (atk && tg >= 0 ? R.h[tg] * V.opts.height : 0) + (hashf(id, 9) - 0.5) * 0.8;
        head(x, y, z, SCOL[f0.drones[i + 3]] || SCOL[0], atk ? 0.9 : 0.6, 0.13);
      }
    }
    fx.proj.geometry.setDrawRange(0, np);
    fx.proj.geometry.attributes.position.needsUpdate = true;
    fx.proj.geometry.attributes.gcolor.needsUpdate = true;
    fx.proj.geometry.attributes.gsize.needsUpdate = true;

    fx.beams.geometry.setDrawRange(0, nb * 2);
    fx.beams.geometry.attributes.position.needsUpdate = true;
    fx.beams.geometry.attributes.color.needsUpdate = true;

    // 閃光・爆発
    let nd = 0;
    const dp = fx.debris.geometry.attributes.position.array, dc = fx.debris.geometry.attributes.gcolor.array, ds = fx.debris.geometry.attributes.gsize.array;
    const F = R.flashes, maxDur = simDur(60, 2.5);
    let lo = 0, hi = F.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (F[mid].t < vt - maxDur) lo = mid + 1; else hi = mid; }
    for (let k = lo; k < F.length; k++) {
      const e = F[k];
      if (e.t > vt) break;
      const age = vt - e.t, y = R.h[e.i] * V.opts.height, ex = e.x + off[e.i * 2], ey = e.y + off[e.i * 2 + 1];
      const len = V.models.defaultLength(R.S.units[e.i].tid, R.S.units[e.i].def) * V.opts.shipScale;
      if (e.kind === 'death') {
        const dur = simDur(e.big ? 14 : 8, e.big ? 2.4 : 1.6), p = age / dur;
        if (p > 1) continue;
        const sz = Math.max(len * 2.2, 0.3) * (e.big ? 1.6 : 1);
        sprite('flare', ex, y, ey, sz * (0.8 + p * 0.6), COL.flash, Math.max(0, 1 - p * 3));
        sprite('smoke', ex, y, ey, sz * (0.5 + p * 1.1), COL.fire, Math.max(0, 1 - p * 1.2) * 0.9, k);
        sprite('smoke', ex, y, ey, sz * (0.7 + p * 1.5), COL.smoke, Math.max(0, 0.6 - p * 0.6), k + 1);
        sprite('ring', ex, y, ey, sz * (0.4 + p * 2.6), COL.shock, Math.max(0, 0.7 - p) * 0.7);
        const nd0 = e.big ? 40 : 18;
        for (let j = 0; j < nd0 && nd < MAX_DEBRIS; j++) {
          const th = hashf(k, j) * Math.PI * 2, ph = (hashf(k, j + 50) - 0.5) * Math.PI, sp = (0.3 + hashf(k, j + 99)) * sz * 1.4;
          const q = p * sp;
          dp[nd * 3] = ex + Math.cos(th) * Math.cos(ph) * q; dp[nd * 3 + 1] = y + Math.sin(ph) * q; dp[nd * 3 + 2] = ey + Math.sin(th) * Math.cos(ph) * q;
          const b = Math.max(0, 1 - p) * 2;
          dc[nd * 3] = 2.4 * b; dc[nd * 3 + 1] = 1.1 * b; dc[nd * 3 + 2] = 0.4 * b;
          ds[nd] = 0.06 + hashf(k, j + 7) * 0.06;
          nd++;
        }
      } else if (e.kind === 'depart' || e.kind === 'arrive' || e.kind === 'escape') {
        const dur = simDur(6, 1.1), p = age / dur;
        if (p > 1) continue;
        const c = R.S.units[e.i].side === 0 ? COL.jumpH : COL.jumpZ;
        const sz = Math.max(len * 6, 1.2);
        sprite('flare', ex, y, ey, sz * (e.kind === 'arrive' ? 1.6 - p : 0.6 + p), c, 1 - p);
        if (e.kind === 'arrive') sprite('ring', ex, y, ey, sz * (0.4 + p * 2.5), c, (1 - p) * 0.7);
        if (e.kind !== 'arrive') sprite('spark', ex, y, ey, sz * 1.4 * (1 - p), c, 1 - p, k);
      } else if (e.kind === 'laneDepart' || e.kind === 'laneArrive') {
        const dur = simDur(5, 0.9), p = age / dur;
        if (p > 1) continue;
        sprite('flare', ex, y, ey, Math.max(len * 5, 1) * (1 - p * 0.5), COL.jumpZ, (1 - p) * 0.9);
        if (e.kind === 'laneDepart' && nb < MAX_BEAM) {
          // レーン上を走る光の筋
          const p6 = nb * 6, a = (1 - p) * 1.4;
          bp[p6] = ex; bp[p6 + 1] = y; bp[p6 + 2] = ey; bp[p6 + 3] = e.tx; bp[p6 + 4] = y; bp[p6 + 5] = e.ty;
          bc[p6] = COL.jumpZ.r * a; bc[p6 + 1] = COL.jumpZ.g * a; bc[p6 + 2] = COL.jumpZ.b * a;
          bc[p6 + 3] = COL.jumpZ.r * a * 0.3; bc[p6 + 4] = COL.jumpZ.g * a * 0.3; bc[p6 + 5] = COL.jumpZ.b * a * 0.3;
          nb++;
          fx.beams.geometry.setDrawRange(0, nb * 2);
          sprite('flare', e.tx, y, e.ty, Math.max(len * 5, 1) * p, COL.jumpZ, (1 - p) * 0.8);
        }
      } else if (e.kind === 'fieldUp' || e.kind === 'fieldDown') {
        const dur = simDur(20, 2.2), p = age / dur;
        if (p > 1 || !V.opts.fields) continue;
        const r = e.r * 2.1 * (e.kind === 'fieldUp' ? 0.6 + p * 0.45 : 1 - p * 0.9);
        sprite('ring', e.x, 0, e.y, r, COL.field, (1 - p) * (e.kind === 'fieldUp' ? 0.5 : 0.8));
        if (e.kind === 'fieldDown') sprite('flare', e.x, 0, e.y, Math.max(len * 10, 3) * (1 - p), COL.field, 1 - p);
      }
    }
    fx.debris.geometry.setDrawRange(0, nd);
    fx.debris.geometry.attributes.position.needsUpdate = true;
    fx.debris.geometry.attributes.gcolor.needsUpdate = true;
    fx.debris.geometry.attributes.gsize.needsUpdate = true;
    fx.debris.material.uniforms.scale.value = 1;

    // ロックタイムの輪
    if (V.opts.locks) {
      const f0 = R.F[fa.k];
      for (const b of world.batches) for (const i of b.shown) {
        if (!(f0.u[i * FW + 4] & FL.lock)) continue;
        const st = world.unitState[i];
        sprite('ring', st.pos.x, st.pos.y, st.pos.z, b.model.length * V.opts.shipScale * 2.2, b.side === 0 ? COL.jumpH : COL.jumpZ, 0.25 * f0.u[i * FW + 8] + 0.08);
      }
    }
    for (let k = spriteN; k < MAX_SPRITE; k++) fx.sprites[k].visible = false;
  }

  // ---------------------------------------------------------------- カメラ

  const cam = { look: null, pos: null, az: 0.8, el: 0.35, dist: 60, plan: null, planT: 0, hot: null, hotT: 0 };

  function resetDirector() {
    const B = V.R.bounds;
    cam.look.set(B.cx, 0, B.cy);
    cam.dist = B.size * 0.9;
    cam.az = 0.9; cam.el = 0.55;
    cam.plan = null; cam.planT = 999; cam.hot = null;
    placeCamera(1);
  }

  // いちばん激しい交戦の場所（直近の射撃の集まり）。なければ艦がいちばん多い場所
  function hotspot() {
    const R = V.R, vt = V.vt, W = Math.max(90, V.speed * 2);
    const cells = new Map(), CELL = 12;
    let lo = 0, hi = R.nShots;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (R.shots[mid * SW + 6] < vt - W) lo = mid + 1; else hi = mid; }
    let count = 0;
    for (let k = lo; k < R.nShots; k++) {
      const o = k * SW;
      if (R.shots[o + 6] > vt) break;
      const mx = (R.shots[o] + R.shots[o + 2]) / 2, my = (R.shots[o + 1] + R.shots[o + 3]) / 2;
      const key = Math.floor(mx / CELL) + ',' + Math.floor(my / CELL);
      const c = cells.get(key) || { n: 0, x: 0, y: 0 };
      c.n++; c.x += mx; c.y += my;
      cells.set(key, c);
      count++;
    }
    let best = null;
    for (const c of cells.values()) if (!best || c.n > best.n) best = c;
    if (best) {
      const cx = best.x / best.n, cy = best.y / best.n;
      // 広がり: 中心から30光秒以内の射撃の、中心からの距離の二乗平均
      let s2 = 0, m = 0;
      for (let k = lo; k < R.nShots; k++) {
        const o = k * SW;
        if (R.shots[o + 6] > vt) break;
        const mx = (R.shots[o] + R.shots[o + 2]) / 2, my = (R.shots[o + 1] + R.shots[o + 3]) / 2;
        const d2 = (mx - cx) * (mx - cx) + (my - cy) * (my - cy);
        if (d2 < 900) { s2 += d2; m++; }
      }
      return { x: cx, y: cy, r: clamp(Math.sqrt(s2 / Math.max(1, m)), 2, 25), n: count };
    }
    // 交戦がないとき: 見えている艦の集まり
    const grid = new Map();
    for (let i = 0; i < R.n; i++) {
      const st = world.unitState[i];
      if (!st || !st.vis || R.S.units[i].def.speed <= 0) continue;
      const key = Math.floor(st.pos.x / 30) + ',' + Math.floor(st.pos.z / 30);
      const c = grid.get(key) || { n: 0, x: 0, y: 0 };
      c.n++; c.x += st.pos.x; c.y += st.pos.z;
      grid.set(key, c);
    }
    for (const c of grid.values()) if (!best || c.n > best.n) best = c;
    if (best) return { x: best.x / best.n, y: best.y / best.n, r: 12, n: 0 };
    return { x: R.bounds.cx, y: R.bounds.cy, r: R.bounds.size / 3, n: 0 };
  }

  function recentEvent() {
    const R = V.R, vt = V.vt, W = Math.max(120, V.speed * 4);
    for (let k = R.flashes.length - 1; k >= 0; k--) {
      const e = R.flashes[k];
      if (e.t > vt) continue;
      if (e.t < vt - W) break;
      if ((e.kind === 'death' && e.big) || e.kind === 'fieldUp' || e.kind === 'fieldDown') return e;
    }
    return null;
  }

  function aliveKeyUnits() {
    const out = [];
    for (const b of world.batches) for (const i of b.shown) if (E.isKey(b.def) || b.def.cost >= 8) if (b.def.speed > 0) out.push(i);
    return out;
  }

  function choosePlan() {
    const opts = [];
    const hot = hotspot();
    if (hot.n > 0) opts.push({ w: 5, kind: 'hot' });
    const ev = recentEvent();
    if (ev) opts.push({ w: 3, kind: 'event', ev });
    const keys = aliveKeyUnits();
    if (keys.length) opts.push({ w: hot.n > 0 ? 2 : 3, kind: 'unit', i: keys[Math.floor(Math.random() * keys.length)] });
    opts.push({ w: hot.n > 0 ? 0.8 : 2, kind: 'overview' });
    let r = Math.random() * opts.reduce((a, o) => a + o.w, 0), pick = opts[0];
    for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
    pick.az = Math.random() * Math.PI * 2;
    pick.el = 0.12 + Math.random() * 0.45;
    pick.spin = (Math.random() < 0.5 ? -1 : 1) * (0.03 + Math.random() * 0.05);
    pick.zoom = 0.8 + Math.random() * 0.6;
    pick.cut = Math.random() < 0.55;
    pick.dur = 7 + Math.random() * 5;
    cam.plan = pick;
    cam.planT = 0;
    cam.az = pick.az; cam.el = pick.el;
  }

  function targetFor(mode, plan) {
    const R = V.R;
    if (mode === 'overview' || (plan && plan.kind === 'overview')) {
      return { x: R.bounds.cx, y: 0, z: R.bounds.cy, dist: R.bounds.size * 0.85, el: plan ? Math.max(plan.el, 0.5) : 0.75 };
    }
    if (mode === 'follow' || (plan && plan.kind === 'unit')) {
      const i = mode === 'follow' ? V.follow : plan.i;
      const st = world.unitState[i];
      if (st && st.vis) {
        const len = V.R.S.units[i] ? V.models.defaultLength(R.S.units[i].tid, R.S.units[i].def) * V.opts.shipScale : 0.16;
        return { x: st.pos.x, y: st.pos.y, z: st.pos.z, dist: Math.max(len * 14, 1.6) * (plan ? plan.zoom : 1), unit: i };
      }
      return null;
    }
    if (plan && plan.kind === 'event') {
      const e = plan.ev;
      return { x: e.x, y: 0, z: e.y, dist: e.r ? e.r * 2.4 : 8 * plan.zoom };
    }
    // 交戦
    if (!cam.hot || V.realT - cam.hotT > 0.4) { cam.hot = hotspot(); cam.hotT = V.realT; }
    const h = cam.hot;
    return { x: h.x, y: 0, z: h.y, dist: clamp(h.r * 2.2, 4, 45) * (plan ? plan.zoom : 1) };
  }

  function placeCamera(k) {
    const c = Math.cos(cam.el);
    tmpV.set(Math.cos(cam.az) * c, Math.sin(cam.el), Math.sin(cam.az) * c).multiplyScalar(cam.dist).add(cam.look);
    if (k >= 1) camera.position.copy(tmpV); else camera.position.lerp(tmpV, k);
    camera.lookAt(cam.look);
  }

  // WASD で自由カメラを動かす: W/S 前後、A/D 左右、E/Q 上下、Shift で速く。速さは見ている点までの距離に比例
  const held = new Set();
  const MOVE_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyQ: 1, KeyE: 1 };
  function flyCamera(dtReal) {
    let any = false;
    for (const c of held) if (MOVE_KEYS[c]) { any = true; break; }
    if (!any) return;
    const fwd = tmpV.set(0, 0, 0), right = tmpV2.set(0, 0, 0);
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0);
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x);
    const mx = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
    const mz = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
    const my = (held.has('KeyE') ? 1 : 0) - (held.has('KeyQ') ? 1 : 0);
    const L = Math.hypot(mx, my, mz);
    if (!L) return;
    const fast = held.has('ShiftLeft') || held.has('ShiftRight') ? 3 : 1;
    const sp = Math.max(camera.position.distanceTo(controls.target), 2) * 0.7 * fast * dtReal / L;
    const dx = (fwd.x * mz + right.x * mx) * sp, dy = my * sp, dz = (fwd.z * mz + right.z * mx) * sp;
    camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
    controls.target.x += dx; controls.target.y += dy; controls.target.z += dz;
  }

  function updateCamera(dtReal) {
    if (V.cam === 'free') {
      flyCamera(dtReal);
      controls.update();
      return;
    }
    let plan = null;
    if (V.cam === 'director') {
      cam.planT += dtReal;
      if (!cam.plan || cam.planT > cam.plan.dur) choosePlan();
      plan = cam.plan;
    }
    const tgt = targetFor(V.cam, plan);
    if (!tgt) {
      if (V.cam === 'director') { choosePlan(); return; }
      if (V.cam === 'follow') { V.cam = 'combat'; syncCamButtons(); toast('追っていた艦が見えなくなったので、交戦を追います'); }
      return;
    }
    const cut = plan && plan.cut && cam.planT === dtReal;
    const k = cut ? 1 : 1 - Math.exp(-dtReal * (V.cam === 'follow' || (plan && plan.kind === 'unit') ? 4 : 1.6));
    cam.look.x = lerp(cam.look.x, tgt.x, k); cam.look.y = lerp(cam.look.y, tgt.y, k); cam.look.z = lerp(cam.look.z, tgt.z, k);
    cam.dist = lerp(cam.dist, tgt.dist, cut ? 1 : 1 - Math.exp(-dtReal * 1.2));
    if (tgt.el != null) cam.el = lerp(cam.el, tgt.el, 1 - Math.exp(-dtReal));
    if (V.cam === 'follow' && tgt.unit != null) {
      // 艦の斜め後ろから
      const q = world.unitState[tgt.unit].q;
      tmpV2.set(0, 0, -1).applyQuaternion(q);
      const want = Math.atan2(tmpV2.z, tmpV2.x);
      let d = want - cam.az;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      cam.az += d * (1 - Math.exp(-dtReal * 1.5));
      cam.el = lerp(cam.el, 0.22, 1 - Math.exp(-dtReal));
    } else {
      cam.az += (plan ? plan.spin : 0.04) * dtReal;
    }
    placeCamera(cut ? 1 : 1 - Math.exp(-dtReal * 6));
    camera.near = clamp(cam.dist * 0.004, 0.005, 2);
    camera.far = 9000;
    camera.updateProjectionMatrix();
  }

  function setCam(mode) {
    if (mode === 'follow' && V.follow < 0) {
      const keys = aliveKeyUnits();
      if (V.selected >= 0) V.follow = V.selected;
      else if (keys.length) V.follow = keys[0];
      else { toast('追う艦をクリックで選んでください'); return; }
    }
    if (V.cam === 'free' && mode !== 'free') {
      cam.look.copy(controls.target);
      tmpV.copy(camera.position).sub(cam.look);
      cam.dist = tmpV.length();
      cam.el = Math.asin(clamp(tmpV.y / cam.dist, -1, 1));
      cam.az = Math.atan2(tmpV.z, tmpV.x);
    }
    V.cam = mode;
    controls.enabled = mode === 'free';
    if (mode === 'free') { controls.target.copy(cam.look); controls.update(); }
    if (mode === 'director') { cam.plan = null; cam.planT = 999; }
    syncCamButtons();
  }
  function syncCamButtons() {
    for (const b of document.querySelectorAll('#camSeg button')) b.setAttribute('aria-pressed', String(b.dataset.cam === V.cam));
  }

  // ---------------------------------------------------------------- 画面の表示（時刻・戦力・字幕・札）

  function updateHud() {
    const S = V.S, R = V.R;
    const t = V.vt;
    $('hudClock').textContent = fmtT(t);
    $('clock2').textContent = fmtT(t);
    if (!V.seeking) $('seek').value = String(Math.round(t));
    const hi = clamp(Math.round(t / S.set.dt), 0, S.hist.t.length - 1);
    let html = '';
    S.sides.forEach((sd, k) => {
      const v = S.hist.str[k][hi] || 0, n = S.hist.cnt[k][hi] || 0;
      html += '<span>' + esc(sd.name) + '</span><div class="meter"><div style="width:' + Math.round(v * 100) + '%;background:' + sideCss(k) + '"></div></div><span class="num">' + Math.round(v * 100) + '%・' + n + '隻</span>';
    });
    if (html !== V.lastStrength) { $('hudStrength').innerHTML = html; V.lastStrength = html; }
    // 字幕
    let cap = '';
    if (V.opts.captions) {
      const life = Math.max(40, V.speed * 4.5);
      const shown = R.captions.filter((c) => c.t <= t && t - c.t < life).slice(-2);
      cap = shown.map((c) => '<div style="opacity:' + clamp(1.4 - (t - c.t) / life, 0, 1).toFixed(2) + '"><span class="t">' + fmtT(c.t) + '</span>' + esc(c.text) + '</div>').join('<br>');
    }
    if (cap !== V.lastCap) { $('caption').innerHTML = cap; V.lastCap = cap; }
    if (V.selected >= 0) updateCard();
  }

  function project(x, y, z) {
    tmpV.set(x, y, z).project(camera);
    if (tmpV.z > 1 || tmpV.z < -1) return null;
    return { x: (tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight };
  }
  function updateLabels() {
    for (const L of world.placeLabels || []) {
      const p = V.opts.places ? project(L.x, 0, L.y) : null;
      L.el.style.display = p ? '' : 'none';
      if (p) { L.el.style.left = p.x + 'px'; L.el.style.top = (p.y - 6) + 'px'; }
    }
    for (const L of world.unitLabels || []) {
      const st = world.unitState[L.i];
      const p = V.opts.unitLabels && st && st.vis ? project(st.pos.x, st.pos.y + 0.3, st.pos.z) : null;
      L.el.style.display = p ? '' : 'none';
      if (p) { L.el.style.left = p.x + 'px'; L.el.style.top = (p.y - 4) + 'px'; }
    }
  }

  function updateCard() {
    const i = V.selected, R = V.R, u = R.S.units[i];
    if (!u) return;
    const fa = frameAt(V.vt), f0 = R.F[fa.k], o = i * FW, fl = f0.u[o + 4];
    const hp = f0.u[o + 2], sh = f0.u[o + 3];
    const st = [];
    if (!(fl & FL.alive) || (u.diedAt >= 0 && V.vt >= u.diedAt)) st.push('撃沈');
    else if (fl & FL.escaped) st.push('離脱');
    else if (!(fl & FL.present)) st.push(fmtT(u.appear) + ' に出現');
    else {
      if (fl & FL.jump) st.push('ジャンプ中');
      if (fl & FL.deploy) st.push('妨害場を展開中');
      if (fl & FL.field) st.push('妨害場を維持中');
      if (fl & FL.lay) st.push('レーンを延伸中');
      if (fl & FL.retreat) st.push('撤退中');
      if (fl & FL.lock) st.push('ロックタイム残り ' + Math.round(f0.u[o + 5] / 60) + '分');
      if (fl & FL.linked) st.push('リンク中');
    }
    const html = '<b>' + esc(u.def.name) + '</b> <span class="k">#' + (i + 1) + '・' + esc(R.S.sides[u.side].name) + '</span>' +
      '<div class="k">船体 ' + Math.round(hp * u.def.hp) + ' / ' + u.def.hp + '</div><div class="meter"><div style="width:' + Math.round(hp * 100) + '%;background:' + sideCss(u.side) + '"></div></div>' +
      (u.def.shield > 0 ? '<div class="k">ウォード ' + Math.round(sh * u.def.shield) + ' / ' + u.def.shield + '</div><div class="meter"><div style="width:' + Math.round(sh * 100) + '%;background:#9fd8ff"></div></div>' : '') +
      '<div>' + esc(st.join('・') || '待機') + '</div>' +
      '<div class="row" style="margin-top:6px;display:flex;gap:6px"><button id="cardFollow">この艦を追う</button><button id="cardClose">閉じる</button></div>';
    if (html !== V.lastCard) {
      $('card').innerHTML = html;
      V.lastCard = html;
      $('cardFollow').onclick = () => { V.follow = i; setCam('follow'); };
      $('cardClose').onclick = () => { V.selected = -1; $('card').hidden = true; };
    }
    $('card').hidden = false;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let toastTimer = 0;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3200);
  }

  function showTitle() {
    const S = V.S;
    $('tcTitle').textContent = S.scn.name || '';
    $('tcNote').textContent = (S.scn.note || '').slice(0, 220) + ((S.scn.note || '').length > 220 ? '…' : '');
    $('tcEyebrow').textContent = S.sides.map((s) => s.name).join('　対　');
    $('hudTitle').textContent = S.scn.name || '';
    $('titlecard').classList.remove('gone');
    clearTimeout(V.titleTimer);
    V.titleTimer = setTimeout(() => $('titlecard').classList.add('gone'), 6000);
  }

  function setupTimeline() {
    const R = V.R;
    const seek = $('seek');
    seek.max = String(Math.ceil(R.end));
    seek.step = '1';
    // 主な出来事の印
    const ticks = $('ticks');
    ticks.innerHTML = R.captions.map((c) => '<i style="left:' + (c.t / R.end * 100).toFixed(2) + '%;background:' + sideCss(c.side) + '" title="' + esc(fmtT(c.t) + ' ' + c.text) + '"></i>').join('');
    updatePlayBtn();
  }
  function updatePlayBtn() { $('playBtn').textContent = V.playing ? '停止' : (V.vt >= V.R.end ? '最初から' : '再生'); }

  function renderSourceInfo() {
    const S = V.S;
    $('srcInfo').innerHTML = esc(V.src.from) + '<br>「' + esc(S.scn.name) + '」・シード ' + S.seed + '・' + S.units.length + '隻<br>結果: ' + esc(S.result ? S.result.text : '') + '（' + fmtT(S.t) + '）';
    $('seedIn').value = S.seed;
    $('presetSel').value = '';
  }

  // ---------------------------------------------------------------- モデルの表

  function renderModelTable() {
    const S = V.S;
    const rows = [];
    const seen = new Set();
    S.units.forEach((u) => {
      if (seen.has(u.tid)) return;
      seen.add(u.tid);
      const m = V.models.modelFor(u.tid, u.def, u.side);
      rows.push('<tr data-tid="' + esc(u.tid) + '"><td><input type="radio" name="mt" value="' + esc(u.tid) + '"' + (V.modelTarget === u.tid ? ' checked' : '') + '></td><td>' + esc(u.def.name) + '</td><td class="src" title="' + esc(m.source) + '">' + esc(m.source) + '</td>' +
        '<td><button data-act="pick">GLB</button> <button data-act="reset"' + (m.source === '既定' ? ' disabled' : '') + '>既定</button> <button data-act="tpl" title="既定のモデルを GLB に書き出す">型紙</button></td></tr>');
    });
    $('modelTable').innerHTML = rows.join('');
    if (!V.modelTarget && rows.length) { V.modelTarget = [...seen][0]; const r = document.querySelector('#modelTable input[type=radio]'); if (r) r.checked = true; }
  }

  async function applyModelFile(tid, file) {
    try {
      const buf = await file.arrayBuffer();
      await V.models.register(tid, { data: buf, name: file.name });
      buildWorld();
      renderModelTable();
      toast(file.name + ' を ' + (V.S.scn.types[tid] ? V.S.scn.types[tid].name : tid) + ' に使います（この画面を閉じると元に戻ります）');
    } catch (e) {
      toast('モデルを読めませんでした: ' + e.message);
    }
  }

  async function exportTemplate(tid) {
    const def = V.S.scn.types[tid];
    const side = V.S.units.find((u) => u.tid === tid).side;
    try {
      const glb = await V.models.exportTemplate(tid, def, side);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      a.download = tid + '.glb';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast(tid + '.glb を書き出しました');
    } catch (e) { toast('書き出せませんでした: ' + e.message); }
  }

  // ---------------------------------------------------------------- 録画

  const rec = { mr: null, chunks: [], canvas: null, ctx: null, t0: 0, type: '' };
  function recType() {
    if (!window.MediaRecorder) return '';
    return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }
  function toggleRec() {
    if (rec.mr) { rec.mr.stop(); return; }
    const type = recType();
    if (!type) { toast('このブラウザは録画に対応していません'); return; }
    const src = renderer.domElement;
    rec.canvas = document.createElement('canvas');
    rec.canvas.width = src.width; rec.canvas.height = src.height;
    rec.ctx = rec.canvas.getContext('2d');
    const stream = rec.canvas.captureStream(60);
    rec.chunks = [];
    rec.type = type;
    rec.mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16e6 });
    rec.mr.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
    rec.mr.onstop = () => {
      const blob = new Blob(rec.chunks, { type: rec.type.split(';')[0] });
      const ext = rec.type.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      // 日本語のファイル名はブラウザに捨てられることがあるので、英数字と日時にする
      const d = new Date(), z = (n) => String(n).padStart(2, '0');
      a.download = 'uchusen3d_' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()) + '.' + ext;
      document.body.appendChild(a); a.click(); a.remove();
      V.lastRecording = { size: blob.size, type: rec.type, name: a.download };
      toast('録画を保存しました（' + (blob.size / 1e6).toFixed(1) + 'MB・' + ext + '）');
      rec.mr = null;
      document.body.classList.remove('recording');
      $('recBtn').innerHTML = '録画';
    };
    rec.mr.start(500);
    rec.t0 = performance.now();
    document.body.classList.add('recording');
  }
  function drawRecFrame() {
    const c = rec.ctx, W = rec.canvas.width, H = rec.canvas.height, src = renderer.domElement;
    if (src.width !== W || src.height !== H) return;
    c.drawImage(src, 0, 0);
    const dpr = renderer.getPixelRatio();
    if (V.opts.letterbox) { const bh = Math.round(H * 0.09); c.fillStyle = '#000'; c.fillRect(0, 0, W, bh); c.fillRect(0, H - bh, W, bh); }
    c.textAlign = 'left'; c.textBaseline = 'top';
    if (V.opts.hud) {
      c.fillStyle = 'rgba(233,238,244,0.9)';
      c.font = (22 * dpr) + 'px "IBM Plex Mono", monospace';
      c.fillText(fmtT(V.vt), 18 * dpr, H * (V.opts.letterbox ? 0.09 : 0) + 30 * dpr);
      c.font = (15 * dpr) + 'px "Dela Gothic One", sans-serif';
      c.fillText(V.S.scn.name || '', 18 * dpr, H * (V.opts.letterbox ? 0.09 : 0) + 10 * dpr);
    }
    const caps = $('caption').innerText.split('\n').filter(Boolean);
    c.textAlign = 'center';
    c.font = (17 * dpr) + 'px "BIZ UDPGothic", sans-serif';
    caps.forEach((line, k) => {
      const y = H * (V.opts.letterbox ? 0.91 : 1) - (caps.length - k) * 26 * dpr - 20 * dpr;
      c.lineWidth = 4 * dpr; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.strokeText(line, W / 2, y);
      c.fillStyle = '#e9eef4'; c.fillText(line, W / 2, y);
    });
    $('recBtn').innerHTML = '<span class="rec-dot"></span>停止 ' + Math.floor((performance.now() - rec.t0) / 1000) + '秒';
  }

  // ---------------------------------------------------------------- 毎コマ

  function loop(now) {
    const dtReal = clamp((now - V.last) / 1000, 0, 0.1);
    V.last = now;
    V.realT += dtReal;
    if (V.R) {
      if (V.playing) {
        V.vt += dtReal * V.speed;
        if (V.vt >= V.R.end) { V.vt = V.R.end; V.playing = false; updatePlayBtn(); }
      }
      const fa = frameAt(V.vt);
      updateSpread(fa, dtReal);
      updateShips(fa, dtReal);
      const fields = updateFields(fa);
      updateLanes(fa, fields);
      updateEffects(fa);
      updateCamera(dtReal);
      updateHud();
      updateLabels();
    }
    V.backdrop.position.copy(camera.position);
    V.sky.material.uniforms.strength.value = V.opts.nebula ? 1 : 0.25;
    filmPass.uniforms.time.value = V.realT;
    composer.render(dtReal);
    if (rec.mr) drawRecFrame();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- 操作

  function saveOpts() { try { localStorage.setItem(OPTS_KEY, JSON.stringify(V.opts)); } catch (e) { /* 保存できない環境 */ } }
  function applyOpts() {
    const o = V.opts;
    document.body.classList.toggle('no-letterbox', !o.letterbox);
    $('hud').style.display = o.hud ? '' : 'none';
    $('caption').style.display = o.captions ? '' : 'none';
    bloomPass.strength = 0.8 * o.bloom;
    filmPass.enabled = o.film;
    $('optBloomOut').textContent = o.bloom.toFixed(2);
    $('optHeightOut').textContent = o.height.toFixed(1);
    $('optSpreadOut').textContent = o.spread.toFixed(1);
    $('optShipScaleOut').textContent = o.shipScale.toFixed(1);
    world.laneKey = '';
  }

  function openDrawer(id) {
    for (const d of document.querySelectorAll('.drawer')) d.classList.toggle('open', d.id === id && !d.classList.contains('open'));
  }

  function bindUi() {
    // 速さ・再生・時刻
    $('speedSel').value = String(V.speed);
    $('speedSel').onchange = (e) => { V.speed = +e.target.value; };
    $('playBtn').onclick = () => {
      if (!V.R) return;
      if (!V.playing && V.vt >= V.R.end) V.vt = 0;
      V.playing = !V.playing;
      if (V.playing) $('titlecard').classList.add('gone');
      updatePlayBtn();
    };
    $('seek').addEventListener('input', (e) => { V.seeking = true; V.vt = +e.target.value; world.spreadCut = true; updatePlayBtn(); });
    $('seek').addEventListener('change', () => { V.seeking = false; });
    for (const b of document.querySelectorAll('#camSeg button')) b.onclick = () => setCam(b.dataset.cam);
    syncCamButtons();
    // 引き出し
    $('scnBtn').onclick = () => openDrawer('drawerScn');
    $('modelBtn').onclick = () => openDrawer('drawerModel');
    $('viewBtn').onclick = () => openDrawer('drawerView');
    for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('.drawer').classList.remove('open');
    $('fsBtn').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => toast('全画面にできませんでした')); };
    $('recBtn').onclick = toggleRec;
    const rt = recType();
    $('recFmt').textContent = rt ? '（このブラウザでは ' + (rt.indexOf('mp4') >= 0 ? 'mp4' : 'webm') + ' で保存されます）' : '（このブラウザは録画に対応していません）';
    // シナリオ
    $('presetSel').innerHTML = '<option value="">プリセットを開く…</option>' + P.SCENARIOS.filter((s) => s.id !== 'empty').map((s) => '<option value="' + s.id + '">' + esc(s.label) + '</option>').join('');
    $('presetSel').onchange = (e) => { if (e.target.value) loadSource(presetSource(e.target.value, 0)); };
    $('takeHandoff').onclick = () => { const h = handoffSource(); if (h) loadSource(h); else toast('2Dの画面から受け取ったシナリオはありません'); };
    $('reseed').onclick = () => { const seed = Math.max(1, parseInt($('seedIn').value, 10) || 1); loadSource(Object.assign({}, V.src, { scenario: V.S.scn, seed, t: V.vt })); };
    $('openJson').onclick = () => $('jsonFile').click();
    $('jsonFile').onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const o = JSON.parse(String(rd.result).replace(/^﻿/, ''));
          if (!o.types || !Array.isArray(o.units)) throw new Error('types と units が必要です');
          loadSource({ scenario: o, seed: (o.settings && o.settings.seed) || 1, t: 0, from: 'ファイル「' + f.name + '」' });
        } catch (err) { toast('シナリオとして読めません: ' + err.message); }
      };
      rd.readAsText(f);
      e.target.value = '';
    };
    // モデル
    const fileIn = document.createElement('input');
    fileIn.type = 'file'; fileIn.accept = '.glb,model/gltf-binary'; fileIn.hidden = true;
    document.body.appendChild(fileIn);
    fileIn.onchange = () => { const f = fileIn.files && fileIn.files[0]; if (f && V.modelTarget) applyModelFile(V.modelTarget, f); fileIn.value = ''; };
    $('modelTable').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-tid]');
      if (!tr) return;
      const tid = tr.dataset.tid;
      if (e.target.matches('input[type=radio]')) { V.modelTarget = tid; return; }
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'pick') { V.modelTarget = tid; fileIn.click(); }
      if (act === 'reset') { V.models.unregister(tid); buildWorld(); renderModelTable(); }
      if (act === 'tpl') exportTemplate(tid);
    });
    const drop = $('drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('over');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && V.modelTarget) applyModelFile(V.modelTarget, f);
    });
    // 表示の設定
    const chk = { optLetterbox: 'letterbox', optCaptions: 'captions', optHud: 'hud', optAutohide: 'autohide', optBeams: 'beams', optFields: 'fields', optLanes: 'lanes', optPlaces: 'places', optUnitLabels: 'unitLabels', optLocks: 'locks', optNebula: 'nebula', optFilm: 'film' };
    for (const [id, k] of Object.entries(chk)) {
      $(id).checked = !!V.opts[k];
      $(id).onchange = (e) => { V.opts[k] = e.target.checked; applyOpts(); saveOpts(); };
    }
    for (const [id, k] of [['optBloom', 'bloom'], ['optHeight', 'height'], ['optSpread', 'spread'], ['optShipScale', 'shipScale']]) {
      $(id).value = String(V.opts[k]);
      $(id).oninput = (e) => { V.opts[k] = +e.target.value; applyOpts(); saveOpts(); };
    }
    // 艦を選ぶ（クリック）。ドラッグは視点の操作
    const cv = renderer.domElement;
    let down = null;
    cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
      down = null;
      pick(e.clientX, e.clientY);
    });
    cv.addEventListener('dblclick', () => { if (V.selected >= 0) { V.follow = V.selected; setCam('follow'); } });
    cv.addEventListener('wheel', () => { if (V.cam !== 'free') setCam('free'); }, { passive: true });
    // キー操作
    document.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, select, textarea')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (MOVE_KEYS[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        held.add(e.code);
        if (MOVE_KEYS[e.code]) { e.preventDefault(); if (V.cam !== 'free') setCam('free'); }
        wake();
        return;
      }
      const k = e.key;
      if (k === ' ') { e.preventDefault(); $('playBtn').click(); }
      else if (k >= '1' && k <= '5') setCam(['director', 'combat', 'follow', 'overview', 'free'][+k - 1]);
      else if (k === 'f' || k === 'F') $('fsBtn').click();
      else if (k === 'r' || k === 'R') toggleRec();
      else if (k === 'h' || k === 'H') { V.opts.hud = !V.opts.hud; applyOpts(); }
      else if (k === 'ArrowRight') { V.vt = Math.min(V.R.end, V.vt + Math.max(30, V.speed * 5)); world.spreadCut = true; }
      else if (k === 'ArrowLeft') { V.vt = Math.max(0, V.vt - Math.max(30, V.speed * 5)); world.spreadCut = true; }
      else if (k === 'Escape') { for (const d of document.querySelectorAll('.drawer')) d.classList.remove('open'); }
      wake();
    });
    document.addEventListener('keyup', (e) => held.delete(e.code));
    window.addEventListener('blur', () => held.clear());
    // 操作が止まったら操作バーを隠す
    let idleTimer = 0;
    function wake() {
      document.body.classList.remove('idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (V.opts.autohide && V.playing && !document.querySelector('.drawer.open')) document.body.classList.add('idle');
      }, 3000);
    }
    document.addEventListener('pointermove', wake);
    document.addEventListener('pointerdown', wake);
    wake();
  }

  function pick(cx, cy) {
    const rc = new THREE.Raycaster();
    const v = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    rc.setFromCamera(v, camera);
    const meshes = [];
    for (const b of world.batches) for (const m of b.meshes) if (m.count) meshes.push(m);
    const hits = rc.intersectObjects(meshes, false);
    let found = -1;
    if (hits.length && hits[0].instanceId != null) {
      const b = hits[0].object.userData.batch;
      found = b.shown[hits[0].instanceId];
    } else {
      // 小さく見えている艦: 画面上でいちばん近いもの
      let best = 18;
      for (let i = 0; i < V.R.n; i++) {
        const st = world.unitState[i];
        if (!st.vis) continue;
        const p = project(st.pos.x, st.pos.y, st.pos.z);
        if (!p) continue;
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < best) { best = d; found = i; }
      }
    }
    if (found >= 0) { V.selected = found; V.lastCard = ''; updateCard(); }
    else { V.selected = -1; $('card').hidden = true; }
  }

  // 開発者ツールやテストから触れるように
  window.Viewer3D = {
    V, setCam, loadSource, presetSource, toggleRec,
    seek: (t) => { V.vt = clamp(t, 0, V.R.end); world.spreadCut = true; },
    play: () => { V.playing = true; updatePlayBtn(); },
    view: () => ({ camera, controls }),
    stats: () => ({ batches: world.batches.length, ships: world.batches.reduce((a, b) => a + b.meshes[0].count, 0), sprites: spriteN, shots: V.R.nShots, flashes: V.R.flashes.length, models: world.batches.map((b) => b.tid + ':' + b.model.source) }),
  };

  boot();
})();
