const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function background(reduced = false, hidden = false) {
  const pending = new Map(), events = {}, listeners = {};
  let next = 0, draws = 0;
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, { get: (_, name) => name === 'drawImage' ? () => draws++ :
    String(name).startsWith('create') ? () => gradient : () => {} });
  const canvas = { getContext: () => ctx };
  const media = { matches: reduced, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const document = { hidden, getElementById: () => canvas, createElement: () => ({ getContext: () => ctx }),
    addEventListener: (name, fn) => { events[name] = fn; } };
  const window = { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    matchMedia: query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; },
    addEventListener: (name, fn) => { events[name] = fn; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/space.js'), 'utf8'), {
    window, document, requestAnimationFrame: fn => { pending.set(++next, fn); return next; },
    cancelAnimationFrame: id => pending.delete(id),
  });
  return { pending, draws: () => draws,
    tick(time = 100) { const [id, fn] = pending.entries().next().value; pending.delete(id); fn(time); },
    motion(value) { media.matches = value; listeners.change(); },
    visible(value) { document.hidden = !value; events.visibilitychange(); },
    resize() { events.resize(); },
  };
}

test('reduced motion paints once without scheduling an animation loop', () => {
  const a = background(true);
  assert.equal(a.draws(), 1);
  assert.equal(a.pending.size, 0);
});

test('normal motion continues animating', () => {
  const a = background();
  assert.equal(a.pending.size, 1);
  a.tick();
  assert.equal(a.draws(), 1);
  assert.equal(a.pending.size, 1);
});

test('live preference changes stop the loop and can resume exactly one loop', () => {
  const a = background();
  a.tick();
  a.motion(true);
  assert.equal(a.pending.size, 0);
  assert.equal(a.draws(), 2);
  a.motion(false);
  a.motion(false);
  assert.equal(a.pending.size, 1);
});

test('visibility and resizing preserve a static reduced-motion background', () => {
  const a = background(true);
  a.visible(false);
  a.resize();
  assert.equal(a.draws(), 1);
  a.visible(true);
  a.resize();
  assert.equal(a.draws(), 3);
  assert.equal(a.pending.size, 0);
});

test('a hidden page does not begin a loop and resumes on becoming visible', () => {
  const a = background(false, true);
  assert.equal(a.pending.size, 0);
  a.visible(true);
  a.visible(true);
  assert.equal(a.pending.size, 1);
  a.tick();
  a.visible(false);
  assert.equal(a.pending.size, 0);
});
