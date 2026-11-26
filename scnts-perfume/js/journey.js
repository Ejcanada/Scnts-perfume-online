// journey.js - cinematic full-screen perfume view (opens when a perfume card is clicked)
// Purely additive: does not touch the live background (fx.js).
(function () {
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root, state = { list: [], i: 0, open: false, raf: 0, parts: [], mx: 0, my: 0, qty: 1, opener: null };

  function slugOf(p) { return (p.image_url || "").split("/").pop().replace(/\.[a-z]+$/i, ""); }
  function get(id) { return window.productsById && productsById[id]; }

  // average colour of the poster -> tint for the whole scene
  function tintFrom(img, cb) {
    function go() {
      try {
        var c = document.createElement("canvas"); c.width = c.height = 8;
        var x = c.getContext("2d"); x.drawImage(img, 0, 0, 8, 8);
        var d = x.getImageData(0, 0, 8, 8).data, r = 0, g = 0, b = 0, n = 0;
        for (var k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; n++; }
        cb([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
      } catch (e) { cb([120, 20, 60]); }
    }
    if (img.complete && img.naturalWidth) go(); else { img.onload = go; img.onerror = function () { cb([120, 20, 60]); }; }
  }

  function build() {
    root = document.createElement("div");
    root.className = "jy"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Perfume view"); root.hidden = true;
    root.innerHTML =
      '<div class="jy-bg"><video class="jy-video" muted loop playsinline preload="none"></video><div class="jy-img"></div><div class="jy-tint"></div><div class="jy-vig"></div></div>' +
      '<canvas class="jy-fx"></canvas>' +
      '<div class="jy-top"><span class="jy-count"></span><span class="jy-brand">Scnts</span><button class="jy-x" aria-label="Close">&#10005;</button></div>' +
      '<div class="jy-ghost" aria-hidden="true"></div>' +
      '<div class="jy-stage">' +
        '<div class="jy-poster-wrap"><div class="jy-poster"><img alt=""><i class="jy-gloss"></i></div><div class="jy-shadow"></div></div>' +
        '<div class="jy-panel"><p class="jy-k"></p><h2 class="jy-name"></h2><p class="jy-desc"></p>' +
          '<div class="jy-row"><span class="jy-price"></span><span class="jy-size"></span></div>' +
          '<div class="jy-buy"><div class="qty"><button data-q="-1" aria-label="Less">&minus;</button><input class="jy-qty" type="number" min="1" max="20" value="1"><button data-q="1" aria-label="More">+</button></div><button class="btn jy-add">Add to cart</button></div>' +
          '<a class="jy-more" href="#">View full details</a></div>' +
      '</div>' +
      '<button class="jy-nav jy-prev" aria-label="Previous perfume">&#8592;</button><button class="jy-nav jy-next" aria-label="Next perfume">&#8594;</button>' +
      '<div class="jy-curtain"></div>';
    document.body.appendChild(root);
    root.querySelector(".jy-x").onclick = close;
    root.querySelector(".jy-prev").onclick = function () { step(-1); };
    root.querySelector(".jy-next").onclick = function () { step(1); };
    root.querySelector(".jy-add").onclick = function (e) {
      var p = state.list[state.i]; if (!p) return;
      var q = Math.min(20, Math.max(1, parseInt(root.querySelector(".jy-qty").value, 10) || 1));
      addToCart(p, q); burst(e.clientX, e.clientY);
    };
    root.querySelectorAll("[data-q]").forEach(function (b) {
      b.onclick = function () { var i = root.querySelector(".jy-qty"); i.value = Math.min(20, Math.max(1, (parseInt(i.value, 10) || 1) + Number(b.dataset.q))); };
    });
    document.addEventListener("keydown", function (e) {
      if (!state.open) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "Tab") { // keep focus inside
        var f = root.querySelectorAll("button,a,input"), a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    });
    // pointer parallax + 3D tilt
    root.addEventListener("pointermove", function (e) {
      var w = innerWidth, h = innerHeight; state.mx = (e.clientX / w - .5) * 2; state.my = (e.clientY / h - .5) * 2;
      if (reduce) return;
      var po = root.querySelector(".jy-poster"), gl = root.querySelector(".jy-gloss");
      po.style.transform = "rotateY(" + state.mx * 12 + "deg) rotateX(" + (-state.my * 9) + "deg)";
      gl.style.background = "radial-gradient(circle at " + (50 + state.mx * 40) + "% " + (40 + state.my * 40) + "%, rgba(255,255,255,.35), transparent 55%)";
      root.querySelector(".jy-img").style.transform = "scale(1.18) translate(" + (-state.mx * 14) + "px," + (-state.my * 10) + "px)";
      root.querySelector(".jy-ghost").style.transform = "translate(" + (-state.mx * 26) + "px," + (-state.my * 14) + "px)";
      var pn = root.querySelector(".jy-panel").getBoundingClientRect();
      root.querySelector(".jy-panel").style.setProperty("--sx", (e.clientX - pn.left) + "px");
      root.querySelector(".jy-panel").style.setProperty("--sy", (e.clientY - pn.top) + "px");
    });
    // swipe
    var sx = null;
    root.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    root.addEventListener("touchend", function (e) { if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 70) step(dx < 0 ? 1 : -1); sx = null; });
    window.addEventListener("resize", sizeCanvas);
  }

  // ---- particles: gold dust rising + sparkle bursts ----
  var cv, cx;
  function sizeCanvas() { if (!cv) return; cv.width = innerWidth; cv.height = innerHeight; }
  function seed() {
    state.parts = [];
    var n = reduce ? 0 : (innerWidth < 700 ? 40 : 90);
    for (var k = 0; k < n; k++) state.parts.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: Math.random() * 2.2 + .4, v: Math.random() * .5 + .15, a: Math.random() * .7 + .2, t: Math.random() * 6, life: -1 });
  }
  function burst(x, y) {
    if (reduce) return;
    for (var k = 0; k < 28; k++) { var an = Math.random() * 6.28, sp = Math.random() * 5 + 1.5; state.parts.push({ x: x, y: y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 1.5, r: Math.random() * 2.6 + .8, a: 1, life: 1, t: 0 }); }
  }
  function loop() {
    if (!state.open) return;
    cx.clearRect(0, 0, cv.width, cv.height);
    for (var k = state.parts.length - 1; k >= 0; k--) {
      var p = state.parts[k];
      if (p.life >= 0) { p.x += p.vx; p.y += p.vy; p.vy += .12; p.vx *= .985; p.life -= .017; if (p.life <= 0) { state.parts.splice(k, 1); continue; } cx.globalAlpha = p.life; }
      else { p.y -= p.v; p.t += .02; p.x += Math.sin(p.t) * .35 + state.mx * .25; if (p.y < -10) { p.y = innerHeight + 10; p.x = Math.random() * innerWidth; } cx.globalAlpha = p.a * (.6 + Math.sin(p.t * 3) * .4); }
      cx.fillStyle = "#ffe29a"; cx.shadowColor = "#e8b84b"; cx.shadowBlur = 10;
      cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.283); cx.fill();
    }
    cx.globalAlpha = 1; state.raf = requestAnimationFrame(loop);
  }

  // ---- fill the scene with one perfume ----
  function paint(p, animate) {
    var q = function (s) { return root.querySelector(s); };
    var src = p.image_url || "";
    var img = q(".jy-poster img"); img.src = src; img.alt = p.name;
    q(".jy-img").style.backgroundImage = src ? 'url("' + src.replace(/"/g, "%22") + '")' : "none";
    q(".jy-k").textContent = (p.brand || "Scnts") + " · " + categoryLabel(p.category);
    var nm = q(".jy-name"); nm.innerHTML = "";
    String(p.name).split(" ").forEach(function (w, wi) {
      var s = document.createElement("span"); s.className = "w";
      w.split("").forEach(function (ch, ci) { var l = document.createElement("i"); l.textContent = ch; l.style.setProperty("--d", (wi * 90 + ci * 38) + "ms"); s.appendChild(l); });
      nm.appendChild(s); nm.appendChild(document.createTextNode(" "));
    });
    q(".jy-ghost").textContent = p.name;
    q(".jy-desc").textContent = p.description || "";
    q(".jy-price").textContent = money(p.price);
    q(".jy-size").textContent = p.size_ml + " ml · " + (p.stock > 0 ? p.stock + " in stock" : "Out of stock");
    q(".jy-add").disabled = p.stock <= 0;
    q(".jy-qty").value = 1;
    q(".jy-more").href = "product.html?id=" + p.id;
    q(".jy-count").textContent = String(state.i + 1).padStart(2, "0") + " / " + String(state.list.length).padStart(2, "0");
    root.querySelector(".jy-prev").style.visibility = root.querySelector(".jy-next").style.visibility = state.list.length > 1 ? "visible" : "hidden";
    tintFrom(img, function (c) { root.style.setProperty("--tint", c.join(",")); });
    // optional background video: images/videos/<poster-name>.mp4 (falls back to images/videos/hero.mp4)
    var v = q(".jy-video"); v.classList.remove("on");
    var tries = ["images/videos/" + slugOf(p) + ".mp4", "images/videos/hero.mp4"], ti = 0;
    v.onerror = function () { ti++; if (ti < tries.length) { v.src = tries[ti]; v.load(); } else { v.removeAttribute("src"); } };
    v.oncanplay = function () { v.classList.add("on"); v.play().catch(function () {}); };
    v.preload = "auto"; v.src = tries[0]; v.load();
    if (animate) { root.classList.remove("swap"); void root.offsetWidth; root.classList.add("swap"); }
  }

  function step(d) {
    if (state.list.length < 2) return;
    state.i = (state.i + d + state.list.length) % state.list.length;
    root.dataset.dir = d > 0 ? "next" : "prev";
    paint(state.list[state.i], true);
  }

  function open(id, from, ev, custom) {
    if (!root) build();
    cv = root.querySelector(".jy-fx"); cx = cv.getContext("2d");
    var cards = Array.prototype.slice.call(document.querySelectorAll("#grid .card [data-id]")).map(function (b) { return Number(b.dataset.id); });
    cards = cards.filter(function (v, k) { return cards.indexOf(v) === k; });
    state.list = custom && custom.length ? custom : cards.map(get).filter(Boolean);
    state.i = Math.max(0, state.list.findIndex(function (p) { return p.id === id; }));
    if (!state.list.length) return;
    state.opener = from; state.open = true; state.mx = state.my = 0;
    root.hidden = false; document.documentElement.classList.add("jy-lock");
    sizeCanvas(); seed();
    var x = ev ? ev.clientX : innerWidth / 2, y = ev ? ev.clientY : innerHeight / 2;
    root.style.setProperty("--ox", x + "px"); root.style.setProperty("--oy", y + "px");
    paint(state.list[state.i], false);
    root.classList.remove("in"); void root.offsetWidth; root.classList.add("in");
    // fly the card's poster into the stage
    var src = from && from.querySelector(".pimg img, img"), dest = root.querySelector(".jy-poster");
    if (src && !reduce && dest.animate) {
      var a = src.getBoundingClientRect();
      requestAnimationFrame(function () {
        var b = dest.getBoundingClientRect();
        dest.animate([
          { transform: "translate(" + (a.left - b.left) + "px," + (a.top - b.top) + "px) scale(" + (a.width / b.width) + "," + (a.height / b.height) + ")", opacity: .9 },
          { transform: "none", opacity: 1 }], { duration: 950, easing: "cubic-bezier(.2,.8,.15,1)" });
      });
    }
    cancelAnimationFrame(state.raf); loop();
    setTimeout(function () { root.querySelector(".jy-add").focus({ preventScroll: true }); }, 700);
  }

  function close() {
    if (!state.open) return;
    root.classList.remove("in"); root.classList.add("out");
    setTimeout(function () {
      root.hidden = true; root.classList.remove("out"); state.open = false;
      cancelAnimationFrame(state.raf); document.documentElement.classList.remove("jy-lock");
      var v = root.querySelector(".jy-video"); v.pause(); v.removeAttribute("src");
      if (state.opener && document.body.contains(state.opener)) { try { state.opener.querySelector("a,button").focus({ preventScroll: true }); } catch (e) {} }
    }, reduce ? 0 : 520);
  }

  // open when a card is clicked (anywhere except its buttons/links)
  document.addEventListener("click", function (e) {
    var card = e.target.closest("#grid .card");
    if (!card || e.target.closest("button,a,input,select")) return;
    var b = card.querySelector("[data-id]"); if (!b) return;
    e.preventDefault(); open(Number(b.dataset.id), card, e);
  });
  // "View" buttons open the journey too (full page stays reachable from inside)
  document.addEventListener("click", function (e) {
    var a = e.target.closest("#grid .card-actions a.btn-outline");
    if (!a) return;
    var card = a.closest(".card"), b = card.querySelector("[data-id]"); if (!b) return;
    e.preventDefault(); open(Number(b.dataset.id), card, e);
  });
  window.Journey = { open: open, close: close };
})();
