const CARDS = Object.freeze({
  dawn: Object.freeze({
    speaker: 'Household elder',
    title: 'Jian’an 2 · Water before work',
    body: 'War has left fields and wells untended around Xu. A household begins with water because seed, labor, and the official tally mean little if the beds stay dry.',
    seal: '許',
  }),
  water: Object.freeze({
    speaker: 'Field note',
    title: 'Three beds under one bucket',
    body: 'Millet asks less water than many grains, but a young stand still needs careful tending. Each measured pour protects both the household meal and the registered harvest.',
    seal: '田',
  }),
  harvest: Object.freeze({
    speaker: 'Household elder',
    title: 'Cut high, keep the grain clean',
    body: 'Ripe millet stores well and travels as army provision. Five sheaves are modest beside the great granaries, yet every state tally begins in a household field.',
    seal: '粟',
  }),
  thresh: Object.freeze({
    speaker: 'Field note',
    title: 'Grain from straw',
    body: 'Threshing turns a bulky harvest into grain that can be measured, sealed, and carried. The straw remains useful at home for fodder, fuel, and bedding.',
    seal: '禾',
  }),
  tally: Object.freeze({
    speaker: 'Tuntian granary clerk',
    title: 'The Xu colony tally',
    body: 'Cao Cao established tuntian fields around Xu in 196 to restore abandoned land and secure grain. In Jian’an 2, this sealed sack becomes the household’s recorded share.',
    seal: '屯田',
  }),
  compassion: Object.freeze({
    speaker: 'Xu family mother',
    title: 'A plot is not yet a livelihood',
    body: 'The register can assign an abandoned plot, but it cannot replace seed lost in flight. Your retained pouch lets the Xu family sow without taking back the share already delivered.',
    seal: '恤鄰',
  }),
  dusk: Object.freeze({
    speaker: 'Household elder',
    title: 'One lamp at dusk',
    body: 'The official sack is gone and the seed pouch has found another field. What remains is enough light for a quiet bowl of millet porridge together.',
    seal: '家',
  }),
  ledger: Object.freeze({
    speaker: 'Field ledger',
    title: 'Work entered; household at rest',
    body: 'Water, harvest, state share, and neighbor’s seed are all accounted for. The first harvest closes not with conquest, but with a lamp, porridge, and sleep.',
    seal: '建安二年',
  }),
});

const MILESTONE_CARDS = Object.freeze({
  1: 'dawn',
  2: 'water',
  3: 'harvest',
  4: 'thresh',
  5: 'tally',
  6: 'compassion',
});

const CARD_ALIASES = Object.freeze({
  well: 'dawn',
  irrigation: 'water',
  millet: 'harvest',
  thresher: 'thresh',
  granary: 'tally',
  tuntian: 'tally',
  refugees: 'compassion',
  xu: 'compassion',
  lamp: 'dusk',
  complete: 'ledger',
  day: 'ledger',
});

/**
 * Historical narrative is event driven: cards appear at completed work rather
 * than on timers, so reading speed can never make a story beat missable.
 */
export class StorySystem {
  static id = 'story';
  static deps = ['farm'];

  async init(ctx) {
    this.ctx = ctx;
    this.activeCard = null;
    this.activeKind = null;
    this.phase = ctx.get('farm').phase;
    this.hour = ctx.get('farm').hour;
    this._seen = new Set();

    this._offMilestone = ctx.events.on('milestone:complete', (event) => {
      const kind = MILESTONE_CARDS[event?.step];
      if (kind) this._show(kind, false);
    });
    this._offSuccess = ctx.events.on('interaction:success', (event) => {
      if (event?.id === 'shrine') this._show('dusk', false);
    });
    this._offPhase = ctx.events.on('day:phase', (event) => {
      if (!event) return;
      this.phase = event.phase;
      this.hour = event.hour;
    });
    this._offComplete = ctx.events.on('day:complete', () => this._show('ledger', false));
  }

  debugCard(kind) {
    if (kind === 'none' || kind === 'clean' || kind == null) {
      this.activeCard = null;
      this.activeKind = null;
      this._seen.clear();
      this.ctx.events.emit('story:clear', {});
      return true;
    }
    const normalized = CARD_ALIASES[kind] ?? kind;
    if (!CARDS[normalized]) return false;
    this._show(normalized, true);
    return true;
  }

  _show(kind, force) {
    const card = CARDS[kind];
    if (!card || (!force && this._seen.has(kind))) return;
    if (!force) this._seen.add(kind);
    this.activeKind = kind;
    this.activeCard = card;
    this.ctx.events.emit('story:card', {
      speaker: card.speaker,
      title: card.title,
      body: card.body,
      seal: card.seal,
      kind,
    });
  }

  dispose() {
    this._offMilestone?.();
    this._offSuccess?.();
    this._offPhase?.();
    this._offComplete?.();
    this._offMilestone = null;
    this._offSuccess = null;
    this._offPhase = null;
    this._offComplete = null;
    this.activeCard = null;
    this.ctx = null;
  }
}
