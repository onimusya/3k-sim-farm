# Ranked asset plan

The complete vision is listed before generation and is not reduced to the current cube balance. Rank is player noticeability. `A` = Thrixel Architect, `A→D` = Architect then Detailer, `S` = Sculptor, `E` = engine-authored. All generated assets use Plus (omit `quality`), are inspected, refined in-context, and grouped before import.

| rank | asset | path | moving groups | target | current 250-cube scope |
|---:|---|---|---|---:|---|
| 1 | young Han field farmer hero, cross-collar hemp clothes, tied hair, hoe/bucket/sack carry silhouette | A→D | head, arms, legs | 20k | Generate Architect; detail only if balance permits |
| 2 | Han ox with wooden yoke and iron ploughshare | A→D | head, legs, tail, yoke | 20k | Generate Architect hero |
| 3 | late-Han rammed-earth farmhouse façade with timber frame, thatch and operable door | A | door | 12k | Generate Architect hero |
| 4 | grey-tile tuntian granary office with ledger counter, Cao seal plaque and opening gate | A | gate, shutters | 15k | Generate Architect hero if balance allows |
| 5 | expressive low-poly pig sow | S | none | 10k | Generate Sculptor if balance allows |
| 6 | chestnut courier horse with simple Han tack | A | head, legs, tail | 14k | Generate Architect if balance allows |
| 7 | displaced Xu family pair in patched hemp clothing | A | heads, arms | 16k | Generate only after core heroes |
| 8 | stone well with wooden windlass and bucket | A | crank, drum, bucket | 7k | Generate only after core heroes |
| 9 | foot-powered grain thresher / winnowing station | A | pedal, drum | 8k | Generate only after core heroes |
| 10 | clerk with official cap, bamboo ledger, seal | A | head, arms | 10k | Generate only after core heroes |
| 11 | black-and-red lacquer household shrine with three cups and oil lamp | A | door/lamp lid | 6k | Generate only after core heroes |
| 12 | village dog | S | none | 5k | Later |
| 13 | chicken/rooster family | S | none | 4k | Later |
| 14 | goose pair | S | none | 5k | Later |
| 15 | sheep/goat pair | S | none | 7k | Later |
| 16 | bamboo grain cart | A | wheels | 8k | Later |
| 17 | handcart | A | wheel | 6k | Later |
| 18 | kiln-fired clay jar set | A | lids | 4k | Later |
| 19 | iron hoe/sickle/rake tool set | A | none | 4k | Later |
| 20 | bamboo basket/winnowing tray set | A | none | 4k | Later |
| 21 | millet sheaf and seed-head cluster | S | none | 3k | Later |
| 22 | gnarled peach tree hero | S | none | 8k | Later |
| 23 | mulberry tree hero | S | none | 8k | Later |
| 24 | timber watchtower / que-like gate accent | A | bell/flag | 10k | Later |
| 25 | mounted relay rider | A→D | rider limbs, horse limbs | 22k | Later |
| 26 | rammed-earth terraces and enclosing walls | E | none | instanced | Build now |
| 27 | millet, wheat, soybean, hemp, gourd, scallion crop families | E | wind phase | instanced | Build now |
| 28 | orchard/woodland tree families, reeds, grass, flowers | E | wind phase | instanced | Build now |
| 29 | farm fences, gates, drying racks, hay, firewood, sacks, baskets, jars | E | gates | shared/instanced | Build now |
| 30 | pigs, chickens, geese, sheep, ox, horse background variants | E | rig groups | shared | Build now; replace heroes as GLBs arrive |
| 31 | villagers, clerk, Xu family, courier background variants | E | rig groups | shared | Build now; replace heroes as GLBs arrive |
| 32 | distant Xuchang wall, watchtowers, mountains, roads, irrigation | E | none | merged | Build now |
| 33 | water/soil/rammed-earth/thatch/tile/timber procedural material set | E | none | shared | Build now |
| 34 | banners, bamboo slips, tally/seal, ledger marks | E | cloth phase | shared | Build now |
| 35 | water, dust, chaff, leaves, fireflies, lamp flame, seal-stamp FX | E | pooled | budgeted | Build now |
| 36 | procedural farm soundscape and action feedback | E | none | WebAudio | Build now |

## Shared Thrixel style guide

- Stylized premium low-poly game asset; faceted but not crude; strong readable silhouette at 5–20 metres.
- Historically grounded late Eastern Han, Xuchang hinterland, circa 197 CE. No Japanese, Ming/Qing, wuxia, high-fantasy, chibi, or modern elements.
- Palette: warm rammed-earth ochre, hemp beige, soot black, weathered timber, grey-green fired tile, restrained iron, black lacquer and cinnabar seal-red accents.
- Surfaces show broad hand-authored color variation and edge wear without photoreal noise. Matte finish, gentle roughness, no glossy plastic.
- Real scale in metres; human around 1.7 m; door around 2.0 m. Object only, centered at origin, feet/base at y=0, no ground plane, backdrop, text, logo, or floating fragments.
- Prefer large clean polygon planes and purposeful bevels. Avoid needle-thin parts. Group semantic surfaces by material.
- Architect assets retain meaningful named moving groups listed in the table. Static pieces are groupable into `Body`.

