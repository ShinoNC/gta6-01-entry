const $ = (id) => document.getElementById(id);
const SPEAKERS = {
  mara: ['MARA SOLIS', 'FIXER'],
  juno: ['JUNO REYES', 'WHEELWOMAN'],
  otto: ['OTTO KANE', 'FIXER'],
  pd: ['VRPD', 'DISPATCH'],
};
const LINES = {
  go: [
    ['mara', 'Drive like you mean it — the Keys are watching.'],
    ['mara', 'Clean and fast, Rook. No heroes.'],
    ['otto', 'My jobs pay — and end careers. Drive clean.'],
  ],
  heat: [
    ['juno', 'Alarms are back! Lose them before they box you in.'],
    ['pd', 'All units: suspect vehicle, code 3.'],
    ['juno', 'The whole department is coming — drive!'],
  ],
  done: [
    ['mara', 'Clean work. The money is moving.'],
    ['mara', 'That is how you earn the Keys.'],
    ['otto', 'Vault work like that gets remembered.'],
  ],
};
export class Dialogue {
  constructor(hud = null) {
    this.hud = hud;
    this.el = $('dialogue-panel');
    this.face = $('dialogue-face');
    this.name = $('dialogue-name');
    this.text = $('dialogue-text');
    this.until = 0;
    this.next = { go: 0, heat: 0, done: 0 };
  }
  say(speaker, text, seconds = 4) {
    const [name, role] = SPEAKERS[speaker];
    this.face.setAttribute('href', `#${speaker}-portrait`);
    this.name.textContent = `${name} · ${role}`;
    this.text.textContent = text;
    // A toast showing when dialogue opens would print over the panel on
    // short screens, so the toast goes away (same as opening an overlay).
    if (this.hud) this.hud.hideMessage();
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