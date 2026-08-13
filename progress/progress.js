const ids = ['01-agriculture','02-sheep','03-woodcutting','04-pigs','05-events','06-farm-animals','07-horses'];
const root = document.querySelector('#shots');

for (const id of ids) {
  const el = document.createElement('article');
  el.className = 'pair';
  el.innerHTML = `
    <h3>${id}</h3>
    <div class="pair-grid">
      <figure><img src="/assets/reference/official/${id}.png" alt="Official locked reference ${id}"><figcaption>Official reference · locked</figcaption></figure>
      <figure><img src="/shots/latest/${id}.png" alt="Current build capture ${id}" onerror="this.style.opacity='.12'"><figcaption>Current build · latest capture</figcaption></figure>
    </div>`;
  root.append(el);
}

const verdicts = [
  { round:'06', title:'Recapture gate · execution credits exhausted', body:'Final woodcut, horse, Han-costume, wattle-fence and one-press navigation fixes compile cleanly. The local Chromium runner is blocked by workspace execution credits, so these changes remain deliberately uncertified rather than presented as a win.', win:false },
  { round:'04', title:'Blind matched-shot critic · official leads 4–3', body:'Ours won sheep care, the tuntian granary event, and the mixed-animal scene. Aggregate narrowed to 204.5 vs 207.5. Remaining defect: wood/horse anatomy and action alignment, now revised in Round 06.', win:false },
  { round:'04', title:'Historical identity critic · 32/40', body:'Historical grounding 8, Three Kingdoms identity 7, farm-life specificity 9, UI/world integration 8. Only the world-without-overlays identity axis remains below the strict bar.', win:false },
  { round:'04', title:'Build · physical tuntian system and safe restart landed', body:'The granary now weighs, divides, seals and registers the grain in-world; a supply cart ties the share to Xuchang logistics. Begin Again now resets task, time, world, player and checkpoint, with an explicit regression test.', win:true },
  { round:'04', title:'Fresh-player correction · one-action guidance running', body:'Round 03 exposed distrust in manual navigation. The next gate requires a storage-clean browser run to finish by ordinary E/click alone, with no source or debug-state assistance.', win:false },
  { round:'03', title:'Historical identity critic · 28/40', body:'Farm-life specificity reached 8/10, but architecture, clothing and tuntian mechanics still leaned on prose. The critic also found the stale Begin Again state; both findings drove Round 04.', win:false },
  { round:'03', title:'Fresh-player critic · failed on navigation trust', body:'Recovery and wrong-order feedback worked, but the player did not infer E auto-follow and stalled at the third bed. Gold-marker guidance is being reduced to one E for travel plus work.', win:false },
  { round:'02', title:'Blind matched-shot critic · official won 6–1', body:'Ours won woodcutting. The recurring gap was merged silhouettes and unclear action staging, which prompted the separated actor/animal compositions.', win:false },
  { round:'02', title:'Historical identity critic · failed 27/40', body:'Correct date, crop and institution, but insufficient late-Han material culture in the physical scene.', win:false },
  { round:'01', title:'Blind matched-shot critic · official won 7–0', body:'Official cohort won 206–163. The intended verbs did not parse quickly enough at thumbnail size.', win:false },
  { round:'01', title:'Fresh-player critic · failed at the final ritual', body:'The player reached 7/7, but the roof hid the avatar and task marker. The deterministic camera cutaway fixed that obstruction.', win:false },
  { round:'00', title:'Locked benchmark', body:'Seven official Harvest Days screenshots preserved unchanged. Gate: polish, readability, charm and identity all ≥8, total ≥34/40.', win:false },
];

document.querySelector('#verdicts').innerHTML = verdicts.map((v) => `<article class="verdict ${v.win ? 'win' : ''}"><small>ROUND ${v.round}</small><h3>${v.title}</h3><p>${v.body}</p></article>`).join('');
