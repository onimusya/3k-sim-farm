const PHASE_MIX = Object.freeze({
  dawn: 0.034,
  morning: 0.04,
  noon: 0.047,
  afternoon: 0.043,
  dusk: 0.034,
  night: 0.022,
});

class FixedRng {
  constructor(seed = 0x7a11d10) {
    this.state = seed >>> 0;
  }

  float() {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  signed() {
    return this.float() * 2 - 1;
  }

  range(min, max) {
    return min + (max - min) * this.float();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * A deliberately small procedural score. No samples are fetched or decoded:
 * wind, animals, insects, watch drums, and work sounds all come from oscillators
 * and one deterministic noise buffer made after the player's first gesture.
 */
export class AudioSystem {
  static id = 'audio';
  static deps = [];

  constructor({ volume = 0.42, muted = false } = {}) {
    this.context = null;
    this.available = true;
    this.started = false;
    this.muted = Boolean(muted);
    this.volume = clamp(Number(volume) || 0.42, 0, 1);

    this._ctx = null;
    this._rng = null;
    this._offs = [];
    this._gestureOffs = [];
    this._persistent = [];
    this._transients = new Set();
    this._unlockPromise = null;
    this._graphReady = false;
    this._ambientStarted = false;
    this._disposed = false;
    this._hardMuted = false;
    this._phase = 'dawn';
    this._heardPhases = new Set();
    this._noiseBuffer = null;

    this.masterGain = null;
    this.ambienceGain = null;
    this.sfxGain = null;
    this.windGain = null;
    this._nextRooster = Infinity;
    this._nextCicada = Infinity;
    this._nextDrum = Infinity;
  }

  async init(ctx) {
    this._ctx = ctx;
    this._rng = ctx.rng?.fork?.() ?? new FixedRng();

    const query = globalThis.location?.search ?? '';
    this._hardMuted = Boolean(
      ctx.config?.capture ||
      ctx.config?.deterministic ||
      ctx.config?.audio === false ||
      /(?:[?&](?:mute|muted)=1)(?:&|$)/.test(query)
    );
    this.muted = this.muted || this._hardMuted || ctx.config?.muted === true;

    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass) this.available = false;

    const on = (name, handler) => this._offs.push(ctx.events.on(name, handler));
    on('game:begin', () => this.unlock());
    on('audio:unlock', () => this.unlock());
    on('audio:mute', (payload) => this.setMuted(typeof payload === 'object' ? payload.muted : payload));
    on('day:phase', (payload) => this._onPhase(payload));
    on('interaction:success', (payload) => this.playAction(payload));
    on('interaction:blocked', () => this._playBlocked());
    on('player:recover', () => this._playRecover());
    on('day:complete', () => this._playCompletion());

    const farm = ctx.peek?.('farm');
    if (farm?.phase) this._phase = String(farm.phase).toLowerCase();

    if (this.available && !this._hardMuted) this._installGestureUnlock();
  }

  update(_dt, ctx) {
    if (!this.started || !this.context || this.context.state !== 'running') return;
    const elapsed = ctx.time.elapsed;

    if (elapsed >= this._nextRooster) {
      this._rooster(0.62);
      this._nextRooster = elapsed + this._rng.range(31, 48);
    }

    if (elapsed >= this._nextCicada) {
      this._cicada();
      this._nextCicada = elapsed + this._rng.range(5.8, 10.5);
    }

    if (elapsed >= this._nextDrum) {
      this._drum(0.24);
      this._nextDrum = elapsed + this._rng.range(35, 57);
    }
  }

  /** Safe to call repeatedly. It creates/resumes Web Audio only from a gesture. */
  unlock() {
    if (this._disposed || this._hardMuted || !this.available) return Promise.resolve(false);
    if (this.started && this.context?.state === 'running') return Promise.resolve(true);
    if (this._unlockPromise) return this._unlockPromise;

    this._unlockPromise = this._doUnlock()
      .catch(() => false)
      .finally(() => {
        this._unlockPromise = null;
      });
    return this._unlockPromise;
  }

  setMuted(muted) {
    this.muted = this._hardMuted || Boolean(muted);
    if (this.masterGain && this.context) {
      const now = this.context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, now);
    }
    return this.muted;
  }

  toggleMuted() {
    return this.setMuted(!this.muted);
  }

  setVolume(volume) {
    this.volume = clamp(Number(volume) || 0, 0, 1);
    this.setMuted(this.muted);
    return this.volume;
  }

  /** Public event-independent action hook, useful to farm debug tools. */
  playAction(payload = {}) {
    if (!this.started || this.muted || !this.context) return;
    const descriptor = typeof payload === 'string'
      ? payload
      : `${payload.id ?? ''} ${payload.label ?? ''} ${payload.world ?? ''}`;
    const action = descriptor.toLowerCase();

    if (/water|well|draw|bucket|irrigat/.test(action)) this._water();
    else if (/harvest|sheaf|cut|millet/.test(action)) this._harvest();
    else if (/thresh|winnow|pedal/.test(action)) this._thresh();
    else if (/granary|deliver|seal|share/.test(action)) this._seal();
    else if (/seed|family|give|compassion/.test(action)) this._share();
    else if (/lamp|light|hearth|fire/.test(action)) this._lamp();
    else if (/sleep|meal|porridge|home/.test(action)) this._hearth();
    else this._woodClick(0.7);
  }

  dispose() {
    this._disposed = true;
    for (const off of this._offs) off();
    for (const off of this._gestureOffs) off();
    this._offs.length = 0;
    this._gestureOffs.length = 0;

    for (const node of this._persistent) {
      try { node.stop?.(); } catch { /* already stopped */ }
      try { node.disconnect?.(); } catch { /* already disconnected */ }
    }
    this._persistent.length = 0;

    for (const record of this._transients) {
      try { record.source.stop?.(); } catch { /* already stopped */ }
      this._disconnectTransient(record);
    }
    this._transients.clear();

    for (const node of [this.windGain, this.ambienceGain, this.sfxGain, this.masterGain]) {
      try { node?.disconnect?.(); } catch { /* already disconnected */ }
    }
    if (this.context && this.context.state !== 'closed') {
      try { this.context.close().catch(() => {}); } catch { /* unsupported close */ }
    }

    this.context = null;
    this._ctx = null;
    this._noiseBuffer = null;
    this.started = false;
    this._graphReady = false;
  }

  async _doUnlock() {
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AudioContextClass) {
        this.available = false;
        this._removeGestureUnlock();
        return false;
      }
      try {
        this.context = new AudioContextClass({ latencyHint: 'interactive' });
      } catch {
        try {
          this.context = new AudioContextClass();
        } catch {
          this.available = false;
          this._removeGestureUnlock();
          return false;
        }
      }
      this._buildGraph();
    }

    if (this.context.state === 'suspended') {
      try { await this.context.resume(); } catch { return false; }
    }
    if (this.context.state !== 'running') return false;

    this.started = true;
    this._removeGestureUnlock();
    this._startAmbience();
    return true;
  }

  _installGestureUnlock() {
    if (!globalThis.document) return;
    const handler = () => { this.unlock(); };
    const options = { capture: true, passive: true };
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      document.addEventListener(type, handler, options);
      this._gestureOffs.push(() => document.removeEventListener(type, handler, options));
    }
  }

  _removeGestureUnlock() {
    for (const off of this._gestureOffs) off();
    this._gestureOffs.length = 0;
  }

  _buildGraph() {
    if (!this.context || this._graphReady) return;
    const audio = this.context;
    const compressor = audio.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.22;

    this.masterGain = audio.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.volume;
    this.ambienceGain = audio.createGain();
    this.ambienceGain.gain.value = 0.72;
    this.sfxGain = audio.createGain();
    this.sfxGain.gain.value = 0.86;

    this.ambienceGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(compressor);
    compressor.connect(audio.destination);
    this._persistent.push(compressor);

    this._noiseBuffer = this._makeNoiseBuffer(2.7);
    this._graphReady = true;
  }

  _makeNoiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(this.context.sampleRate * seconds));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i++) {
      const white = this._rng.signed();
      brown = (brown + 0.025 * white) / 1.025;
      data[i] = clamp(brown * 3.3 + white * 0.075, -1, 1);
    }
    return buffer;
  }

  _startAmbience() {
    if (this._ambientStarted || !this.context || !this._noiseBuffer) return;
    this._ambientStarted = true;
    const audio = this.context;

    const wind = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const windGain = audio.createGain();
    const lfo = audio.createOscillator();
    const lfoDepth = audio.createGain();
    wind.buffer = this._noiseBuffer;
    wind.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = 780;
    filter.Q.value = 0.42;
    windGain.gain.value = PHASE_MIX[this._phase] ?? PHASE_MIX.dawn;
    lfo.type = 'sine';
    lfo.frequency.value = 0.073;
    lfoDepth.gain.value = 0.009;

    wind.connect(filter);
    filter.connect(windGain);
    windGain.connect(this.ambienceGain);
    lfo.connect(lfoDepth);
    lfoDepth.connect(windGain.gain);
    wind.start();
    lfo.start();

    this.windGain = windGain;
    this._persistent.push(wind, filter, windGain, lfo, lfoDepth);
    this._scheduleAmbientForPhase(this._phase, true);
  }

  _onPhase(payload = {}) {
    const phase = String(typeof payload === 'string' ? payload : payload.phase ?? 'dawn').toLowerCase();
    this._phase = PHASE_MIX[phase] === undefined ? 'dawn' : phase;
    if (this.context && this.windGain) {
      const now = this.context.currentTime;
      this.windGain.gain.cancelScheduledValues(now);
      this.windGain.gain.setValueAtTime(PHASE_MIX[this._phase], now);
    }
    if (this.started) this._scheduleAmbientForPhase(this._phase, false);
  }

  _scheduleAmbientForPhase(phase, initial) {
    const elapsed = this._ctx?.time?.elapsed ?? 0;
    const warm = phase === 'noon' || phase === 'afternoon' || phase === 'dusk';
    this._nextCicada = warm ? elapsed + this._rng.range(initial ? 2.5 : 0.35, 5.5) : Infinity;
    this._nextRooster = phase === 'dawn' || phase === 'morning'
      ? elapsed + this._rng.range(initial ? 0.25 : 1.5, 4.5)
      : Infinity;
    this._nextDrum = elapsed + this._rng.range(initial ? 5 : 26, initial ? 8 : 43);

    if (!this._heardPhases.has(phase)) {
      this._heardPhases.add(phase);
      if (phase === 'dawn') {
        this._rooster(0.78, 0.18);
        this._drum(0.16, 1.7);
      } else if (phase === 'noon') {
        this._drum(0.25, 0.12);
        this._cicada(0.8);
      } else if (phase === 'dusk') {
        this._drum(0.3, 0.12);
      } else if (phase === 'night') {
        this._tone({ from: 294, to: 220, gain: 0.025, duration: 1.4, delay: 0.12, type: 'sine', destination: this.ambienceGain });
      }
    }
  }

  _tone({ from, to = from, gain = 0.05, duration = 0.2, delay = 0, attack = 0.008, type = 'sine', destination = this.sfxGain, pan = 0 }) {
    if (!this.context || !destination || this.muted) return null;
    const audio = this.context;
    const start = audio.currentTime + Math.max(0, delay);
    const end = start + Math.max(0.015, duration);
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    const panner = audio.createStereoPanner?.();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, from), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), end);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, gain), start + Math.min(attack, duration * 0.35));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope);
    if (panner) {
      panner.pan.value = clamp(pan, -1, 1);
      envelope.connect(panner);
      panner.connect(destination);
    } else {
      envelope.connect(destination);
    }
    oscillator.start(start);
    oscillator.stop(end + 0.015);
    this._trackTransient(oscillator, panner ? [envelope, panner] : [envelope]);
    return oscillator;
  }

  _noise({ type = 'bandpass', frequency = 1200, q = 0.8, gain = 0.035, duration = 0.12, delay = 0, attack = 0.004, destination = this.sfxGain, pan = 0 }) {
    if (!this.context || !this._noiseBuffer || !destination || this.muted) return null;
    const audio = this.context;
    const start = audio.currentTime + Math.max(0, delay);
    const end = start + Math.max(0.015, duration);
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const envelope = audio.createGain();
    const panner = audio.createStereoPanner?.();
    source.buffer = this._noiseBuffer;
    source.loop = true;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, gain), start + Math.min(attack, duration * 0.3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter);
    filter.connect(envelope);
    if (panner) {
      panner.pan.value = clamp(pan, -1, 1);
      envelope.connect(panner);
      panner.connect(destination);
    } else {
      envelope.connect(destination);
    }
    source.start(start, this._rng.range(0, Math.max(0.01, this._noiseBuffer.duration - 0.05)));
    source.stop(end + 0.015);
    this._trackTransient(source, panner ? [filter, envelope, panner] : [filter, envelope]);
    return source;
  }

  _trackTransient(source, nodes) {
    const record = { source, nodes };
    this._transients.add(record);
    source.onended = () => {
      this._disconnectTransient(record);
      this._transients.delete(record);
    };
  }

  _disconnectTransient(record) {
    try { record.source.disconnect?.(); } catch { /* already disconnected */ }
    for (const node of record.nodes) {
      try { node.disconnect?.(); } catch { /* already disconnected */ }
    }
  }

  _rooster(level = 0.7, delay = 0) {
    const gain = 0.032 * level;
    const pan = this._rng.range(-0.58, 0.58);
    this._tone({ from: 480, to: 810, gain, duration: 0.17, delay, attack: 0.025, type: 'sawtooth', destination: this.ambienceGain, pan });
    this._tone({ from: 730, to: 920, gain: gain * 0.92, duration: 0.2, delay: delay + 0.19, attack: 0.018, type: 'triangle', destination: this.ambienceGain, pan });
    this._tone({ from: 830, to: 510, gain: gain * 1.05, duration: 0.34, delay: delay + 0.43, attack: 0.026, type: 'sawtooth', destination: this.ambienceGain, pan });
    this._tone({ from: 690, to: 450, gain: gain * 0.72, duration: 0.31, delay: delay + 0.82, attack: 0.018, type: 'triangle', destination: this.ambienceGain, pan });
  }

  _cicada(level = 1) {
    const pan = this._rng.range(-0.82, 0.82);
    for (let i = 0; i < 6; i++) {
      const frequency = this._rng.range(3650, 4350);
      this._tone({
        from: frequency,
        to: frequency * 1.035,
        gain: 0.0065 * level,
        duration: 0.035,
        delay: i * 0.057,
        attack: 0.004,
        type: 'square',
        destination: this.ambienceGain,
        pan,
      });
    }
  }

  _drum(level = 0.35, delay = 0) {
    const pan = this._rng.range(-0.3, 0.3);
    this._tone({ from: 104, to: 46, gain: 0.17 * level, duration: 1.05, delay, attack: 0.006, type: 'sine', destination: this.ambienceGain, pan });
    this._noise({ type: 'lowpass', frequency: 310, q: 0.7, gain: 0.045 * level, duration: 0.24, delay, destination: this.ambienceGain, pan });
  }

  _woodClick(level = 1, delay = 0) {
    this._tone({ from: 155, to: 78, gain: 0.085 * level, duration: 0.13, delay, attack: 0.002, type: 'triangle' });
    this._noise({ type: 'bandpass', frequency: 760, q: 1.1, gain: 0.05 * level, duration: 0.07, delay, attack: 0.001 });
  }

  _water() {
    const pan = this._rng.range(-0.18, 0.18);
    this._noise({ type: 'highpass', frequency: 1600, q: 0.45, gain: 0.035, duration: 0.32, pan });
    this._tone({ from: 1320, to: 610, gain: 0.048, duration: 0.25, delay: 0.04, attack: 0.004, type: 'sine', pan });
    this._tone({ from: 880, to: 540, gain: 0.032, duration: 0.2, delay: 0.17, attack: 0.004, type: 'sine', pan: -pan });
  }

  _harvest() {
    const pan = this._rng.range(-0.22, 0.22);
    this._noise({ type: 'bandpass', frequency: 2850, q: 0.6, gain: 0.06, duration: 0.24, pan });
    this._tone({ from: 540, to: 260, gain: 0.027, duration: 0.12, delay: 0.03, attack: 0.002, type: 'triangle', pan });
  }

  _thresh() {
    this._woodClick(1.05, 0);
    this._woodClick(0.78, 0.19);
    this._noise({ type: 'bandpass', frequency: 1800, q: 0.55, gain: 0.034, duration: 0.33, delay: 0.06 });
  }

  _seal() {
    this._woodClick(1.18, 0);
    this._tone({ from: 92, to: 52, gain: 0.075, duration: 0.5, delay: 0.015, attack: 0.004, type: 'sine' });
  }

  _share() {
    this._noise({ type: 'highpass', frequency: 2100, q: 0.5, gain: 0.024, duration: 0.24 });
    this._tone({ from: 392, to: 392, gain: 0.04, duration: 0.45, delay: 0.04, attack: 0.012, type: 'sine' });
    this._tone({ from: 523.25, to: 523.25, gain: 0.035, duration: 0.58, delay: 0.19, attack: 0.012, type: 'sine' });
  }

  _lamp() {
    this._noise({ type: 'highpass', frequency: 2700, q: 0.45, gain: 0.04, duration: 0.42, attack: 0.02 });
    this._tone({ from: 330, to: 440, gain: 0.025, duration: 0.52, delay: 0.11, attack: 0.04, type: 'sine' });
  }

  _hearth() {
    this._tone({ from: 294, to: 220, gain: 0.037, duration: 0.75, attack: 0.03, type: 'sine' });
    this._tone({ from: 392, to: 330, gain: 0.028, duration: 0.88, delay: 0.13, attack: 0.03, type: 'sine' });
  }

  _playBlocked() {
    if (!this.started || this.muted) return;
    this._tone({ from: 128, to: 84, gain: 0.052, duration: 0.14, attack: 0.002, type: 'square' });
    this._woodClick(0.43, 0.02);
  }

  _playRecover() {
    if (!this.started || this.muted) return;
    this._tone({ from: 220, to: 330, gain: 0.03, duration: 0.33, attack: 0.018, type: 'sine' });
  }

  _playCompletion() {
    if (!this.started || this.muted) return;
    this._drum(0.72, 0);
    this._drum(0.54, 0.38);
    this._tone({ from: 261.63, to: 261.63, gain: 0.045, duration: 1.25, delay: 0.34, attack: 0.025, type: 'sine' });
    this._tone({ from: 392, to: 392, gain: 0.042, duration: 1.3, delay: 0.61, attack: 0.025, type: 'sine' });
  }
}
