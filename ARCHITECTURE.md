# Fields of the Fractured Han — engine contract

Target: a self-contained browser farm-life simulation whose low-poly visual polish, readability, and charm beat the seven official *Harvest Days: My Dream Farm* reference screenshots while its late-Han identity is unmistakable in the first frame. WebGL2 + Three.js. Downloaded Thrixel GLBs are reserved for the most visible hero assets; large structures, repeated foliage, crops, props, FX, UI, and audio are authored in-engine. The build works offline after install.

Historical frame: the Xuchang hinterland, Jian’an 2 (197 CE), during the first harvests of Cao Cao's tuntian colonies. The player is a civilian field household balancing seed, grain share, displaced neighbors, and a quiet evening meal. History changes the farm loop; it is not ornamental lore.

## Hard rules

1. Every subsystem owns one directory. Coupled visuals (sky, light, exposure, material albedo, fog) have one sequential owner: `render`.
2. Subsystems never import each other. They communicate through `ctx.get(id)` and the event bus.
3. Runtime dependency: `three` only. No CDN assets. All reference screenshots remain quality evidence and are never rendered in-game.
4. No `Math.random()` in gameplay or visuals. Use a retained `ctx.rng.fork()`.
5. No wall-clock animation. Use `ctx.time`; CSS transitions/animations are prohibited in captured UI.
6. No per-frame allocation in simulation/render loops. Reuse scratch vectors, matrices, colors, and pools.
7. Dispose every geometry, material, texture, render target, and audio node created.
8. Respect `ctx.config.q`; repeated geometry must be instanced or shared.
9. `npm run build`, smoke, day-flow, and all seven captures must pass after every owner pass.
10. No missable timer, stamina death, crop loss, combat, or irreversible failure in the first-day loop.

## Player contract

- WASD / arrows move. The isometric chase camera follows smoothly without pointer lock.
- `E` or left click performs the one contextual action. `R` returns to the last safe point without losing progress.
- Exactly one active world affordance is gold-highlighted; the bottom prompt uses a literal verb.
- Tools auto-equip. Carried water/grain/seed is visible. There is no inventory or tool-selection friction.
- The current task is always a one-line bamboo-slip strip. Every station is visible from the last station or connected by a gold pennant path.
- Milestones checkpoint to local storage. Interactions are idempotent under key spam.

## Day loop

1. Dawn — draw water from the stone well.
2. Water three millet beds.
3. Harvest five ripe millet sheaves.
4. Thresh the harvest at the foot-powered thresher; collect one grain sack.
5. Deliver the sealed tuntian share to the granary clerk.
6. Choose compassion — give retained seed grain to a displaced Xu family at an abandoned plot.
7. Dusk — light the household lamp, eat millet porridge, and sleep.
8. Night — `DAY COMPLETE` appears as a lacquer seal; the completed field ledger remains visible.

Time advances only at milestones. Reload resumes the latest completed milestone. Wrong-order interactions show a short prerequisite and never lock progress.

## Subsystem interface

```js
export class System {
  static id = 'system';
  static deps = [];
  async init(ctx) {}
  fixedUpdate(h, ctx) {}
  update(dt, ctx) {}
  lateUpdate(dt, ctx) {}
  resize(w, h, ctx) {}
  async prewarmMaterials(ctx) {}
  dispose() {}
}
```

`ctx` provides `scene`, `camera`, `overlayScene`, `overlayCamera`, `canvas`, `config`, `events`, `input`, `time`, `rng`, `get(id)`, `peek(id)`, and `has(id)`.

## Ownership map

| id | directory | owns |
|---|---|---|
| `render` | `src/render/` | WebGLRenderer, palette, sky, fog, lights, shadows, final composition |
| `world` | `src/world/` | terrain, water, buildings, fields, paths, props, foliage, collision landmarks |
| `actors` | `src/actors/` | player avatar, ox, pigs, chickens, horse, villagers, presentation animation |
| `farm` | `src/farm/` | milestone state machine, interactables, crops, carried items, checkpoints |
| `player` | `src/player/` | input, movement, collision, chase camera, nearest contextual action, recovery |
| `story` | `src/story/` | clerk, Xu family, dispatches, dialogue cards, historical field ledger |
| `fx` | `src/fx/` | interaction bursts, dust, leaves, water glints, seal stamp, fireflies |
| `audio` | `src/audio/` | procedural soundscape and action transients, opt-in audio context |
| `ui` | `src/ui/` | HUD, prompts, task strip, dialogue, controls, accessibility hooks, completion seal |

Lead-owned shared files: `src/core/`, `src/main.js`, `src/shots.js`, `tools/`, build config, `progress/`.

## Canonical events

| event | payload | emitter | actor |
|---|---|---|---|
| `interaction:attempt` | `{ id }` | player | farm/story |
| `interaction:success` | `{ id, step, label, world }` | farm | fx/audio/ui/story |
| `interaction:blocked` | `{ id, reason }` | farm | ui/audio |
| `task:changed` | `{ step, total, title, targetId }` | farm | ui/world |
| `day:phase` | `{ phase, hour }` | farm | render/audio/ui/story |
| `carry:changed` | `{ kind, amount }` | farm | actors/ui |
| `story:card` | `{ speaker, title, body, seal }` | story | ui |
| `day:complete` | `{ ledger }` | farm | render/ui/audio/fx/story |
| `player:recover` | `{ position }` | player | ui/audio |

## Shared vocabulary

Surfaces: `rammed-earth`, `packed-dirt`, `timber`, `thatch`, `grey-tile`, `stone`, `water`, `millet`, `hemp`, `lacquer`, `bronze`, `cloth`.

Phases: `dawn`, `morning`, `noon`, `afternoon`, `dusk`, `night`.

Carry kinds: `none`, `water-bucket`, `millet-sheaf`, `grain-sack`, `seed-pouch`, `lamp`.

## Render integration

```js
const render = ctx.get('render');
render.renderer;
render.setTimeOfDay(hour);
render.setWeather(kind);
render.resetTemporal();
```

Only `render` may modify exposure, tone mapping, fog, environment, sun/hemisphere colors, or shadow budgets. All materials use the shared `materials.js` palette. `mesh.userData.noShadow = true` is the single shadow opt-out.

## Quality bar and locked shots

Each capture is paired 1:1 with `assets/reference/official`:

| ours | official | judged axis |
|---|---|---|
| `01-agriculture` | agriculture | avatar, lush crop density, readable farm panorama |
| `02-sheep` | sheep | animal silhouettes, layered pasture, architecture |
| `03-woodcutting` | woodcutting | exploration depth, grass/forest density, held tool |
| `04-pigs` | pigs | expressive close animal, material/contact detail |
| `05-events` | events | historical market/granary story readability |
| `06-farm-animals` | farm animals | herd variety, depth, ambient life |
| `07-horses` | horses | intimate animal close-up, stable framing, charm |

Blind A/B rubric: polish, readability, charm, and thematic identity, each 0–10. A round passes only when the fresh critic selects ours overall, no axis is below the official shot, smoke passes, and the defect count does not rise. Critics name one biggest remaining gap; the next owner pass fixes that root cause.

## Debug and test hooks

- `window.__GAME_STATE__()` returns public deterministic state for assertions, not navigation decisions.
- DOM: `data-testid="task-current"`, `task-progress`, `interaction-prompt`, `day-phase`, `day-complete`.
- `farm.debugStage(step)` stages any milestone without leftover state.
- `actors.debugPose(kind)`, `fx.debugBurst(kind)`, `ui.debugState(mode)`, `story.debugCard(kind)` are capture hooks; `none/clean` fully reset.
- Browser fresh-player test clears storage, starts muted at 1280×720, uses screenshots and ordinary inputs, and must reach `Day Complete` within eight minutes without source/console/debug-state guidance.

