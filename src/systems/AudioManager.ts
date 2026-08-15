export type SfxName = 'menu' | 'light' | 'heavy' | 'block' | 'jump' | 'special' | 'ultimate' | 'ko' | 'victory';

class AudioManagerImpl {
  private context: AudioContext | null = null;
  private muted = false;

  async unlock(): Promise<void> {
    try {
      if (!this.context) this.context = new AudioContext();
      if (this.context.state === 'suspended') await this.context.resume();
    } catch (error) {
      console.warn('[Audio] Web Audio unavailable. Game will continue silently.', error);
      this.context = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  isMuted(): boolean { return this.muted; }

  play(name: SfxName): void {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    const profiles: Record<SfxName, [number, number, OscillatorType, number]> = {
      menu: [520, 760, 'square', .045], light: [190, 80, 'square', .055], heavy: [110, 44, 'sawtooth', .09],
      block: [740, 360, 'triangle', .06], jump: [260, 520, 'sine', .055], special: [330, 980, 'sawtooth', .09],
      ultimate: [90, 880, 'sawtooth', .16], ko: [150, 35, 'square', .22], victory: [440, 880, 'triangle', .18],
    };
    const [from, to, type, duration] = profiles[name];
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    gain.gain.setValueAtTime(name === 'ultimate' || name === 'ko' ? .16 : .09, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    osc.connect(gain).connect(this.context.destination);
    osc.start(now); osc.stop(now + duration + .02);

    if (name === 'heavy' || name === 'ko' || name === 'ultimate') this.noise(duration * .8, name === 'ko' ? .11 : .06);
  }

  private noise(duration: number, volume: number): void {
    if (!this.context || this.muted) return;
    const frames = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, frames, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(volume, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, this.context.currentTime + duration);
    source.connect(gain).connect(this.context.destination);
    source.start();
  }
}

export const AudioManager = new AudioManagerImpl();
