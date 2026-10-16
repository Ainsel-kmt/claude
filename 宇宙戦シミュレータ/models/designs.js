/* 宇宙戦シミュレータ 艦のモデル（グランドデザインにそって組み立てる）
 *
 * グランドデザインは models/デザイン.md。ここはそれを形にするコード。
 * 人類統合機構は「軍艦＋幽子の輪」、ザイレンは「線と体節」。
 * models/gallery.html で並べて見たり、GLB に書き出したりする（書き出した GLB を 3Dビューアが使う）。
 *
 * 決まり: 前（艦首）が +Z、上が +Y。長さは 10 前後で作る（ビューアが艦種ごとの長さにそろえる）。
 * 材質は5つで、名前で役目が決まる。hull（船体）・hull2（暗い装甲・内側）・trim（金属の縁）・
 * team_glow（陣営の色で光る。ビューアが陣営の色に塗り替える）・white_light（白い灯り）。
 * window.ShipDesigns(THREE, { mergeGeometries, mergeVertices }) で使う。
 */
(function (global) {
  'use strict';

  global.ShipDesigns = function (THREE, utils) {
    const { mergeGeometries, mergeVertices } = utils;
    const D = Math.PI / 180;
    const TAU = Math.PI * 2;

    // ---------------------------------------------------------------- 色と材質

    const PALETTE = {
      human: {
        hull: { color: '#a8b1bc', metalness: 0.45, roughness: 0.52 },
        hull2: { color: '#47505b', metalness: 0.55, roughness: 0.55 },
        trim: { color: '#8c98a6', metalness: 0.6, roughness: 0.34 },
        glow: '#4aa6ff',
      },
      zairen: {
        hull: { color: '#6a5040', metalness: 0.22, roughness: 0.45 },
        hull2: { color: '#2a201a', metalness: 0.2, roughness: 0.62 },
        trim: { color: '#b08658', metalness: 0.6, roughness: 0.32 },
        glow: '#ff8a2a',
      },
    };

    function materials(faction) {
      const p = PALETTE[faction];
      const std = (name, o, extra) => new THREE.MeshStandardMaterial(Object.assign({ name, color: o.color, metalness: o.metalness, roughness: o.roughness }, extra || {}));
      return {
        hull: std('hull', p.hull),
        hull2: std('hull2', p.hull2, { side: THREE.DoubleSide }),
        trim: std('trim', p.trim),
        team: new THREE.MeshStandardMaterial({ name: 'team_glow', color: '#000000', emissive: p.glow, emissiveIntensity: 2.4, metalness: 0, roughness: 1 }),
        white: new THREE.MeshStandardMaterial({ name: 'white_light', color: '#000000', emissive: '#e8f0ff', emissiveIntensity: 0.75, metalness: 0, roughness: 1 }),
      };
    }

    // ---------------------------------------------------------------- 形の道具

    function rng(seed) {
      let s = seed >>> 0;
      return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }

    // 位置・回転（度）・大きさ（数か [x, y, z]）を当てる
    function xf(g, o) {
      if (!o) return g;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((o.rx || 0) * D, (o.ry || 0) * D, (o.rz || 0) * D, 'XYZ'));
      const s = o.s == null ? new THREE.Vector3(1, 1, 1) : Array.isArray(o.s) ? new THREE.Vector3(o.s[0], o.s[1], o.s[2]) : new THREE.Vector3(o.s, o.s, o.s);
      m.compose(new THREE.Vector3(o.x || 0, o.y || 0, o.z || 0), q, s);
      g.applyMatrix4(m);
      return g;
    }
    // 添字なし・位置と法線だけの形にする。flat なら面ごとの法線（角ばった見た目）
    function plain(g, flat) {
      g = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (flat || !g.attributes.normal) { g.deleteAttribute('normal'); g.computeVertexNormals(); }
      return g;
    }
    // Y 軸向きの形を Z 軸向き（艦首方向）に倒す
    const toZ = (g) => xf(g, { rx: 90 });

    const box = (w, h, l, o) => xf(plain(new THREE.BoxGeometry(w, h, l), true), o);

    // 角を落とした八角形
    function octShape(w, h, k) {
      const x = w / 2, y = h / 2;
      k = Math.max(0.001, Math.min(k, x * 0.9, y * 0.9));
      const s = new THREE.Shape();
      s.moveTo(-x + k, -y); s.lineTo(x - k, -y); s.lineTo(x, -y + k); s.lineTo(x, y - k);
      s.lineTo(x - k, y); s.lineTo(-x + k, y); s.lineTo(-x, y - k); s.lineTo(-x, -y + k); s.closePath();
      return s;
    }
    // 面取りした箱（断面 w×h、長さ l、面取り c）。装甲の塊
    function cbox(w, h, l, c, o) {
      c = Math.max(0.002, Math.min(c, w / 2 * 0.9, h / 2 * 0.9, l / 2 * 0.9));
      const g = new THREE.ExtrudeGeometry(octShape(w - 2 * c, h - 2 * c, c * 0.8), { depth: Math.max(1e-3, l - 2 * c), bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, steps: 1, curveSegments: 1 });
      g.translate(0, 0, -(l - 2 * c) / 2);
      return xf(plain(g, true), o);
    }
    // 断面 pts（[[x, y], ...] 反時計回り）を長さ l だけ押し出した柱。taper(t) で長さ方向に断面を変える
    // （t は 0 が艦尾側の端、1 が艦首側の端。[x の倍率, y の倍率, y のずれ] を返す）
    function prism(pts, l, c, o, steps, taper) {
      const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-3, l - 2 * c), bevelEnabled: c > 0, bevelThickness: c, bevelSize: c, bevelSegments: 1, steps: steps || 1, curveSegments: 1 });
      g.translate(0, 0, -(l - 2 * c) / 2);
      if (taper) {
        g.computeBoundingBox();
        const z0 = g.boundingBox.min.z, z1 = g.boundingBox.max.z, p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const r = taper((p.getZ(i) - z0) / (z1 - z0 || 1));
          p.setXYZ(i, p.getX(i) * r[0], p.getY(i) * r[1] + (r[2] || 0), p.getZ(i));
        }
      }
      return xf(plain(g, true), o);
    }
    // 回転体（[[半径, z], ...] を z の小さい順に）。Z 軸まわり
    function lathe(prof, seg, o, flat) {
      const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(Math.max(1e-4, r), z)), seg);
      return xf(plain(toZ(g), flat), o);
    }
    const cyl = (rt, rb, l, seg, o, flat) => xf(plain(toZ(new THREE.CylinderGeometry(rt, rb, l, seg || 12)), flat), o);
    // Z 軸を囲む輪
    const ring = (R, t, rs, ts, o) => xf(plain(new THREE.TorusGeometry(R, t, rs || 8, ts || 48)), o);
    const sph = (r, ws, hs, o) => xf(plain(new THREE.SphereGeometry(r, ws || 10, hs || 8)), o);
    // 上半分の丸屋根（+Y 向き）
    const dome = (r, ws, o) => xf(plain(new THREE.SphereGeometry(r, ws || 12, Math.max(3, (ws || 12) / 2), 0, TAU, 0, Math.PI / 2)), o);
    // 上側だけの殻（Z 軸向きの筒の、上の arc 度ぶん）
    function shell(r, l, arc, seg, o) {
      const a = arc * D;
      const g = new THREE.CylinderGeometry(r, r, l, seg || 10, 1, true, Math.PI - a / 2, a);
      return xf(plain(toZ(g), true), o);
    }
    function tube(pts, r, seg, rs, o) {
      const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
      return xf(plain(new THREE.TubeGeometry(c, seg || 24, r, rs || 6, false)), o);
    }

    // 部品の入れ物（材質ごと）
    const parts = () => ({ hull: [], hull2: [], trim: [], team: [], white: [] });

    // 材質ごとにまとめ、同じ頂点をまとめて軽くする
    function finish(P) {
      const out = {};
      for (const k of Object.keys(P)) {
        const gs = P[k].filter(Boolean);
        if (!gs.length) continue;
        let g = mergeGeometries(gs, false);
        g = mergeVertices(g, 1e-4);
        g.computeBoundingBox(); g.computeBoundingSphere();
        out[k] = g;
      }
      return out;
    }

    // ================================================================ 人類統合機構: 軍艦＋幽子の輪

    // 船体: 甲板が平らで、側面が面取りされ、竜骨が細い六角の断面。艦首はくさび形にすぼまる
    function hHull(P, L, W, H, o) {
      o = o || {};
      const z = o.z || 0, prow = o.prow == null ? 0.6 : o.prow;
      const pts = [[-0.3 * W, -H / 2], [0.3 * W, -H / 2], [W / 2, -0.08 * H], [0.4 * W, H / 2], [-0.4 * W, H / 2], [-W / 2, -0.08 * H]];
      const c = Math.min(W, H) * 0.035;
      P.hull.push(prism(pts, L, c, { z }, 10, (t) => {
        let sx = 1, sy = 1, dy = 0;
        if (t > prow) { const u = (t - prow) / (1 - prow); sx = 1 - 0.82 * Math.pow(u, 1.25); sy = 1 - 0.5 * u; dy = -0.2 * H * u; }
        if (t < 0.04) { const u = 1 - t / 0.04; sx *= 1 - 0.06 * u; sy *= 1 - 0.06 * u; }
        return [sx, sy, dy];
      }));
      // 甲板の上の装甲（暗い帯）・両舷の装甲帯・竜骨
      P.hull2.push(cbox(W * 0.46, H * 0.14, L * 0.4, H * 0.03, { y: H / 2 + H * 0.05, z: z - L * 0.12 }));
      for (const s of [-1, 1]) P.hull2.push(cbox(W * 0.05, H * 0.3, L * 0.48, W * 0.01, { x: s * W * 0.49, y: -0.06 * H, z: z - L * 0.08 }));
      P.hull2.push(cbox(W * 0.32, H * 0.18, L * 0.52, H * 0.03, { y: -H / 2 - H * 0.05, z: z - L * 0.1 }));
      // 甲板の継ぎ目（細い暗い線）
      for (let i = 0; i < 4; i++) P.hull2.push(box(W * 0.78, 0.012 * H, 0.025 * L * 0.4, { y: H / 2 + 0.004, z: z - L * 0.42 + i * L * 0.17 }));
      // 艦首寄りの陣営の帯
      for (const s of [-1, 1]) P.team.push(box(W * 0.015, H * 0.05, L * 0.14, { x: s * W * 0.497, y: H * 0.12, z: z + L * 0.02 }));
      // 舷側の装甲の継ぎ目（縦の溝）と、上の段の小さな窓の列
      for (const s of [-1, 1]) {
        for (let i = 0; i < 5; i++) P.hull2.push(box(0.012 * W, H * 0.42, 0.02 * L * 0.5, { x: s * (W * 0.5 + 0.004), y: H * 0.12, z: z - L * 0.4 + i * L * 0.11 }));
        if (!o.noWindows) for (let i = 0; i < 4; i++) P.white.push(box(0.01, H * 0.03, L * 0.01, { x: s * (W * 0.45 + 0.006), y: H * 0.38, z: z - L * 0.34 + i * L * 0.07, rz: s * 25 }));
      }
    }

    // 幽子の輪: 全艦に共通の思考主推進機関・ウォードの発生器。金属の輪の前後に陣営色の光の帯、
    // 輪の上に発生器の塊（白い灯り付き）、船体とは支柱でつなぐ
    function hRing(P, R, t, z, o) {
      o = o || {};
      P.trim.push(ring(R, t, 6, 48, { z }));
      for (const dz of [-1, 1]) P.team.push(ring(R - t * 0.1, t * 0.28, 4, 48, { z: z + dz * t * 0.92 }));
      const n = o.nodes || 4, rot = o.rot == null ? 45 : o.rot;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rot * D;
        P.hull.push(cbox(t * 2.7, t * 2.2, t * 3.4, t * 0.45, { x: Math.cos(a) * R, y: Math.sin(a) * R, z, rz: a / D }));
        P.white.push(sph(t * 0.32, 6, 4, { x: Math.cos(a) * (R + t * 1.25), y: Math.sin(a) * (R + t * 1.25), z }));
      }
      const ns = o.struts || 4, r0 = o.r0 || R * 0.35, srot = o.srot == null ? 0 : o.srot;
      for (let i = 0; i < ns; i++) {
        const a = (i / ns) * TAU + srot * D, rm = (R + r0) / 2;
        P.hull2.push(cbox(R - r0, t * 0.8, t * 1.3, t * 0.2, { x: Math.cos(a) * rm, y: Math.sin(a) * rm, z, rz: a / D }));
      }
    }

    // 機関: 釣鐘形の噴射口（艦尾向き）、縁の金具、奥の陣営色の光
    function hEngine(P, x, y, z, r) {
      P.hull2.push(lathe([[r * 0.92, -1.3 * r], [r * 1.02, -1.2 * r], [r, -0.85 * r], [r * 0.74, 0], [r * 0.6, 0.25 * r]], 18, { x, y, z }));
      P.trim.push(ring(r * 0.78, r * 0.09, 6, 24, { x, y, z: z + 0.05 * r }));
      P.team.push(cyl(r * 0.84, r * 0.84, 0.05 * r, 18, { x, y, z: z - 1.0 * r }));
    }
    // 機関部の箱と噴射口の並び
    function hEngines(P, z, list, r, W, H) {
      P.hull2.push(cbox(W, H, r * 2.6, Math.min(W, H) * 0.08, { z: z + r * 1.1 }));
      for (const [x, y] of list) hEngine(P, x, y, z, r);
    }

    // 主砲（ライン系統の照射器）: 丸い砲塔、短い砲身、先の陣営色のレンズ
    function hTurret(P, x, y, z, r) {
      P.trim.push(dome(r, 12, { x, y, z }));
      P.hull2.push(cyl(r * 0.2, r * 0.26, r * 1.7, 8, { x, y: y + r * 0.42, z: z + r * 1.0 }));
      P.team.push(sph(r * 0.17, 8, 6, { x, y: y + r * 0.42, z: z + r * 1.9 }));
    }

    // 艦橋: 面取りした塔、前向きの窓の帯、帆柱と灯り
    function hBridge(P, x, y, z, w, h, l) {
      P.hull.push(cbox(w, h, l, Math.min(w, h) * 0.14, { x, y: y + h / 2, z }));
      P.hull2.push(cbox(w * 0.7, h * 0.5, l * 0.7, Math.min(w, h) * 0.1, { x, y: y + h + h * 0.22, z: z - l * 0.1 }));
      P.white.push(box(w * 0.8, h * 0.1, 0.02, { x, y: y + h * 0.75, z: z + l / 2 + 0.006 }));
      P.trim.push(cyl(0.025, 0.045, h * 1.4, 6, { x, y: y + h * 1.45 + h * 0.7, z: z - l * 0.25, rx: -90 }));
      P.white.push(sph(0.05, 6, 4, { x, y: y + h * 1.45 + h * 1.4, z: z - l * 0.25 }));
    }

    // 甲板の小さな出っ張り（機器箱・配管の覆い）。乱数は艦種ごとに決まっている
    function hGreebles(P, seed, n, x0, x1, y, z0, z1, size) {
      const r = rng(seed);
      for (let i = 0; i < n; i++) {
        const w = size * (0.5 + r()), l = size * (0.5 + r() * 1.5), h = size * (0.2 + r() * 0.5);
        P[r() < 0.7 ? 'hull2' : 'trim'].push(box(w, h, l, { x: x0 + (x1 - x0) * r(), y: y + h / 2, z: z0 + (z1 - z0) * r() }));
      }
    }
    // 航海灯（左舷・右舷）
    function navLights(P, x, y, z, r) {
      P.white.push(sph(r, 6, 4, { x, y, z }));
      P.white.push(sph(r, 6, 4, { x: -x, y, z }));
    }

    const HUMAN = {
      // ガード級: 量産の護衛艦。くさび形の船体に小さな幽子の輪が1つ、主砲2基、機関2基
      guard() {
        const P = parts(), L = 10, W = 2.2, H = 1.35;
        hHull(P, L, W, H);
        hRing(P, 1.55, 0.13, -1.0, { nodes: 4, struts: 4 });
        hEngines(P, -5.3, [[-0.52, -0.05], [0.52, -0.05]], 0.4, W * 0.82, H * 0.9);
        hBridge(P, 0, H / 2 + H * 0.12, -2.7, 0.75, 0.42, 1.1);
        hTurret(P, 0, H / 2 + 0.02, 1.4, 0.3);
        hTurret(P, 0, H / 2 + H * 0.19, -0.2 - 1.5, 0.26);
        for (const s of [-1, 1]) P.hull2.push(cbox(0.05, 0.85, 1.3, 0.015, { x: s * 1.18, y: 0.15, z: -3.4, rz: s * -18 }));
        hGreebles(P, 11, 14, -0.6, 0.6, H / 2, 0.2, 2.8, 0.14);
        navLights(P, 1.32, 0.55, -3.4, 0.05);
        return P;
      },
      // ノード艦: リンクの中枢。二重の幽子の輪を籠でつなぎ、背にリンクの送信塔、機関4基、主砲4基、艦尾にウォードの翼
      node() {
        const P = parts(), L = 10, W = 2.3, H = 1.75;
        hHull(P, L, W, H, { prow: 0.64 });
        P.hull.push(cbox(W * 0.62, H * 0.42, L * 0.36, 0.08, { y: H / 2 + H * 0.2, z: -0.9 }));
        for (const z of [-0.85, 0.65]) hRing(P, 2.15, 0.16, z, { nodes: 6, struts: 6, rot: 30, srot: 30 });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + 22.5 * D;
          P.trim.push(cyl(0.035, 0.035, 1.5, 6, { x: Math.cos(a) * 2.15, y: Math.sin(a) * 2.15, z: -0.1 }));
        }
        // リンクの送信塔
        P.hull2.push(cyl(0.09, 0.16, 2.0, 8, { y: H / 2 + H * 0.4 + 1.0, z: -1.6, rx: -90 }));
        for (const [h, r] of [[0.8, 0.3], [1.3, 0.24], [1.75, 0.18]]) P.trim.push(ring(r, 0.03, 6, 24, { y: H / 2 + H * 0.4 + h, z: -1.6, rx: 90 }));
        P.team.push(sph(0.13, 10, 8, { y: H / 2 + H * 0.4 + 2.08, z: -1.6 }));
        hEngines(P, -5.3, [[-0.5, 0.32], [0.5, 0.32], [-0.5, -0.38], [0.5, -0.38]], 0.36, W * 0.84, H * 0.95);
        hBridge(P, 0, H / 2 + H * 0.41, -3.2, 0.85, 0.42, 1.0);
        hTurret(P, 0, H / 2 + 0.02, 1.9, 0.3);
        hTurret(P, 0, H / 2 + H * 0.41, 0.55, 0.28);
        for (const s of [-1, 1]) hTurret(P, s * 0.75, H / 2 - 0.02, 1.0, 0.22);
        // ウォードの翼（X 字）
        for (const a of [45, 135, 225, 315]) P.hull2.push(cbox(1.4, 0.06, 1.2, 0.02, { x: Math.cos(a * D) * 1.25, y: Math.sin(a * D) * 1.05, z: -4.0, rz: a }));
        for (const a of [45, 135, 225, 315]) P.team.push(box(0.5, 0.075, 0.05, { x: Math.cos(a * D) * 1.75, y: Math.sin(a * D) * 1.45, z: -3.42, rz: a }));
        hGreebles(P, 23, 18, -0.7, 0.7, H / 2, 1.0, 3.2, 0.14);
        navLights(P, 1.2, 0.0, -2.0, 0.05);
        return P;
      },
      // 通信艦: 細身の船体に、両舷の大きな皿形アンテナ（幽子ペアの送受信）と背の帆柱、前に伸びるアンテナの竿
      comms() {
        const P = parts(), L = 10, W = 1.55, H = 1.15;
        hHull(P, L, W, H, { prow: 0.66 });
        hRing(P, 1.1, 0.1, -2.6, { nodes: 4, struts: 4 });
        hEngines(P, -5.2, [[0, 0]], 0.42, W * 0.7, H * 0.8);
        hBridge(P, 0, H / 2 + H * 0.12, -3.6, 0.6, 0.36, 0.9);
        // 帆柱と横木
        P.hull2.push(cyl(0.07, 0.12, 2.4, 8, { y: H / 2 + 1.2, z: 0.3, rx: -90 }));
        for (const [h, w] of [[0.9, 1.4], [1.6, 1.0], [2.2, 0.6]]) P.trim.push(box(w, 0.04, 0.06, { y: H / 2 + h, z: 0.3 }));
        P.white.push(sph(0.07, 8, 6, { y: H / 2 + 2.45, z: 0.3 }));
        // 両舷の皿
        for (const s of [-1, 1]) {
          const x = s * 1.55;
          P.hull2.push(cbox(0.9, 0.12, 0.3, 0.03, { x: s * 1.0, y: 0.25, z: -0.6 }));
          P.hull2.push(lathe([[0.02, -0.02], [0.6, 0.06], [1.05, 0.26], [1.1, 0.3]], 24, { x, y: 0.25, z: -0.6, ry: s * 90 }));
          P.trim.push(ring(1.08, 0.035, 6, 32, { x: x + s * 0.3, y: 0.25, z: -0.6, ry: s * 90 }));
          P.team.push(sph(0.09, 8, 6, { x: x + s * 0.55, y: 0.25, z: -0.6 }));
          P.trim.push(cyl(0.02, 0.02, 0.55, 6, { x: x + s * 0.28, y: 0.25, z: -0.6, ry: 90 }));
        }
        // 前の竿
        for (const s of [-1, 1]) {
          P.trim.push(cyl(0.025, 0.04, 2.6, 6, { x: s * 0.25, y: 0.1, z: 5.6 }));
          P.white.push(sph(0.05, 6, 4, { x: s * 0.25, y: 0.1, z: 6.9 }));
        }
        hGreebles(P, 37, 10, -0.4, 0.4, H / 2, 1.2, 3.2, 0.12);
        for (let i = 0; i < 5; i++) navLights(P, 0.78, -0.05, -2.0 + i * 0.9, 0.035);
        return P;
      },
      // 静穏場艦: 妨害場を張る。船体をぐるりと囲む大きな平たい輪（六つの発生器の塔）と、背の丸屋根
      quiet() {
        const P = parts(), L = 10, W = 2.4, H = 1.55;
        hHull(P, L, W, H, { prow: 0.66 });
        P.trim.push(ring(3.3, 0.2, 6, 60, { z: -0.3, s: [1, 1, 0.55] }));
        for (const dz of [-1, 1]) P.team.push(ring(3.22, 0.07, 4, 60, { z: -0.3 + dz * 0.13 }));
        P.team.push(ring(3.5, 0.05, 4, 60, { z: -0.3 }));
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + 30 * D;
          P.hull.push(cbox(0.75, 0.55, 0.9, 0.12, { x: Math.cos(a) * 3.3, y: Math.sin(a) * 3.3, z: -0.3, rz: a / D }));
          P.team.push(box(0.08, 0.35, 0.92, { x: Math.cos(a) * 3.68, y: Math.sin(a) * 3.68, z: -0.3, rz: a / D }));
          P.hull2.push(cbox(2.2, 0.16, 0.3, 0.04, { x: Math.cos(a) * 2.05, y: Math.sin(a) * 2.05, z: -0.3, rz: a / D }));
        }
        P.hull.push(dome(0.85, 16, { y: H / 2 + 0.05, z: -0.3 }));
        P.trim.push(ring(0.88, 0.05, 6, 32, { y: H / 2 + 0.07, z: -0.3, rx: 90 }));
        P.team.push(sph(0.14, 10, 8, { y: H / 2 + 0.92, z: -0.3 }));
        hEngines(P, -5.2, [[-0.55, 0], [0.55, 0]], 0.38, W * 0.8, H * 0.85);
        hBridge(P, 0, H / 2 + H * 0.12, -3.3, 0.7, 0.4, 0.9);
        hTurret(P, 0, H / 2 + 0.02, 2.0, 0.24);
        hGreebles(P, 41, 10, -0.6, 0.6, H / 2, 0.9, 2.9, 0.12);
        return P;
      },
      // 哨戒艦: 細い針のような船体、前に長い探知の竿、両舷に薄い探知板、小さな幽子の輪
      picket() {
        const P = parts(), L = 9, W = 1.0, H = 0.75;
        hHull(P, L, W, H, { prow: 0.55, z: -0.5 });
        hRing(P, 0.85, 0.08, -3.0, { nodes: 3, struts: 3, rot: 90, srot: 90 });
        hEngines(P, -5.4, [[0, 0]], 0.3, W * 0.7, H * 0.8);
        P.trim.push(cyl(0.03, 0.06, 3.4, 6, { z: 5.4 }));
        for (const z of [4.6, 5.6, 6.6]) P.hull2.push(sph(0.09, 8, 6, { z }));
        P.team.push(sph(0.07, 8, 6, { z: 7.15 }));
        for (const s of [-1, 1]) {
          P.trim.push(cyl(0.025, 0.025, 1.0, 6, { x: s * 0.85, y: 0.05, z: -1.2, ry: 90 }));
          P.hull2.push(box(2.6, 0.03, 1.5, { x: s * 2.25, y: 0.05, z: -1.2 }));
          P.trim.push(box(2.66, 0.045, 0.05, { x: s * 2.25, y: 0.05, z: -0.45 }));
          P.trim.push(box(2.66, 0.045, 0.05, { x: s * 2.25, y: 0.05, z: -1.95 }));
          P.white.push(sph(0.045, 6, 4, { x: s * 3.55, y: 0.05, z: -1.2 }));
        }
        hBridge(P, 0, H / 2 + 0.05, -2.0, 0.45, 0.28, 0.7);
        return P;
      },
      // 拠点: 縦の塔を軸に、大きな居住の輪（12の区画）と幽子の輪、4本の腕、砲塔、塔の上の妨害場の発生器
      base() {
        const P = parts();
        const RY = { rx: 90 };   // Z 軸を囲む輪を、Y 軸を囲む（水平な）輪にする
        // 塔
        P.hull.push(cyl(0.55, 0.75, 6.2, 12, { rx: -90, y: 0.2 }));
        for (const [y, r] of [[-2.2, 1.0], [-0.4, 1.2], [1.6, 1.0]]) P.hull2.push(cyl(r, r, 0.45, 12, { rx: -90, y }, true));
        P.trim.push(dome(1.0, 18, { y: 3.3 }));
        P.team.push(ring(1.02, 0.06, 6, 40, Object.assign({ y: 3.32 }, RY)));
        P.team.push(sph(0.2, 10, 8, { y: 4.4 }));
        P.trim.push(cyl(0.05, 0.08, 1.0, 6, { rx: -90, y: 3.9 }));
        P.trim.push(cyl(0.04, 0.12, 2.2, 6, { rx: 90, y: -3.9 }));
        P.white.push(sph(0.08, 6, 4, { y: -5.0 }));
        // 居住の輪
        P.hull.push(ring(5.0, 0.42, 8, 72, RY));
        P.team.push(ring(5.0, 0.1, 4, 72, Object.assign({ y: 0.4 }, RY)));
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          P.hull2.push(cbox(1.15, 0.95, 1.5, 0.12, { x: Math.cos(a) * 5.0, z: Math.sin(a) * 5.0, ry: -a / D + 90 }));
          P.white.push(box(0.9, 0.06, 0.02, { x: Math.cos(a) * 5.62, y: 0.15, z: Math.sin(a) * 5.62, ry: -a / D + 90 }));
          if (i % 2 === 0) hTurretAt(P, Math.cos(a) * 5.0, 0.5, Math.sin(a) * 5.0, 0.3, a);
        }
        // スポーク
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + 45 * D;
          P.hull2.push(cbox(4.1, 0.32, 0.4, 0.06, { x: Math.cos(a) * 2.75, z: Math.sin(a) * 2.75, ry: -a / D }));
        }
        // 幽子の輪（塔の上寄り）
        P.trim.push(ring(2.6, 0.16, 6, 56, Object.assign({ y: 1.6 }, RY)));
        for (const dy of [-1, 1]) P.team.push(ring(2.55, 0.06, 4, 56, Object.assign({ y: 1.6 + dy * 0.15 }, RY)));
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          P.hull.push(cbox(0.42, 0.42, 0.5, 0.07, { x: Math.cos(a) * 2.6, y: 1.6, z: Math.sin(a) * 2.6, ry: -a / D }));
          P.hull2.push(cbox(1.5, 0.12, 0.16, 0.03, { x: Math.cos(a) * 1.75, y: 1.6, z: Math.sin(a) * 1.75, ry: -a / D }));
        }
        // 下の腕（入港の桟橋）
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU;
          P.hull2.push(cbox(2.6, 0.28, 0.42, 0.06, { x: Math.cos(a) * 1.9, y: -1.9, z: Math.sin(a) * 1.9, ry: -a / D }));
          P.white.push(sph(0.07, 6, 4, { x: Math.cos(a) * 3.2, y: -1.75, z: Math.sin(a) * 3.2 }));
        }
        return P;
      },
      // 砲撃艦: シェルを撃つ。背骨のような長い加速砲（2本の軌条と6つのコイル）が艦首から突き出す
      artillery() {
        const P = parts(), W = 1.7, H = 1.25;
        hHull(P, 6.6, W, H, { z: -1.6, prow: 0.7 });
        hRing(P, 1.35, 0.12, -2.9, { nodes: 4, struts: 4 });
        hEngines(P, -5.2, [[-0.45, 0], [0.45, 0]], 0.36, W * 0.8, H * 0.85);
        // 加速砲
        for (const s of [-1, 1]) P.hull2.push(cbox(0.14, 0.38, 6.6, 0.03, { x: s * 0.27, y: H / 2 + 0.22, z: 1.9 }));
        P.trim.push(cbox(0.3, 0.1, 6.4, 0.02, { y: H / 2 + 0.04, z: 1.9 }));
        for (let i = 0; i < 6; i++) {
          const z = -0.6 + i * 1.0;
          P.trim.push(cbox(0.95, 0.75, 0.22, 0.06, { y: H / 2 + 0.22, z }));
          P.team.push(ring(0.24, 0.035, 6, 24, { y: H / 2 + 0.22, z: z + 0.12 }));
        }
        P.hull.push(cbox(1.05, 0.85, 0.55, 0.1, { y: H / 2 + 0.22, z: 5.2 }));
        P.team.push(cyl(0.16, 0.16, 0.04, 16, { y: H / 2 + 0.22, z: 5.48 }));
        // 弾倉
        P.hull.push(cbox(1.5, 0.6, 1.4, 0.1, { y: H / 2 + 0.1, z: -1.8 }));
        for (let i = 0; i < 3; i++) P.hull2.push(box(1.52, 0.04, 0.06, { y: H / 2 + 0.25, z: -2.3 + i * 0.5 }));
        hBridge(P, 0, H / 2 + 0.4, -3.4, 0.6, 0.35, 0.8);
        hGreebles(P, 53, 8, -0.6, 0.6, H / 2, -0.3, 1.0, 0.12);
        return P;
      },
      // ミサイル艦: 幅広の船体の甲板に、誘導弾の発射筒の箱（升目のふた）が2つ。両舷に増設の発射器
      missile() {
        const P = parts(), L = 10, W = 2.6, H = 1.4;
        hHull(P, L, W, H, { prow: 0.66 });
        for (const [z, rows] of [[1.2, 5], [-1.6, 6]]) {
          const l = rows * 0.42 + 0.2;
          P.hull.push(cbox(1.9, 0.36, l, 0.06, { y: H / 2 + 0.16, z }));
          for (let r = 0; r < rows; r++) for (let c = 0; c < 4; c++) {
            const x = -0.63 + c * 0.42, zz = z - (rows - 1) * 0.21 + r * 0.42;
            P.hull2.push(box(0.34, 0.04, 0.34, { x, y: H / 2 + 0.35, z: zz }));
          }
          P.team.push(box(1.7, 0.02, 0.03, { y: H / 2 + 0.36, z: z + l / 2 - 0.05 }));
        }
        for (const s of [-1, 1]) {
          P.hull2.push(cbox(0.45, 0.6, 2.6, 0.08, { x: s * 1.42, y: 0.1, z: -0.2 }));
          for (let i = 0; i < 4; i++) P.team.push(box(0.02, 0.18, 0.18, { x: s * 1.655, y: 0.18, z: -1.1 + i * 0.6 }));
        }
        hRing(P, 1.75, 0.13, -3.5, { nodes: 4, struts: 4 });
        hEngines(P, -5.3, [[-0.6, 0], [0.6, 0]], 0.4, W * 0.8, H * 0.85);
        hBridge(P, 0, H / 2 + 0.05, -4.2, 0.8, 0.42, 0.9);
        return P;
      },
      // 無人機母艦: 平たく幅広の船体、甲板は発着の甲板（中央に灯りの列）、両舷に格納庫の口と無人機の架台
      carrier() {
        const P = parts(), L = 10, W = 3.2, H = 1.5;
        hHull(P, L, W, H, { prow: 0.7 });
        P.hull2.push(cbox(W * 0.9, 0.18, L * 0.72, 0.05, { y: H / 2 + 0.1, z: -0.4 }));
        P.trim.push(box(W * 0.92, 0.04, L * 0.72, { y: H / 2 + 0.03, z: -0.4 }));
        for (let i = 0; i < 8; i++) P.team.push(box(0.03, 0.015, 0.12, { y: H / 2 + 0.2, z: -3.4 + i * 0.85 }));
        for (const s of [-1, 1]) {
          P.trim.push(box(0.05, 0.012, L * 0.6, { x: s * 1.2, y: H / 2 + 0.195, z: -0.4 }));
          // 格納庫の口（暗い奥に光）
          for (let i = 0; i < 3; i++) {
            const z = -2.4 + i * 1.5;
            P.hull2.push(box(0.06, 0.55, 1.0, { x: s * 1.585, y: 0.0, z }));
            P.team.push(box(0.02, 0.06, 0.9, { x: s * 1.62, y: 0.3, z }));
          }
          // 無人機の架台
          for (let i = 0; i < 5; i++) {
            const z = -2.8 + i * 1.1;
            P.trim.push(prism([[-0.18, 0], [0.18, 0], [0, 0.42]], 0.08, 0, { x: s * 1.0, y: H / 2 + 0.24, z, rx: -90 }));
          }
        }
        hRing(P, 2.05, 0.13, -3.2, { nodes: 4, struts: 4 });
        hEngines(P, -5.3, [[-0.8, 0], [0, 0], [0.8, 0]], 0.36, W * 0.82, H * 0.85);
        hBridge(P, 1.1, H / 2 + 0.2, -2.0, 0.6, 0.6, 1.4);
        return P;
      },
    };
    // 拠点の輪の上の砲塔（外向き）
    function hTurretAt(P, x, y, z, r, a) {
      P.trim.push(dome(r, 12, { x, y, z }));
      const ox = Math.cos(a), oz = Math.sin(a);
      P.hull2.push(cyl(r * 0.2, r * 0.26, r * 1.6, 8, { x: x + ox * r * 0.9, y: y + r * 0.4, z: z + oz * r * 0.9, ry: 90 - a / D }));
      P.team.push(sph(r * 0.17, 8, 6, { x: x + ox * r * 1.75, y: y + r * 0.4, z: z + oz * r * 1.75 }));
    }

    // ================================================================ ザイレン: 線と体節

    // 体節: 多面の紡錘形（角ばった殻）。上に暗い甲殻の板を重ねる。fy で少し平たくする
    function zSeg(P, r, len, z, o) {
      o = o || {};
      const sides = o.sides || 8, fy = o.fy || 0.8, y = o.y || 0;
      const prof = [[0.32 * r, -len / 2], [0.8 * r, -0.4 * len], [r, -0.16 * len], [0.97 * r, 0.14 * len], [0.8 * r, 0.36 * len], [0.38 * r, len / 2]];
      P.hull.push(lathe(prof, sides, { y, z, s: [1, fy, 1], rz: 180 / sides }, true));
      P.hull2.push(shell(r * 1.07, len * 0.7, o.arc || 140, sides + 4, { y, z: z - len * 0.04, s: [1, fy, 1] }));
      // 甲殻の稜線
      P.trim.push(box(r * 0.08, r * 0.06, len * 0.6, { y: y + r * fy * 1.08, z: z - len * 0.04 }));
    }
    // 継ぎ目: 節と節のあいだの首と、陣営色に光る輪
    function zJoint(P, r, z, o) {
      o = o || {};
      const fy = o.fy || 0.8, y = o.y || 0;
      P.trim.push(cyl(r * 0.42, r * 0.42, r * 0.34, 8, { y, z, s: [1, fy, 1] }, true));
      P.team.push(ring(r * 0.5, r * 0.065, 6, 28, { y, z, s: [1, fy, 1] }));
    }
    // 体: 節の並び（艦尾から艦首へ）。z の中心を 0 にそろえ、継ぎ目と背骨の線と軌条を付ける。
    // 戻り値: 各節の { r, len, z } と、艦尾と艦首の z
    function zBody(P, segs, o) {
      o = o || {};
      const gap = o.gap == null ? 0.18 : o.gap, fy = o.fy || 0.8;
      const total = segs.reduce((a, s) => a + s.len, 0) + gap * (segs.length - 1);
      let z = -total / 2 + (o.z || 0);
      const out = [];
      segs.forEach((s, i) => {
        const zc = z + s.len / 2;
        zSeg(P, s.r, s.len, zc, { fy, sides: o.sides, arc: o.arc });
        out.push({ r: s.r, len: s.len, z: zc });
        z += s.len;
        if (i < segs.length - 1) { zJoint(P, Math.min(s.r, segs[i + 1].r), z + gap / 2, { fy }); z += gap; }
      });
      const z0 = out[0].z - out[0].len / 2, z1 = out[out.length - 1].z + out[out.length - 1].len / 2;
      const rmax = Math.max(...segs.map((s) => s.r));
      // 背骨の線（片道の線の通り道）: 細い金属の棒と、その上の光る筋
      if (o.spine !== false) {
        const ys = rmax * fy * 1.16;
        P.trim.push(cbox(rmax * 0.1, rmax * 0.08, (z1 - z0) * 0.92, 0.01, { y: ys, z: (z0 + z1) / 2 }));
        P.team.push(box(rmax * 0.035, rmax * 0.02, (z1 - z0) * 0.88, { y: ys + rmax * 0.05, z: (z0 + z1) / 2 }));
      }
      // レーンの軌条: 腹の下の2本の細い管（レーンに乗る）
      if (o.rails !== false) {
        for (const sx of [-1, 1]) {
          const pts = out.map((s) => [sx * s.r * 0.5, -s.r * fy * 0.95, s.z]);
          pts.unshift([sx * out[0].r * 0.35, -out[0].r * fy * 0.8, z0 - 0.2]);
          pts.push([sx * out[out.length - 1].r * 0.3, -out[out.length - 1].r * fy * 0.75, z1 + 0.2]);
          P.trim.push(tube(pts, rmax * 0.045, Math.max(16, out.length * 8), 6));
          for (const s of out) P.hull2.push(box(rmax * 0.06, s.r * fy * 0.3, rmax * 0.08, { x: sx * s.r * 0.5, y: -s.r * fy * 0.8, z: s.z }));
        }
      }
      return { segs: out, z0, z1, rmax, fy };
    }
    // 艦首の二股の角と、そのあいだの片道の線の発射口（光る玉と金属の輪）
    function zProngs(P, z, r, len, o) {
      o = o || {};
      const spread = o.spread == null ? 0.32 : o.spread, y = o.y || 0;
      for (const s of [-1, 1]) {
        P.hull.push(lathe([[r * 0.22, 0], [r * 0.2, len * 0.3], [r * 0.12, len * 0.75], [0.004, len]], 6, { x: s * r * spread, y, z, ry: s * 5, s: [1, 0.85, 1] }, true));
      }
      P.team.push(sph(r * 0.16, 12, 10, { y, z: z + len * 0.32 }));
      P.trim.push(ring(r * 0.24, r * 0.035, 6, 24, { y, z: z + len * 0.32 }));
    }
    // 艦尾の光る尾の玉と、小さな安定板
    function zTail(P, z, r, o) {
      o = o || {};
      const fy = o.fy || 0.8;
      P.team.push(sph(r * 0.2, 10, 8, { z: z - r * 0.1 }));
      P.trim.push(ring(r * 0.26, r * 0.04, 6, 20, { z }));
      for (const s of [-1, 1]) P.hull2.push(cbox(r * 0.9, r * 0.05, r * 1.0, r * 0.02, { x: s * r * 0.55, y: r * fy * 0.15, z: z + r * 0.45, rz: s * -12, ry: s * -14 }));
    }
    // 片道の線の照射器（背に載る小さな角と光）
    function zEmitter(P, x, y, z, r) {
      P.hull2.push(lathe([[r * 0.55, -r * 0.6], [r * 0.6, -r * 0.2], [r * 0.4, r * 0.3], [r * 0.2, r * 0.6]], 6, { x, y, z, s: [1, 0.7, 1] }, true));
      for (const s of [-1, 1]) P.trim.push(lathe([[r * 0.09, 0], [r * 0.06, r * 0.8], [0.003, r * 1.3]], 5, { x: x + s * r * 0.17, y: y + r * 0.12, z: z + r * 0.45 }, true));
      P.team.push(sph(r * 0.11, 8, 6, { x, y: y + r * 0.12, z: z + r * 0.85 }));
    }

    const ZAIREN = {
      // ナーム級: 小型・多数。3つの節がすぼまっていく矢じり形。二股の角と後ろの翼
      narm() {
        const P = parts();
        const b = zBody(P, [{ r: 1.0, len: 2.5 }, { r: 0.86, len: 2.2 }, { r: 0.68, len: 1.9 }], { z: -0.9, fy: 0.72 });
        zProngs(P, b.z1 - 0.2, 0.9, 2.4, { spread: 0.3 });
        zTail(P, b.z0, 0.9, { fy: 0.72 });
        for (const s of [-1, 1]) {
          P.hull2.push(prism([[0, 0], [1.7, -0.25], [1.6, 0.0], [0.2, 0.18]], 0.08, 0.01, { x: s * 0.75, y: -0.05, z: b.segs[0].z + 0.2, rx: 90, rz: s > 0 ? 0 : 180, s: [1, 1, 1] }));
          P.team.push(box(0.02, 0.04, 0.9, { x: s * 2.25, y: -0.05, z: b.segs[0].z - 0.55, ry: s * 8 }));
        }
        // 片側だけの探知のこぶ（ザイレンの艦は少し非対称）
        P.hull2.push(sph(0.22, 8, 6, { x: 0.62, y: 0.38, z: b.segs[1].z }));
        P.team.push(sph(0.06, 6, 4, { x: 0.78, y: 0.45, z: b.segs[1].z + 0.12 }));
        return P;
      },
      // ガルメス級: 大型の幹線艦。7つの太い節の両脇に、僚艦を運ぶ揺りかご（軌条と運ばれる小さな節の荷）。背に照射器4基
      garmes() {
        const P = parts();
        const segs = [];
        for (let i = 0; i < 7; i++) segs.push({ r: 1.05 + (i === 0 || i === 6 ? -0.15 : 0) + (i % 2) * 0.05, len: 1.25 });
        const b = zBody(P, segs, { fy: 0.74, gap: 0.12, sides: 8 });
        // 揺りかご
        for (const s of [-1, 1]) {
          const x = s * 1.75;
          P.trim.push(cbox(0.12, 0.12, (b.z1 - b.z0) * 0.8, 0.02, { x, y: 0.35, z: (b.z0 + b.z1) / 2 }));
          P.trim.push(cbox(0.12, 0.12, (b.z1 - b.z0) * 0.8, 0.02, { x, y: -0.45, z: (b.z0 + b.z1) / 2 }));
          for (let i = 1; i < 6; i++) P.hull2.push(cbox(0.95, 0.1, 0.14, 0.02, { x: s * 1.25, y: -0.05, z: b.segs[i].z, rz: s * -12 }));
          for (let i = 0; i < 3; i++) {
            const z = b.segs[1].z + i * (b.segs[2].z - b.segs[1].z) * 2;
            P.hull2.push(lathe([[0.15, -0.75], [0.42, -0.5], [0.48, 0.1], [0.32, 0.6], [0.1, 0.8]], 6, { x, y: -0.05, z, s: [1, 0.85, 1] }, true));
            P.team.push(ring(0.33, 0.03, 6, 20, { x, y: -0.05, z: z - 0.1 }));
          }
        }
        for (let i = 0; i < 4; i++) zEmitter(P, (i % 2 ? 0.45 : -0.45), 0.92, b.segs[1 + i].z + 0.1, 0.42);
        zProngs(P, b.z1 - 0.1, 1.0, 1.6, { spread: 0.36 });
        zTail(P, b.z0, 1.0, { fy: 0.74 });
        return P;
      },
      // エルダ級: レーンを延ばす敷設艦。艦首に長い針（敷設の放出器）と、それを巻く糸巻きの輪。胴の真ん中に太い巻き胴
      elda() {
        const P = parts();
        const b = zBody(P, [{ r: 0.85, len: 1.8 }, { r: 1.0, len: 1.4 }, { r: 0.9, len: 1.7 }], { z: -2.4, fy: 0.78 });
        // 巻き胴（真ん中の節に重ねる）
        const mz = b.segs[1].z;
        P.hull2.push(cyl(1.18, 1.18, 1.0, 16, { z: mz, s: [1, 0.85, 1] }, true));
        for (let i = 0; i < 5; i++) P.trim.push(ring(1.2, 0.04, 6, 32, { z: mz - 0.4 + i * 0.2, s: [1, 0.85, 1] }));
        // 放出器の針と糸巻き
        const z = b.z1 - 0.1;
        P.hull.push(lathe([[0.42, 0], [0.32, 0.8], [0.14, 3.2], [0.003, 5.0]], 8, { z }, true));
        for (let i = 0; i < 5; i++) {
          const zz = z + 0.7 + i * 0.75, r = 0.75 - i * 0.11;
          P[i % 2 ? 'trim' : 'team'].push(ring(r, i % 2 ? 0.035 : 0.03, 6, 32, { z: zz }));
          if (i % 2 === 0) for (let k = 0; k < 3; k++) {
            const a = (k / 3) * TAU + i * 0.4;
            P.hull2.push(box(0.035, r - 0.12, 0.035, { x: Math.cos(a) * (r * 0.55), y: Math.sin(a) * (r * 0.55), z: zz, rz: a / D - 90 }));
          }
        }
        P.team.push(sph(0.09, 8, 6, { z: z + 5.0 }));
        zTail(P, b.z0, 0.85, { fy: 0.78 });
        return P;
      },
      // オルドラ級: 巨大旗艦。9つの節（真ん中の3つは格納庫で、両脇に光る口）、艦首の長い攻城線砲（コイルの輪）、
      // 艦尾のレーンの錨（大きな輪を4本の腕で支える）、背の光る線
      flagship() {
        const P = parts();
        const radii = [1.0, 1.2, 1.35, 1.45, 1.45, 1.45, 1.35, 1.2, 1.05];
        const b = zBody(P, radii.map((r) => ({ r, len: 1.15 })), { z: -0.6, fy: 0.72, gap: 0.14, sides: 10, arc: 150 });
        // 格納庫の口（真ん中の3節）
        for (const i of [3, 4, 5]) {
          const s0 = b.segs[i];
          for (const s of [-1, 1]) {
            P.hull2.push(cbox(0.18, 0.62, 0.78, 0.04, { x: s * s0.r * 0.96, y: -0.08, z: s0.z }));
            P.team.push(box(0.03, 0.05, 0.7, { x: s * s0.r * 1.06, y: 0.25, z: s0.z }));
            P.team.push(box(0.03, 0.05, 0.7, { x: s * s0.r * 1.06, y: -0.42, z: s0.z }));
          }
        }
        // 背の照射器（片道の線 8門のうち見える分）
        for (let i = 1; i < 8; i += 2) zEmitter(P, (i % 4 === 1 ? 0.55 : -0.55), b.segs[i].r * 0.72 * 0.95, b.segs[i].z, 0.38);
        // 攻城線砲: 艦首から伸びる砲身とコイル、先の光
        const z = b.z1 - 0.15;
        P.hull.push(cbox(0.95, 0.75, 1.0, 0.12, { z: z + 0.3 }));
        P.hull2.push(cyl(0.2, 0.3, 4.6, 10, { z: z + 2.9 }, true));
        for (let i = 0; i < 5; i++) {
          const zz = z + 1.3 + i * 0.75, r = 0.5 - i * 0.04;
          P.trim.push(ring(r, 0.07, 6, 28, { z: zz }));
          P.team.push(ring(r - 0.1, 0.03, 6, 28, { z: zz + 0.08 }));
        }
        for (const s of [-1, 1]) P.hull.push(lathe([[0.2, 0], [0.18, 1.0], [0.1, 2.3], [0.004, 2.9]], 6, { x: s * 0.62, y: -0.05, z: z + 0.6, ry: s * 3, s: [1, 0.8, 1] }, true));
        P.team.push(sph(0.16, 12, 10, { z: z + 5.3 }));
        // レーンの錨
        const za = b.z0 - 0.9;
        P.trim.push(ring(2.3, 0.14, 6, 56, { z: za }));
        P.team.push(ring(2.12, 0.05, 4, 56, { z: za + 0.1 }));
        P.team.push(ring(2.12, 0.05, 4, 56, { z: za - 0.1 }));
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + 45 * D;
          P.hull2.push(cbox(1.75, 0.22, 0.3, 0.05, { x: Math.cos(a) * 1.4, y: Math.sin(a) * 1.4, z: za + 0.3, rz: a / D }));
          P.hull.push(cbox(0.42, 0.42, 0.55, 0.08, { x: Math.cos(a) * 2.3, y: Math.sin(a) * 2.3, z: za, rz: a / D }));
        }
        P.team.push(sph(0.22, 10, 8, { z: za }));
        // 背の大きな甲殻の稜（司令の節）
        P.hull2.push(lathe([[0.1, -0.9], [0.45, -0.5], [0.5, 0.3], [0.2, 0.8]], 6, { y: 1.35, z: b.segs[4].z, s: [0.8, 0.9, 1] }, true));
        P.white.push(sph(0.05, 6, 4, { y: 1.78, z: b.segs[4].z + 0.3 }));
        return P;
      },
    };

    // ================================================================ 一覧

    const LIST = [
      { key: 'node', faction: 'human', name: 'ノード艦', make: HUMAN.node },
      { key: 'guard', faction: 'human', name: 'ガード級', make: HUMAN.guard },
      { key: 'comms', faction: 'human', name: '通信艦', make: HUMAN.comms },
      { key: 'quiet', faction: 'human', name: '静穏場艦', make: HUMAN.quiet },
      { key: 'picket', faction: 'human', name: '哨戒艦', make: HUMAN.picket },
      { key: 'artillery', faction: 'human', name: '砲撃艦', make: HUMAN.artillery },
      { key: 'missile', faction: 'human', name: 'ミサイル艦', make: HUMAN.missile },
      { key: 'carrier', faction: 'human', name: '無人機母艦', make: HUMAN.carrier },
      { key: 'base', faction: 'human', name: '人類拠点', make: HUMAN.base },
      { key: 'narm', faction: 'zairen', name: 'ナーム級', make: ZAIREN.narm },
      { key: 'garmes', faction: 'zairen', name: 'ガルメス級', make: ZAIREN.garmes },
      { key: 'elda', faction: 'zairen', name: 'エルダ級', make: ZAIREN.elda },
      { key: 'flagship', faction: 'zairen', name: 'オルドラ級', make: ZAIREN.flagship },
    ];

    // 艦種 key のモデルを THREE.Group で作る（材質ごとに1つのメッシュ）
    function build(key) {
      const item = LIST.find((x) => x.key === key);
      if (!item) throw new Error('知らない艦種: ' + key);
      const geoms = finish(item.make());
      const mats = materials(item.faction);
      const g = new THREE.Group();
      g.name = item.name;
      for (const [k, geo] of Object.entries(geoms)) {
        const m = new THREE.Mesh(geo, mats[k]);
        m.name = mats[k].name;
        g.add(m);
      }
      let tris = 0;
      for (const geo of Object.values(geoms)) tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      g.userData = { key, faction: item.faction, name: item.name, tris: Math.round(tris) };
      return g;
    }

    return { LIST, build, materials, PALETTE };
  };
})(typeof window !== 'undefined' ? window : globalThis);
