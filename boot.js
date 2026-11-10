// 시작 파일: 앱을 열 때마다 version.json 을 새로 받아서(주소 뒤에 시각을 붙여 중간 서버의 옛 복사본을 피한다),
// 모든 화면 파일(css, js)을 "?v=버전" 이 붙은 주소로 불러온다. 주소가 바뀌니 호스팅이 들고 있던 옛 파일(최대 10분)을 쓰지 않는다.
// 버전을 못 받으면(오프라인·느린 망) 마지막으로 성공한 버전으로, 그것도 없으면 번호 없이 예전 방식으로 연다.
(function () {
  'use strict';
  var KEY = 'svcmon.boot', FAIL = 'svcmon.boot.fail', PLAIN = 'svcmon.boot.plain';
  var w = window, d = document;
  var load = w.__bootImport || function (u) { return import(u); };
  var ls = { get: function (k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { w.localStorage.setItem(k, v); } catch (e) { /* 저장이 막혀 있어도 계속 */ } }, del: function (k) { try { w.localStorage.removeItem(k); } catch (e) { /* */ } } };
  var ss = { get: function (k) { try { return w.sessionStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { w.sessionStorage.setItem(k, v); } catch (e) { /* */ } } };

  function storedInfo() { try { var j = JSON.parse(ls.get(KEY) || 'null'); return j && j.v ? j : null; } catch (e) { return null; } }
  function fetchInfo() {
    var ctl = typeof w.AbortController === 'function' ? new w.AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 4000) : null;
    return w.fetch('./version.json?t=' + Date.now(), { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('version ' + r.status); return r.json(); })
      .then(function (j) { clearTimeout(timer); if (!j || !j.v) throw new Error('no version'); ls.set(KEY, JSON.stringify(j)); return j; })
      .catch(function (e) { clearTimeout(timer); throw e; });
  }
  function canImportMap() { try { return !!(w.HTMLScriptElement && w.HTMLScriptElement.supports && w.HTMLScriptElement.supports('importmap')); } catch (e) { return false; } }

  function start(info) {
    var q = info && info.v ? '?v=' + encodeURIComponent(String(info.v)) : '';
    var link = d.createElement('link'); link.rel = 'stylesheet'; link.href = 'css/app.css' + q; d.head.appendChild(link);
    if (q && info.files && info.files.length && canImportMap()) {
      var base = new URL('./', d.baseURI).href, imports = {};
      info.files.forEach(function (f) { var u = new URL(f, base).href; imports[u] = u + q; });
      var im = d.createElement('script'); im.type = 'importmap'; im.textContent = JSON.stringify({ imports: imports }); d.head.appendChild(im);
    }
    return load('./js/app.js' + q).then(function () { ss.set(FAIL, ''); }).catch(function (e) {
      if (w.console) w.console.error('boot', e);
      if (!ss.get(FAIL)) { ss.set(FAIL, '1'); ss.set(PLAIN, '1'); ls.del(KEY); w.location.reload(); return; }   // 한 번은 번호 없이 예전 방식으로 다시 시도
      var app = d.getElementById('app'); if (app) app.textContent = '앱을 불러오지 못했어요. 새로고침해 주세요.';
    });
  }

  w.__booted = ss.get(PLAIN) === '1' ? start(null) : fetchInfo().catch(function () { return storedInfo(); }).then(start);   // (__booted: 테스트에서 끝나기를 기다리는 용도)
})();
