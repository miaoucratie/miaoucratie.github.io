/* Justification des paragraphes */
(function () {
  'use strict';
  var WS = [0, -0.5, -1, -1.5, -2, -2.5, -3, -3.5, -4];
  var LS = [0, -0.1, 0.1];

  function measure(p) {
    var words = [];
    var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    var node, re = /\S+/g, m, r, rects;
    while ((node = walker.nextNode())) {
      re.lastIndex = 0;
      while ((m = re.exec(node.nodeValue))) {
        r = document.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        rects = r.getClientRects();
        if (!rects.length) continue;
        words.push({ l: rects[0].left, r: rects[rects.length - 1].right, top: Math.round(rects[0].top) });
      }
    }
    var lines = [], cur = [];
    words.forEach(function (w) {
      if (cur.length && w.top > cur[cur.length - 1].top + 4) { lines.push(cur); cur = []; }
      cur.push(w);
    });
    if (cur.length) lines.push(cur);
    var max = 0, min = 99;
    for (var i = 0; i < lines.length; i++) {
      for (var j = 1; j < lines[i].length; j++) {
        var g = lines[i][j].l - lines[i][j - 1].r;
        if (i < lines.length - 1 && g > max) max = g;
        if (g < min) min = g;
      }
    }
    return { max: max, min: min, lines: lines.length, last: lines.length ? lines[lines.length - 1].length : 0 };
  }

  /* Meilleur interstice */
  function search(p, LSX, start) {
    var best = start, bw = '', bl = '';
    for (var i = 0; i < WS.length; i++) {
      for (var k = 0; k < LSX.length; k++) {
        if (!WS[i] && !LSX[k]) continue;
        p.style.wordSpacing = WS[i] + 'px';
        p.style.letterSpacing = LSX[k] + 'px';
        var sc = score(measure(p)) + Math.abs(LSX[k]) * 8;
        if (sc < best) { best = sc; bw = WS[i] ? WS[i] + 'px' : ''; bl = LSX[k] ? LSX[k] + 'px' : ''; }
      }
    }
    return { score: best, ws: bw, ls: bl };
  }

  function tune(p) {
    var LSX = window.innerWidth <= 480 ? [0, -0.1, 0.1, -0.2, 0.2, 0.3, 0.4] : LS;
    p.style.wordSpacing = '';
    p.style.letterSpacing = '';
    var first = measure(p);
    if (first.lines < 2) return;
    var res = search(p, LSX, score(first));
    p.style.wordSpacing = res.ws;
    p.style.letterSpacing = res.ls;
    /* Repli à gauche */
    if (measure(p).max > 14) {
      p.style.wordSpacing = '';
      p.style.letterSpacing = '';
      p.style.textAlign = 'left';
    }
  }

  function score(m) {
    var s = m.max;
    if (m.min < 3.4) s += 80;       /* Mots collés */
    if (m.last < 2 && m.lines > 1) s += 60; /* Dernier mot seul */
    return s;
  }

  function run() {
    var list = document.querySelectorAll('.mm p');
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      p.style.textAlign = '';
      if (getComputedStyle(p).textAlign !== 'justify' || !p.offsetParent) continue;
      tune(p);
    }
  }

  var timer, lastW = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      run();
    }, 160);
  }
  function start() { lastW = window.innerWidth; run(); }
  window.addEventListener('resize', schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else window.addEventListener('load', start);
})();
