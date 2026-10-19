/* MAIN world: observe existing requests only; never issue API requests. */
(() => {
  'use strict';
  if (window.__xFollowCaptureNetwork) return;
  window.__xFollowCaptureNetwork = true;
  const channel = 'X_FOLLOW_CAPTURE_V1';
  const C = globalThis.XCollector;
  let ready = false;
  let session = null;
  const pending = [];
  const emit = message => {
    if (ready) window.postMessage(message, location.origin);
    else pending.push(message);
  };
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel) return;
    if (event.data.type === 'CONTROL') {session=event.data.session || null;return;}
    if (event.data.type !== 'READY') return;
    ready = true;
    while (pending.length) window.postMessage(pending.shift(), location.origin);
  });
  const routeChanged = () => {session=null;window.postMessage({channel,type:'ROUTE_CHANGED'},location.origin);};
  if (window.history) for (const name of ['pushState','replaceState']) {
    const original=history[name];
    history[name]=function(...args) {const before=location.href;const result=original.apply(this,args);if (before !== location.href) routeChanged();return result;};
  }
  window.addEventListener('popstate',routeChanged);
  // BFCache restores the same JS heap; explicitly leave its capture gate off.
  window.addEventListener('pagehide',routeChanged);
  window.addEventListener('pageshow',event=>{if(event.persisted) routeChanged();});
  const allowed = context => session && context && session.handle.toLowerCase() === context.handle.toLowerCase() && session.tab === context.tab;
  window.postMessage({ channel, type: 'HELLO' }, location.origin);
  const publish = (context,data,capturedAt,token) => {if (session?.token === token) emit({channel,type:'RESPONSE',context,data,capturedAt,captureToken:token});};
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const [input, init] = args;
    const pageUrl = location.href;
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const token = session?.token;
    let context = token && C.requestContext(url, pageUrl, init?.body);
    let contextPromise = null;
    // Clone before fetch consumes a Request body; never consume the original.
    if (token && !context && init?.body === undefined && input?.method === 'POST' && typeof input.clone === 'function') {
      try { contextPromise = input.clone().text().then(body => C.requestContext(url, pageUrl, body)).catch(() => null); } catch { /* Body already consumed. */ }
    }
    const responsePromise = originalFetch.apply(this, args);
    if (context || contextPromise) responsePromise.then(response => {
      if (!response.ok || session?.token !== token) return;
      const capturedAt = new Date().toISOString();
      // Clone immediately: the host page may consume its response at once.
      const copy = response.clone();
      Promise.resolve(context || contextPromise).then(c => {
        if (allowed(c) && session?.token === token) return copy.json().then(data => publish(c,data,capturedAt,token));
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
    const token = session?.token;
    const context = token && request && C.requestContext(request.url, location.href, body);
    if (allowed(context)) this.addEventListener('load', () => {
      if (session?.token !== token || requests.get(this) !== request) return; // Aborted/reopened XHR.
      if (this.status < 200 || this.status >= 300) return;
      try {
        const data = this.responseType === 'json' ? this.response : (!this.responseType || this.responseType === 'text') ? JSON.parse(this.responseText) : null;
        if (data) publish(context,data,new Date().toISOString(),token);
      } catch { /* Non-JSON responses do not affect the host page. */ }
    }, { once: true });
    return send.call(this, body);
  };
})();
