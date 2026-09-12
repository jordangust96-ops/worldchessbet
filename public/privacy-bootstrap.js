/* Runs before platform-injected scripts. Keep this synchronous. */
(function () {
  var KEY = "chessbet_cookie_preferences_v1", VERSION = 1, TTL = 180 * 86400000;
  var memory = null;
  var publicPaths = ["/", "/about", "/faq", "/blog", "/fair-play-integrity", "/privacy-policy", "/terms-of-service", "/official-rules"];
  function gpc() { return navigator.globalPrivacyControl === true; }
  function read() {
    var p = memory;
    try { var raw = localStorage.getItem(KEY); if (raw !== null) p = JSON.parse(raw); } catch (_) {}
    if (!p || p.version !== VERSION || typeof p.savedAt !== "number" || p.savedAt > Date.now() || Date.now() - p.savedAt >= TTL || typeof p.analytics !== "boolean" || typeof p.marketing !== "boolean") return null;
    return p;
  }
  function choice() {
    var p = read();
    return { decided: !!p, analytics: !!p && p.analytics && !gpc(), marketing: !!p && p.marketing && !gpc(), gpc: gpc() };
  }
  function publicPage() {
    try {
      if (localStorage.getItem("base44_access_token") || localStorage.getItem("token")) return false;
    } catch (_) { return false; }
    return publicPaths.indexOf(location.pathname.toLowerCase().replace(/\/$/, "") || "/") >= 0;
  }
  function allowed(category) { return publicPage() && choice()[category] === true; }
  function clean() {
    var c = { analytics: allowed("analytics"), marketing: allowed("marketing") };
    var blocked = function(k) {
      return /^ph_|^base44_analytics_|^lastExternalReferrer/.test(k) ||
        (!c.analytics && /^_ga(?:_|$)|^_gid$|^_gat/.test(k)) ||
        (!c.marketing && /^_fbp$|^_fbc$/.test(k));
    };
    ["localStorage", "sessionStorage"].forEach(function(name) {
      try { var s = window[name]; Object.keys(s).forEach(function(k) { if (blocked(k) || k === "chessbet_pending_oauth_login") s.removeItem(k); }); } catch (_) {}
    });
    document.cookie.split(";").forEach(function(part) {
      var k = part.split("=")[0].trim();
      if (!blocked(k)) return;
      var parts = location.hostname.split(".");
      var domains = ["", location.hostname, "." + location.hostname];
      for (var i = 1; i < parts.length - 1; i++) domains.push("." + parts.slice(i).join("."));
      domains.forEach(function(d) { document.cookie = k + "=; Max-Age=0; path=/; SameSite=Lax" + (d ? "; domain=" + d : ""); });
    });
  }
  function save(p) {
    memory = { version: VERSION, savedAt: Date.now(), analytics: p.analytics === true && !gpc(), marketing: p.marketing === true && !gpc() };
    var persisted = true;
    try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch (_) { persisted = false; }
    window["ga-disable-G-JLHMN26FS2"] = !allowed("analytics");
    if (!allowed("marketing") && typeof window.fbq === "function") window.fbq("consent", "revoke");
    clean();
    window.dispatchEvent(new Event("chessbet:privacy-change"));
    return persisted;
  }
  function blockedUrl(input) {
    try {
      var u = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href);
      if (u.origin === location.origin && (/^\/api\/runtime\/session-recordings\//.test(u.pathname) || /^\/api\/app-logs\/[^/]+\/log-user-in-app\//.test(u.pathname) || /^\/api\/apps\/[^/]+\/analytics\//.test(u.pathname))) return true;
      if (/(^|\.)heycatch\.(ai|com)$/.test(u.hostname)) return true;
      if (/(^|\.)(google-analytics\.com|googletagmanager\.com)$/.test(u.hostname)) return !allowed("analytics");
      if (/(^|\.)(facebook\.com|facebook\.net)$/.test(u.hostname)) return !allowed("marketing");
    } catch (_) {}
    return false;
  }
  var originalFetch = window.fetch.bind(window);
  window.fetch = function(input, init) { return blockedUrl(input) ? Promise.resolve(new Response(null, { status: 204 })) : originalFetch(input, init); };
  var originalBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  if (originalBeacon) navigator.sendBeacon = function(url, body) { return blockedUrl(url) ? true : originalBeacon(url, body); };
  var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) { this.__chessbetPrivacyUrl = url; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function() { if (blockedUrl(this.__chessbetPrivacyUrl)) { this.abort(); return; } return send.apply(this, arguments); };
  // Unload third-party libraries before they can observe a different route.
  ["pushState", "replaceState"].forEach(function(method) {
    var original = history[method].bind(history);
    history[method] = function(state, title, url) {
      if (url != null && window.__chessbetTrackingLoaded) {
        var target = new URL(String(url), location.href);
        if (target.origin === location.origin && target.href !== location.href) {
          if (method === "replaceState") location.replace(target.href); else location.assign(target.href);
          return;
        }
      }
      return original(state, title, url);
    };
  });
  window.ChessBetPrivacy = { read: read, choice: choice, allowed: allowed, publicPage: publicPage, save: save, clean: clean };
  window.addEventListener("storage", function(e) {
    if (e.key === KEY || e.key === null) { clean(); location.reload(); }
  });
  window.addEventListener("focus", function() {
    if (gpc() && window.__chessbetTrackingLoaded) { save({analytics:false,marketing:false}); location.reload(); }
  });
  clean();
})();