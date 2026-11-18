// Keyboard + mouse state. Keys are tracked by code (KeyW, KeyF, ...), and
// `pressed` reports a key only on the frame it went down, so F enters a car
// once instead of toggling every frame. Dragging the mouse orbits the camera.
export class Input {
  constructor() {
    this.down = new Set();
    this.justPressed = new Set();
    this.dragDeltaX = 0;
    this.dragDeltaY = 0;
    this.dragging = false;
    // A tap is a quick click without a drag: the shoot trigger on foot.
    this.tap = false;
    this.mouseDownAt = 0;
    this.mouseDownX = 0;
    this.mouseDownY = 0;

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
      this.dragDeltaY += event.movementY;
    });
  }

  isDown(code) {
    return this.down.has(code);
  }

  pressed(code) {
    return this.justPressed.has(code);
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
    this.dragDeltaY = 0;
  }
}
