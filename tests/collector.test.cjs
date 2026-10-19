const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ URL, Date, console });
vm.runInContext(fs.readFileSync('src/collector/core.js', 'utf8'), context);
const C = context.XCollector;
const plain = value => JSON.parse(JSON.stringify(value));
function tweet(id = '100', likes = 3) {
  return { __typename: 'Tweet', rest_id: id, legacy: { full_text: 'hello', created_at: 'Mon Oct 19 10:00:00 +0000 2026', favorite_count: likes, reply_count: 2, retweet_count: 1, quote_count: 0, user_id_str: '9' }, views: { count: '45' }, core: { user_results: { result: { rest_id: '9', legacy: { screen_name: 'writer', name: 'Writer' } } } } };
}
function payload(items) {
  return { data: { user: { result: { timeline_v2: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: items }] } } } } } };
}
function entry(t, extra = {}) { return { entryId: `tweet-${t.rest_id}`, content: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: t }, ...extra } } }; }
function request(handle = 'Alice', tab = 'posts', userId = '1') {
  const operation = tab === 'posts' ? 'UserTweets' : 'UserTweetsAndReplies';
  return C.requestContext(`https://x.com/i/api/graphql/hash/${operation}?variables=${encodeURIComponent(JSON.stringify({userId, cursor:'next'}))}`, `https://x.com/${handle}${tab === 'replies' ? '/with_replies' : ''}`);
}
const time1 = '2026-10-19T10:00:00.000Z', time2 = '2026-10-19T11:00:00.000Z';
test('only profile posts/replies and matching operations are captured', () => {
  assert.equal(request().handle, 'Alice');
  for (const path of ['home', 'explore', 'alice/media', 'alice/status/123', 'alice/following', 'alice/likes']) {
    assert.equal(C.requestContext('https://x.com/i/api/graphql/h/UserTweets?variables=%7B%22userId%22%3A%221%22%7D', `https://x.com/${path}`), null);
  }
  assert.equal(C.requestContext('https://x.com/i/api/graphql/h/UserTweets?variables=%7B%22userId%22%3A%221%22%7D', 'https://x.com/alice/with_replies'), null);
  assert.equal(C.requestContext('https://evil.com/i/api/graphql/h/UserTweets', 'https://x.com/alice'), null);
});
test('extracts timeline items, metadata, long text, relationships, skips ads and cursors', () => {
  const t = tweet();
  t.note_tweet = { note_tweet_results: { result: { text: 'long full text' } } };
  t.legacy.in_reply_to_status_id_str = '50';
  t.quoted_status_result = { result: tweet('99') };
  const data = payload([entry(t), entry(tweet('101'), { promotedMetadata: {} }), { content: { cursorType: 'Bottom', value: 'cursor' } }]);
  const batch = C.parseBatch(request(), data, time1);
  assert.equal(batch.items.length, 1);
  const item = batch.items[0];
  assert.equal(item.text, 'long full text');
  assert.equal(item.author.handle, 'writer');
  assert.equal(item.metrics.likes, 3);
  assert.equal(item.metrics.bookmarks, null);
  assert.equal(item.metrics.views, 45);
  assert.equal(item.relationships.replyToId, '50');
  assert.equal(item.relationships.quoteId, '99');
  assert.equal(item.publishedAt, '2026-10-19T10:00:00.000Z');
  assert.equal(item.raw.rest_id, '100');
});
test('module conversation items preserve context author rather than profile owner', () => {
  const data = payload([{ entryId: 'conversation', content: { items: [{ item: { itemContent: { tweet_results: { result: { __typename: 'TweetWithVisibilityResults', tweet: tweet() } } } } }] } }]);
  const b = C.parseBatch(request('alice', 'replies'), data, time1);
  assert.equal(b.items.length, 1);
  assert.equal(b.owner.id, '1');
  assert.equal(b.items[0].author.id, '9');
  assert.equal(b.tab, 'replies');
});
test('merges pages by tweet ID, updates counts, keeps first time, ignores stale counts', () => {
  let b = C.mergeBucket(null, C.parseBatch(request(), payload([entry(tweet())]), time1));
  b = C.mergeBucket(b, C.parseBatch(request(), payload([entry(tweet('100', 12)), entry(tweet('102'))]), time2));
  assert.equal(Object.keys(b.items).length, 2);
  assert.equal(b.items['100'].firstCapturedAt, time1);
  assert.equal(b.items['100'].lastCapturedAt, time2);
  assert.equal(b.items['100'].metrics.likes, 12);
  b = C.mergeBucket(b, C.parseBatch(request(), payload([entry(tweet('100', 1))]), time1));
  assert.equal(b.items['100'].metrics.likes, 12);
  assert.equal(b.lastCapturedAt, time2);
});
test('user IDs and tabs isolate buckets; account rename keeps identity', () => {
  const a = C.parseBatch(request(), payload([entry(tweet())]), time1);
  const renamed = C.parseBatch(request('renamed'), payload([entry(tweet())]), time2);
  const reply = C.parseBatch(request('Alice','replies'), payload([entry(tweet())]), time1);
  const other = C.parseBatch(request('Bob','posts','2'), payload([entry(tweet())]), time1);
  assert.equal(C.bucketKey(a), C.bucketKey(renamed));
  assert.notEqual(C.bucketKey(a), C.bucketKey(reply));
  assert.notEqual(C.bucketKey(a), C.bucketKey(other));
  assert.equal(C.mergeBucket(C.mergeBucket(null,a),renamed).owner.handle, 'renamed');
});
test('export includes owner/tab/time and filename uses safe owner, tab and local timestamp', () => {
  const b = C.mergeBucket(null, C.parseBatch(request(), payload([entry(tweet())]), time1));
  const exp = C.exportBucket(b, time2);
  assert.equal(exp.count, 1);
  assert.equal(exp.owner.id, '1');
  assert.equal(exp.tab, 'posts');
  assert.equal(exp.exportedAt, time2);
  assert.equal(exp.items[0].id, '100');
  assert.match(C.exportFilename(b, new Date(2026,9,19,18,30,0)), /^Alice_1_posts_20261019_183000\.json$/);
});
test('latest missing metric is null, not a stale value labeled as current', () => {
  const initial = C.mergeBucket(null,C.parseBatch(request(),payload([entry(tweet())]),time1));
  const latest = tweet(); delete latest.views;
  const b = C.mergeBucket(initial,C.parseBatch(request(),payload([entry(latest)]),time2));
  assert.equal(b.items['100'].metrics.views, null);
});
