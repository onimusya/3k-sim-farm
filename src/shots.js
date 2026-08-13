export const SHOTS = {
  '01-agriculture': {
    pos: [6.2, 3.2, 7.8], look: [-0.4, 1.0, 2.7], fov: 52, time: 10.2,
    apply: (e) => { e.ctx.peek('farm')?.debugStage?.(3); e.ctx.peek('world')?.debugBannerVisible?.(6,6,false); e.ctx.peek('actors')?.debugPose?.('agriculture'); e.ctx.peek('fx')?.debugBurst?.('harvest', { x: 1.1, y: 0.65, z: 3.1 }); e.ctx.peek('ui')?.setTask?.({ title: 'Harvest millet for the Cao tuntian share', displayStep: 3, total: 7 }); },
    doc: 'Matched agriculture action: sickle visibly cuts ripe millet; ox-plough, bamboo tally and Han colony form three readable depth planes.',
  },
  '02-sheep': {
    pos: [-11.3, 2.15, -1.1], look: [-16.4, 0.82, -5.1], fov: 48, time: 10.4,
    apply: (e) => { e.ctx.peek('farm')?.debugStage?.(5); e.ctx.peek('actors')?.debugPose?.('herd'); e.ctx.peek('ui')?.setTask?.({ title: 'Offer a seed-grain ration to the farm flock', displayStep: 5, total: 7 }); e.ctx.peek('ui')?.setCarry?.({ kind: 'none' }); },
    doc: 'Matched herd tableau: charming sheep/goat care, three depth planes, farmhouse and Han fencing without clipped focal animals.',
  },
  '03-woodcutting': {
    pos: [22.8, 3.0, 14.8], look: [18.15, 1.0, 18.0], fov: 55, time: 15.4,
    apply: (e) => { e.ctx.peek('farm')?.debugStage?.(4); e.ctx.peek('world')?.debugTreeVisible?.(16,18,false); e.ctx.peek('world')?.debugTreeVisible?.(20,16,false); e.ctx.peek('world')?.debugFelledLog?.(18,17.75,true); e.ctx.peek('actors')?.debugPose?.('woodcut'); e.ctx.peek('fx')?.debugBurst?.('leaves', { x: 18, y: 1.8, z: 17 }); e.ctx.peek('ui')?.setTask?.({ title: 'Split storm-felled timber for the threshing floor', displayStep: 4, total: 7 }); },
    doc: 'Matched woodland action: held tool aligned to a clear target, chipping/leaves feedback, controlled greens and distant Xuchang ridge.',
  },
  '04-pigs': {
    pos: [-11.8, 1.65, 5.8], look: [-17.25, 0.68, 1.8], fov: 46, time: 11.2,
    apply: (e) => { e.ctx.peek('farm')?.debugStage?.(4); e.ctx.peek('actors')?.debugPose?.('pigs'); e.ctx.peek('fx')?.debugBurst?.('feed', { x: -18.5, y: 0.2, z: 2.4 }); e.ctx.peek('ui')?.setTask?.({ title: 'Feed the sow and her piglet after threshing', displayStep: 4, total: 7 }); e.ctx.peek('ui')?.setCarry?.({ kind: 'none' }); },
    doc: 'Matched pig close-up: expressive sow and piglet visibly reacting to feed, clean anatomy and contact shadows.',
  },
  '05-events': {
    pos: [11.1, 2.7, 3.2], look: [16.4, 1.3, -2.15], fov: 48, time: 13.0,
    apply: (e) => { e.ctx.peek('farm')?.debugStage?.(6); e.ctx.peek('actors')?.debugPose?.('tuntian'); e.ctx.peek('story')?.debugCard?.('tally'); e.ctx.peek('fx')?.debugBurst?.('seal', { x: 16.0, y: 1.1, z: -1.9 }); e.ctx.peek('ui')?.setTask?.({ title: 'Weigh, seal and register the Cao tuntian share', displayStep: 5, total: 7 }); e.ctx.peek('ui')?.setCarry?.({ kind: 'grain-sack', amount: 1, label: 'unmeasured grain sack' }); },
    doc: 'Matched community event: active grain tally exchange at a late-Han tuntian granary, crowd life and unmistakable historical UI.',
  },
  '06-farm-animals': {
    pos: [-9.3, 2.45, 0.8], look: [-16.2, 0.78, -4.7], fov: 52, time: 15.0,
    apply: (e) => { e.ctx.peek('farm')?.debugStage?.(6); e.ctx.peek('actors')?.debugPose?.('farm-animals'); e.ctx.peek('ui')?.setTask?.({ title: 'Scatter seed grain for the chickens and geese', displayStep: 6, total: 7 }); e.ctx.peek('ui')?.setCarry?.({ kind: 'seed-pouch', amount: 1, label: 'seed-grain pouch' }); },
    doc: 'Matched mixed animals: ox, cattle, geese, chickens and goats with varied poses, readable depth and ambient farm life.',
  },
  '07-horses': {
    pos: [-11.5, 2.5, -1.4], look: [-17.4, 1.08, -6.7], fov: 54, time: 16.4,
    apply: (e) => { e.ctx.peek('farm')?.debugStage?.(7); e.ctx.peek('world')?.debugPastureVisible?.(false); e.ctx.peek('actors')?.debugPose?.('horses'); e.ctx.peek('fx')?.debugBurst?.('groom', { x: -17.3, y: 1.0, z: -6.85 }); e.ctx.peek('render')?.setTimeOfDay?.(17.15, 'afternoon'); e.ctx.peek('ui')?.setTask?.({ title: 'Groom the relay mare before evening', displayStep: 7, total: 7 }); },
    doc: 'Matched horse portrait: mare and foal grooming interaction, stable framing, tenderness and dusk light.',
  },
};

export function clearState(engine) {
  engine.ctx.peek('fx')?.debugBurst?.('none');
  engine.ctx.peek('ui')?.debugState?.('clean');
  engine.ctx.peek('story')?.debugCard?.('none');
  engine.ctx.peek('actors')?.debugPose?.('none');
  engine.ctx.peek('world')?.debugTreeVisible?.(16,18,true);
  engine.ctx.peek('world')?.debugTreeVisible?.(20,16,true);
  engine.ctx.peek('world')?.debugFelledLog?.(18,17.75,false);
  engine.ctx.peek('world')?.debugBannerVisible?.(6,6,true);
  engine.ctx.peek('world')?.debugPastureVisible?.(true);
}
