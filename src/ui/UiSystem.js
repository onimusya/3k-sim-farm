const CARRY_PRESENTATION = Object.freeze({
  none: { icon: '', label: '' },
  'water-bucket': { icon: '水', label: 'Water bucket' },
  'millet-sheaf': { icon: '禾', label: 'Millet sheaves' },
  'grain-sack': { icon: '粟', label: 'Sealed grain sack' },
  'seed-pouch': { icon: '種', label: 'Seed-grain pouch' },
  lamp: { icon: '火', label: 'Household lamp' },
});

const DOUBLE_HOURS = Object.freeze([
  '子時', '丑時', '丑時', '寅時', '寅時', '卯時',
  '卯時', '辰時', '辰時', '巳時', '巳時', '午時',
  '午時', '未時', '未時', '申時', '申時', '酉時',
  '酉時', '戌時', '戌時', '亥時', '亥時', '子時',
]);

const PHASE_LABELS = Object.freeze({
  dawn: 'Dawn',
  morning: 'Morning',
  noon: 'Noon',
  afternoon: 'Afternoon',
  dusk: 'Dusk',
  night: 'Night',
});

const LEDGER_LABELS = Object.freeze({
  watered: 'Watered',
  harvested: 'Harvested',
  threshed: 'Threshed',
  delivered: 'Delivered',
  shared: 'Shared',
  meals: 'Meals',
});

const LEDGER_UNITS = Object.freeze({
  watered: 'beds',
  harvested: 'sheaves',
  threshed: 'sack',
  delivered: 'share',
  shared: 'seed measure',
  meals: 'household',
});

function query(id) {
  return document.getElementById(id);
}

function titleCase(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatClock(hour) {
  if (typeof hour === 'string' && /[^0-9.:]/.test(hour)) return hour;
  if (typeof hour === 'string' && /^\d{1,2}:\d{2}$/.test(hour)) {
    const parsed = Number(hour.slice(0, hour.indexOf(':')));
    const index = ((parsed % 24) + 24) % 24;
    return `${DOUBLE_HOURS[index]} · ${hour.padStart(5, '0')}`;
  }

  const numeric = finiteNumber(hour);
  if (numeric === null) return '卯時 · 05:40';
  const wrapped = ((numeric % 24) + 24) % 24;
  let hours = Math.floor(wrapped);
  let minutes = Math.round((wrapped - hours) * 60);
  if (minutes === 60) {
    hours = (hours + 1) % 24;
    minutes = 0;
  }
  return `${DOUBLE_HOURS[hours]} · ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function readableKey(key) {
  return String(key ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ledgerValue(key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.value !== undefined) return String(value.value);
    if (value.amount !== undefined) {
      return `${value.amount}${value.unit ? ` ${value.unit}` : ''}`;
    }
  }
  if (typeof value === 'number' && LEDGER_UNITS[key]) {
    const unit = LEDGER_UNITS[key];
    const plural = value === 1 ? unit : unit === 'sack' ? 'sacks' : unit === 'share' ? 'shares' : unit;
    return `${value} ${plural}`;
  }
  if (typeof value === 'boolean') return value ? 'Complete' : '—';
  return String(value ?? '—');
}

/**
 * DOM-only game presentation. The class deliberately has no subsystem imports;
 * its integration surface is the shared event bus plus the public methods below.
 */
export class UiSystem {
  static id = 'ui';
  static deps = [];

  constructor() {
    this._ctx = null;
    this._els = {};
    this._offs = [];
    this._domOffs = [];
    this._begun = false;
    this._storyShownFrame = -1;
    this._feedbackUntil = -1;
    this._basePrompt = { visible: false, label: '', key: 'E', tone: 'normal', id: null };
    this._inputWasEnabled = true;
    this._disabledInputForBoot = false;
    this._pendingTapRelease = false;
    this._touch = false;
  }

  async init(ctx) {
    this._ctx = ctx;
    this._cacheElements();
    this._repairStaticCopy();
    this._installAccessibility();
    this._bindEvents();
    this._bindDom();
    this._syncInitialState();

    this._touch = Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches);
    document.documentElement.classList.toggle('is-touch', this._touch);
    this._renderPrompt(this._basePrompt);

    const capture = Boolean(
      ctx.config?.capture ||
      ctx.config?.deterministic ||
      globalThis.location?.search?.includes('capture=1')
    );

    if (capture) {
      this._begun = true;
      this._hide(this._els.boot);
      document.body.classList.add('game-ready');
    } else {
      this._show(this._els.boot);
      if (ctx.input) {
        this._inputWasEnabled = ctx.input.enabled !== false;
        ctx.input.enabled = false;
        this._disabledInputForBoot = true;
      }
      this._els.begin?.focus({ preventScroll: true });
    }
  }

  update(_dt, ctx) {
    if (this._pendingTapRelease && ctx.input?.inject) {
      ctx.input.inject('KeyE', false);
      this._pendingTapRelease = false;
    }

    if (this._feedbackUntil >= 0 && ctx.time.elapsed >= this._feedbackUntil) {
      this._feedbackUntil = -1;
      this._renderPrompt(this._basePrompt);
    }

    if (
      this._begun &&
      !this._els.story?.hidden &&
      ctx.time.frame > this._storyShownFrame &&
      ctx.input?.pressed?.('use')
    ) {
      // Informational, never modal: PlayerSystem reads this same edge earlier in
      // the frame, so E dismisses the card without consuming the farm action.
      this.dismissStory('key');
    }
  }

  /** Player-facing prompt API for systems that prefer ctx.get('ui') to events. */
  setPrompt(prompt, visible = true) {
    const next = this._normalisePrompt(prompt, visible);
    this._basePrompt = next;
    if (this._feedbackUntil < 0) this._renderPrompt(next);
    return this;
  }

  clearPrompt() {
    return this.setPrompt({ visible: false });
  }

  setTask(payload = {}) {
    let title = payload.title ?? payload.label ?? payload.task;
    const compact = {
      'Deliver the sealed tuntian share to the granary clerk': 'Deliver the sealed grain share',
      'Measure, register and divide the tuntian grain share': 'Weigh and divide the tuntian share',
      'Give the retained seed grain to the displaced Xu family': 'Give seed grain to the Xu family',
      'Light the household lamp, then share porridge and sleep': 'Light the lamp, then share porridge',
      'Thresh the millet and collect one grain sack': 'Thresh millet into one grain sack',
    };
    if (typeof title === 'string') title = compact[title] ?? title;
    if (title !== undefined && this._els.taskCurrent) {
      this._els.taskCurrent.textContent = String(title);
    }

    const total = finiteNumber(payload.total) ?? 7;
    const explicit = finiteNumber(payload.displayStep ?? payload.current);
    const rawStep = finiteNumber(payload.step);
    const zeroBasedIndex = finiteNumber(payload.index);
    const oneBased = explicit ?? rawStep ?? (zeroBasedIndex === null ? null : zeroBasedIndex + 1);
    if (oneBased !== null && this._els.taskProgress) {
      const current = Math.max(1, Math.min(total, oneBased));
      this._els.taskProgress.textContent = `${current} of ${total}`;
      this._els.taskProgress.setAttribute('aria-label', `Task ${current} of ${total}`);
    }

    this._feedbackUntil = -1;
    this._basePrompt = { visible: false, label: '', key: 'E', tone: 'normal', id: null };
    this._renderPrompt(this._basePrompt);
    if (title) this._announce(`Current task: ${title}`);
    return this;
  }

  setPhase(payload = {}) {
    const rawPhase = typeof payload === 'string' ? payload : payload.phase;
    const phaseKey = String(rawPhase ?? 'dawn').toLowerCase();
    const phase = PHASE_LABELS[phaseKey] ?? titleCase(rawPhase || 'Dawn');
    const hour = typeof payload === 'object' ? payload.hour : undefined;
    if (this._els.phase) this._els.phase.textContent = phase;
    if (this._els.hour) this._els.hour.textContent = formatClock(hour);
    if (this._els.dayClock) this._els.dayClock.dataset.phase = phaseKey;
    return this;
  }

  setCarry(payload = {}) {
    const kind = typeof payload === 'string' ? payload : payload.kind ?? 'none';
    const amount = typeof payload === 'object' ? finiteNumber(payload.amount) : null;
    const presentation = CARRY_PRESENTATION[kind] ?? {
      icon: '物',
      label: readableKey(kind),
    };
    const visible = kind !== 'none' && amount !== 0;

    if (!visible) {
      this._hide(this._els.carry);
      return this;
    }

    if (this._els.carryIcon) this._els.carryIcon.textContent = payload.icon ?? presentation.icon;
    if (this._els.carryLabel) {
      const base = payload.label ?? presentation.label;
      this._els.carryLabel.textContent = amount !== null && amount > 1 ? `${base} · ${amount}` : base;
    }
    this._show(this._els.carry);
    return this;
  }

  showStory(payload = {}) {
    if (!payload || payload.hidden === true || payload.visible === false) {
      this.dismissStory('event');
      return this;
    }

    const speaker = payload.speaker ?? 'Field Ledger';
    const title = payload.title ?? 'XUCHANG HINTERLAND';
    const body = payload.body ?? payload.text ?? '';
    if (this._els.storyTitle) this._els.storyTitle.textContent = String(title);
    if (this._els.storySpeaker) this._els.storySpeaker.textContent = String(speaker);
    if (this._els.storyBody) this._els.storyBody.textContent = String(body);

    if (this._els.storySeal) {
      const hasSeal = payload.seal !== false && payload.seal !== null;
      this._els.storySeal.hidden = !hasSeal;
      if (hasSeal) this._els.storySeal.textContent = payload.seal === true || payload.seal === undefined ? '記' : String(payload.seal);
    }

    if (this._els.storyHint) this._els.storyHint.textContent = this._touch ? 'Continue with the action button' : 'Press E to continue';
    if (this._els.story) {
      this._els.story.setAttribute('aria-label', `${speaker}: ${body}`);
      this._show(this._els.story);
    }
    this._storyShownFrame = this._ctx?.time?.frame ?? -1;
    this._announce(`${speaker}: ${body}`);
    return this;
  }

  dismissStory(source = 'api') {
    if (!this._els.story || this._els.story.hidden) return this;
    this._hide(this._els.story);
    this._ctx?.events?.emit('story:dismissed', { source });
    return this;
  }

  showComplete(payload = {}) {
    this.dismissStory('complete');
    this.clearPrompt();
    this.setCarry({ kind: 'none' });
    this._hide(this._els.boot);
    this._renderLedger(payload.ledger);

    const summary = payload.summary ?? payload.body;
    if (summary && this._els.completeSummary) this._els.completeSummary.textContent = String(summary);
    this._show(this._els.complete);
    this._announce('Day complete. The field ledger is sealed.');

    if (!this._ctx?.config?.deterministic) this._els.newDay?.focus({ preventScroll: true });
    return this;
  }

  /** Deterministic capture hook. `clean`/`none` remove every transient overlay. */
  debugState(mode = 'clean') {
    const state = String(mode ?? 'clean').toLowerCase();
    this._begun = true;
    this._hide(this._els.boot);
    this._hide(this._els.complete);
    document.body.classList.add('game-ready');

    if (state === 'clean' || state === 'none') {
      this._feedbackUntil = -1;
      this._basePrompt = { visible: false, label: '', key: 'E', tone: 'normal', id: null };
      this._renderPrompt(this._basePrompt);
      this._hide(this._els.story);
      this._hide(this._els.carry);
      this.setTask({ title: 'Draw water from the stone well', displayStep: 1, total: 7 });
      this.setPhase({ phase: 'dawn', hour: 5 + 40 / 60 });
      return this;
    }

    if (state === 'busy') {
      this.setTask({ title: 'Deliver the sealed tuntian grain share', displayStep: 5, total: 7 });
      this.setPhase({ phase: 'afternoon', hour: 15 + 20 / 60 });
      this.setCarry({ kind: 'grain-sack', amount: 1 });
      this.setPrompt({ label: 'Present the sealed grain share', visible: true, id: 'granary-clerk' });
      this.showStory({
        seal: '田',
        title: 'TUNTIAN OFFICE',
        speaker: 'Granary Clerk',
        body: 'The colony takes its measure first. What remains is yours to keep — or to share.',
      });
      return this;
    }

    if (state === 'complete') {
      this.showComplete({ ledger: { watered: 3, harvested: 5, shared: 1 } });
    }
    return this;
  }

  dispose() {
    for (const off of this._offs) off();
    for (const off of this._domOffs) off();
    this._offs.length = 0;
    this._domOffs.length = 0;
    this._els.announcer?.remove();
    document.documentElement.classList.remove('is-touch');
    this._ctx = null;
  }

  _cacheElements() {
    this._els = {
      hud: query('hud'),
      canvas: query('game'),
      era: query('era-card'),
      dayClock: query('day-clock'),
      phase: query('phase'),
      hour: query('hour'),
      taskSlip: query('task-slip'),
      taskCurrent: document.querySelector('[data-testid="task-current"]'),
      taskProgress: document.querySelector('[data-testid="task-progress"]'),
      prompt: query('prompt'),
      promptKey: query('prompt')?.querySelector('kbd') ?? null,
      promptLabel: query('prompt')?.querySelector('span') ?? null,
      carry: query('carry'),
      carryIcon: query('carry-icon'),
      carryLabel: query('carry-label'),
      controls: query('controls'),
      story: query('story-card'),
      storySeal: query('story-seal'),
      storyTitle: query('story-title'),
      storySpeaker: query('story-speaker'),
      storyBody: query('story-body'),
      storyHint: query('story-card')?.querySelector('em') ?? null,
      complete: query('day-complete'),
      completePanel: query('day-complete')?.querySelector('.complete-panel') ?? null,
      completeSummary: query('day-complete')?.querySelector('.complete-panel > p') ?? null,
      ledger: query('day-complete')?.querySelector('dl') ?? null,
      ledgerNotes: null,
      boot: query('boot-card'),
      begin: query('begin'),
      newDay: query('new-day'),
      announcer: null,
    };
  }

  _repairStaticCopy() {
    const eraText = this._els.era?.querySelector('strong');
    const taskKicker = this._els.taskSlip?.querySelector('small');
    const bootText = this._els.boot?.querySelector('p');
    const bootHelp = this._els.boot?.querySelector('small');
    const completeSummary = this._els.completeSummary;
    if (eraText) eraText.textContent = 'Jian’an 2 · 197 CE';
    if (taskKicker) taskKicker.textContent = 'FIELD LEDGER · TODAY';
    if (bootText) bootText.textContent = 'A farm day near Xuchang · Jian’an 2';
    if (bootHelp) bootHelp.textContent = 'WASD to move · E to work · R to return';
    if (completeSummary) completeSummary.textContent = 'You met the colony’s grain share and gave seed to a family from Xu.';
    const sealMini = this._els.taskSlip?.querySelector('.seal-mini');
    const bootSeal = this._els.boot?.querySelector('.boot-seal');
    const completeSeal = this._els.complete?.querySelector('.big-seal');
    if (sealMini) sealMini.textContent = '田';
    if (bootSeal) bootSeal.textContent = '田';
    if (completeSeal) completeSeal.textContent = '成';
    if (this._els.storySeal) this._els.storySeal.textContent = '曹';
    if (this._els.hour) this._els.hour.textContent = '卯時 · 05:40';
  }

  _installAccessibility() {
    if (this._els.hud) this._els.hud.setAttribute('aria-live', 'off');
    if (this._els.canvas) {
      this._els.canvas.tabIndex = 0;
      this._els.canvas.setAttribute('aria-describedby', 'controls');
    }
    if (this._els.prompt) {
      this._els.prompt.setAttribute('role', 'button');
      this._els.prompt.setAttribute('tabindex', '0');
      this._els.prompt.setAttribute('aria-hidden', 'true');
    }
    if (this._els.story) {
      this._els.story.setAttribute('role', 'status');
      this._els.story.setAttribute('aria-live', 'polite');
      this._els.story.setAttribute('aria-hidden', 'true');
    }
    if (this._els.complete) {
      this._els.complete.setAttribute('role', 'dialog');
      this._els.complete.setAttribute('aria-modal', 'true');
      this._els.complete.setAttribute('aria-labelledby', 'day-complete-title');
      this._els.complete.setAttribute('aria-hidden', 'true');
      const heading = this._els.complete.querySelector('h1');
      if (heading) heading.id = 'day-complete-title';

      const notes = document.createElement('ul');
      notes.id = 'ledger-notes';
      notes.hidden = true;
      notes.setAttribute('aria-label', 'Completed field ledger');
      this._els.ledger?.before(notes);
      this._els.ledgerNotes = notes;
    }
    if (this._els.boot) {
      this._els.boot.setAttribute('role', 'dialog');
      this._els.boot.setAttribute('aria-modal', 'true');
      this._els.boot.setAttribute('aria-labelledby', 'boot-title');
      const heading = this._els.boot.querySelector('h1');
      if (heading) heading.id = 'boot-title';
    }

    const announcer = document.createElement('div');
    announcer.id = 'game-announcer';
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    this._els.hud?.append(announcer);
    this._els.announcer = announcer;
  }

  _bindEvents() {
    const on = (name, handler) => this._offs.push(this._ctx.events.on(name, handler));
    on('task:changed', (payload) => this.setTask(payload));
    on('day:phase', (payload) => this.setPhase(payload));
    on('carry:changed', (payload) => this.setCarry(payload));
    on('story:card', (payload) => this.showStory(payload));
    on('story:clear', () => this.dismissStory('event'));
    on('day:complete', (payload) => this.showComplete(payload));

    // Player implementations may use either name; both carry the same shape:
    // { label|verb, visible, id, key? }.
    on('interaction:prompt', (payload) => this.setPrompt(payload, payload?.visible ?? payload?.available ?? true));
    on('prompt:changed', (payload) => this.setPrompt(payload, payload?.visible ?? payload?.available ?? true));
    on('interaction:focus', (payload) => this.setPrompt(payload, payload?.available ?? payload?.visible ?? true));
    on('interaction:leave', () => this.clearPrompt());
    on('prompt:clear', () => this.clearPrompt());

    on('interaction:blocked', (payload = {}) => {
      const reason = payload.reason ?? 'Finish the current field task first';
      this._showFeedback(String(reason), 'blocked', 2.35);
      this._announce(String(reason));
    });
    on('interaction:success', (payload = {}) => {
      this._basePrompt = { visible: false, label: '', key: 'E', tone: 'normal', id: null };
      if (payload.label) this._showFeedback(`Done · ${payload.label}`, 'success', 1.05);
    });
    on('player:recover', () => this._showFeedback('Returned to the field path', 'normal', 1.45));
  }

  _bindDom() {
    const listen = (target, name, handler, options) => {
      if (!target) return;
      target.addEventListener(name, handler, options);
      this._domOffs.push(() => target.removeEventListener(name, handler, options));
    };

    listen(this._els.boot, 'click', (event) => this._beginGame(event));
    listen(this._els.prompt, 'click', (event) => this._activatePrompt(event));
    listen(this._els.prompt, 'keydown', (event) => {
      if (event.code !== 'Enter' && event.code !== 'Space') return;
      event.preventDefault();
      this._activatePrompt(event);
    });
    listen(this._els.newDay, 'click', () => {
      this._hide(this._els.complete);
      this._ctx.events.emit('day:restart', { source: 'ui' });
      this._announce('A new farm day begins.');
      this._els.canvas?.focus({ preventScroll: true });
    });
  }

  _syncInitialState() {
    const farm = this._ctx.peek?.('farm');
    if (farm) {
      if (farm.currentTask) this.setTask(farm.currentTask);
      this.setPhase({ phase: farm.phase ?? 'dawn', hour: farm.hour });
      this.setCarry({ kind: farm.carry ?? 'none', amount: farm.carryAmount ?? 0 });
      if (farm.dayComplete) this.showComplete({ ledger: farm.ledger });
    }

    // Player init precedes UI init, so its first focus value may already be
    // stable and therefore never emit a change event on frame one.
    const interaction = this._ctx.peek?.('player')?.interaction;
    if (interaction?.available) this.setPrompt(interaction, true);
  }

  _beginGame(event) {
    if (this._begun) return;
    this._begun = true;
    this._hide(this._els.boot);
    document.body.classList.add('game-ready');
    if (this._disabledInputForBoot && this._ctx.input) {
      this._ctx.input.enabled = this._inputWasEnabled;
      this._disabledInputForBoot = false;
    }
    this._ctx.events.emit('game:begin', { source: event?.pointerType || event?.type || 'ui' });
    this._ctx.events.emit('audio:unlock', { source: 'begin' });
    this._announce('The farm day has begun. Draw water from the stone well.');
    this._els.canvas?.focus({ preventScroll: true });
  }

  _activatePrompt(event) {
    if (!this._begun || this._els.prompt?.hidden || this._feedbackUntil >= 0 || this._basePrompt.visible === false) return;
    event?.preventDefault?.();
    const input = this._ctx.input;
    if (input?.inject) {
      input.inject('KeyE', true);
      this._pendingTapRelease = true;
    }
    else this._ctx.events.emit('ui:action', { id: this._basePrompt.id, source: 'prompt' });
    this._els.canvas?.focus({ preventScroll: true });
  }

  _normalisePrompt(prompt, visible) {
    if (typeof prompt === 'string') {
      return { visible: visible !== false, label: prompt, key: 'E', tone: 'normal', id: null };
    }
    const value = prompt ?? {};
    const label = value.verb ?? value.label ?? value.text ?? value.action ?? '';
    return {
      visible: value.visible ?? value.available ?? value.active ?? visible ?? Boolean(label),
      label: String(label),
      key: String(value.key ?? 'E').toUpperCase(),
      tone: value.tone ?? (value.enabled === false ? 'blocked' : 'normal'),
      id: value.id ?? value.targetId ?? null,
    };
  }

  _renderPrompt(prompt) {
    if (!this._els.prompt) return;
    const visible = Boolean(prompt.visible && prompt.label);
    if (!visible) {
      this._hide(this._els.prompt);
      return;
    }
    const key = this._touch ? 'TAP' : prompt.key || 'E';
    if (this._els.promptKey) this._els.promptKey.textContent = key;
    if (this._els.promptLabel) this._els.promptLabel.textContent = prompt.label;
    this._els.prompt.dataset.tone = prompt.tone || 'normal';
    this._els.prompt.setAttribute('aria-label', `${this._touch ? 'Tap' : `Press ${key} to`} ${prompt.label}`);
    this._show(this._els.prompt);
  }

  _showFeedback(label, tone, seconds) {
    this._feedbackUntil = (this._ctx?.time?.elapsed ?? 0) + seconds;
    this._renderPrompt({ visible: true, label, key: 'E', tone, id: null });
  }

  _renderLedger(ledger) {
    if (!this._els.ledger || ledger === undefined || ledger === null) return;
    if (Array.isArray(ledger?.entries)) {
      if (this._els.ledgerNotes) {
        const fragment = document.createDocumentFragment();
        for (const entry of ledger.entries) {
          const item = document.createElement('li');
          item.textContent = String(entry);
          fragment.append(item);
        }
        this._els.ledgerNotes.replaceChildren(fragment);
        this._show(this._els.ledgerNotes);
      }
      if (ledger.title && this._els.completePanel) this._els.completePanel.setAttribute('aria-description', String(ledger.title));
      return;
    }
    let entries;
    if (Array.isArray(ledger)) {
      entries = ledger.slice(0, 4).map((entry, index) => {
        if (entry && typeof entry === 'object') {
          return [entry.label ?? entry.key ?? `Entry ${index + 1}`, entry.value ?? entry.amount ?? '—'];
        }
        return [`Entry ${index + 1}`, entry];
      });
    } else if (typeof ledger === 'object') {
      entries = Object.entries(ledger).slice(0, 4);
    } else {
      return;
    }
    if (entries.length === 0) return;

    const fragment = document.createDocumentFragment();
    for (const [key, value] of entries) {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      const normalisedKey = String(key).toLowerCase().replace(/\s+/g, '-');
      term.textContent = LEDGER_LABELS[normalisedKey] ?? readableKey(key);
      description.textContent = ledgerValue(normalisedKey, value);
      row.append(term, description);
      fragment.append(row);
    }
    this._els.ledger.replaceChildren(fragment);
    this._els.ledger.style.gridTemplateColumns = `repeat(${entries.length}, minmax(0, 1fr))`;
  }

  _announce(message) {
    if (this._els.announcer) this._els.announcer.textContent = String(message ?? '');
  }

  _show(element) {
    if (!element) return;
    element.hidden = false;
    element.setAttribute('aria-hidden', 'false');
  }

  _hide(element) {
    if (!element) return;
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
  }
}
