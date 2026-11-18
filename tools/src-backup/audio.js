export const RADIO_STATIONS = [
  {
    name: 'WAVE 88.1 · Neon Drive',
    bpm: 112,
    melodyMidi: [69, 72, 76, 79, 76, 72, 74, 76, 69, 72, 76, 81, 79, 76, 74, 72],
    bassMidi: [45, 45, 41, 43],
    tracks: ['Midnight Run', 'Neon Tide', 'Coastal Static'],
  },
  {
    name: 'RADIO SOL 101.9',
    bpm: 96,
    melodyMidi: [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 81, 79, 76, 74],
    bassMidi: [48, 55, 53, 50],
    tracks: ['Solset Boulevard', 'Palm Static', 'Harbor Gold'],
  },
];
const ENGINE_GEAR_COUNT = 4;
const ENGINE_BASE_HZ = 52;
const ENGINE_TOP_HZ = 210;
const SIREN_LOW_HZ = 720;
const SIREN_HIGH_HZ = 980;
const SIREN_TONE_SECONDS = 0.32;
const TRACK_STEPS_PER_TRACK = 32;
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
    this.engineSubOsc = null;
    this.engineFilter = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenIntensity = 0;
    this.engineSpeed = 0;
    this.engineDriving = false;
    this.soundEnabled = true;
    this.musicEnabled = true;
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
      this.engineOsc.frequency.value = ENGINE_BASE_HZ;
      this.engineSubOsc = this.ctx.createOscillator();
      this.engineSubOsc.type = 'sine';
      this.engineSubOsc.frequency.value = ENGINE_BASE_HZ / 2;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 420;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter);
      this.engineSubOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain).connect(this.ctx.destination);
      this.engineOsc.start();
      this.engineSubOsc.start();
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = SIREN_LOW_HZ;
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
  nowPlaying() {
    const station = RADIO_STATIONS[this.stationIndex];
    const track = station.tracks[Math.floor(this.radioStep / TRACK_STEPS_PER_TRACK) % station.tracks.length];
    return `${station.name} — '${track}'`;
  }
  nextStation() {
    this.stationIndex = (this.stationIndex + 1) % RADIO_STATIONS.length;
    this.radioStep = 0;
    if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.05;
    return this.radioStationName();
  }
  setSoundEnabled(enabled) {
    this.soundEnabled = enabled;
    if (this.ctx && !enabled) this.ctx.suspend().catch(() => {});
    if (this.ctx && enabled) this.ctx.resume().catch(() => {});
  }
  setMusicEnabled(enabled) {
    this.musicEnabled = enabled;
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
    if (!this.ctx || !this.soundEnabled) return;
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
  horn() {
    this.blip(392, 0.28, 0.09, 'square');
    this.blip(494, 0.28, 0.09, 'square');
  }
  gunshot() {
    if (!this.ctx || !this.soundEnabled) return;
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
    const gearSpan = 1 / ENGINE_GEAR_COUNT;
    const gear = Math.min(ENGINE_GEAR_COUNT - 1, Math.floor(this.engineSpeed / gearSpan));
    const withinGear = (this.engineSpeed - gear * gearSpan) / gearSpan;
    const gearBase = ENGINE_BASE_HZ + gear * ((ENGINE_TOP_HZ - ENGINE_BASE_HZ) / ENGINE_GEAR_COUNT) * 0.55;
    const engineFrequency = gearBase + withinGear * 55;
    this.engineOsc.frequency.setTargetAtTime(engineFrequency, this.ctx.currentTime, 0.08);
    this.engineSubOsc.frequency.setTargetAtTime(engineFrequency / 2, this.ctx.currentTime, 0.08);
    this.engineFilter.frequency.setTargetAtTime(320 + this.engineSpeed * 900, this.ctx.currentTime, 0.1);
    this.engineGain.gain.setTargetAtTime(this.engineDriving ? 0.05 : 0, this.ctx.currentTime, 0.1);
    const sirenTone = Math.floor(this.clock / SIREN_TONE_SECONDS) % 2 === 0 ? SIREN_LOW_HZ : SIREN_HIGH_HZ;
    this.sirenOsc.frequency.setTargetAtTime(sirenTone, this.ctx.currentTime, 0.03);
    this.sirenGain.gain.setTargetAtTime(this.sirenIntensity * 0.045, this.ctx.currentTime, 0.15);
    if (!this.musicEnabled) return;
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