export class Input {
  constructor() {
    this.down = new Set();
    this.justPressed = new Set();
    this.dragDeltaX = 0;
    this.dragging = false;
    this.tap = false;
    this.mouseDownAt = 0;
    this.mouseDownX = 0;
    this.mouseDownY = 0;
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
      this.dragging = false;
    });
    const canvas = document.getElementById('game-canvas');
    canvas.addEventListener('mousedown', (event) => {
      this.dragging = true;
      this.mouseDownAt = performance.now();
      this.mouseDownX = event.clientX;
      this.mouseDownY = event.clientY;
    });
    window.addEventListener('mouseup', (event) => {
      this.dragging = false;
      const quick = performance.now() - this.mouseDownAt < 250;
      const still = Math.hypot(event.clientX - this.mouseDownX, event.clientY - this.mouseDownY) < 8;
      if (this.mouseDownAt > 0 && quick && still) this.tap = true;
      this.mouseDownAt = 0;
    });
    window.addEventListener('mousemove', (event) => {
      if (!this.dragging) return;
      this.dragDeltaX += event.movementX;
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
    this.dragDeltaX = 0;
  }
}