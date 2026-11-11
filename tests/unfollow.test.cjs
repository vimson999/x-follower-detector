const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function run(action, followsYou = false, unfollowWhitelist = undefined) {
  let clicks = 0;
  const badges = [];
  const store = {};
  const cellClasses = new Set();
  const cell = {
    style: {}, scrollIntoView() {},
    classList: {add: c => cellClasses.add(c), remove: c => cellClasses.delete(c), contains: c => cellClasses.has(c)},
    appendChild(b) { badges.push(b); },
    querySelector(s) {
      if (s === 'a[href^="/"]') return {getAttribute: () => '/alice'};
      if (s.includes('userFollowIndicator')) return followsYou ? {} : null;
      if (s.includes('-unfollow')) return {click() {clicks++;}};
      if (s === '.xf-badge-bye') return badges[0] || null;
      return null;
    }
  };
  const context = {
    URL,
    console: {log() {}, error() {}}, setTimeout: fn => {fn();}, alert() {},
    document: {
      title: 'Following',
      createElement: () => {
        const listeners = {};
        const classes = new Set();
        return {
          classList: {add: c => classes.add(c), contains: c => classes.has(c)},
          addEventListener: (k, fn) => { listeners[k] = fn; },
          triggerClick: () => listeners.click?.({preventDefault() {}, stopPropagation() {}})
        };
      },
      querySelectorAll: s => s.includes('UserCell') ? [cell] : [],
      querySelector: s => s.includes('confirmationSheetConfirm') ? {click() {clicks++;}} : null
    },
    chrome: {runtime: {sendMessage() {}, onMessage: {addListener() {}}},
      storage: {local: {get: async () => structuredClone(store), set: async o => Object.assign(store, structuredClone(o))}}}
  };
  context.window = {location: {pathname: '/me/following', href: 'https://x.com/me/following'},
    getComputedStyle: () => ({position: 'relative'}), scrollBy() {}};
  vm.runInNewContext(fs.readFileSync('src/content/content.js','utf8'), context);
  const engine = context.window.XFollowEngine;
  engine.mode = 'UNFOLLOW';
  engine.config = {unfollowAction: action, unfollowWhitelist, minInterval: 0, maxInterval: 0, batchSize: 999, restTime: 0};
  engine.isRunning = true;
  // Remove the rendered row on the next scan, as X does after a successful unfollow.
  let scans = 0;
  context.document.querySelectorAll = s => s.includes('UserCell') && scans++ === 0 ? [cell] : [];
  await engine.loop();
  return {clicks, badges, cell, stats: engine.stats, store};
}

test('default and explicit mark modes label candidates without any clicks', async () => {
  for (const action of [undefined, 'MARK', 'unknown']) {
    const result = await run(action);
    assert.equal(result.clicks, 0);
    assert.equal(result.badges[0]?.innerText, '疑似未回关');
    assert.equal(result.cell.style.border, '2px solid #ff3b5c');
    assert.ok(result.cell.classList.contains('xf-target-unfollow'));
    assert.equal(result.stats.followed, 1);
  }
});
test('auto mode still executes unfollow and confirmation', async () => {
  assert.equal((await run('AUTO')).clicks, 2);
});
test('both modes preserve users showing follows-you indicator', async () => {
  for (const action of ['MARK','AUTO']) {
    const result = await run(action, true);
    assert.equal(result.clicks, 0);
    assert.equal(result.badges.length, 0);
    assert.equal(result.stats.skipped, 1);
  }
});
test('whitelist preserves users in both mark and auto modes across handle and URL formats', async () => {
  for (const action of ['MARK', 'AUTO']) {
    for (const raw of ['Alice', '@ALICE', 'https://x.com/Alice?s=20', ['bob', '@Alice']]) {
      const result = await run(action, false, raw);
      assert.equal(result.clicks, 0);
      assert.equal(result.badges.length, 0);
      assert.equal(result.stats.followed, 0);
      assert.equal(result.stats.skipped, 1);
    }
  }
});
test('clicking the marked badge adds user to persistent whitelist', async () => {
  const result = await run('MARK');
  assert.equal(result.badges[0].innerText, '疑似未回关');
  assert.equal(result.cell.style.border, '2px solid #ff3b5c');
  result.badges[0].triggerClick();
  await new Promise(r => setImmediate(r));
  assert.equal(result.badges[0].innerText, '已加白名单');
  assert.equal(result.cell.style.border, '2px solid #00ba7c');
  assert.ok(result.cell.classList.contains('xf-target-safe'));
  assert.deepEqual(result.store.settings.unfollowWhitelist, ['@alice']);
});

test('many consecutive screens of mutual followers do not trigger premature finish before reaching later candidates', async () => {
  const badges = [];
  const makeCell = (handle, followsYou) => ({
    style: {}, scrollIntoView() {},
    classList: {add() {}, remove() {}, contains() { return false; }},
    appendChild(b) { badges.push({handle, badge: b}); },
    querySelector(s) {
      if (s === 'a[href^="/"]') return {getAttribute: () => `/${handle}`};
      if (s.includes('userFollowIndicator')) return followsYou ? {} : null;
      return null;
    }
  });
  const screens = [
    ...Array.from({length: 12}, (_, i) => [makeCell(`mutual_${i}`, true)]),
    [makeCell('target_after_12_screens', false)]
  ];
  let scanIdx = 0;
  const context = {
    URL,
    console: {log() {}, error() {}}, setTimeout: fn => {fn();}, alert() {},
    document: {
      title: 'Following',
      createElement: () => ({classList: {add() {}, contains() { return false; }}, addEventListener() {}}),
      querySelectorAll: s => s.includes('UserCell') ? (screens[scanIdx++] || []) : [],
      querySelector: () => null
    },
    chrome: {runtime: {sendMessage() {}, onMessage: {addListener() {}}},
      storage: {local: {get: async () => ({}), set: async () => {}}}}
  };
  context.window = {location: {pathname: '/me/following', href: 'https://x.com/me/following'},
    getComputedStyle: () => ({position: 'relative'}), scrollBy() {}};
  vm.runInNewContext(fs.readFileSync('src/content/content.js','utf8'), context);
  const engine = context.window.XFollowEngine;
  engine.mode = 'UNFOLLOW';
  engine.config = {unfollowAction: 'MARK', minInterval: 0, maxInterval: 0, batchSize: 999, restTime: 0};
  engine.isRunning = true;
  await engine.loop();
  assert.equal(engine.stats.skipped, 12);
  assert.equal(engine.stats.followed, 1);
  assert.equal(badges.length, 1);
  assert.equal(badges[0].handle, 'target_after_12_screens');
});
