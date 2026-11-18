const SPEAKERS = {
  mara: ['MARA SOLIS', 'FIXER'],
  juno: ['JUNO REYES', 'WHEELWOMAN'],
  pd: ['KEYS PD', 'DISPATCH'],
};
const LINES = {
  go: [
    ['mara', 'Drive like you mean it — the Keys are watching.'],
    ['mara', 'Clean and fast, Rook. No heroes on my jobs.'],
  ],
  heat: [
    ['juno', 'Alarms are back! Lose them before they box you in.'],
    ['pd', 'All units: suspect vehicle, code 3. Box them in.'],
    ['juno', 'Whole department is coming — drive, Rook, drive!'],
  ],
  done: [
    ['mara', 'Clean work. The money is already moving.'],
    ['mara', 'That is how you earn the Keys, Rook.'],
  ],
};

export class Dialogue {
  constructor() {
    this.el = document.getElementById('dialogue-panel');
    this.face = document.getElementById('dialogue-face');
    this.name = document.getElementById('dialogue-name');
    this.text = document.getElementById('dialogue-text');
    this.until = 0;
    this.next = { go: 0, heat: 0, done: 0 };
  }

  say(speaker, text, seconds = 4) {
    const [name, role] = SPEAKERS[speaker];
    this.face.setAttribute('href', `#${speaker}-portrait`);
    this.name.textContent = `${name} · ${role}`;
    this.text.textContent = text;
    this.el.classList.remove('hidden');
    this.until = performance.now() + seconds * 1000;
  }

  cue(kind) {
    const lines = LINES[kind];
    const [speaker, text] = lines[this.next[kind] % lines.length];
    this.next[kind] += 1;
    this.say(speaker, text);
  }

  update() {
    if (this.until && performance.now() > this.until) {
      this.el.classList.add('hidden');
      this.until = 0;
    }
  }
}
