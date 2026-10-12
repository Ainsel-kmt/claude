/* 3Dビューアの艦モデル
 *
 * 既定のモデルはコードで組み立てる。GLB（glTF）のモデルがあれば艦種ごとに差し替える。
 * モデルの決まり: 前が +Z、上が +Y。大きさは自動でそろえる（長さを艦種ごとの既定の長さに合わせる）。
 * マテリアル名に team / accent / チーム を含む部分は、陣営の色で光らせる。
 *
 * window.ShipModelKit(THREE, addons) が、viewer3d.js から three.js を読み込んだあとに呼ばれる。
 */
(function (global) {
  'use strict';

  global.ShipModelKit = function (THREE, addons) {
    const { mergeGeometries, GLTFLoader, GLTFExporter } = addons;

    // 陣営の色（発光用に明るめ）と船体の色
    const SIDE_GLOW = [new THREE.Color(0.35, 0.75, 1.6), new THREE.Color(1.8, 0.62, 0.18)];
    const SIDE_TINT = [new THREE.Color('#3987e5'), new THREE.Color('#e8692c')];
    const HULL = {
      human: { color: '#9aa6b4', metalness: 0.7, roughness: 0.4 },
      human2: { color: '#5e6a78', metalness: 0.7, roughness: 0.5 },
      alien: { color: '#6a5442', metalness: 0.55, roughness: 0.42 },
      alien2: { color: '#2b2420', metalness: 0.5, roughness: 0.6 },
    };

    // 艦種ごとの既定の長さ（光秒）。実物（数km）よりはるかに大きく誇張している
    const BASE_LENGTH = {
      node: 0.3, guard: 0.16, comms: 0.18, quiet: 0.24, picket: 0.11, base: 2.0, base2: 1.6,
      narm: 0.14, garmes: 0.45, elda: 0.26, generic: 0.16,
    };

    // ---------------------------------------------------------------- 部品

    const D = Math.PI / 180;
    function prep(g, opt) {
      opt = opt || {};
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((opt.rx || 0) * D, (opt.ry || 0) * D, (opt.rz || 0) * D));
      const s = opt.s ? (Array.isArray(opt.s) ? new THREE.Vector3(...opt.s) : new THREE.Vector3(opt.s, opt.s, opt.s)) : new THREE.Vector3(1, 1, 1);
      m.compose(new THREE.Vector3(opt.x || 0, opt.y || 0, opt.z || 0), q, s);
      g = g.index ? g.toNonIndexed() : g;
      g.applyMatrix4(m);
      g.deleteAttribute('uv');
      return g;
    }
    // 円柱を Z 軸向きに（top が +Z）
    const cylZ = (rTop, rBot, len, seg, opt) => prep(new THREE.CylinderGeometry(rTop, rBot, len, seg || 8), Object.assign({ rx: 90 }, opt));
    const coneZ = (r, len, seg, opt) => prep(new THREE.ConeGeometry(r, len, seg || 8), Object.assign({ rx: 90 }, opt));
    const box = (w, h, l, opt) => prep(new THREE.BoxGeometry(w, h, l), opt);
    const sph = (r, opt) => prep(new THREE.SphereGeometry(r, 12, 8), opt);
    const torus = (r, t, seg, opt) => prep(new THREE.TorusGeometry(r, t, 6, seg || 24), opt);
    const octa = (r, opt) => prep(new THREE.OctahedronGeometry(r, 0), opt);

    // 部品の一覧（材質ごと）から設計図を作る
    function design(parts) { return parts; }

    // 材質の種類: hull / hull2 / glow（陣営色で発光）/ white（白い発光）
    const DESIGNS = {
      guard: () => design({
        hull: [cylZ(0.05, 0.12, 0.62, 6), coneZ(0.05, 0.22, 6, { z: 0.42 }), box(0.07, 0.045, 0.34, { x: 0.16, z: -0.08 }), box(0.07, 0.045, 0.34, { x: -0.16, z: -0.08 })],
        hull2: [box(0.34, 0.02, 0.18, { z: -0.12 }), box(0.03, 0.12, 0.16, { y: 0.08, z: -0.2 })],
        glow: [box(0.012, 0.05, 0.26, { x: 0.2, z: -0.06 }), box(0.012, 0.05, 0.26, { x: -0.2, z: -0.06 }), cylZ(0.04, 0.04, 0.04, 8, { z: -0.33 }),
          cylZ(0.025, 0.025, 0.03, 8, { x: 0.16, z: -0.26 }), cylZ(0.025, 0.025, 0.03, 8, { x: -0.16, z: -0.26 })],
        white: [sph(0.02, { y: 0.05, z: 0.18 })],
      }),
      node: () => design({
        hull: [cylZ(0.07, 0.11, 0.8, 8), coneZ(0.07, 0.18, 8, { z: 0.49 }), cylZ(0.13, 0.13, 0.12, 8, { z: -0.1 })],
        hull2: [box(0.62, 0.02, 0.05, { z: -0.1 }), box(0.02, 0.62, 0.05, { z: -0.1 })],
        glow: [torus(0.3, 0.018, 32, { z: -0.1 }), cylZ(0.06, 0.06, 0.05, 8, { z: -0.42 }), sph(0.05, { z: 0.6 })],
        white: [sph(0.07, { z: -0.1 })],
      }),
      comms: () => design({
        hull: [cylZ(0.05, 0.08, 0.7, 6), coneZ(0.05, 0.14, 6, { z: 0.42 })],
        hull2: [prep(new THREE.CylinderGeometry(0.2, 0.06, 0.06, 16, 1, true), { y: 0.18, rx: -20 }), box(0.02, 0.18, 0.02, { y: 0.09 })],
        glow: [sph(0.03, { y: 0.27, z: 0.03 }), cylZ(0.035, 0.035, 0.04, 8, { z: -0.37 }), box(0.3, 0.01, 0.01, { z: 0.1 })],
        white: [sph(0.015, { x: 0.15, z: 0.1 }), sph(0.015, { x: -0.15, z: 0.1 })],
      }),
      quiet: () => design({
        hull: [prep(new THREE.CylinderGeometry(0.42, 0.5, 0.08, 6)), prep(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), { y: 0.04 })],
        hull2: [prep(new THREE.CylinderGeometry(0.5, 0.42, 0.05, 6), { y: -0.06 })],
        glow: [torus(0.47, 0.018, 6, { rx: 90, ry: 30, y: 0.01 }), sph(0.05, { y: 0.18 })],
        white: [cylZ(0.04, 0.04, 0.03, 8, { z: -0.5 })],
      }),
      picket: () => design({
        hull: [coneZ(0.07, 0.7, 5, { z: 0.05 })],
        hull2: [box(0.36, 0.015, 0.14, { z: -0.2 }), box(0.015, 0.16, 0.12, { y: 0.07, z: -0.22 })],
        glow: [sph(0.035, { z: 0.38 }), cylZ(0.03, 0.03, 0.03, 6, { z: -0.31 })],
        white: [],
      }),
      base: () => design({
        hull: [cylZ(0.09, 0.12, 0.9, 12, { rx: 0 }), torus(0.42, 0.045, 32, { rx: 90 }), torus(0.25, 0.03, 24, { rx: 90, y: 0.22 })],
        hull2: [box(0.84, 0.03, 0.04), box(0.04, 0.03, 0.84), box(0.6, 0.02, 0.03, { y: 0.22, ry: 45 }), box(0.6, 0.02, 0.03, { y: 0.22, ry: -45 })],
        glow: [torus(0.42, 0.012, 48, { rx: 90, y: 0.05 }), sph(0.06, { y: 0.48 }), sph(0.05, { y: -0.48 })],
        white: [sph(0.02, { x: 0.42 }), sph(0.02, { x: -0.42 }), sph(0.02, { z: 0.42 }), sph(0.02, { z: -0.42 })],
      }),
      narm: () => design({
        hull: [prep(new THREE.ConeGeometry(0.2, 0.9, 3), { rx: 90, s: [1, 1, 0.35] })],
        hull2: [prep(new THREE.ConeGeometry(0.1, 0.4, 3), { rx: 90, rz: 180, s: [1.6, 1, 0.3], z: -0.32 }), box(0.012, 0.12, 0.35, { y: 0.05, z: -0.05 })],
        glow: [box(0.02, 0.02, 0.5, { y: 0.035, z: 0.02 }), sph(0.035, { z: -0.42 }), box(0.3, 0.008, 0.02, { z: -0.2 })],
        white: [],
      }),
      garmes: () => design({
        hull: [box(0.2, 0.14, 0.95), coneZ(0.11, 0.2, 4, { z: 0.57, rz: 45 })],
        hull2: [box(0.34, 0.06, 0.2, { z: 0.25 }), box(0.34, 0.06, 0.2, { z: -0.05 }), box(0.34, 0.06, 0.2, { z: -0.35 }), box(0.05, 0.22, 0.6, { y: 0.1 })],
        glow: [box(0.36, 0.012, 0.03, { z: 0.25 }), box(0.36, 0.012, 0.03, { z: -0.05 }), box(0.36, 0.012, 0.03, { z: -0.35 }), box(0.16, 0.08, 0.02, { z: -0.48 })],
        white: [],
      }),
      elda: () => design({
        hull: [box(0.16, 0.12, 0.42, { z: -0.18 }), cylZ(0.015, 0.03, 0.62, 6, { z: 0.3 })],
        hull2: [box(0.42, 0.03, 0.12, { z: -0.26 }), box(0.03, 0.26, 0.12, { z: -0.26 })],
        glow: [torus(0.06, 0.012, 16, { z: 0.62 }), torus(0.1, 0.01, 16, { z: 0.5 }), sph(0.025, { z: 0.62 }), box(0.18, 0.02, 0.02, { z: -0.4 })],
        white: [],
      }),
      // 形からの汎用
      circle: () => design({ hull: [sph(0.3, { s: [0.7, 0.55, 1] })], hull2: [], glow: [cylZ(0.05, 0.05, 0.04, 8, { z: -0.3 })], white: [] }),
      diamond: () => design({ hull: [octa(0.35, { s: [0.6, 0.45, 1.3] })], hull2: [], glow: [sph(0.04, { z: -0.44 })], white: [] }),
      triangle: () => design({ hull: [coneZ(0.2, 0.8, 3)], hull2: [], glow: [sph(0.04, { z: -0.4 })], white: [] }),
      square: () => design({ hull: [box(0.3, 0.2, 0.8)], hull2: [], glow: [box(0.25, 0.04, 0.02, { z: -0.41 })], white: [] }),
      hexagon: () => design({ hull: [prep(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 6))], hull2: [], glow: [torus(0.45, 0.015, 6, { rx: 90, ry: 30 })], white: [] }),
      star: () => DESIGNS.base(),
    };

    const designKey = (tid, def) => (DESIGNS[tid] ? tid : tid === 'base2' ? 'base' : (DESIGNS[def.shape] ? def.shape : 'circle'));
    const isAlien = (key, def) => ['narm', 'garmes', 'elda'].includes(key) || (!DESIGNS[key] && def.jump === 'lane');

    function materialsFor(key, def, side) {
      const alien = isAlien(key, def);
      const h1 = alien ? HULL.alien : HULL.human, h2 = alien ? HULL.alien2 : HULL.human2;
      return {
        hull: new THREE.MeshStandardMaterial({ color: h1.color, metalness: h1.metalness, roughness: h1.roughness }),
        hull2: new THREE.MeshStandardMaterial({ color: h2.color, metalness: h2.metalness, roughness: h2.roughness }),
        glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: SIDE_GLOW[side], emissiveIntensity: 2.2 }),
        white: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.6, 1.6, 1.7), emissiveIntensity: 1.5 }),
      };
    }

    // 部品の組 → { parts: [{ geometry, material }], length }（長さ1にそろえ、原点を中心に）
    function normalize(parts) {
      const bb = new THREE.Box3();
      for (const p of parts) { p.geometry.computeBoundingBox(); bb.union(p.geometry.boundingBox); }
      const size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      const len = Math.max(size.z, size.x * 0.8, size.y * 0.8, 1e-6);
      const m = new THREE.Matrix4().makeScale(1 / len, 1 / len, 1 / len).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      for (const p of parts) { p.geometry.applyMatrix4(m); p.geometry.computeBoundingSphere(); }
      return parts;
    }

    function buildDefault(tid, def, side) {
      const key = designKey(tid, def);
      const d = DESIGNS[key]();
      const mats = materialsFor(key, def, side);
      const parts = [];
      for (const k of ['hull', 'hull2', 'glow', 'white']) {
        const gs = (d[k] || []).filter(Boolean);
        if (!gs.length) continue;
        const g = mergeGeometries(gs, false);
        g.computeVertexNormals();
        parts.push({ geometry: g, material: mats[k] });
      }
      return { parts: normalize(parts), source: '既定', key };
    }

    function defaultLength(tid, def) {
      if (BASE_LENGTH[tid]) return BASE_LENGTH[tid];
      if (def.speed <= 0 && def.jump === 'none') return 1.5 * (def.size || 1);
      return 0.16 * (def.size || 1);
    }

    // ---------------------------------------------------------------- GLB の差し替え

    // 登録: { キー: { data(ArrayBuffer), name, scale, rotation[x,y,z]（度）, offset[x,y,z], length } }
    // キーは "1:narm"（陣営:艦種ID）、"narm"（艦種ID）、"ナーム級"（艦種名）の順に探す
    const overrides = {};

    function b64ToBuffer(b64) {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u.buffer;
    }

    function parseGlb(buffer) {
      return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', (g) => resolve(g), (e) => reject(e)));
    }

    async function prepareOverride(entry) {
      const gltf = await parseGlb(entry.data);
      const root = gltf.scene;
      const r = entry.rotation || [0, 0, 0];
      root.rotation.set(r[0] * D, r[1] * D, r[2] * D);
      root.updateMatrixWorld(true);
      const parts = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        parts.push({ geometry: g, material: o.material, team: [].concat(o.material).some((m) => /team|accent|チーム/i.test(m.name || '')) });
      });
      if (!parts.length) throw new Error('メッシュが入っていません');
      normalize(parts);
      if (entry.offset) for (const p of parts) p.geometry.translate(entry.offset[0] || 0, entry.offset[1] || 0, entry.offset[2] || 0);
      return parts;
    }

    async function register(key, entry) {
      const e = Object.assign({}, entry);
      if (typeof e.data === 'string') e.data = b64ToBuffer(e.data);
      e.parts = await prepareOverride(e);
      overrides[key] = e;
      return e;
    }
    function unregister(key) { delete overrides[key]; }

    // models/models.js（tools/pack-models.js で作る）を読み込む
    async function loadPacked(packed) {
      const errors = [];
      if (!packed || !packed.entries) return errors;
      for (const [key, entry] of Object.entries(packed.entries)) {
        try { await register(key, entry); } catch (e) { errors.push(key + ': ' + e.message); }
      }
      return errors;
    }

    function findOverride(tid, def, side) {
      return overrides[side + ':' + tid] || overrides[tid] || overrides[side + ':' + def.name] || overrides[def.name] || null;
    }

    // 艦種と陣営に対するモデル（部品の組と長さ）
    function modelFor(tid, def, side) {
      const ov = findOverride(tid, def, side);
      const len = defaultLength(tid, def) * (ov && ov.scale ? ov.scale : 1) * (ov && ov.length ? ov.length / defaultLength(tid, def) : 1);
      if (ov) {
        const parts = ov.parts.map((p) => {
          let material = p.material;
          if (p.team) {
            material = [].concat(p.material).map((m) => {
              if (!/team|accent|チーム/i.test(m.name || '')) return m;
              const c = m.clone();
              if (c.emissive) { c.emissive = SIDE_GLOW[side].clone(); c.emissiveIntensity = 2; }
              if (c.color) c.color = SIDE_TINT[side].clone();
              return c;
            });
            if (material.length === 1) material = material[0];
          }
          return { geometry: p.geometry, material };
        });
        return { parts, length: len, source: ov.name || 'GLB', key: tid };
      }
      const m = buildDefault(tid, def, side);
      return { parts: m.parts, length: len, source: '既定', key: m.key };
    }

    // 既定モデルを GLB に書き出す（差し替え用の型紙。向きと大きさの確認に使う）
    function exportTemplate(tid, def, side) {
      const m = buildDefault(tid, def, side);
      const g = new THREE.Group();
      g.name = def.name || tid;
      const names = ['hull', 'hull2', 'team_glow', 'white'];
      m.parts.forEach((p, i) => {
        const mat = p.material.clone();
        mat.name = names[i] || 'part' + i;
        const mesh = new THREE.Mesh(p.geometry, mat);
        mesh.name = mat.name;
        g.add(mesh);
      });
      return new Promise((resolve, reject) => {
        new GLTFExporter().parse(g, (res) => resolve(res), (e) => reject(e), { binary: true });
      });
    }

    return { modelFor, register, unregister, loadPacked, exportTemplate, defaultLength, overrides, SIDE_GLOW, SIDE_TINT };
  };
})(typeof window !== 'undefined' ? window : globalThis);
