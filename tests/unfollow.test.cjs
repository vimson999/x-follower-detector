const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

async function run(action, followsYou = false) {
  let clicks = 0;
  const badges = [];
  const cell = {
    style: {}, scrollIntoView() {},
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
    console: {log() {}, error() {}}, setTimeout: fn => {fn();}, alert() {},
    document: {
      title: 'Following', createElement: () => ({}),
      querySelectorAll: s => s.includes('UserCell') ? [cell] : [],
      querySelector: s => s.includes('confirmationSheetConfirm') ? {click() {clicks++;}} : null
    },
    chrome: {runtime: {sendMessage() {}, onMessage: {addListener() {}}},
      storage: {local: {get: async () => ({}), set: async () => {}}}}
  };
  context.window = {location: {pathname: '/me/following', href: 'https://x.com/me/following'},
    getComputedStyle: () => ({position: 'relative'}), scrollBy() {}};
  vm.runInNewContext(fs.readFileSync('src/content/content.js','utf8'), context);
  const engine = context.window.XFollowEngine;
  engine.mode = 'UNFOLLOW';
  engine.config = {unfollowAction: action, minInterval: 0, maxInterval: 0, batchSize: 999, restTime: 0};
  engine.isRunning = true;
  // Remove the rendered row on the next scan, as X does after a successful unfollow.
  let scans = 0;
  context.document.querySelectorAll = s => s.includes('UserCell') && scans++ === 0 ? [cell] : [];
  await engine.loop();
  return {clicks, badges, stats: engine.stats};
}

test('default and explicit mark modes label candidates without any clicks', async () => {
  for (const action of [undefined, 'MARK', 'unknown']) {
    const result = await run(action);
    assert.equal(result.clicks, 0);
    assert.equal(result.badges[0]?.innerText, '疑似未回关');
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
