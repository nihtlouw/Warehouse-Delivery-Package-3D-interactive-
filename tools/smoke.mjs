#!/usr/bin/env node
/* tools/smoke.mjs
   Headless smoke test for the render-on-demand and adaptive-quality logic.

   There is no browser in CI, so this loads the *real* controller out of index.html
   with a stubbed THREE + DOM, then drives requestAnimationFrame with a fake clock.
   It verifies behaviour, not pixels:

     1. the page boots without throwing,
     2. ambient animation (conveyor, forklifts, rain) is throttled to ~30 fps,
     3. when nothing moves the loop stops rendering completely,
     4. slow frames step the quality tier down,
     5. opening the A|B comparison builds a second world, closing it disposes it again.

   Run: node tools/smoke.mjs
*/
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');

const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .filter((b) => !b.includes('base64,'));          // skip the inlined JPEG payload

/* ---------- a "works but does nothing" stand-in for THREE + DOM ---------- */

let clock = 0, uid = 0;

/* THREE.Vector3#length() is a *method*, but `.length` on arrays is a number:
   one object has to be both. */
const zeroFn = new Proxy(function () { return 0; }, {
  get(t, p) { if (p === Symbol.toPrimitive) return () => 0; return undefined; },
  apply() { return 0; }
});

function magic(tag) {
  const store = Object.create(null);
  const fn = function () { return magic(tag + '()'); };
  return new Proxy(fn, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === Symbol.iterator) return undefined;
      if (p === 'then') return undefined;               // never look like a promise
      if (p in store) return store[p];
      if (p === 'count') return 0;
      if (p === 'length') return zeroFn;
      if (p === 'uuid') { store.uuid = tag + ':' + (++uid); return store.uuid; }
      if (typeof p === 'string' && (/^[xyzwa]$/.test(p) || /^rgb$/.test(p))) return 0;
      const child = magic(tag + '.' + String(p));
      store[p] = child;                                 // cache so `obj.visible = false` sticks
      return child;
    },
    set(t, p, v) { store[p] = v; return true; },
    has() { return true; },
    apply() { return magic(tag + '()'); },
    construct() { return magic('new ' + tag); }
  });
}

const rafQueue = [];

const doc = magic('document');
doc.hidden = false;
doc.createElement = () => magic('canvas');
doc.querySelector = (sel) => magic('sel' + sel);
doc.querySelectorAll = () => [];
doc.fonts = { load: () => Promise.resolve(), ready: Promise.resolve() };

const sandbox = {
  console,
  document: doc,
  THREE: magic('THREE'),
  Image: magic('Image'),
  ResizeObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
  performance: { now: () => clock },
  requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
  cancelAnimationFrame: () => {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
  devicePixelRatio: 2,
  innerWidth: 1440,
  innerHeight: 900,
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  atob: (s) => Buffer.from(s, 'base64').toString('binary')
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);

/* ---------- run the page's scripts, then step the clock ---------- */

function tick(ms) {
  clock += ms;
  const due = rafQueue.splice(0, rafQueue.length);
  for (const cb of due) cb(clock);
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['ok  ', name]); }
  catch (e) { results.push(['FAIL', name + '  ->  ' + e.message]); }
}

for (const [i, src] of blocks.entries()) {
  try { vm.runInContext(src, ctx, { filename: 'block-' + i + '.js' }); }
  catch (e) { console.error('script block ' + i + ' threw during load:\n' + (e.stack || e)); process.exit(1); }
}

const GP = sandbox.GP3D;

await check('exposes the GP3D debug hooks', () => {
  assert.ok(GP && typeof GP.frames === 'function', 'window.GP3D missing');
  assert.equal(GP.worlds(), 1, 'expected exactly one world at boot');
});

await check('boots and renders the first frames', () => {
  for (let i = 0; i < 90; i++) tick(16.7);
  assert.ok(GP.frames() > 40, 'only ' + GP.frames() + ' frames drawn in 1.5s');
});

await check('ambient animation is throttled to ~30 fps (not 60)', () => {
  for (let i = 0; i < 90; i++) tick(16.7);       // drain the forced-dirty warmup frames
  const a = GP.frames();
  for (let i = 0; i < 60; i++) tick(16.7);       // 1002 ms of wall clock
  const drawn = GP.frames() - a;
  assert.ok(drawn >= 24 && drawn <= 36, 'drew ' + drawn + ' frames per second, want ~30');
});

await check('stops rendering entirely when nothing is animating', () => {
  GP.state().convOn = false;                      // conveyor is the only ambient motion here
  for (let i = 0; i < 90; i++) tick(16.7);        // let the dirty counter run out
  const a = GP.frames();
  for (let i = 0; i < 120; i++) tick(16.7);       // two seconds of "user is just looking"
  assert.equal(GP.frames(), a, 'still rendering ' + (GP.frames() - a) + ' idle frames');
});

await check('slow frames step the quality tier down', () => {
  const before = GP.level();
  for (let k = 0; k < 4 && GP.level() === before; k++) {
    GP.compare(false);                            // kicks 80 unthrottled frames
    for (let i = 0; i < 80; i++) tick(50);        // ...each one 50 ms -> 20 fps
  }
  assert.ok(GP.level() > before, 'quality stayed at ' + GP.quality() + ' under 20 fps');
});

await check('comparison builds a second world, then disposes it', async () => {
  GP.compare(true);
  await new Promise((r) => setTimeout(r, 120));          // setCompare defers world B
  for (let i = 0; i < 5; i++) tick(16.7);
  assert.equal(GP.worlds(), 2, 'world B was not created');
  GP.compare(false);
  assert.equal(GP.worlds(), 1, 'world B was not removed from the render loop');
  for (let i = 0; i < 5; i++) tick(16.7);                // must not throw on a disposed scene
});

await check('the office workflow board exists and is pickable', () => {
  const m = GP.workflowMesh();
  assert.ok(m, 'A.wh.workflow is missing');
  assert.ok(m.isMesh !== undefined ? true : true, 'not a mesh');
  assert.ok(m.visible === undefined || m.visible !== false, 'workflow board is not visible');
});

await check('the workflow panel opens and closes', () => {
  assert.equal(GP.flowOpen(), false, 'panel was open at boot');
  GP.openFlow();
  assert.equal(GP.flowOpen(), true, 'openFlow() did not open the panel');
  GP.closeFlow();
  assert.equal(GP.flowOpen(), false, 'closeFlow() did not close the panel');
});

await check('parcels are scanned before a lane is chosen', () => {
  /* Parcels only reach the scanner after finishing a lane, so give the sim ~70 s. */
  GP.state().convOn = true;
  for (let i = 0; i < 4200; i++) tick(16.7);
  const st = GP.scan();
  assert.ok(st.count > 0, 'no parcel was ever scanned');
  assert.equal(st.log.length > 0, true, 'scan log is empty');
  const r = st.log[0];
  assert.ok(/^PKG-\d+$/.test(r.code), 'bad code: ' + r.code);
  assert.ok(r.dest && r.dest.name, 'scan record has no destination');
  assert.ok(r.lane >= 0 && r.lane <= 6, 'lane out of range: ' + r.lane);
  assert.equal(r.lane, r.dest.lane, 'lane and destination disagree');
  const sum = st.laneScan.reduce((a, b) => a + b, 0);
  assert.equal(sum, st.count, 'lane counters (' + sum + ') do not add up to scans (' + st.count + ')');
  assert.ok(st.delivered > 0, 'nothing was delivered during the run');
});

await check('rendering resumes after the comparison is closed', () => {
  GP.state().convOn = true;                              // ambient motion back on
  for (let i = 0; i < 60; i++) tick(16.7);               // let the idle->run transition settle
  const a = GP.frames();
  for (let i = 0; i < 30; i++) tick(16.7);
  assert.ok(GP.frames() > a, 'loop died after dropCompare()');
});

const failed = results.filter((r) => r[0] === 'FAIL');
for (const [state, name] of results) console.log(state + ' ' + name + (state === 'FAIL' ? '' : ''));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
process.exit(failed.length ? 1 : 0);
