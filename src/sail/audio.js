/**
 * The sound of the opening: the gong ensemble as background music (public/sail/music.mp3, made by
 * `python scripts/prepare_assets.py sail_music`), soft waves under it, and the swell and fanfare of
 * the opening itself, which are synthesised.
 *
 * The music is placed on the race server's clock (`setClock`), not on when each device happened to
 * start it. A room of phones therefore plays the same beat at the same moment instead of a wash of
 * out-of-step copies, and they sit under the LED, which plays it louder through the PA.
 *
 * Browsers only allow sound after a touch or click, so `unlock()` has to be called from one.
 */
const MUSIC_URL = '/sail/music.mp3';
// The file is one seamless loop of 5 cycles of the gong pattern, with a little of itself either
// side so a decoder's padding can't land inside the loop. See sail_music() in prepare_assets.py.
const LOOP_START = 0.5;
const LOOP_SECONDS = 21.4291;
const MUSIC_GAIN = 0.65;            // the recording is mastered loud
const WAVE_LEVEL = 0.16;            // the one number to change if the waves sit too high or low

// How loud the music and the waves sit in each scene.
const SCENES = {
  harbor: { music: 0.75, waves: 1 },
  sail: { music: 1, waves: 1 },
  hush: { music: 0, waves: 1 },      // while the bulb rises, only the sea under the sequence
  open: { music: 1, waves: 0.7 },
};

export function createAudio({ musicLevel = 1 } = {}) {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let waveBus = null;
  let fxBus = null;
  let analyser = null;
  let muted = false;
  let soundOn = true;           // the host fades everything out for the live performance
  let scene = 'harbor';
  let now = () => Date.now();
  let musicBuffer = null;
  let musicSource = null;

  // Fetched straight away so it is ready the moment someone taps; decoded once sound is allowed.
  const musicFile = fetch(MUSIC_URL).then((r) => r.arrayBuffer()).catch((err) => {
    console.warn('[sail] music failed to load', err);
    return null;
  });

  /**
   * Pink noise for the sea. White noise sounds like static because so much of its energy is up
   * high; pink falls away with pitch, which is what makes it read as water.
   */
  function makeSeaNoise() {
    const len = ctx.sampleRate * 8;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
    return buf;
  }

  /**
   * One slow swell: noise that comes in and all but dies away, in the band a phone's speaker can
   * actually play. Below about 300 Hz it would be inaudible on a phone yet still take up headroom;
   * above about 2 kHz it starts to sound like static. Both are cut, steeply.
   */
  function swell(sea, low, high, rate, level, offset) {
    const src = ctx.createBufferSource();
    src.buffer = sea;
    src.loop = true;
    let node = src;
    const filter = (type, freq) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = 0.4;
      node.connect(f);
      node = f;
      return f;
    };
    filter('highpass', low);
    filter('highpass', low);
    const lp = filter('lowpass', high);
    filter('lowpass', high * 1.3);
    const gain = ctx.createGain();
    gain.gain.value = level;
    node.connect(gain).connect(waveBus);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const depth = ctx.createGain();
    depth.gain.value = level * 0.8;
    const bright = ctx.createGain();
    bright.gain.value = high * 0.35;
    lfo.connect(depth).connect(gain.gain);
    lfo.connect(bright).connect(lp.frequency);
    src.start(0, offset);
    lfo.start(ctx.currentTime + offset);
  }

  /** Starts the loop at the point the shared clock says it should be at. */
  function startMusic() {
    if (!ctx || !musicBuffer || ctx.state !== 'running') return;
    if (musicSource) {
      try { musicSource.stop(); } catch { /* already stopped */ }
    }
    const src = ctx.createBufferSource();
    src.buffer = musicBuffer;
    src.loop = true;
    src.loopStart = LOOP_START;
    src.loopEnd = LOOP_START + LOOP_SECONDS;
    src.connect(musicBus);
    const lead = 0.06;
    const position = (((now() / 1000 + lead) % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
    src.start(ctx.currentTime + lead, LOOP_START + position);
    musicSource = src;
  }

  function ensure() {
    if (ctx) {
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    ctx.resume().catch(() => {});

    // Everything meets in a limiter, so the fanfare can't clip a phone's speaker.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(limiter).connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(master);
    waveBus = ctx.createGain();
    waveBus.gain.value = 0;
    waveBus.connect(master);
    fxBus = ctx.createGain();
    fxBus.connect(master);

    const sea = makeSeaNoise();
    swell(sea, 300, 1500, 0.1, WAVE_LEVEL, 0);
    swell(sea, 450, 1100, 0.067, WAVE_LEVEL * 0.8, 3.1);
    applyScene(0.6);

    musicFile.then((data) => {
      if (!data) return;
      // The callback form: Safari before 14.1 has no promise version.
      ctx.decodeAudioData(data, (buffer) => {
        musicBuffer = buffer;
        startMusic();
      }, (err) => console.warn('[sail] music failed to decode', err));
    });

    // A locked phone suspends audio and its clock, so pick the beat back up on return.
    ctx.onstatechange = () => { if (ctx.state === 'running') startMusic(); };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && ctx.state !== 'running') ctx.resume().catch(() => {});
    });
    return true;
  }

  function applyScene(fade = 1.2) {
    const s = SCENES[scene];
    const t = ctx.currentTime;
    const end = t + Math.max(fade, 0.01);
    const set = (bus, v) => {
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(soundOn ? v : 0, end);
    };
    set(musicBus, s.music * MUSIC_GAIN * musicLevel);
    set(waveBus, s.waves);
  }

  function tone(freq, at, dur, vol, type = 'sine') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(fxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** The rise: two climbing tones, an octave apart, as the bulb comes out of the lantern. */
  function riser(dur) {
    const t = ctx.currentTime;
    for (const [from, to, vol, type] of [[196, 784, 0.22, 'triangle'], [392, 1568, 0.09, 'sine']]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(vol * 0.12, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.9);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
      o.connect(g).connect(fxBus);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  let level = null;

  return {
    /** Call from a touch or click. */
    unlock: ensure,
    get unlocked() { return !!ctx && ctx.state === 'running'; },

    /** The clock the music follows: the race server's, so every device plays in step. */
    setClock(fn) { now = fn; },

    /** 'harbor', 'sail', 'hush' or 'open'. Safe to call every frame. */
    setScene(name) {
      if (name === scene) return;
      scene = name;
      if (ctx) applyScene();
    },

    /** The host's fade, ahead of the live performance. Safe to call every frame. */
    setSoundOn(on) {
      if (on === soundOn) return;
      soundOn = on;
      if (ctx) applyScene(3);
    },

    setMuted(v) {
      muted = v;
      if (master) master.gain.value = v ? 0 : 0.9;
    },
    get muted() { return muted; },

    bell() {
      if (!ensure()) return;
      for (const [f, a] of [[880, 0], [1320, 0.12], [1760, 0.24]]) tone(f, a, 1.1, 0.14);
    },
    tick() {
      if (ensure()) tone(660, 0, 0.18, 0.2, 'triangle');
    },
    /** A soft dip of the paddle, a little different each side. */
    paddle(side) {
      if (ctx && soundOn) tone(side === 'L' ? 349.23 : 440, 0, 0.1, 0.06);
    },
    go() {
      if (ensure()) tone(990, 0, 0.5, 0.24, 'triangle');
    },

    /** Cues from src/sail/opening.js. */
    cue(name) {
      if (!ensure() || !soundOn) return;
      if (name === 'rise') {
        riser(3);
      } else if (name === 'on') {
        // The bulb catches: a quick shimmer upward.
        [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => tone(f, i * 0.07, 1.9, 0.17));
      } else if (name === 'write') {
        // One soft note per line of the logo as it writes on.
        [[523.25, 659.25], [587.33, 783.99], [659.25, 880], [783.99, 1046.5]].forEach(([a, b], i) => {
          tone(a, i * 0.37, 0.9, 0.13, 'triangle');
          tone(b, i * 0.37, 0.9, 0.09);
        });
      } else if (name === 'open') {
        // A short fanfare, landing on a big held C major.
        [[392, 0], [523.25, 0.16], [659.25, 0.32]].forEach(([f, a]) => {
          tone(f, a, 0.4, 0.34, 'triangle');
          tone(f * 2, a, 0.25, 0.08);
        });
        for (const f of [130.81, 261.63, 392, 523.25, 659.25, 783.99, 1046.5]) {
          tone(f, 0.5, 3, 0.2, 'triangle');
          tone(f * 2, 0.5, 1.8, 0.05);
        }
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(f, 0.6 + i * 0.09, 1.2, 0.09));
      }
    },

    /** The current output level (RMS, 0 to 1), for checking the mix. */
    level() {
      if (!ctx) return 0;
      if (!analyser) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 8192;
        master.connect(analyser);
        level = new Float32Array(analyser.fftSize);
      }
      analyser.getFloatTimeDomainData(level);
      let sum = 0;
      for (let i = 0; i < level.length; i++) sum += level[i] * level[i];
      return Math.sqrt(sum / level.length);
    },

    get state() { return ctx ? ctx.state : 'none'; },
    get musicReady() { return !!musicBuffer; },
    /** Where the loop is now, in seconds, for checking that devices agree. */
    get musicPosition() { return ((now() / 1000) % LOOP_SECONDS + LOOP_SECONDS) % LOOP_SECONDS; },
  };
}
