/**
 * 隔离沙盒的静态启动页。
 *
 * - iframe 仅开启 allow-scripts、不开启 allow-same-origin，因此是独立不透明源，
 *   无法访问主应用的 DOM、React 状态、同源存储与 Cookie。
 * - CSP 禁止一切网络请求，生成代码需要 eval 才能编译，所以只放行 inline/eval 脚本。
 * - 生成代码通过 new Function 注入，并把常用浏览器全局对象遮蔽为 undefined。
 */
export const SANDBOX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'">
<style>
html, body { margin: 0; height: 100%; overflow: hidden; background: #FBF7EF; }
canvas { display: block; width: 100%; height: 100%; background: #FBF7EF; }
</style>
</head>
<body>
<canvas id="view"></canvas>
<script>
(function () {
  'use strict';

  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d');
  var token = null;
  var model = null;
  var state;
  var params = {};
  var speed = 1;
  var playing = false;
  var errored = false;
  var destroyed = false;
  var frame = null;
  var last = null;
  var acc = 0;
  var fixed = 1 / 120;
  var viewport = { width: 1, height: 1 };
  var dpr = 1;

  function post(message) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, '*');
    }
  }

  function describe(error) {
    if (error && typeof error.message === 'string') return error.message;
    return String(error);
  }

  function cancelFrame() {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  }

  function fail(scope, error) {
    errored = true;
    playing = false;
    cancelFrame();
    post({ type: 'error', token: token, scope: scope, message: describe(error) });
    post({ type: 'status', token: token, status: 'error' });
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(1, Math.round(rect.width || window.innerWidth || 1));
    var height = Math.max(1, Math.round(rect.height || window.innerHeight || 1));
    dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    var pixelWidth = Math.round(width * dpr);
    var pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    viewport = { width: width, height: height };
  }

  function render(first) {
    if (!ctx || !model || errored) return;
    try {
      ctx.clearRect(0, 0, viewport.width, viewport.height);
      model.draw(ctx, state, params, viewport);
    } catch (error) {
      fail(first ? 'first-frame' : 'draw', error);
    }
  }

  function schedule() {
    if (playing && !destroyed && !errored && model && frame === null) {
      frame = requestAnimationFrame(onFrame);
    }
  }

  function onFrame(timestamp) {
    frame = null;
    if (!playing || destroyed || errored || !model) return;

    var delta = last === null ? 0 : (timestamp - last) / 1000;
    last = timestamp;
    if (!isFinite(delta) || delta < 0) delta = 0;
    delta = Math.min(delta, 0.1);
    acc += delta * speed;

    var executed = 0;
    try {
      while (acc >= fixed && executed < 24) {
        state = model.step(state, params, fixed);
        acc -= fixed;
        executed += 1;
      }
    } catch (error) {
      fail('step', error);
      return;
    }
    if (executed >= 24) acc = 0;

    render();
    if (!errored) schedule();
  }

  function compile(code) {
    var factory = new Function(
      'window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames',
      'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
      'localStorage', 'sessionStorage', 'indexedDB',
      'navigator', 'location', 'history', 'opener', 'React',
      '"use strict";\\n' + code
    );
    return factory.call(undefined);
  }

  function initWith(message) {
    cancelFrame();
    destroyed = false;
    errored = false;
    playing = false;
    model = null;
    token = message.token;
    params = message.params && typeof message.params === 'object' ? message.params : {};
    speed = typeof message.speed === 'number' && isFinite(message.speed)
      ? Math.min(4, Math.max(0.25, message.speed))
      : 1;

    try {
      var candidate = compile(String(message.code || ''));
      if (
        !candidate ||
        typeof candidate.createState !== 'function' ||
        typeof candidate.step !== 'function' ||
        typeof candidate.draw !== 'function'
      ) {
        throw new Error('生成的仿真逻辑缺少 createState / step / draw');
      }
      model = candidate;
      resize();
      state = model.createState(params);
      render(true);
      if (errored) return;
      playing = message.playing !== false;
      post({ type: 'status', token: token, status: playing ? 'running' : 'paused' });
      schedule();
    } catch (error) {
      model = null;
      fail('init', error);
    }
  }

  function stepOnce() {
    if (!model || errored) return;
    playing = false;
    cancelFrame();
    try {
      state = model.step(state, params, fixed);
      render();
      if (!errored) post({ type: 'status', token: token, status: 'paused' });
    } catch (error) {
      fail('step', error);
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'ping') {
      post({ type: 'ready' });
      return;
    }
    if (data.type === 'init') {
      initWith(data);
      return;
    }
    if (token === null || data.token !== token) return;

    if (data.type === 'params' && data.params && typeof data.params === 'object') {
      params = data.params;
      if (!playing) render();
      return;
    }
    if (data.type === 'speed') {
      if (typeof data.speed === 'number' && isFinite(data.speed)) {
        speed = Math.min(4, Math.max(0.25, data.speed));
      }
      return;
    }
    if (data.type === 'play') {
      if (errored || !model) return;
      playing = true;
      last = null;
      acc = 0;
      post({ type: 'status', token: token, status: 'running' });
      schedule();
      return;
    }
    if (data.type === 'pause') {
      playing = false;
      cancelFrame();
      if (!errored) post({ type: 'status', token: token, status: 'paused' });
      return;
    }
    if (data.type === 'step') {
      stepOnce();
      return;
    }
    if (data.type === 'reset') {
      if (!model || errored) return;
      playing = false;
      cancelFrame();
      try {
        state = model.createState(params);
        render();
        if (!errored) post({ type: 'status', token: token, status: 'paused' });
      } catch (error) {
        fail('init', error);
      }
      return;
    }
    if (data.type === 'destroy') {
      destroyed = true;
      playing = false;
      cancelFrame();
      model = null;
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () {
      if (!model) return;
      resize();
      render();
    }).observe(canvas);
  }
})();
</script>
</body>
</html>`
