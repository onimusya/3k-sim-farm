# Fields of the Fractured Han

A playable low-poly farm-life day set in the Xuchang hinterland during Jian'an 2 (197 CE). Water millet, harvest and thresh it, measure Cao Cao's tuntian share, retain seed for a displaced Xu family, then close the household day with lamp and porridge.

## Run

```powershell
npm install
npm run dev
```

Open <http://127.0.0.1:5277/>. The live build ledger and seven locked matched-shot comparisons are at <http://127.0.0.1:5277/progress/>.

## Controls

- `E` / click: follow the sole gold task marker and perform the contextual farm action
- `WASD` / arrow keys: optional manual movement; immediately cancels auto-follow
- `R`: return to the last safe ground without losing progress

There is no missable timer, combat, stamina, inventory selection, or irreversible failure. Progress checkpoints after every watered bed, harvested sheaf, and major milestone.

## Verification

```powershell
npm run build
npm run smoke
npm run daytest
npm run shots
```

`daytest` covers task reconstruction, E-spam idempotence, recovery, full restart, assert hooks, and console errors. `shots` captures all seven deterministic review compositions into `shots/latest`.

## Project structure

- `src/world` — late-Han farmstead, millet, granary, registers, tuntian balance, refugee plot
- `src/farm` — complete seven-milestone day and checkpoint rules
- `src/player` — camera-relative movement, recovery, task guidance
- `src/actors`, `src/fx`, `src/audio` — people, animals, reactions, and procedural sound
- `src/ui`, `src/story` — bamboo-ledger interface and event-driven historical story cards
- `tools` — browser smoke, day-loop, capture, baseline, and profiling harnesses
- `progress` — live A/B build ledger

The two grouped `.glb` accents were made with the available Thrixel free-plan cube budget; the rest of the game is original procedural Three.js geometry.
