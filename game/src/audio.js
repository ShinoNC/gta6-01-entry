// All sound is synthesized with WebAudio — no audio files. Engine hum
// follows speed, sirens wail near police, gunshots are noise bursts, and
// two radio stations loop short synth melodies. Silent until the player
// clicks START (the browser needs a gesture to unlock audio).
export const RADIO_STATIONS = [
  {
    name: 'WAVE 88.1 · Neon Drive',
    bpm: 112,
    melodyMidi: [69, 72, 76, 79, 76, 72, 74, 76, 69, 72, 76, 81, 79, 76, 74, 72],
    bassMidi: [45, 45, 41, 43],
  },
  {
    name: 'RADIO SOL 101.9',
    bpm: 96,
    melodyMidi: [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 81, 79, 76, 74],
    bassMidi: [48, 55, 53, 50],
  },
];

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.stationIndex = 0;
    this.radioStep = 0;
    this.nextNoteTime = 0;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenIntensity = 0;
    this.engineSpeed = 0;
    this.engineDriving = false;
    this.clock = 0;
  }

  unlock() {
    if (this.ctx) {
      this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      const engineFilter = this.ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(engineFilter).connect(this.engineGain).connect(this.ctx.destination);
      this.engineOsc.start();
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 800;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain).connect(this.ctx.destination);
      this.sirenOsc.start();
    } catch {
      this.ctx = null;
    }
  }

  radioStationName() {
    return RADIO_STATIONS[this.stationIndex].name;
  }

  nextStation() {
    this.stationIndex = (this.stationIndex + 1) % RADIO_STATIONS.length;
    this.radioStep = 0;
    if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.05;
    return this.radioStationName();
  }

  setEngine(speedNorm, driving) {
    this.engineSpeed = speedNorm;
    this.engineDriving = driving;
  }

  setSiren(nearestPoliceDistance) {
    this.sirenIntensity = Number.isFinite(nearestPoliceDistance)
      ? Math.max(0, 1 - nearestPoliceDistance / 80)
      : 0;
  }

  blip(frequency, seconds, gainValue, type = 'sine', when = 0) {
    if (!this.ctx) return;
    const startAt = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainValue, startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + seconds + 0.02);
  }

  gunshot() {
    if (!this.ctx) return;
    const duration = 0.14;
    const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * duration), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.25;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1600;
    source.connect(filter).connect(gain).connect(this.ctx.destination);
    source.start();
  }

  chime() {
    this.blip(880, 0.14, 0.08);
    this.blip(1174.66, 0.2, 0.08, 'sine', 0.1);
  }

  click() {
    this.blip(1400, 0.04, 0.05, 'square');
  }

  scheduleRadioNote(frequency, startAt, seconds, gainValue, type) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + seconds);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + seconds + 0.02);
  }

  update(dt) {
    this.clock += dt;
    if (!this.ctx) return;
    const engineFrequency = 55 + this.engineSpeed * 150;
    this.engineOsc.frequency.setTargetAtTime(engineFrequency, this.ctx.currentTime, 0.08);
    this.engineGain.gain.setTargetAtTime(this.engineDriving ? 0.05 : 0, this.ctx.currentTime, 0.1);
    this.sirenOsc.frequency.setTargetAtTime(780 + 320 * Math.sin(this.clock * Math.PI * 2 * 0.55), this.ctx.currentTime, 0.05);
    this.sirenGain.gain.setTargetAtTime(this.sirenIntensity * 0.045, this.ctx.currentTime, 0.15);
    const station = RADIO_STATIONS[this.stationIndex];
    const beatSeconds = 60 / station.bpm / 2;
    while (this.nextNoteTime < this.ctx.currentTime + 0.25) {
      const step = this.radioStep % station.melodyMidi.length;
      this.scheduleRadioNote(midiToFrequency(station.melodyMidi[step]), this.nextNoteTime, beatSeconds * 0.9, 0.04, 'triangle');
      if (step % 4 === 0) {
        const bar = Math.floor(step / 4) % station.bassMidi.length;
        this.scheduleRadioNote(midiToFrequency(station.bassMidi[bar]), this.nextNoteTime, beatSeconds * 3.5, 0.05, 'sine');
      }
      this.radioStep += 1;
      this.nextNoteTime += beatSeconds;
    }
  }
}
