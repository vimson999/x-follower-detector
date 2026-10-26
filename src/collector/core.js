/* Shared, dependency-free parsing and merge rules (page, worker and popup). */
(() => {
  'use strict';
  const RESERVED = new Set(['home', 'explore', 'search', 'notifications', 'messages', 'i', 'settings', 'compose', 'login', 'logout', 'signup', 'tos', 'privacy', 'intent', 'account']);
  const HOSTS = new Set(['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com', 'api.x.com', 'api.twitter.com']);
  function requestContext(requestUrl, pageUrl, body) {
    try {
      const page = new URL(pageUrl);
      if (!HOSTS.has(page.hostname) || page.protocol !== 'https:') return null;
      const match = page.pathname.match(/^\/([a-zA-Z0-9_]{1,15})(?:\/(with_replies))?\/?$/);
      if (!match || RESERVED.has(match[1].toLowerCase())) return null;
      const url = new URL(requestUrl, pageUrl);
      if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) return null;
      const operation = url.pathname.match(/\/(?:i\/api\/)?graphql\/[^/]+\/(UserTweets|UserOriginalsTimeline|UserTweetsAndReplies|UserRepliesTimeline)$/)?.[1];
      const tab = match[2] ? 'replies' : 'posts';
      if (!(tab === 'posts' ? ['UserTweets', 'UserOriginalsTimeline'] : ['UserTweetsAndReplies', 'UserRepliesTimeline']).includes(operation)) return null;
      const post = typeof body === 'string' ? JSON.parse(body) : body;
      let variables = url.searchParams.get('variables') || post?.variables;
      if (typeof variables === 'string') variables = JSON.parse(variables);
      if (!/^\d+$/.test(variables?.userId || '')) return null;
      return { userId: variables.userId, handle: match[1], tab, operation, cursor: variables.cursor || null, pageUrl: page.href };
    } catch { return null; }
  }
  function unwrap(result) {
    return result?.__typename === 'TweetWithVisibilityResults' ? result.tweet : result;
  }
  function authorOf(tweet) {
    const user = tweet.core?.user_results?.result;
    return { id: user?.rest_id || tweet.legacy?.user_id_str || null,
      handle: user?.core?.screen_name || user?.legacy?.screen_name || null,
      name: user?.core?.name || user?.legacy?.name || null,
      verified: user?.is_blue_verified ?? user?.legacy?.verified ?? null };
  }
  function count(value) {
    return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  }
  function normalize(result, rawItem) {
    const t = unwrap(result);
    if (!t?.rest_id || !t.legacy || !/^\d+$/.test(t.rest_id)) return null;
    const l = t.legacy;
    const author = authorOf(t);
    const published = l.created_at ? new Date(l.created_at) : null;
    return {
      id: t.rest_id, url: `https://x.com/${author.handle || 'i'}/status/${t.rest_id}`,
      author, text: t.note_tweet?.note_tweet_results?.result?.text ?? l.full_text ?? '',
      publishedAt: published && !isNaN(published) ? published.toISOString() : null,
      metrics: { likes: count(l.favorite_count), replies: count(l.reply_count), reposts: count(l.retweet_count), quotes: count(l.quote_count), views: count(t.views?.count), bookmarks: count(l.bookmark_count) },
      relationships: { replyToId: l.in_reply_to_status_id_str || null, replyToUserId: l.in_reply_to_user_id_str || null,
        quoteId: l.quoted_status_id_str || unwrap(t.quoted_status_result?.result)?.rest_id || null,
        repostId: unwrap(l.retweeted_status_result?.result || t.retweeted_status_result?.result)?.rest_id || null,
        conversationId: l.conversation_id_str || null },
      media: (l.extended_entities?.media || l.entities?.media || []).map(m => ({ id: m.id_str || m.media_key || null, type: m.type || null, url: m.media_url_https || m.media_url || null, expandedUrl: m.expanded_url || null, altText: m.ext_alt_text || null, video: m.video_info || null })),
      raw: t, rawItem
    };
  }
  function parseBatch(context, data, capturedAt = new Date().toISOString()) {
    const items = [];
    // Walk only timeline instruction containers, then itemContent; never flatten
    // nested quoted/retweeted tweets into independent timeline records.
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node.promotedMetadata || node.promoted_metadata) return;
      if (node.itemContent) {
        const item = node.itemContent;
        if (!item.promotedMetadata && !item.promoted_metadata) {
          const t = normalize(item.tweet_results?.result, node);
          if (t) items.push(t);
        }
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (!['tweet_results', 'quoted_status_result', 'retweeted_status_result', 'legacy'].includes(key)) visit(value);
      }
    }
    // Restrict to this user's timeline. Ignore other response sections.
    const user = data?.data?.user?.result;
    const timeline = user?.timeline_v2?.timeline || user?.timeline?.timeline || user?.timeline;
    if (timeline?.instructions) visit(timeline.instructions);
    const userHandle = user?.core?.screen_name || user?.legacy?.screen_name;
    return { owner: { id: context.userId, handle: userHandle || context.handle,
        name: user?.core?.name || user?.legacy?.name || null }, tab: context.tab,
      capturedAt, terminated: !!timeline?.instructions?.some(i => i.type === 'TimelineTerminateTimeline' && i.direction === 'Bottom'), source: { operation: context.operation, cursor: context.cursor, pageUrl: context.pageUrl }, items };
  }
  function bucketKey(batch) { return `capture:${batch.owner.id}:${batch.tab}`; }
  function mergeBucket(existing, batch) {
    const b = existing ? JSON.parse(JSON.stringify(existing)) : { schemaVersion: 1, owner: batch.owner, tab: batch.tab, firstCapturedAt: batch.capturedAt, lastCapturedAt: batch.capturedAt, items: {}, pageCount: 0 };
    const newest = batch.capturedAt >= b.lastCapturedAt;
    if (newest) { b.owner = { ...b.owner, ...batch.owner, name: batch.owner.name || b.owner.name }; b.lastCapturedAt = batch.capturedAt; b.lastSource = batch.source; }
    b.firstCapturedAt = batch.capturedAt < b.firstCapturedAt ? batch.capturedAt : b.firstCapturedAt;
    b.pageCount++;
    for (const item of batch.items) {
      const old = b.items[item.id];
      const firstCapturedAt = old && old.firstCapturedAt < batch.capturedAt ? old.firstCapturedAt : batch.capturedAt;
      if (old && old.lastCapturedAt > batch.capturedAt) { old.firstCapturedAt = firstCapturedAt; continue; }
      const metrics = { ...item.metrics };
      b.items[item.id] = { ...item, metrics, firstCapturedAt, lastCapturedAt: batch.capturedAt, source: batch.source };
    }
    return b;
  }
  function exportBucket(bucket, exportedAt = new Date().toISOString()) {
    const items = Object.values(bucket.items).sort((a,b) => (b.publishedAt || '').localeCompare(a.publishedAt || '') || b.id.localeCompare(a.id));
    return { schemaVersion: 1, owner: bucket.owner, tab: bucket.tab, exportedAt,
      firstCapturedAt: bucket.firstCapturedAt, lastCapturedAt: bucket.lastCapturedAt,
      count: items.length, pageCount: bucket.pageCount, items };
  }
  function exportFilename(bucket, date = new Date()) {
    const safe = s => String(s || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    return `${safe(bucket.owner.handle)}_${safe(bucket.owner.id)}_${bucket.tab}_${stamp}.json`;
  }
  globalThis.XCollector = { requestContext, parseBatch, bucketKey, mergeBucket, exportBucket, exportFilename };
})();
