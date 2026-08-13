/**
 * Input aggregation: keyboard, pointer (locked or not), wheel, gamepad — exposed
 * as a stable PER-FRAME SNAPSHOT so gameplay never touches a DOM event.
 *
 * Why a snapshot and not listeners in gameplay code:
 *  - a DOM event can fire twice between two frames, or zero times; gameplay that
 *    reads events directly behaves differently at different frame rates
 *  - a capture harness / demo bot can then DRIVE the game by writing into this
 *    object (see tools/smoke.mjs) and everything downstream — state machines,
 *    animation, AI reacting to the player — runs untouched. That is how you get
 *    a scripted playthrough that is really the game being played, rather than a
 *    canned camera path that proves nothing.
 *  - `frozen` gives the shot API one switch to take control away
 *
 * Edge queries (`pressed`, `released`) are only valid during the frame the
 * transition happened. Read them in update(), never in fixedUpdate() — a fixed
 * step may run 0 or N times in a frame, so an edge is missed or double-counted.
 */

export const DEFAULT_ACTIONS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  sprint: ['ShiftLeft'],
  use: ['KeyF', 'KeyE'],
  primary: ['Mouse0'],
  secondary: ['Mouse2'],
  reload: ['KeyR'],
  pause: ['Escape'],
};

export class Input {
  constructor(canvas, { actions = DEFAULT_ACTIONS, sensitivity = 0.0022, pointerLock = true } = {}) {
    this.canvas = canvas;
    this.actions = actions;
    this.sensitivity = sensitivity;
    this.pointerLock = pointerLock;

    this.down = new Set(); // codes held right now
    this._pressed = new Set(); // went down during this frame
    this._released = new Set(); // went up during this frame
    /**
     * An ORDERED queue of `{ code, down }`, not two sets. Two sets cannot
     * represent both of the things that legitimately happen inside one frame:
     *   - a fast TAP (down then up) must yield a press AND a release, not held
     *   - a RE-PRESS (up then down) must leave the key held
     * With sets you have to pick an order and one of those breaks. Processing all
     * downs before all ups silently swallowed the re-press, which is exactly what
     * a bot driving the game does when it releases the previous case's keys and
     * presses the next case's in the same frame — the key came out NOT held and
     * the run measured zero movement.
     */
    this._queue = [];

    /** Accumulated pointer delta for this frame, in radians after sensitivity. */
    this.look = { x: 0, y: 0 };
    this._rawLook = { x: 0, y: 0 };
    this.wheel = 0;
    this._rawWheel = 0;

    this.enabled = true;
    /** When true, every query reads as neutral. The shot API sets this. */
    this.frozen = false;
    this.locked = false;

    this._handlers = [];
  }

  attach() {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._handlers.push(() => target.removeEventListener(type, fn, opts));
    };

    on(window, 'keydown', (e) => {
      if (e.repeat) return;
      this._queue.push({ code: e.code, down: true });
      // Space scrolls, F5/Tab/etc. are the user's; only swallow what we bind.
      if (this._isBound(e.code)) e.preventDefault();
    });
    on(window, 'keyup', (e) => this._queue.push({ code: e.code, down: false }));
    on(window, 'blur', () => {
      // Without this, alt-tabbing while holding W leaves the player sprinting.
      for (const c of this.down) this._queue.push({ code: c, down: false });
    });

    on(this.canvas, 'mousedown', (e) => {
      this._queue.push({ code: `Mouse${e.button}`, down: true });
      if (this.pointerLock && !this.locked) this.canvas.requestPointerLock?.();
    });
    on(window, 'mouseup', (e) => this._queue.push({ code: `Mouse${e.button}`, down: false }));
    on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'mousemove', (e) => {
      if (this.pointerLock && !this.locked) return;
      this._rawLook.x += e.movementX ?? 0;
      this._rawLook.y += e.movementY ?? 0;
    });
    on(window, 'wheel', (e) => {
      this._rawWheel += Math.sign(e.deltaY);
    }, { passive: true });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });

    return this;
  }

  detach() {
    for (const off of this._handlers) off();
    this._handlers.length = 0;
  }

  _isBound(code) {
    for (const codes of Object.values(this.actions)) if (codes.includes(code)) return true;
    return false;
  }

  /** Promote queued events into this frame's snapshot, in the order they arrived. */
  beginFrame() {
    this._pressed.clear();
    this._released.clear();
    if (this.enabled && !this.frozen) {
      for (const ev of this._queue) {
        if (ev.down) {
          if (!this.down.has(ev.code)) {
            this.down.add(ev.code);
            this._pressed.add(ev.code);
          }
        } else if (this.down.delete(ev.code)) {
          this._released.add(ev.code);
        }
      }
      this.look.x = this._rawLook.x * this.sensitivity;
      this.look.y = this._rawLook.y * this.sensitivity;
      this.wheel = this._rawWheel;
    } else {
      this.down.clear();
      this.look.x = this.look.y = 0;
      this.wheel = 0;
    }
    this._queue.length = 0;
    this._rawLook.x = this._rawLook.y = 0;
    this._rawWheel = 0;
  }

  endFrame() {
    this._pressed.clear();
    this._released.clear();
  }

  /**
   * BOT / TEST DRIVING — feed a synthetic event exactly where a DOM event would
   * land, so `pressed()` and `released()` edges fire normally.
   *
   * Use this from tools (smoke test, profiler, demo recorder) instead of writing
   * into `down` directly: `down.add('Mouse0')` makes the key look HELD but never
   * generates a press edge, so anything gated on `pressed()` silently never
   * happens and the tool reports zero events for a game that works. That exact
   * mistake cost a debugging round here.
   */
  inject(code, isDown = true) {
    this._queue.push({ code, down: !!isDown });
    return this;
  }

  /** Feed raw pointer delta in pixels, pre-sensitivity — like a real mouse. */
  injectLook(dx, dy) {
    this._rawLook.x += dx;
    this._rawLook.y += dy;
    return this;
  }

  /** Take control for a bot: enabled, unfrozen, and pointer-lock not required. */
  takeControl() {
    this.enabled = true;
    this.frozen = false;
    this.pointerLock = false;
    return this;
  }

  /** Held. */
  held(action) {
    const codes = this.actions[action];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Went down this frame. */
  pressed(action) {
    const codes = this.actions[action];
    if (!codes) return false;
    for (const c of codes) if (this._pressed.has(c)) return true;
    return false;
  }

  /** Went up this frame. */
  released(action) {
    const codes = this.actions[action];
    if (!codes) return false;
    for (const c of codes) if (this._released.has(c)) return true;
    return false;
  }

  /** -1/0/1 pair for a WASD-style axis. Not normalised — the mover decides
   *  whether diagonal movement is faster, which is a design choice. */
  axis2(negX = 'left', posX = 'right', negY = 'back', posY = 'forward', out = { x: 0, y: 0 }) {
    out.x = (this.held(posX) ? 1 : 0) - (this.held(negX) ? 1 : 0);
    out.y = (this.held(posY) ? 1 : 0) - (this.held(negY) ? 1 : 0);
    return out;
  }
}
