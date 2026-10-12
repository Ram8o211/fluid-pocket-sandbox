export class ShopAudio {
  constructor() { this.enabled = true; this.context = null; }
  play(kind = 'tap') {
    if (!this.enabled) return;
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return;
      this.context ||= new Audio(); if (this.context.state === 'suspended') this.context.resume();
      const notes = kind === 'sale' ? [392, 494, 587, 784] : kind === 'pour' ? [240, 320] : kind === 'measure' ? [622, 784] : [440];
      notes.forEach((frequency, i) => {
        const at = this.context.currentTime + i * .065, oscillator = this.context.createOscillator(), gain = this.context.createGain();
        oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.025, at + .012); gain.gain.exponentialRampToValueAtTime(.0001, at + .1);
        oscillator.connect(gain); gain.connect(this.context.destination); oscillator.start(at); oscillator.stop(at + .12);
      });
    } catch { /* Sound is optional; browsers without audio remain fully playable. */ }
  }
}
