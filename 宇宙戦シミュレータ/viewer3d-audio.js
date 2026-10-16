/* 宇宙戦シミュレータ 3Dビューアの効果音
 *
 * 音声ファイルは使わず、Web Audio でその場で合成する（ファイルを直接開いても鳴る）。
 * 宇宙に音はないが、映画のように鳴らす。
 * SpaceAudio() で作り、ユーザーの操作（クリックかキー）のあとに ensure() で鳴らし始める（ブラウザの決まり）。
 * play(名前, { gain, pan, side, size }) で1つ鳴らす。ambient(true) で環境音（低いうなり）。
 * 試聴用に、OfflineAudioContext を渡して init(ctx) すると、同じ音をファイルに書き出せる。
 */
(function (global) {
  'use strict';

  function SpaceAudio() {
    const A = { ctx: null, master: null, out: null, recDest: null, noise: null, voices: 0, amb: null, volume: 0.6 };
    const MAX_VOICES = 48;

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
      A.master = ctx.createGain();
      A.master.gain.value = A.volume;
      // 大きな音が重なっても割れないように
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
      A.master.connect(comp);
      comp.connect(ctx.destination);
      A.out = comp;
      if (ctx.createMediaStreamDestination) { A.recDest = ctx.createMediaStreamDestination(); comp.connect(A.recDest); }
      // 雑音（2秒、くり返して使う）
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) >>> 0; d[i] = (seed / 4294967296) * 2 - 1; }
      A.noise = buf;
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
    function voiceOut(gain, pan, t) {
      const ctx = A.ctx, g = ctx.createGain();
      g.gain.value = gain;
      if (ctx.createStereoPanner && pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p); p.connect(A.master);
      } else g.connect(A.master);
      return g;
    }
    // 音量の山: 立ち上がり a 秒で peak、そこから dur 秒で消える
    function env(param, t, a, peak, dur) {
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, a));
      param.exponentialRampToValueAtTime(0.0001, t + a + dur);
    }
    function noise(t, dur, out) {
      const s = A.ctx.createBufferSource();
      s.buffer = A.noise; s.loop = true;
      s.connect(out);
      s.start(t, Math.random() * 1.5);
      s.stop(t + dur + 0.05);
      return s;
    }
    function osc(type, f0, f1, t, dur, out) {
      const o = A.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      o.connect(out);
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

    // ---- 音の作り方（out へつなぐ。t は始める時刻、o は大きさや陣営）
    const SOUNDS = {
      // 主砲（ライン系統）。人類は高く澄んだ音、ザイレンは低くうなる音
      beam(t, out, o) {
        if (o.side === 1) {
          const lp = filter('lowpass', 1600, 500, t, 0.22, 1, gainNode(t, 0.004, 0.22, 0.22, out));
          osc('sawtooth', 380 * o.det, 150 * o.det, t, 0.22, lp);
          osc('sine', 120 * o.det, 70 * o.det, t, 0.2, gainNode(t, 0.004, 0.25, 0.2, out));
        } else {
          const hp = filter('highpass', 300, 300, t, 0.15, 0, gainNode(t, 0.003, 0.2, 0.15, out));
          osc('sine', 1700 * o.det, 520 * o.det, t, 0.15, hp);
          osc('triangle', 3300 * o.det, 900 * o.det, t, 0.12, gainNode(t, 0.002, 0.05, 0.12, out));
        }
        noise(t, 0.03, filter('highpass', 3000, 3000, t, 0.03, 0, gainNode(t, 0.001, 0.06, 0.03, out)));
        return 0.3;
      },
      // 撃沈（小さめの艦）
      death(t, out, o) {
        const dur = 0.9 * o.size;
        noise(t, dur, filter('lowpass', 1400, 140, t, dur, 0.7, gainNode(t, 0.004, 0.7, dur, out)));
        osc('sine', 95, 32, t, dur * 0.8, gainNode(t, 0.004, 0.55, dur * 0.8, out));
        noise(t, 0.35, filter('highpass', 2500, 2500, t, 0.35, 0, gainNode(t, 0.002, 0.18, 0.35, out)));
        return dur;
      },
      // 撃沈（拠点・ガルメス級・ノード艦など大物）
      deathBig(t, out) {
        const dur = 2.6;
        noise(t, 0.12, filter('highpass', 1500, 1500, t, 0.12, 0, gainNode(t, 0.001, 0.4, 0.12, out)));
        noise(t, dur, filter('lowpass', 1100, 90, t, dur, 0.8, gainNode(t, 0.006, 0.85, dur, out)));
        osc('sine', 70, 24, t, dur * 0.9, gainNode(t, 0.006, 0.8, dur * 0.9, out));
        noise(t + 0.1, 1.2, filter('bandpass', 3000, 800, t + 0.1, 1.2, 1.5, gainNode(t + 0.1, 0.05, 0.12, 1.2, out)));
        return dur;
      },
      // シェルの発射: 低い「ドン」と、飛び去る風切り
      shellLaunch(t, out) {
        osc('sine', 110, 36, t, 0.5, gainNode(t, 0.002, 0.8, 0.5, out));
        noise(t, 0.05, filter('highpass', 1500, 1500, t, 0.05, 0, gainNode(t, 0.001, 0.35, 0.05, out)));
        noise(t + 0.02, 0.9, filter('bandpass', 300, 1600, t + 0.02, 0.9, 2.5, gainNode(t + 0.02, 0.08, 0.3, 0.85, out)));
        return 1.0;
      },
      // シェルの着弾: 割れる音、重い爆風、長く続く地鳴り
      shellBoom(t, out, o) {
        const dur = 3.8 * o.size;
        noise(t, 0.1, filter('highpass', 1800, 1800, t, 0.1, 0, gainNode(t, 0.001, 0.6, 0.1, out)));
        noise(t, dur, filter('lowpass', 1000, 70, t, dur, 0.9, gainNode(t, 0.01, 1.0, dur, out)));
        osc('sine', 58, 21, t, dur * 0.85, gainNode(t, 0.01, 1.0, dur * 0.85, out));
        noise(t + 0.15, dur * 1.2, filter('lowpass', 170, 120, t + 0.15, dur * 1.2, 0.5, gainNode(t + 0.15, 0.3, 0.45, dur * 1.2, out)));
        return dur * 1.3;
      },
      // ジャンプで消える: 下から上へ吸い込まれる音
      jumpOut(t, out) {
        noise(t, 0.75, filter('bandpass', 200, 3800, t, 0.7, 6, gainNode(t, 0.05, 0.4, 0.7, out)));
        osc('sine', 260, 1600, t, 0.6, gainNode(t, 0.03, 0.08, 0.6, out));
        return 0.8;
      },
      // ジャンプで現れる: 上から下へ落ちてきて、軽い「ドン」
      jumpIn(t, out) {
        noise(t, 0.6, filter('bandpass', 3600, 260, t, 0.55, 6, gainNode(t, 0.02, 0.4, 0.55, out)));
        osc('sine', 85, 40, t + 0.45, 0.35, gainNode(t + 0.45, 0.004, 0.45, 0.35, out));
        return 0.9;
      },
      // レーンでの移動（ザイレン）: 短い金属的な走り抜け
      lane(t, out) {
        const lp = filter('lowpass', 2400, 2400, t, 0.35, 2, gainNode(t, 0.01, 0.12, 0.35, out));
        osc('sawtooth', 500, 1900, t, 0.3, lp);
        return 0.4;
      },
      // 妨害場の完成: 重なった低い和音がふくらむ
      fieldUp(t, out) {
        const dur = 3.6;
        const g = A.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.9);
        g.gain.setValueAtTime(0.3, t + 1.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const lp = filter('lowpass', 500, 900, t, dur, 0.5, g);
        g.connect(out);
        for (const [f, det] of [[55, 0], [82.4, 2], [110, -3], [165, 4]]) {
          const o2 = osc('sine', f, f, t, dur, lp);
          o2.detune.value = det;
        }
        osc('sine', 880, 880, t + 0.3, dur - 0.3, gainNode(t + 0.3, 0.6, 0.03, dur - 0.9, out));
        return dur;
      },
      // 妨害場が消える: 下がっていく和音
      fieldDown(t, out) {
        const dur = 2.4;
        const g = gainNode(t, 0.05, 0.28, dur, out);
        osc('sine', 110, 50, t, dur, g);
        osc('sine', 165, 70, t, dur, g);
        return dur;
      },
      // 誘導弾の発射: 噴射の音
      missile(t, out) {
        noise(t, 0.6, filter('bandpass', 900, 2600, t, 0.6, 1.5, gainNode(t, 0.02, 0.25, 0.6, out)));
        osc('sawtooth', 180, 520, t, 0.45, filter('lowpass', 900, 900, t, 0.45, 0, gainNode(t, 0.02, 0.05, 0.45, out)));
        return 0.7;
      },
      // 迎撃で撃ち落とした: 高い「チッ」
      intercept(t, out) {
        osc('sine', 2600, 2200, t, 0.06, gainNode(t, 0.001, 0.15, 0.06, out));
        osc('sine', 1900, 1700, t + 0.035, 0.06, gainNode(t + 0.035, 0.001, 0.1, 0.06, out));
        return 0.15;
      },
      // 無人機の射撃: 小さく震える音
      drone(t, out) {
        const o2 = osc('triangle', 560, 520, t, 0.16, gainNode(t, 0.004, 0.07, 0.16, out));
        const lfo = A.ctx.createOscillator(), lg = A.ctx.createGain();
        lfo.frequency.value = 22; lg.gain.value = 35;
        lfo.connect(lg); lg.connect(o2.frequency);
        lfo.start(t); lfo.stop(t + 0.2);
        return 0.2;
      },
    };
    A.names = Object.keys(SOUNDS);

    // 1つ鳴らす。o: { gain（0〜1）, pan（-1〜1）, side, size, when（ctx の時刻。省くと今） }
    A.play = function (name, o) {
      const ctx = A.ctx, fn = SOUNDS[name];
      if (!ctx || !fn || (ctx.state !== 'running' && !A.offline)) return false;
      if (!A.offline && A.voices >= MAX_VOICES) return false;
      o = Object.assign({ gain: 1, pan: 0, side: 0, size: 1, det: 0.94 + Math.random() * 0.12 }, o || {});
      if (o.gain < 0.01) return false;
      const t = o.when != null ? o.when : ctx.currentTime + 0.01;
      const out = voiceOut(o.gain, o.pan, t);
      const len = fn(t, out, o);
      if (!A.offline) {
        A.voices++;
        setTimeout(() => { A.voices--; out.disconnect(); }, (len + 0.3) * 1000);
      }
      return true;
    };

    // 環境音: ごく低いうなり（再生中だけ）
    A.ambient = function (on, level) {
      const ctx = A.ctx;
      if (!ctx) return;
      if (on && !A.amb) {
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        g.connect(A.master);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 0.7;
        lp.connect(g);
        const s = ctx.createBufferSource();
        s.buffer = A.noise; s.loop = true; s.connect(lp); s.start();
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = 41;
        const og = ctx.createGain(); og.gain.value = 0.25;
        o.connect(og); og.connect(g); o.start();
        // ゆっくり揺らす
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 0.07; lg.gain.value = 60;
        lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
        A.amb = { g, nodes: [s, o, lfo] };
      }
      if (A.amb) A.amb.g.gain.setTargetAtTime(on ? (level == null ? 0.12 : level) : 0.0001, ctx.currentTime, 0.6);
    };

    return A;
  }

  global.SpaceAudio = SpaceAudio;
})(typeof window !== 'undefined' ? window : this);
