/* 宇宙戦シミュレータ 3Dビューアの効果音
 *
 * 音声ファイルは使わず、Web Audio でその場で合成する（ファイルを直接開いても鳴る）。
 * 宇宙に音はないが、映画のように鳴らす。重く聞こえるように、次のことをしている。
 *  - 低い音（サイン波・茶色の雑音）を芯にして、軽く歪ませる（小さなスピーカーでも重さが伝わるように倍音を足す）
 *  - 高い音は短く、低い音は長く残す
 *  - 全部の音を共通の残響（広い空間の響き）に少し送る
 *  - 遠くの音はこもらせて、残響を多めにする
 * SpaceAudio() で作り、ユーザーの操作（クリックかキー）のあとに ensure() で鳴らし始める（ブラウザの決まり）。
 * play(名前, { gain, pan, side, size, near }) で1つ鳴らす。ambient(true) で環境音（低いうなり）。
 * 試聴用に、OfflineAudioContext を渡して init(ctx) すると、同じ音をファイルに書き出せる。
 */
(function (global) {
  'use strict';

  function SpaceAudio() {
    const A = { ctx: null, master: null, out: null, recDest: null, buf: null, rev: null, voices: 0, amb: null, volume: 0.6 };
    const MAX_VOICES = 48;
    // 残響に送る量（音ごと）
    const REV = {
      beam: 0.35, death: 0.55, deathBig: 0.75, shellLaunch: 0.55, shellBoom: 0.85, jumpOut: 0.7, jumpIn: 0.6,
      lane: 0.45, fieldUp: 0.8, fieldDown: 0.7, missile: 0.4, intercept: 0.35, drone: 0.25,
      lanceCharge: 0.6, lanceFire: 0.9, launch: 0.4,
    };

    // ---- 下ごしらえ（雑音・残響・歪みの形）
    // 雑音: white（白）・pink（やや低め）・brown（低い。ゴーッという音）。端と頭をつないで、くり返しても継ぎ目が鳴らないようにする
    function makeNoise(ctx, kind, secs, seed) {
      const sr = ctx.sampleRate, len = Math.floor(sr * secs), N = Math.floor(sr * 0.05);
      const g = new Float32Array(len + N);
      let s = seed, b0 = 0, b1 = 0, b2 = 0, br = 0;
      for (let i = 0; i < len + N; i++) {
        s = (s * 1103515245 + 12345) >>> 0;
        const w = (s / 4294967296) * 2 - 1;
        if (kind === 'pink') {
          b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
          g[i] = b0 + b1 + b2 + w * 0.1848;
        } else if (kind === 'brown') {
          br = (br + 0.02 * w) / 1.02;
          g[i] = br;
        } else g[i] = w;
      }
      let mean = 0;
      for (let i = 0; i < len + N; i++) mean += g[i];
      mean /= len + N;
      let pk = 0;
      for (let i = 0; i < len + N; i++) { g[i] -= mean; pk = Math.max(pk, Math.abs(g[i])); }
      const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0), k = 0.95 / pk;
      for (let i = 0; i < len; i++) d[i] = g[i] * k;
      for (let i = 0; i < N; i++) { const a = i / N; d[i] = g[i] * k * a + g[len + i] * k * (1 - a); }
      return buf;
    }
    // 残響の響き方: 左右で別の雑音を、だんだん暗く・小さくしていく（約4秒）
    function makeIR(ctx, secs) {
      const sr = ctx.sampleRate, len = Math.floor(sr * secs), pre = Math.floor(sr * 0.03);
      const buf = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let s = 9001 + ch * 7919, y = 0;
        for (let i = pre; i < len; i++) {
          s = (s * 1103515245 + 12345) >>> 0;
          const w = (s / 4294967296) * 2 - 1, x = (i - pre) / sr;
          const a = 0.55 * Math.exp(-x * 2.2) + 0.03;   // 高い音ほど早く消える
          y += a * (w - y);
          const swell = Math.min(1, x / 0.06);          // 立ち上がりを少しなだらかに
          d[i] = y * Math.exp(-x * 1.7) * swell;
        }
      }
      return buf;
    }
    const curves = {};
    function curve(k) {
      if (curves[k]) return curves[k];
      const n = 2048, c = new Float32Array(n), tk = Math.tanh(k);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / tk; }
      return (curves[k] = c);
    }

    // ctx を渡さなければ、ふつうの AudioContext を作る
    A.init = function (ctx) {
      if (A.ctx) return A.ctx;
      if (!ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      A.ctx = ctx;
      A.offline = !!(global.OfflineAudioContext && ctx instanceof global.OfflineAudioContext);
      A.buf = { white: makeNoise(ctx, 'white', 3, 12345), pink: makeNoise(ctx, 'pink', 4, 2468), brown: makeNoise(ctx, 'brown', 5, 97531) };
      // 音量 → 低音を少し持ち上げる → まとめて圧縮 → 割れ止め
      A.master = ctx.createGain();
      A.master.gain.value = A.volume;
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'lowshelf'; shelf.frequency.value = 110; shelf.gain.value = 3;
      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 3; glue.attack.value = 0.012; glue.release.value = 0.35;
      const makeup = ctx.createGain();
      makeup.gain.value = 1.35;
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.15;
      A.master.connect(shelf); shelf.connect(glue); glue.connect(makeup); makeup.connect(lim);
      lim.connect(ctx.destination);
      A.out = lim;
      if (ctx.createMediaStreamDestination) { A.recDest = ctx.createMediaStreamDestination(); lim.connect(A.recDest); }
      // 共通の残響
      const conv = ctx.createConvolver();
      conv.buffer = makeIR(ctx, 4.2);
      const revIn = ctx.createGain(), revOut = ctx.createGain();
      revIn.gain.value = 1; revOut.gain.value = 0.55;
      const revHp = ctx.createBiquadFilter();       // 残響の中の低すぎる音は濁るので削る
      revHp.type = 'highpass'; revHp.frequency.value = 90;
      revIn.connect(revHp); revHp.connect(conv); conv.connect(revOut); revOut.connect(A.master);
      A.rev = revIn;
      return ctx;
    };
    // ユーザーの操作のあとに呼ぶ
    A.ensure = function () {
      const ctx = A.init();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    };
    A.setVolume = function (v) {
      A.volume = v;
      if (A.master) A.master.gain.setTargetAtTime(v, A.ctx.currentTime, 0.05);
    };

    // ---- 部品
    // 1つの音の出口: 大きさ → （遠ければこもらせる）→ 左右 → 出力と残響へ
    function voiceOut(o, rev) {
      const ctx = A.ctx, g = ctx.createGain();
      g.gain.value = o.gain;
      let last = g;
      const near = o.near == null ? 1 : Math.max(0, Math.min(1, o.near));
      if (near < 0.95) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 500 + 16000 * Math.pow(near, 1.6); lp.Q.value = 0.5;
        last.connect(lp); last = lp;
      }
      if (ctx.createStereoPanner && o.pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, o.pan));
        last.connect(p); last = p;
      }
      last.connect(A.master);
      if (rev > 0) {
        const s = ctx.createGain();
        s.gain.value = rev * (1 + 0.8 * (1 - near));
        last.connect(s); s.connect(A.rev);
      }
      return g;
    }
    // 音量の山: 立ち上がり a 秒で peak、そこから dur 秒で消える
    function env(param, t, a, peak, dur) {
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, a));
      param.exponentialRampToValueAtTime(0.0001, t + a + dur);
    }
    // 雑音を流す。wide なら左右で別の場所を流して広げる
    function noise(t, dur, out, kind, wide) {
      const ctx = A.ctx, buf = A.buf[kind || 'white'];
      const src = () => {
        const s = ctx.createBufferSource();
        s.buffer = buf; s.loop = true;
        s.start(t, Math.random() * buf.duration * 0.9);
        s.stop(t + dur + 0.05);
        return s;
      };
      if (!wide) { const s = src(); s.connect(out); return s; }
      const m = ctx.createChannelMerger(2);
      src().connect(m, 0, 0); src().connect(m, 0, 1);
      m.connect(out);
      return m;
    }
    function osc(type, f0, f1, t, dur, out, detune) {
      const o = A.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      if (detune) o.detune.value = detune;
      o.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
      return o;
    }
    // 揺らし: param を f0→f1 Hz で depth だけ揺らす
    function lfo(f0, f1, depth, t, dur, param) {
      const o = A.ctx.createOscillator(), g = A.ctx.createGain();
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(0.1, f1), t + dur);
      g.gain.value = depth;
      o.connect(g); g.connect(param);
      o.start(t); o.stop(t + dur + 0.05);
      return o;
    }
    function filter(type, f0, f1, t, dur, q, out) {
      const f = A.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
      if (q) f.Q.value = q;
      f.connect(out);
      return f;
    }
    function gainNode(t, a, peak, dur, out) {
      const g = A.ctx.createGain();
      env(g.gain, t, a, peak, dur);
      g.connect(out);
      return g;
    }
    // 歪み（k が大きいほど強い）
    function shaper(k, out) {
      const w = A.ctx.createWaveShaper();
      w.curve = curve(k); w.oversample = '4x';
      w.connect(out);
      return w;
    }
    // 破片の散る音: 短い雑音の粒を span 秒のあいだにばらまく（前のほうに多く）
    function crackle(t, span, n, peak, out, f0, f1) {
      f0 = f0 || 1200; f1 = f1 || 5000;
      for (let i = 0; i < n; i++) {
        const u = Math.pow(Math.random(), 1.7), tt = t + span * u;
        const dd = 0.008 + Math.random() * 0.035;
        const f = f0 * Math.pow(f1 / f0, Math.random());
        const p = peak * (0.35 + Math.random() * 0.65) * (1 - 0.75 * u);
        noise(tt, dd, filter('bandpass', f, f, tt, dd, 1.2, gainNode(tt, 0.0008, p, dd, out)));
      }
    }
    // 爆発の芯（撃沈・シェルの着弾で使う）。s は大きさ、low は低さ（1 がふつう、小さいほど低い）
    function blast(t, out, s, low, peak) {
      const D = 1.2 * s;
      // 割れる音（ごく短い）
      noise(t, 0.1, filter('highpass', 900, 600, t, 0.1, 0.7, shaper(4, gainNode(t, 0.001, 0.45 * peak, 0.1 * Math.sqrt(s), out))));
      // 火の玉: 茶色の雑音を歪ませ、だんだんこもらせる（左右に広げる）
      const fire = filter('lowpass', 3600 * low, 120 * low, t, D, 0.9, gainNode(t, 0.004, 0.95 * peak, D, out));
      noise(t, D, shaper(3, fire), 'brown', true);
      // 腹に来る低い衝撃（倍音を足して小さなスピーカーでも聞こえるように）
      osc('sine', 92 * low, 24 * low, t, D * 0.85, shaper(1.8, gainNode(t, 0.003, 0.8 * peak, D * 0.85, out)));
      // 長く残る地鳴り
      noise(t + 0.05, D * 2, filter('lowpass', 150 * low, 90 * low, t + 0.05, D * 2, 0.6, gainNode(t + 0.05, 0.25, 0.55 * peak, D * 2, out)), 'brown', true);
      return D * 2.1;
    }

    // ---- 音の作り方（out へつなぐ。t は始める時刻、o は大きさや陣営）。鳴っている長さ（秒）を返す
    const SOUNDS = {
      // 主砲（ライン系統）。人類は芯のある重い発砲音に金属の響き、ザイレンは低く唸る生き物のような音
      beam(t, out, o) {
        const d = o.det;
        if (o.side === 1) {
          // 唸り: のこぎり波を速く揺らし、こもらせながら下げる
          const lp = filter('lowpass', 1500, 170, t, 0.6, 4, gainNode(t, 0.012, 0.32, 0.6, out));
          const sh = shaper(3, lp);
          const c1 = osc('sawtooth', 105 * d, 44 * d, t, 0.6, sh, -10), c2 = osc('sawtooth', 106 * d, 44.5 * d, t, 0.6, sh, 10);
          lfo(31, 19, 45, t, 0.6, c1.frequency); lfo(29, 17, 40, t, 0.6, c2.frequency);
          // 低い重み
          osc('sine', 78 * d, 30 * d, t, 0.55, shaper(2, gainNode(t, 0.006, 0.55, 0.55, out)));
          // 湿った息のような雑音
          noise(t, 0.45, filter('bandpass', 700, 220, t, 0.45, 1.8, gainNode(t, 0.02, 0.35, 0.45, out)), 'brown');
          return 0.7;
        }
        // 撃ち出しの割れ
        noise(t, 0.045, filter('bandpass', 2400, 1300, t, 0.045, 0.9, shaper(3, gainNode(t, 0.001, 0.28, 0.045, out))));
        // 胴: 少しずらしたのこぎり波2本を、下げながらこもらせる
        const lp = filter('lowpass', 2800, 240, t, 0.42, 1.4, gainNode(t, 0.002, 0.3, 0.42, out));
        const sh = shaper(2.5, lp);
        osc('sawtooth', 300 * d, 78 * d, t, 0.42, sh, -9); osc('sawtooth', 301 * d, 78.5 * d, t, 0.42, sh, 9);
        // 低い重み
        osc('sine', 150 * d, 40 * d, t, 0.38, shaper(1.6, gainNode(t, 0.002, 0.6, 0.38, out)));
        // 澄んだ金属の響き（人類らしさ）
        osc('sine', 620 * d, 600 * d, t, 0.8, gainNode(t, 0.002, 0.05, 0.8, out));
        osc('sine', 1013 * d, 990 * d, t, 0.55, gainNode(t, 0.002, 0.03, 0.55, out));
        return 0.85;
      },
      // 撃沈（小さめの艦）
      death(t, out, o) {
        const low = o.side === 1 ? 0.85 : 1;
        const len = blast(t, out, o.size, low, 1);
        crackle(t + 0.03, 1.1 * o.size, 10, 0.16, out);
        return len;
      },
      // 撃沈（拠点・ガルメス級・ノード艦など大物）: 大きな爆発のあとに誘爆が続き、船体がきしむ
      deathBig(t, out, o) {
        const low = o.side === 1 ? 0.85 : 1;
        let len = blast(t, out, 2.6, 0.75 * low, 1);
        blast(t + 0.42, out, 1.2, 0.9 * low, 0.55);
        blast(t + 1.05, out, 1.6, 0.8 * low, 0.5);
        // 船体のきしみ: 低いのこぎり波を細い帯域で、ゆっくり揺らしながら下げる
        const bp = filter('bandpass', 420, 180, t + 0.3, 2.6, 7, gainNode(t + 0.3, 0.5, 0.22, 2.4, out));
        const g1 = osc('sawtooth', 52, 33, t + 0.3, 2.8, shaper(2, bp));
        lfo(0.9, 0.5, 6, t + 0.3, 2.8, g1.frequency);
        // 腹に来る長いうねり
        osc('sine', 48 * low, 16, t, 3.6, shaper(1.5, gainNode(t, 0.01, 0.75, 3.6, out)));
        crackle(t + 0.05, 3.2, 26, 0.18, out);
        len = Math.max(len, 4.2);
        return len;
      },
      // シェルの発射: 大砲のような重い「ドン」、装填の金属音、遠ざかるうなり
      shellLaunch(t, out) {
        noise(t, 0.06, filter('bandpass', 1800, 900, t, 0.06, 0.8, shaper(4, gainNode(t, 0.001, 0.4, 0.06, out))));
        const lp = filter('lowpass', 2600, 170, t, 0.8, 0.9, gainNode(t, 0.003, 0.9, 0.8, out));
        noise(t, 0.8, shaper(3, lp), 'brown', true);
        osc('sine', 98, 27, t, 0.75, shaper(2.2, gainNode(t, 0.002, 1.0, 0.75, out)));
        // 装填の「ガコン」
        noise(t + 0.32, 0.07, filter('bandpass', 850, 700, t + 0.32, 0.07, 7, gainNode(t + 0.32, 0.002, 0.6, 0.07, out)));
        osc('sine', 180, 120, t + 0.32, 0.1, gainNode(t + 0.32, 0.002, 0.18, 0.1, out));
        // 遠ざかるうなり
        const bp = filter('bandpass', 260, 700, t + 0.05, 1.8, 1.6, gainNode(t + 0.05, 0.35, 0.35, 1.5, out));
        noise(t + 0.05, 1.9, bp, 'brown', true);
        return 2.2;
      },
      // シェルの着弾: 衝撃で割れる音、重い火球、腹に来る衝撃が2度、長い地鳴りと破片
      shellBoom(t, out, o) {
        const s = o.size;
        let len = blast(t, out, 3.2 * s, 0.7, 1);
        osc('sine', 62, 15, t, 3.2 * s, shaper(2.2, gainNode(t, 0.004, 0.9, 3.2 * s, out)));
        osc('sine', 44, 19, t + 0.13, 1.6 * s, shaper(1.6, gainNode(t + 0.13, 0.01, 0.6, 1.6 * s, out)));
        // 地鳴りを小刻みに震わせる
        const rg = gainNode(t + 0.2, 0.5, 0.5, 5.5 * s, out);
        const trem = A.ctx.createGain();
        trem.gain.value = 1;
        lfo(6.5, 3, 0.35, t + 0.2, 5.7 * s, trem.gain);
        trem.connect(rg);
        noise(t + 0.2, 5.7 * s, filter('lowpass', 220, 70, t + 0.2, 5.7 * s, 0.7, trem), 'brown', true);
        crackle(t + 0.04, 3.5 * s, 30, 0.2, out);
        len = Math.max(len, 6.2 * s);
        return len;
      },
      // ジャンプで消える: 空間が吸い込まれるようにふくらみ、最後に「ボン」と閉じる
      jumpOut(t, out) {
        const R = 0.9;
        noise(t, R + 0.05, filter('bandpass', 160, 2600, t, R, 3.5, gainNode(t, R - 0.02, 0.5, 0.08, out)), 'pink', true);
        const lp = filter('lowpass', 300, 900, t, R, 2, gainNode(t, R - 0.02, 0.35, 0.08, out));
        osc('sawtooth', 42, 150, t, R, shaper(2, lp), -12); osc('sawtooth', 42.5, 152, t, R, shaper(2, lp), 12);
        osc('sine', 130, 28, t + R, 0.65, shaper(2, gainNode(t + R, 0.003, 0.85, 0.65, out)));
        noise(t + R, 0.5, filter('lowpass', 1800, 120, t + R, 0.5, 0.8, gainNode(t + R, 0.003, 0.5, 0.5, out)), 'brown', true);
        return R + 0.9;
      },
      // ジャンプで現れる: 上から落ちてくる風切りと、着いた瞬間の重い衝撃
      jumpIn(t, out) {
        const R = 0.42;
        noise(t, R + 0.1, filter('bandpass', 3200, 200, t, R, 3.5, gainNode(t, R * 0.8, 0.45, R * 0.4, out)), 'pink', true);
        noise(t + R, 0.06, filter('highpass', 1000, 1000, t + R, 0.06, 0.7, shaper(3, gainNode(t + R, 0.001, 0.3, 0.06, out))));
        osc('sine', 88, 24, t + R, 0.9, shaper(2, gainNode(t + R, 0.003, 0.9, 0.9, out)));
        noise(t + R, 0.8, filter('lowpass', 2000, 110, t + R, 0.8, 0.8, shaper(2.5, gainNode(t + R, 0.004, 0.6, 0.8, out))), 'brown', true);
        return R + 1.2;
      },
      // レーンでの移動（ザイレン）: 低い金属の唸りが走り抜ける
      lane(t, out) {
        const bp = filter('bandpass', 280, 2000, t, 0.75, 6, gainNode(t, 0.08, 0.4, 0.7, out));
        const sh = shaper(2.5, bp);
        osc('sawtooth', 70, 240, t, 0.75, sh, -14); osc('sawtooth', 71, 243, t, 0.75, sh, 14);
        noise(t, 0.8, filter('bandpass', 200, 1100, t, 0.8, 1.8, gainNode(t, 0.1, 0.3, 0.7, out)), 'brown', true);
        osc('sine', 60, 40, t, 0.6, gainNode(t, 0.05, 0.35, 0.55, out));
        return 1.0;
      },
      // 妨害場の完成: 金管のような低い和音がふくらむ（映画の予告編の「ブォーン」）
      fieldUp(t, out) {
        const D = 5.2;
        const g = A.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.4, t + 0.7);
        g.gain.setValueAtTime(0.4, t + 2.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + D);
        g.connect(out);
        const lp = A.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 1.5;
        lp.frequency.setValueAtTime(110, t);
        lp.frequency.exponentialRampToValueAtTime(1500, t + 1.3);
        lp.frequency.exponentialRampToValueAtTime(260, t + D);
        lp.connect(g);
        const sh = shaper(2.2, lp);
        for (const [f, det] of [[36.7, -8], [36.7, 9], [55, -6], [55, 7], [73.4, -4], [73.4, 5]]) osc('sawtooth', f, f, t, D, sh, det);
        osc('sine', 36.7, 36.7, t, D, gainNode(t, 0.7, 0.5, D - 0.7, out));
        // 予兆の吸い込み
        noise(t, 0.8, filter('highpass', 900, 3000, t, 0.75, 0.7, gainNode(t, 0.65, 0.12, 0.12, out)), 'pink', true);
        return D;
      },
      // 妨害場が消える: 低い和音が下がって沈む
      fieldDown(t, out) {
        const D = 3.4;
        const lp = filter('lowpass', 1300, 80, t, D, 1.2, gainNode(t, 0.06, 0.4, D, out));
        const sh = shaper(2.2, lp);
        for (const [f0, f1, det] of [[73.4, 34, -7], [73.4, 34, 8], [55, 25, -5], [55, 25, 6]]) osc('sawtooth', f0, f1, t, D, sh, det);
        osc('sine', 55, 22, t, D, gainNode(t, 0.06, 0.5, D, out));
        return D;
      },
      // 誘導弾の発射: 点火の「ボッ」と、遠ざかる噴射の轟音
      missile(t, out) {
        osc('sine', 150, 50, t, 0.3, shaper(2, gainNode(t, 0.002, 0.6, 0.3, out)));
        noise(t, 0.3, filter('lowpass', 1600, 300, t, 0.3, 0.8, gainNode(t, 0.002, 0.45, 0.3, out)), 'brown');
        // 噴射: 細かく震わせ、だんだんこもらせる
        const lp = filter('lowpass', 5000, 500, t + 0.05, 1.4, 0.7, gainNode(t + 0.05, 0.06, 0.35, 1.3, out));
        const trem = A.ctx.createGain();
        trem.gain.value = 1;
        lfo(24, 18, 0.35, t, 1.5, trem.gain);
        trem.connect(lp);
        noise(t + 0.05, 1.4, filter('bandpass', 700, 1300, t + 0.05, 1.4, 0.7, trem), 'pink', true);
        noise(t + 0.05, 1.4, filter('lowpass', 380, 200, t + 0.05, 1.4, 0.7, trem), 'brown', true);
        return 1.6;
      },
      // 迎撃で撃ち落とした: 乾いた「パン」と小さな破片
      intercept(t, out) {
        noise(t, 0.06, filter('bandpass', 1500, 900, t, 0.06, 1.1, shaper(5, gainNode(t, 0.001, 0.45, 0.06, out))));
        osc('sine', 230, 70, t, 0.16, shaper(1.6, gainNode(t, 0.002, 0.45, 0.16, out)));
        noise(t, 0.3, filter('lowpass', 900, 200, t, 0.3, 0.7, gainNode(t, 0.003, 0.2, 0.3, out)), 'brown');
        crackle(t + 0.02, 0.3, 4, 0.12, out);
        return 0.45;
      },
      // 貫く線の溜め（ザイレンの旗艦）: 低い唸りが共鳴しながら高まり、電気のはぜる音が増えていく
      lanceCharge(t, out) {
        const D = 3.6;
        const g = A.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + D - 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + D);
        g.connect(out);
        const lp = filter('lowpass', 140, 1700, t, D - 0.4, 7, g);
        const sh = shaper(2.4, lp);
        const c1 = osc('sawtooth', 38, 76, t, D, sh, -9), c2 = osc('sawtooth', 38.4, 76.8, t, D, sh, 9);
        lfo(4, 16, 3, t, D, c1.frequency); lfo(5, 18, 3, t, D, c2.frequency);
        osc('sine', 190, 880, t, D, gainNode(t, D - 0.6, 0.05, 0.5, out));
        osc('sine', 38, 76, t, D, gainNode(t, D - 0.6, 0.45, 0.5, out));
        crackle(t + D * 0.45, D * 0.55, 18, 0.1, out, 2000, 7000);
        return D;
      },
      // 貫く線の発射: 空気が裂けるような割れ、唸り続ける太い光の轟音、腹に来る衝撃、長い残響
      lanceFire(t, out) {
        noise(t, 0.12, filter('highpass', 700, 500, t, 0.12, 0.7, shaper(5, gainNode(t, 0.001, 0.55, 0.12, out))));
        osc('sine', 85, 18, t, 2.2, shaper(2.2, gainNode(t, 0.003, 1.0, 2.2, out)));
        // 光の轟音: 低いのこぎり波と雑音を速く震わせる
        const D = 2.6;
        const rg = gainNode(t + 0.02, 0.03, 0.55, D, out);
        const trem = A.ctx.createGain();
        trem.gain.value = 1;
        lfo(32, 20, 0.4, t, D + 0.1, trem.gain);
        trem.connect(rg);
        const lp = filter('lowpass', 2600, 300, t, D, 2, trem);
        const sh = shaper(3, lp);
        osc('sawtooth', 55, 41, t, D, sh, -12); osc('sawtooth', 55.6, 41.5, t, D, sh, 12);
        noise(t, D, filter('bandpass', 420, 180, t, D, 1.4, trem), 'brown', true);
        // 焼けるような高い音（短く）
        noise(t, 1.2, filter('highpass', 3500, 2000, t, 1.2, 0.7, gainNode(t, 0.01, 0.09, 1.1, out)), 'pink', true);
        // 長い地鳴り
        noise(t + 0.1, 4.5, filter('lowpass', 160, 80, t + 0.1, 4.5, 0.6, gainNode(t + 0.1, 0.4, 0.5, 4.2, out)), 'brown', true);
        crackle(t + 0.05, 1.8, 14, 0.14, out);
        return 5;
      },
      // 方舟からの発艦: 留め具の外れる金属音と、短い噴射
      launch(t, out) {
        noise(t, 0.06, filter('bandpass', 700, 600, t, 0.06, 7, gainNode(t, 0.002, 0.55, 0.06, out)));
        osc('sine', 150, 85, t, 0.16, shaper(1.6, gainNode(t, 0.002, 0.5, 0.16, out)));
        noise(t + 0.08, 0.6, filter('bandpass', 350, 1100, t + 0.08, 0.6, 1.2, gainNode(t + 0.08, 0.06, 0.3, 0.5, out)), 'pink', true);
        noise(t + 0.08, 0.6, filter('lowpass', 500, 200, t + 0.08, 0.6, 0.7, gainNode(t + 0.08, 0.05, 0.3, 0.5, out)), 'brown');
        return 0.9;
      },
      // 無人機の射撃: 低めの短い連射「ドドド」
      drone(t, out, o) {
        const d = o.det;
        for (let i = 0; i < 3; i++) {
          const tt = t + i * 0.055;
          const lp = filter('lowpass', 1100, 400, tt, 0.06, 1, gainNode(tt, 0.002, 0.22, 0.06, out));
          osc('square', 125 * d, 70 * d, tt, 0.06, lp);
          noise(tt, 0.02, filter('bandpass', 1800, 1800, tt, 0.02, 1, gainNode(tt, 0.001, 0.08, 0.02, out)));
        }
        return 0.35;
      },
    };
    A.names = Object.keys(SOUNDS);

    // 1つ鳴らす。o: { gain（0〜1）, pan（-1〜1）, side, size, near（近さ 0〜1。小さいほど遠くてこもる）, when（ctx の時刻。省くと今） }
    A.play = function (name, o) {
      const ctx = A.ctx, fn = SOUNDS[name];
      if (!ctx || !fn || (ctx.state !== 'running' && !A.offline)) return false;
      if (!A.offline && A.voices >= MAX_VOICES) return false;
      o = Object.assign({ gain: 1, pan: 0, side: 0, size: 1, det: 0.94 + Math.random() * 0.12 }, o || {});
      if (o.gain < 0.01) return false;
      const t = o.when != null ? o.when : ctx.currentTime + 0.01;
      const out = voiceOut(o, REV[name] || 0);
      const len = fn(t, out, o);
      if (!A.offline) {
        A.voices++;
        setTimeout(() => { A.voices--; out.disconnect(); }, (len + 0.3) * 1000);
      }
      return true;
    };

    // 環境音: ごく低いうなり（再生中だけ）。ゆっくりうねる2つの低音と、遠い地鳴り
    A.ambient = function (on, level, when) {
      const ctx = A.ctx;
      if (!ctx) return;
      if (on && !A.amb) {
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        g.connect(A.master);
        const send = ctx.createGain();
        send.gain.value = 0.3;
        g.connect(send); send.connect(A.rev);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 95; lp.Q.value = 0.7;
        lp.connect(g);
        const m = ctx.createChannelMerger(2);
        const nodes = [];
        for (let ch = 0; ch < 2; ch++) {
          const s = ctx.createBufferSource();
          s.buffer = A.buf.brown; s.loop = true; s.connect(m, 0, ch); s.start(0, ch * 2.1);
          nodes.push(s);
        }
        m.connect(lp);
        for (const [f, gv] of [[32.7, 0.16], [33.15, 0.16], [49.1, 0.06]]) {
          const o = ctx.createOscillator();
          o.type = 'sine'; o.frequency.value = f;
          const og = ctx.createGain(); og.gain.value = gv;
          o.connect(og); og.connect(g); o.start();
          nodes.push(o);
        }
        // ゆっくり揺らす
        const l = ctx.createOscillator(), lg = ctx.createGain();
        l.frequency.value = 0.06; lg.gain.value = 35;
        l.connect(lg); lg.connect(lp.frequency); l.start();
        nodes.push(l);
        A.amb = { g, nodes };
      }
      if (A.amb) A.amb.g.gain.setTargetAtTime(on ? (level == null ? 0.12 : level) : 0.0001, when == null ? ctx.currentTime : when, 0.6);
    };

    return A;
  }

  global.SpaceAudio = SpaceAudio;
})(typeof window !== 'undefined' ? window : this);
