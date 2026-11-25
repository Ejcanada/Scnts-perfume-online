// fx.js - visual effects only. Safe to delete: the site works the same without it.
// Live background (gold dust + petals + cursor sparkles), intro splash, hero slideshow,
// scroll reveal, glow that follows the mouse, ripples, scroll progress bar.
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  function $(s, r) { return (r || document).querySelector(s); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---------- intro splash (once per visit) ----------
  function splash() {
    if (reduce) return;
    try { if (sessionStorage.getItem("scnts_splash")) return; sessionStorage.setItem("scnts_splash", "1"); } catch (e) {}
    var s = document.createElement("div");
    s.className = "splash";
    s.innerHTML = '<div class="splash-inner"><div class="splash-emblem"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" pathLength="1"/></svg>' +
      '<img src="images/logo-circle.png" alt=""></div><p>Elevate your confidence</p></div>';
    document.body.appendChild(s);
    setTimeout(function () { s.classList.add("out"); }, 2100);
    setTimeout(function () { s.remove(); }, 3100);
  }

  // ---------- live background ----------
  function liveBg() {
    var wrap = document.createElement("div");
    wrap.className = "live-bg";
    wrap.innerHTML = '<i class="mist m1"></i><i class="mist m2"></i><i class="mist m3"></i><canvas></canvas>';
    document.body.insertBefore(wrap, document.body.firstChild);
    if (reduce) return;

    var cv = wrap.querySelector("canvas"), cx = cv.getContext("2d");
    var W, H, dpr = Math.min(window.devicePixelRatio || 1, 2);
    function size() { W = window.innerWidth; H = window.innerHeight; cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size();
    window.addEventListener("resize", size);

    // glowing gold dot, drawn once and stamped many times
    var spr = document.createElement("canvas"); spr.width = spr.height = 64;
    var sc = spr.getContext("2d"), g = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,245,200,1)"); g.addColorStop(.25, "rgba(255,214,120,.85)"); g.addColorStop(1, "rgba(232,184,75,0)");
    sc.fillStyle = g; sc.fillRect(0, 0, 64, 64);

    var small = W < 640;
    var dust = [], petals = [], trail = [];
    var nDust = Math.round(Math.min(90, Math.max(28, W * H / 17000)) * (small ? .55 : 1));
    var nPetal = small ? 6 : 13;
    function mkDust(init) { return { x: rand(0, W), y: init ? rand(0, H) : H + 12, s: rand(5, 15), vy: -rand(.08, .32), vx: rand(-.12, .12), ph: rand(0, 6.28), tw: rand(.015, .04) }; }
    function mkPetal(init) { return { x: rand(0, W), y: init ? rand(0, H) : -30, s: rand(9, 18), vy: rand(.35, .8), sw: rand(.6, 1.6), ph: rand(0, 6.28), r: rand(0, 6.28), vr: rand(-.02, .02), a: rand(.16, .34) }; }
    for (var i = 0; i < nDust; i++) dust.push(mkDust(true));
    for (i = 0; i < nPetal; i++) petals.push(mkPetal(true));

    var mx = -999, my = -999, lastX = 0, lastY = 0;
    window.addEventListener("mousemove", function (e) {
      mx = e.clientX; my = e.clientY;
      if (!fine) return;
      var dx = mx - lastX, dy = my - lastY;
      if (dx * dx + dy * dy > 520) {
        lastX = mx; lastY = my;
        for (var k = 0; k < 2; k++) trail.push({ x: mx + rand(-6, 6), y: my + rand(-6, 6), vx: rand(-.6, .6), vy: rand(-.2, .9), l: 0, m: rand(34, 56), s: rand(14, 26) });
        if (trail.length > 90) trail.splice(0, trail.length - 90);
      }
    }, { passive: true });

    var running = true;
    document.addEventListener("visibilitychange", function () { running = !document.hidden; if (running) requestAnimationFrame(frame); });

    function frame() {
      if (!running) return;
      cx.clearRect(0, 0, W, H);

      // petals
      for (var i = 0; i < petals.length; i++) {
        var p = petals[i];
        p.ph += .015; p.y += p.vy; p.x += Math.sin(p.ph) * p.sw; p.r += p.vr;
        if (p.y > H + 30) petals[i] = mkPetal(false);
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.scale(1, Math.abs(Math.cos(p.ph * .8)) * .6 + .4);
        cx.fillStyle = "rgba(255,130,175," + p.a + ")";
        cx.beginPath(); cx.moveTo(0, -p.s); cx.bezierCurveTo(p.s * .9, -p.s * .5, p.s * .7, p.s * .7, 0, p.s); cx.bezierCurveTo(-p.s * .7, p.s * .7, -p.s * .9, -p.s * .5, 0, -p.s); cx.fill();
        cx.restore();
      }

      // gold dust
      for (i = 0; i < dust.length; i++) {
        var d = dust[i];
        d.ph += d.tw; d.y += d.vy; d.x += d.vx + Math.sin(d.ph) * .2;
        var dx = d.x - mx, dy = d.y - my, dist = dx * dx + dy * dy;
        if (dist < 14000) { var f = (14000 - dist) / 14000; d.x += dx * f * .03; d.y += dy * f * .03; }
        if (d.y < -20) dust[i] = mkDust(false);
        cx.globalAlpha = .25 + .6 * Math.abs(Math.sin(d.ph));
        cx.drawImage(spr, d.x - d.s / 2, d.y - d.s / 2, d.s, d.s);
      }

      // cursor sparkle trail
      for (i = trail.length - 1; i >= 0; i--) {
        var t = trail[i];
        t.l++; t.x += t.vx; t.y += t.vy; t.vy += .02;
        if (t.l > t.m) { trail.splice(i, 1); continue; }
        var life = 1 - t.l / t.m;
        cx.globalAlpha = life; var sz = t.s * (.4 + life * .8);
        cx.drawImage(spr, t.x - sz / 2, t.y - sz / 2, sz, sz);
      }
      cx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------- hero slideshow ----------
  function slider() {
    var s = $("#hero-slider");
    if (!s) return;
    var slides = [].slice.call(s.querySelectorAll(".slide"));
    var box = $(".s-dots", s), cur = 0, dots = [];

    slides.forEach(function (_, i) {
      var d = document.createElement("button");
      d.className = "dot"; d.type = "button"; d.setAttribute("aria-label", "Slide " + (i + 1));
      d.innerHTML = "<i></i>";
      d.onclick = function () { go(i); };
      d.firstChild.addEventListener("animationend", function () { if (d.classList.contains("active")) go(cur + 1); });
      box.appendChild(d); dots.push(d);
    });

    // sparkles that twinkle over the hero
    for (var k = 0; k < 16; k++) {
      var t = document.createElement("i");
      t.className = "tw";
      t.style.cssText = "left:" + rand(4, 96) + "%;top:" + rand(6, 92) + "%;width:" + rand(6, 13) + "px;height:" + rand(6, 13) + "px;animation-delay:" + rand(0, 3) + "s;animation-duration:" + rand(2.4, 4.6) + "s";
      s.appendChild(t);
    }

    function go(n) {
      cur = (n + slides.length) % slides.length;
      slides.forEach(function (el, i) { el.classList.toggle("active", i === cur); });
      dots.forEach(function (d, i) {
        d.classList.remove("active");
        if (i === cur) { void d.offsetWidth; d.classList.add("active"); }
      });
    }
    $(".prev", s).onclick = function () { go(cur - 1); };
    $(".next", s).onclick = function () { go(cur + 1); };
    go(0);

    var x0 = null;
    s.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    s.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) go(cur + (dx < 0 ? 1 : -1));
    });
    s.addEventListener("mousemove", function (e) {
      var r = s.getBoundingClientRect();
      s.style.setProperty("--px", ((e.clientX - r.left) / r.width - .5).toFixed(3));
      s.style.setProperty("--py", ((e.clientY - r.top) / r.height - .5).toFixed(3));
    }, { passive: true });
    s.addEventListener("mouseleave", function () { s.style.setProperty("--px", 0); s.style.setProperty("--py", 0); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") go(cur + 1); else if (e.key === "ArrowLeft") go(cur - 1);
    });

    // magnetic buttons
    if (fine) s.querySelectorAll(".btn").forEach(function (b) {
      b.addEventListener("mousemove", function (e) {
        var r = b.getBoundingClientRect();
        b.style.setProperty("--tx", (e.clientX - r.left - r.width / 2) * .22 + "px");
        b.style.setProperty("--ty", (e.clientY - r.top - r.height / 2) * .3 + "px");
      });
      b.addEventListener("mouseleave", function () { b.style.setProperty("--tx", "0px"); b.style.setProperty("--ty", "0px"); });
    });
  }

  // ---------- scroll reveal ----------
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        var el = e.target;
        el.classList.add("in");
        io.unobserve(el);
        // hand control back to the normal hover styles once the intro animation is done
        setTimeout(function () { el.classList.remove("reveal", "in"); el.style.removeProperty("--d"); }, 1300);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }) : null;

  function reveal(root) {
    var els = (root || document).querySelectorAll(".card, .box, .feature, .mood, .quote, .page-title, .sub, .toolbar, .detail, .cart-row");
    els.forEach(function (el, i) {
      if (el.dataset.fx || reduce || !io) return;
      el.dataset.fx = "1";
      el.classList.add("reveal");
      el.style.setProperty("--d", (i % 8) * 0.07 + "s");
      io.observe(el);
    });
  }
  function watch() {
    reveal();
    // product cards are drawn later by the API, so watch for new ones
    new MutationObserver(function () { reveal(); }).observe(document.body, { childList: true, subtree: true });
  }

  // ---------- glow that follows the mouse + 3D tilt on cards ----------
  document.addEventListener("mousemove", function (e) {
    var t = e.target.closest ? e.target.closest(".card, .hero") : null;
    if (!t) return;
    var r = t.getBoundingClientRect();
    t.style.setProperty("--mx", e.clientX - r.left + "px");
    t.style.setProperty("--my", e.clientY - r.top + "px");
    if (!reduce && fine && t.classList.contains("card")) {
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      t.style.transform = "translateY(-10px) perspective(900px) rotateX(" + (-y * 5) + "deg) rotateY(" + (x * 6) + "deg)";
    }
  }, { passive: true });
  document.addEventListener("mouseout", function (e) {
    var c = e.target.closest ? e.target.closest(".card") : null;
    if (c && !c.contains(e.relatedTarget)) c.style.transform = "";
  });

  // ---------- button ripple ----------
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".btn") : null;
    if (!b || reduce) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
    var dot = document.createElement("span");
    dot.className = "ripple";
    dot.style.cssText = "width:" + s + "px;height:" + s + "px;left:" + (e.clientX - r.left - s / 2) + "px;top:" + (e.clientY - r.top - s / 2) + "px";
    b.appendChild(dot);
    setTimeout(function () { dot.remove(); }, 650);
  });

  // ---------- header state + scroll progress ----------
  var bar = document.createElement("div");
  bar.className = "scroll-progress";
  function onScroll() {
    var h = document.getElementById("site-header");
    if (h) h.classList.toggle("scrolled", window.scrollY > 20);
    var max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.setProperty("--p", max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : 0);
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  // ---------- start ----------
  splash();
  function start() {
    document.body.appendChild(bar);
    liveBg();
    slider();
    watch();
    onScroll();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
