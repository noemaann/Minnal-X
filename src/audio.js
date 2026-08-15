/**
 * Audio Module for MINNAL-X
 * Uses Web Audio API to dynamically synthesize lightning/sci-fi sound effects.
 * Cleans up node networks on completion to prevent Audio Node leaks.
 */

export class AudioManager {
  constructor() {
    this.ctx = null;
  }

  /**
   * Initializes the Web Audio API context.
   */
  init() {
    if (!this.ctx) {
      // Lazy init audio context on user interaction
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      console.log('AudioManager: Web Audio Context initialized.');
    }
  }

  /**
   * Synthesizes a sci-fi energy hum or charge-up sound.
   * @param {number} duration In seconds.
   */
  playCharge(duration = 1.0) {
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + duration);

    gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + duration * 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);

    // Clean up node references on sound end to avoid AudioNode memory leaks
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    console.log('AudioManager: Playing charge sound (synthesized)...');
  }

  /**
   * Synthesizes a lightning crack / zap sound.
   */
  playZap() {
    this.init();
    if (!this.ctx) return;

    const duration = 0.25;
    const bufferSize = this.ctx.sampleRate * duration; // 0.25 seconds of sound
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Populate with white noise
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    // Filter to make it crackle
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start();
    noise.stop(this.ctx.currentTime + duration);

    // Clean up node references on completion
    noise.onended = () => {
      noise.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    console.log('AudioManager: Playing lightning zap (synthesized)...');
  }
}
