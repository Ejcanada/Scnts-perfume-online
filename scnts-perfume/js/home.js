// home.js - extra home page sections built from the real catalogue (story, poster wall, counters).
(function () {
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var COPY = {
    men: { h: "Bold & woody", p: "Deep, warm and confident.", k: "For him", link: "shop.html?category=men", cta: "Shop for him" },
    women: { h: "Floral & radiant", p: "Soft, glowing and unforgettable.", k: "For her", link: "shop.html?category=women", cta: "Shop for her" }
  };

  function countUp(el) {
    var to = Number(el.dataset.n) || 0, pre = el.dataset.prefix || "", t0 = null, dur = 1600;
    if (reduce) { el.textContent = pre + to.toLocaleString("en-PH"); return; }
    function f(t) { if (!t0) t0 = t; var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = pre + Math.round(to * e).toLocaleString("en-PH"); if (k < 1) requestAnimationFrame(f); }
    requestAnimationFrame(f);
  }

  function numbers(list) {
    var fr = document.getElementById("n-frag"), fm = document.getElementById("n-from");
    if (fr) fr.dataset.n = list.length;
    if (fm && list.length) fm.dataset.n = Math.round(Math.min.apply(null, list.map(function (p) { return Number(p.price); })));
    var box = document.getElementById("numbers"); if (!box) return;
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (e) { if (e.isIntersecting) { box.classList.add("in"); box.querySelectorAll("b").forEach(countUp); io.disconnect(); } });
    }, { threshold: .4 });
    io.observe(box);
  }

  function story(list) {
    var sec = document.getElementById("story"); if (!sec) return;
    var picks = ["men", "women"].map(function (c) { return { c: c, p: list.filter(function (p) { return p.category === c; })[0] }; }).filter(function (x) { return x.p; });
    if (!picks.length) return;
    var stack = document.getElementById("story-stack"), steps = document.getElementById("story-steps"), cnt = document.getElementById("story-count");
    stack.innerHTML = picks.map(function (x, i) { return '<img class="' + (i ? "" : "on") + '" src="' + esc(x.p.image_url || "") + '" alt="">'; }).join("");
    steps.innerHTML = picks.map(function (x, i) {
      var c = COPY[x.c];
      return '<article class="story-step" data-i="' + i + '"><p class="ss-k">' + c.k + '</p><h2>' + c.h + '</h2><p class="ss-p">' + c.p + '</p>' +
        '<p class="ss-pick">' + esc(x.p.name) + ' <b>' + money(x.p.price) + '</b></p>' +
        '<div class="ss-act"><button class="btn" type="button" data-open="' + x.p.id + '">Step inside</button><a class="ss-link" href="' + c.link + '">' + c.cta + '</a></div></article>';
    }).join("");
    sec.hidden = false;
    function set(i) {
      stack.querySelectorAll("img").forEach(function (im, k) { im.classList.toggle("on", k === i); });
      steps.querySelectorAll(".story-step").forEach(function (s, k) { s.classList.toggle("on", k === i); });
      cnt.textContent = String(i + 1).padStart(2, "0") + " / " + String(picks.length).padStart(2, "0");
    }
    set(0);
    var io = new IntersectionObserver(function (en) { en.forEach(function (e) { if (e.isIntersecting) set(Number(e.target.dataset.i)); }); }, { rootMargin: "-45% 0px -45% 0px" });
    steps.querySelectorAll(".story-step").forEach(function (s) { io.observe(s); });
    steps.addEventListener("click", function (e) {
      var b = e.target.closest("[data-open]"); if (!b) return;
      var id = Number(b.dataset.open), p = list.filter(function (x) { return x.id === id; })[0];
      Journey.open(id, null, e, [p]);
    });
  }

  function wall(list) {
    var sec = document.getElementById("wall"); if (!sec || !list.length) return;
    var base = list.slice(); while (base.length < 8) base = base.concat(list);
    function item(p) { return '<button class="wall-item" type="button" data-id="' + p.id + '" aria-label="' + esc(p.name) + '"><img src="' + esc(p.image_url || "") + '" alt="" loading="lazy"><span>' + esc(p.name) + "</span></button>"; }
    var a = base.map(item).join(""), r = base.slice().reverse().map(item).join("");
    sec.querySelector("#wall-a .wall-track").innerHTML = a + a;
    sec.querySelector("#wall-b .wall-track").innerHTML = r + r;
    sec.hidden = false;
    // fixed speed (pixels per second) so a long catalogue does not spin too fast. Lower = slower.
    var WALL_SPEED = 45;
    sec.querySelectorAll(".wall-track").forEach(function (t, i) { t.style.animationDuration = Math.max(30, Math.round((t.scrollWidth / 2) / (WALL_SPEED + i * 8))) + "s"; });
    sec.addEventListener("click", function (e) {
      var b = e.target.closest(".wall-item"); if (!b) return;
      Journey.open(Number(b.dataset.id), b, e, list);
    });
  }

  function reveal() {
    var els = document.querySelectorAll(".manifesto,.numbers,.story-step,.wall-title,.steps li,.steps h2,.faq,.guide-band,.ritual");
    els.forEach(function (el) { el.classList.add("hv"); });
    var io = new IntersectionObserver(function (en) { en.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("hv-in"); io.unobserve(e.target); } }); }, { threshold: .15 });
    els.forEach(function (el, i) { el.style.setProperty("--d", (i % 3) * 120 + "ms"); io.observe(el); });
  }

  window.Home = { build: function (list) {
    if (window.productsById) list.forEach(function (p) { productsById[p.id] = p; });
    numbers(list); story(list); wall(list); reveal();
  } };
})();
