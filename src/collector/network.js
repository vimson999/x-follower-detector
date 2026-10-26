/* MAIN world: observe existing requests only; never issue API requests. */
(() => {
  'use strict';
  if (window.__xFollowCaptureNetwork) return;
  window.__xFollowCaptureNetwork = true;
  const channel = 'X_FOLLOW_CAPTURE_V1';
  const C = globalThis.XCollector;
  let ready = false;
  let session = null;
  let initializing = true;
  let resolveStartup;
  const startup = new Promise(resolve => {resolveStartup=resolve;});
  const initialize = value => {if(initializing) {initializing=false;resolveStartup(value?.token);}};
  const requestToken = () => initializing ? startup : Promise.resolve(session?.token);
  const pending = [];
  const emit = message => {
    if (ready) window.postMessage(message, location.origin);
    else pending.push(message);
  };
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel) return;
    if (event.data.type === 'CONTROL') {session=event.data.session || null;initialize(session);return;}
    if (event.data.type !== 'READY') return;
    ready = true;
    while (pending.length) window.postMessage(pending.shift(), location.origin);
  });
  const routeChanged = () => {
    const p = C.requestContext('https://x.com/i/api/graphql/capture/UserTweets?variables=%7B%22userId%22%3A%220%22%7D',location.href)
      || C.requestContext('https://x.com/i/api/graphql/capture/UserTweetsAndReplies?variables=%7B%22userId%22%3A%220%22%7D',location.href);
    if (!p || !session || p.handle.toLowerCase() !== session.handle.toLowerCase()) session=null;
    window.postMessage({channel,type:'ROUTE_CHANGED'},location.origin);
  };
  if (window.history) for (const name of ['pushState','replaceState']) {
    const original=history[name];
    history[name]=function(...args) {const before=location.href;const result=original.apply(this,args);if (before !== location.href) routeChanged();return result;};
  }
  window.addEventListener('popstate',routeChanged);
  // BFCache restores the same JS heap; explicitly leave its capture gate off.
  window.addEventListener('pagehide',()=>{initialize(null);session=null;routeChanged();});
  window.addEventListener('pageshow',event=>{if(event.persisted) {session=null;routeChanged();}});
  const allowed = context => session && context && session.handle.toLowerCase() === context.handle.toLowerCase();
  window.postMessage({ channel, type: 'HELLO' }, location.origin);
  const publish = (context,data,capturedAt,token) => {if (session?.token === token) emit({channel,type:'RESPONSE',context,data,capturedAt,captureToken:token});};
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const [input, init] = args;
    const pageUrl = location.href;
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const tokenPromise = requestToken();
    const observing = initializing || !!session;
    let context = observing && C.requestContext(url, pageUrl, init?.body);
    let contextPromise = null;
    // Clone before fetch consumes a Request body; never consume the original.
    if (observing && !context && init?.body === undefined && input?.method === 'POST' && typeof input.clone === 'function') {
      try { contextPromise = input.clone().text().then(body => C.requestContext(url, pageUrl, body)).catch(() => null); } catch { /* Body already consumed. */ }
    }
    const responsePromise = originalFetch.apply(this, args);
    if (context || contextPromise) responsePromise.then(response => {
      const capturedAt = new Date().toISOString();
      // Clone immediately: the host page may consume its response at once.
      const copy = response.clone();
      Promise.all([context || contextPromise,tokenPromise]).then(([c,token]) => {
        if (token && allowed(c) && session?.token === token) {
          if (!response.ok) return publish(c,{httpStatus:response.status,errors:[{message:`时间线请求失败：HTTP ${response.status}`}]},capturedAt,token);
          return copy.json().then(data => publish(c,data,capturedAt,token), error => publish(c,{errors:[{message:`时间线响应不是有效 JSON：${error.message}`}]},capturedAt,token));
        }
      }).catch(() => {});
    }).catch(() => {});
    return responsePromise;
  };
  const proto = XMLHttpRequest.prototype;
  const open = proto.open, send = proto.send;
  const requests = new WeakMap();
  proto.open = function (method, url, ...args) {
    requests.set(this, { url: String(url) });
    return open.call(this, method, url, ...args);
  };
  proto.send = function (body) {
    const request = requests.get(this);
    const tokenPromise = requestToken();
    const observing = initializing || !!session;
    const context = observing && request && C.requestContext(request.url, location.href, body);
    if (context) this.addEventListener('load', () => {
      if (requests.get(this) !== request) return; // Aborted/reopened XHR.
      const capturedAt = new Date().toISOString();
      const deliver = data => tokenPromise.then(token=>{if(token && allowed(context)) publish(context,data,capturedAt,token);});
      if (this.status < 200 || this.status >= 300) {deliver({httpStatus:this.status,errors:[{message:`时间线请求失败：HTTP ${this.status}`}]});return;}
      try {
        const data = this.responseType === 'json' ? this.response : (!this.responseType || this.responseType === 'text') ? JSON.parse(this.responseText) : null;
        if (data) deliver(data);
      } catch { /* Non-JSON responses do not affect the host page. */ }
    }, { once: true });
    return send.call(this, body);
  };
})();
