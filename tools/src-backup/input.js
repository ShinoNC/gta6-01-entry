export class Input {
  constructor() {
    this.down = new Set();
    this.justPressed = new Set();
    this.tap = false;
    this.wheelNotches = 0;
    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      this.down.add(event.code);
      this.justPressed.add(event.code);
      if (['ArrowUp', 'ArrowDown', 'Space'].includes(event.code)) event.preventDefault();
    });
    window.addEventListener('keyup', (event) => this.down.delete(event.code));
    window.addEventListener('blur', () => {
      this.down.clear();
    });
    const canvas = document.getElementById('game-canvas');
    // No mouse-look: a click on the canvas is an attack, immediately.
    canvas.addEventListener('mousedown', () => {
      this.tap = true;
    });
    window.addEventListener(
      'wheel',
      (event) => {
        this.wheelNotches += event.deltaY > 0 ? 1 : -1;
      },
      { passive: true },
    );
  }
  isDown(code) {
    return this.down.has(code);
  }
  pressed(code) {
    return this.justPressed.has(code);
  }
  consumeWheel() {
    const steps = this.wheelNotches;
    this.wheelNotches = 0;
    return steps;
  }
  moveAxes() {
    const forward = (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0) - (this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0);
    const strafe = (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0);
    return { forward, strafe };
  }
  endFrame() {
    this.justPressed.clear();
    this.tap = false;
  }
}
