import * as THREE from 'three';

export const CHECKPOINT_KEY = 'fields-of-the-fractured-han:day-one:v1';

const TOTAL_STEPS = 7;
const WATER_IDS = Object.freeze(['water1', 'water2', 'water3']);
const HARVEST_IDS = Object.freeze(['harvest1', 'harvest2', 'harvest3', 'harvest4', 'harvest5']);
const ALL_TARGET_IDS = Object.freeze([
  'well',
  ...WATER_IDS,
  ...HARVEST_IDS,
  'thresher',
  'granary',
  'refugees',
  'shrine',
  'bed',
]);
const KNOWN_TARGETS = new Set(ALL_TARGET_IDS);

const STEP_TIME = Object.freeze({
  1: Object.freeze({ phase: 'dawn', hour: 6.25 }),
  2: Object.freeze({ phase: 'morning', hour: 8 }),
  3: Object.freeze({ phase: 'noon', hour: 11.5 }),
  4: Object.freeze({ phase: 'afternoon', hour: 13.5 }),
  5: Object.freeze({ phase: 'afternoon', hour: 15 }),
  6: Object.freeze({ phase: 'afternoon', hour: 16.5 }),
  7: Object.freeze({ phase: 'dusk', hour: 18.25 }),
  complete: Object.freeze({ phase: 'night', hour: 20.5 }),
});

const TASKS = Object.freeze({
  well: Object.freeze({
    title: 'Draw water from the stone well',
    verb: 'Draw water',
    label: 'stone well',
    radius: 4.5,
  }),
  thresher: Object.freeze({
    title: 'Thresh the millet and collect one grain sack',
    verb: 'Thresh millet',
    label: 'foot-powered thresher',
    radius: 4.5,
  }),
  granary: Object.freeze({
    title: 'Measure, register and divide the tuntian grain share',
    verb: 'Weigh and seal grain',
    label: 'tuntian balance and field register',
    radius: 6.6,
  }),
  refugees: Object.freeze({
    title: 'Give the retained seed grain to the displaced Xu family',
    verb: 'Give seed',
    label: 'Xu family plot',
    radius: 5.2,
  }),
  shrine: Object.freeze({
    title: 'Light the household lamp, then share porridge and sleep',
    verb: 'Light lamp',
    label: 'household lamp',
    radius: 4.5,
  }),
  bed: Object.freeze({
    title: 'Share millet porridge and sleep',
    verb: 'Eat and sleep',
    label: 'household bed',
    radius: 6.6,
  }),
});

export const DAY_LEDGER = Object.freeze({
  title: 'Field ledger — Jian’an 2 (197 CE)',
  place: 'Xuchang hinterland',
  entries: Object.freeze([
    'Three millet beds watered',
    'Five ripe sheaves harvested and threshed',
    'One sealed tuntian grain share delivered',
    'Retained seed grain given to the displaced Xu family',
    'Household lamp lit; millet porridge shared',
  ]),
  seal: 'DAY COMPLETE',
});

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

/**
 * Owns the complete first-day rules. Visual systems only receive explicit state
 * labels and events; they never participate in deciding whether work succeeds.
 */
export class FarmSystem {
  static id = 'farm';
  static deps = ['world', 'render'];

  async init(ctx) {
    this.ctx = ctx;
    this.world = ctx.get('world');
    this.render = ctx.get('render');

    this.step = 1;
    this.completedStep = 0;
    this.dayComplete = false;
    this.phase = 'dawn';
    this.hour = STEP_TIME[1].hour;
    this.carry = 'none';
    this.carryAmount = 0;
    this.currentTask = null;
    this.activeTarget = null;
    this.ledger = null;
    this.debugMode = false;
    this.storageAvailable = true;

    this.progress = {
      watered: 0,
      waterTotal: WATER_IDS.length,
      harvested: 0,
      harvestTotal: HARVEST_IDS.length,
      lit: false,
      slept: false,
    };

    this._completedTargets = new Set();
    this._worldPoint = new THREE.Vector3();
    this._handlingInteraction = false;
    this._lastMutationFrame = -1;
    this._lastCarryKind = '';
    this._lastCarryAmount = -1;

    const restored = this._readCheckpoint();
    this._reconstruct(restored, true);
    // Farm initializes before several consumers. Re-broadcast once on the first
    // engine frame so actors/audio receive restored carry and phase state too.
    this._initialBroadcastPending = true;
    this._offAttempt = ctx.events.on('interaction:attempt', (payload) => this._onInteractionAttempt(payload));
    this._offRestart = ctx.events.on('day:restart', () => this.restartDay());
  }

  update() {
    if (!this._initialBroadcastPending) return;
    this._initialBroadcastPending = false;
    this._emitPhase();
    this._emitCarry(true);
    if (this.dayComplete) this.ctx.events.emit('day:complete', { ledger: this.ledger });
  }

  getActiveTarget() {
    return this.activeTarget;
  }

  isTargetComplete(id) {
    return this._completedTargets.has(id);
  }

  restartDay() {
    this.debugMode = false;
    this._lastMutationFrame = -1;
    try {
      globalThis.localStorage?.removeItem(CHECKPOINT_KEY);
    } catch {
      this.storageAvailable = false;
    }
    this._reconstruct(0, true);
    this._writeCheckpoint();
    return true;
  }

  /**
   * Stages the beginning of a numbered milestone without writing over the
   * player's real checkpoint. `resume` exits debug state and reloads that save.
   */
  debugStage(step) {
    this._lastMutationFrame = -1;
    if (step === 'resume' || step === 'none' || step === 'clean') {
      this.debugMode = false;
      const restored = this._readCheckpoint();
      const restoredStep = typeof restored === 'object' ? restored.completedStep : restored;
      this._reconstruct(restored, true, restoredStep === TOTAL_STEPS);
      return true;
    }
    if (step === 'complete' || Number(step) === TOTAL_STEPS + 1) {
      this.debugMode = true;
      this._reconstruct(TOTAL_STEPS, true, true);
      return true;
    }
    const number = Number(step);
    if (!Number.isFinite(number)) return false;
    this.debugMode = true;
    const stagedStep = clampInteger(number, 1, TOTAL_STEPS);
    this._reconstruct(stagedStep - 1, true);
    return true;
  }

  _readCheckpoint() {
    try {
      const storage = globalThis.localStorage;
      if (!storage) {
        this.storageAvailable = false;
        return 0;
      }
      const raw = storage.getItem(CHECKPOINT_KEY);
      if (!raw) return 0;
      const checkpoint = JSON.parse(raw);
      if (!checkpoint || checkpoint.version !== 1) return 0;
      return {
        completedStep: clampInteger(checkpoint.completedStep, 0, TOTAL_STEPS),
        watered: clampInteger(checkpoint.watered, 0, WATER_IDS.length),
        harvested: clampInteger(checkpoint.harvested, 0, HARVEST_IDS.length),
        lit: checkpoint.lit === true,
      };
    } catch {
      this.storageAvailable = false;
      return 0;
    }
  }

  _writeCheckpoint() {
    if (this.debugMode) return;
    try {
      const storage = globalThis.localStorage;
      if (!storage) {
        this.storageAvailable = false;
        return;
      }
      storage.setItem(CHECKPOINT_KEY, JSON.stringify({
        version: 1,
        completedStep: this.completedStep,
        watered: this.progress.watered,
        harvested: this.progress.harvested,
        lit: this.progress.lit,
      }));
      this.storageAvailable = true;
    } catch {
      // Privacy modes and full quotas must never make the farm unplayable.
      this.storageAvailable = false;
    }
  }

  _reconstruct(checkpoint, emit, emitCompletion = false) {
    const detailed = checkpoint && typeof checkpoint === 'object';
    const completed = clampInteger(detailed ? checkpoint.completedStep : checkpoint, 0, TOTAL_STEPS);
    this.completedStep = completed;
    this.dayComplete = completed === TOTAL_STEPS;
    this.step = this.dayComplete ? TOTAL_STEPS : completed + 1;
    this.ledger = this.dayComplete ? DAY_LEDGER : null;

    this.progress.watered = completed >= 2
      ? WATER_IDS.length
      : completed === 1 && detailed
        ? clampInteger(checkpoint.watered, 0, WATER_IDS.length - 1)
        : 0;
    this.progress.harvested = completed >= 3
      ? HARVEST_IDS.length
      : completed === 2 && detailed
        ? clampInteger(checkpoint.harvested, 0, HARVEST_IDS.length - 1)
        : 0;
    this.progress.lit = completed >= 7 || (completed === 6 && detailed && checkpoint.lit === true);
    this.progress.slept = completed >= 7;

    this._completedTargets.clear();
    if (completed >= 1) this._completedTargets.add('well');
    for (let i = 0; i < this.progress.watered; i += 1) this._completedTargets.add(WATER_IDS[i]);
    for (let i = 0; i < this.progress.harvested; i += 1) this._completedTargets.add(HARVEST_IDS[i]);
    if (completed >= 4) this._completedTargets.add('thresher');
    if (completed >= 5) this._completedTargets.add('granary');
    if (completed >= 6) this._completedTargets.add('refugees');
    if (this.progress.lit) this._completedTargets.add('shrine');
    if (completed >= 7) {
      this._completedTargets.add('bed');
    }

    if (this.dayComplete) this._setCarry('none', 0, false);
    else if (this.step === 2) {
      const remaining = WATER_IDS.length - this.progress.watered;
      this._setCarry('water-bucket', remaining, false);
    }
    else if (this.step === 3) {
      this._setCarry(this.progress.harvested > 0 ? 'millet-sheaf' : 'none', this.progress.harvested, false);
    }
    else if (this.step === 4) this._setCarry('millet-sheaf', HARVEST_IDS.length, false);
    else if (this.step === 5) this._setCarry('grain-sack', 1, false);
    else if (this.step === 6) this._setCarry('seed-pouch', 1, false);
    else if (this.step === 7) this._setCarry(this.progress.lit ? 'none' : 'lamp', this.progress.lit ? 0 : 1, false);
    else this._setCarry('none', 0, false);

    const time = this.dayComplete ? STEP_TIME.complete : STEP_TIME[this.step];
    this.phase = time.phase;
    this.hour = time.hour;
    this._applyAllWorldStates();
    this._refreshTask(false);

    if (emit) {
      this._emitPhase();
      this._emitCarry(true);
      this._emitTask();
      if (this.dayComplete && emitCompletion) this.ctx.events.emit('day:complete', { ledger: this.ledger });
    }
  }

  _applyAllWorldStates() {
    this.world.setInteractionState('well', this._completedTargets.has('well') ? 'drawn' : 'ready');
    for (const id of WATER_IDS) {
      this.world.setInteractionState(id, this._completedTargets.has(id) ? 'watered' : 'dry');
    }
    for (const id of HARVEST_IDS) {
      this.world.setInteractionState(id, this._completedTargets.has(id) ? 'harvested' : 'ripe');
    }
    this.world.setInteractionState('thresher', this._completedTargets.has('thresher') ? 'threshed' : 'ready');
    this.world.setInteractionState('granary', this._completedTargets.has('granary') ? 'delivered' : 'waiting');
    this.world.setInteractionState('refugees', this._completedTargets.has('refugees') ? 'gifted' : 'waiting');
    this.world.setInteractionState('shrine', this._completedTargets.has('shrine') ? 'lit' : 'unlit');
    this.world.setInteractionState('bed', this._completedTargets.has('bed') ? 'slept' : 'ready');
  }

  _refreshTask(emit = true) {
    if (this.dayComplete) {
      this.currentTask = {
        step: TOTAL_STEPS,
        total: TOTAL_STEPS,
        title: 'Day complete — field ledger sealed',
        targetId: null,
        verb: '',
        label: '',
        radius: 0,
      };
      this.activeTarget = null;
      if (emit) this._emitTask();
      return;
    }

    let id;
    let definition;
    let title;
    if (this.step === 1) {
      id = 'well';
      definition = TASKS.well;
    } else if (this.step === 2) {
      id = WATER_IDS[this.progress.watered];
      definition = { verb: 'Water bed', label: 'dry millet bed', radius: 2.05 };
      title = `Water the millet beds (${this.progress.watered + 1} of ${WATER_IDS.length})`;
    } else if (this.step === 3) {
      id = HARVEST_IDS[this.progress.harvested];
      definition = { verb: 'Cut sheaf', label: 'ripe millet sheaf', radius: 2.05 };
      title = `Harvest the ripe millet (${this.progress.harvested + 1} of ${HARVEST_IDS.length})`;
    } else if (this.step === 4) {
      id = 'thresher';
      definition = TASKS.thresher;
    } else if (this.step === 5) {
      id = 'granary';
      definition = TASKS.granary;
    } else if (this.step === 6) {
      id = 'refugees';
      definition = TASKS.refugees;
    } else {
      id = this.progress.lit ? 'bed' : 'shrine';
      definition = TASKS[id];
    }

    this.currentTask = {
      step: this.step,
      total: TOTAL_STEPS,
      title: title ?? definition.title,
      targetId: id,
      verb: definition.verb,
      label: definition.label,
      radius: definition.radius,
    };
    this.activeTarget = {
      id,
      step: this.step,
      verb: definition.verb,
      label: definition.label,
      radius: definition.radius,
    };
    if (emit) this._emitTask();
  }

  _emitTask() {
    const task = this.currentTask;
    this.ctx.events.emit('task:changed', {
      step: task.step,
      total: task.total,
      title: task.title,
      targetId: task.targetId,
      verb: task.verb,
      label: task.label,
      radius: task.radius,
    });
  }

  _emitPhase() {
    this.render.setTimeOfDay?.(this.hour, this.phase);
    this.ctx.events.emit('day:phase', { phase: this.phase, hour: this.hour });
  }

  _setCarry(kind, amount, emit = true) {
    this.carry = kind;
    this.carryAmount = amount;
    if (emit) this._emitCarry();
  }

  _emitCarry(force = false) {
    if (!force && this.carry === this._lastCarryKind && this.carryAmount === this._lastCarryAmount) return;
    this._lastCarryKind = this.carry;
    this._lastCarryAmount = this.carryAmount;
    this.ctx.events.emit('carry:changed', { kind: this.carry, amount: this.carryAmount });
  }

  _onInteractionAttempt(payload) {
    const frame = this.ctx.time.frame;
    const id = typeof payload?.id === 'string' ? payload.id : null;
    if (this._handlingInteraction) return;
    // The event bus is synchronous, so a bot or both bound controls can submit
    // more than once before the frame ends. Once one mutation committed, every
    // later attempt that frame is a no-op (including the final bed action).
    if (frame === this._lastMutationFrame) return;

    if (this.dayComplete) {
      this._emitBlocked(id, 'The field ledger is sealed for the night.');
      return;
    }
    if (!id) {
      // Player guidance emits the canonical physical-attempt event for input,
      // audio and smoke instrumentation. It reserves no farm mutation, so it
      // is intentionally silent while the one-press transaction is walking.
      if (payload?.guided === true) return;
      this._emitBlocked(null, 'Press E once to follow and complete the gold-marked task.');
      return;
    }
    if (id !== this.activeTarget?.id) {
      if (this._completedTargets.has(id)) this._emitBlocked(id, 'That work is already complete.');
      else if (KNOWN_TARGETS.has(id)) this._emitBlocked(id, `First: ${this.currentTask.title}.`);
      else this._emitBlocked(id, 'There is no farm task here.');
      return;
    }
    if (this._completedTargets.has(id)) return;

    this._handlingInteraction = true;
    this._lastMutationFrame = frame;
    try {
      this._performAction(id);
    } finally {
      this._handlingInteraction = false;
    }
  }

  _performAction(id) {
    const actionStep = this.step;
    let label = '';

    if (actionStep === 1 && id === 'well') {
      this._completedTargets.add(id);
      this.world.setInteractionState(id, 'drawn');
      this._setCarry('water-bucket', WATER_IDS.length);
      label = 'Drew water from the stone well';
    } else if (actionStep === 2 && id === WATER_IDS[this.progress.watered]) {
      this._completedTargets.add(id);
      this.progress.watered += 1;
      this.world.setInteractionState(id, 'watered');
      const remaining = WATER_IDS.length - this.progress.watered;
      this._setCarry(remaining > 0 ? 'water-bucket' : 'none', remaining);
      label = `Watered millet bed ${this.progress.watered} of ${WATER_IDS.length}`;
    } else if (actionStep === 3 && id === HARVEST_IDS[this.progress.harvested]) {
      this._completedTargets.add(id);
      this.progress.harvested += 1;
      this.world.setInteractionState(id, 'harvested');
      this._setCarry('millet-sheaf', this.progress.harvested);
      label = `Harvested millet sheaf ${this.progress.harvested} of ${HARVEST_IDS.length}`;
    } else if (actionStep === 4 && id === 'thresher') {
      this._completedTargets.add(id);
      this.world.setInteractionState(id, 'threshed');
      this.world.debugSpinThresher?.(2);
      this._setCarry('grain-sack', 1);
      label = 'Threshed the millet and collected one grain sack';
    } else if (actionStep === 5 && id === 'granary') {
      this._completedTargets.add(id);
      this.world.setInteractionState(id, 'delivered');
      this._setCarry('seed-pouch', 1);
      label = 'Weighed the grain, sealed the state share and retained the household seed measure';
    } else if (actionStep === 6 && id === 'refugees') {
      this._completedTargets.add(id);
      this.world.setInteractionState(id, 'gifted');
      this._setCarry('none', 0);
      label = 'Gave the retained seed grain to the Xu family';
    } else if (actionStep === 7 && id === 'shrine' && !this.progress.lit) {
      this._completedTargets.add(id);
      this.progress.lit = true;
      this.world.setInteractionState(id, 'lit');
      this._setCarry('none', 0);
      label = 'Lit the household lamp';
    } else if (actionStep === 7 && id === 'bed' && this.progress.lit) {
      this._completedTargets.add(id);
      this.progress.slept = true;
      this.world.setInteractionState(id, 'slept');
      label = 'Shared millet porridge and slept';
    } else {
      this._emitBlocked(id, `First: ${this.currentTask.title}.`);
      return;
    }

    this.ctx.events.emit('interaction:success', {
      id,
      step: actionStep,
      label,
      world: this._worldPosition(id),
    });

    const milestoneComplete =
      actionStep === 1 ||
      (actionStep === 2 && this.progress.watered === WATER_IDS.length) ||
      (actionStep === 3 && this.progress.harvested === HARVEST_IDS.length) ||
      (actionStep >= 4 && actionStep <= 6) ||
      (actionStep === 7 && id === 'bed' && this.progress.slept);

    if (milestoneComplete) this._completeMilestone(actionStep);
    else {
      // Subtargets are tiny milestones too from the player's perspective. A
      // dev-server refresh or tab reload must not erase watered beds, cut
      // sheaves, or the lit lamp and send the player back through old work.
      this._writeCheckpoint();
      this._refreshTask(true);
    }
  }

  _completeMilestone(step) {
    this.completedStep = step;
    this._writeCheckpoint();
    this._reconstruct(step, true);
    this.ctx.events.emit('milestone:complete', {
      step,
      total: TOTAL_STEPS,
      phase: this.phase,
      hour: this.hour,
    });
    if (step === TOTAL_STEPS) this.ctx.events.emit('day:complete', { ledger: this.ledger });
  }

  _worldPosition(id) {
    this._worldPoint.set(0, 0, 0);
    this.world.getInteractablePosition?.(id, this._worldPoint);
    return { x: this._worldPoint.x, y: this._worldPoint.y, z: this._worldPoint.z };
  }

  _emitBlocked(id, reason) {
    this.ctx.events.emit('interaction:blocked', { id, reason });
  }

  dispose() {
    this._offAttempt?.();
    this._offRestart?.();
    this._offAttempt = null;
    this._offRestart = null;
    this.activeTarget = null;
    this.currentTask = null;
    this.ctx = null;
    this.world = null;
    this.render = null;
  }
}
