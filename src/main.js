import { Engine, boot, Input, configFromLocation, installShotApi, signalReady, prewarm } from '../lib/index.js';
import { RenderSystem } from './render/RenderSystem.js';
import { WorldSystem } from './world/WorldSystem.js';
import { ActorSystem } from './actors/ActorSystem.js';
import { FarmSystem } from './farm/FarmSystem.js';
import { PlayerSystem } from './player/PlayerSystem.js';
import { StorySystem } from './story/StorySystem.js';
import { FxSystem } from './fx/FxSystem.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { UiSystem } from './ui/UiSystem.js';
import { SHOTS, clearState } from './shots.js';

const BEGUN_SESSION_KEY = 'fields-of-the-fractured-han:begun:v1';

function readBegunSession() {
  try {
    return globalThis.sessionStorage?.getItem(BEGUN_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberBegunSession() {
  try {
    globalThis.sessionStorage?.setItem(BEGUN_SESSION_KEY, '1');
  } catch {
    // Storage restrictions must not prevent the day from starting.
  }
}

function clearBegunSession() {
  try {
    globalThis.sessionStorage?.removeItem(BEGUN_SESSION_KEY);
  } catch {
    // A completed restart still works when storage is unavailable.
  }
}

const { config, capture, lockstep, shot } = configFromLocation();
config.fov = 55;
const resumeBegunSession = !capture && readBegunSession();
const canvas = document.getElementById('game');
const input = new Input(canvas, { sensitivity: config.sensitivity, pointerLock: false });
const engine = new Engine({ canvas, config, input });
engine
  .add(RenderSystem)
  .add(WorldSystem)
  .add(ActorSystem)
  .add(FarmSystem)
  .add(PlayerSystem)
  .add(StorySystem)
  .add(FxSystem)
  .add(AudioSystem)
  .add(UiSystem);

engine.events.on('game:begin', rememberBegunSession);
engine.events.on('day:restart', clearBegunSession);
await boot(engine);
// A document/HMR reload is the only runtime route that can recreate the title
// card. Resume through its real click handler so input and accessibility state
// are restored exactly as if the player clicked Begin again.
if (resumeBegunSession) document.getElementById('begin')?.click();
const shotApi = installShotApi(engine, { shots: SHOTS, capture, lockstep, clearState });
window.__PREWARM__ = config.prewarm ? await prewarm(engine) : { ok: false, reason: 'disabled' };
window.__GAME_STATE__ = () => {
  const farm = engine.ctx.peek('farm');
  const player = engine.ctx.peek('player');
  return {
    frame: engine.time.frame,
    step: farm?.step ?? 0,
    task: farm?.currentTask?.title ?? '',
    progress: farm?.progress ?? {},
    dayComplete: !!farm?.dayComplete,
    phase: farm?.phase ?? 'dawn',
    carry: farm?.carry ?? 'none',
    player: player?.position ? [player.position.x, player.position.y, player.position.z] : null,
  };
};
engine.start();
if (shot) window.__APPLY_SHOT__(shot);
await signalReady(shotApi, 4);
if (capture) document.getElementById('boot-card')?.setAttribute('hidden', '');
if (import.meta.hot) import.meta.hot.dispose(() => engine.dispose());
