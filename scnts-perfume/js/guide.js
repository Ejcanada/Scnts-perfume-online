// guide.js - "Find your fragrance": a short guided quiz that recommends perfumes from the real catalogue.
(function () {
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root, all = null, ans = {}, step = 0;

  function build() {
    root = document.createElement("div");
    root.className = "gd"; root.hidden = true; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Find your fragrance");
    root.innerHTML = '<div class="gd-bg"><i></i><i></i><i></i></div>' +
      '<div class="gd-top"><button class="gd-back" aria-label="Back">&#8592;</button><span class="gd-brand">Scnts</span><button class="gd-x" aria-label="Close">&#10005;</button></div>' +
      '<div class="gd-dots"><b></b><b></b><b></b></div><div class="gd-body"></div>';
    document.body.appendChild(root);
    root.querySelector(".gd-x").onclick = close;
    root.querySelector(".gd-back").onclick = function () { if (step > 0) { step--; render(); } };
    document.addEventListener("keydown", function (e) { if (!root.hidden && e.key === "Escape") close(); });
  }

  function tiers() {
    var pr = all.map(function (p) { return Number(p.price); }).sort(function (a, b) { return a - b; });
    var lo = pr[0], hi = pr[pr.length - 1], a = lo + (hi - lo) / 3, b = lo + 2 * (hi - lo) / 3;
    return [
      { id: "t1", label: "Easy on the pocket", note: "Up to " + money(Math.round(a)), min: 0, max: a },
      { id: "t2", label: "The sweet spot", note: money(Math.round(a)) + " to " + money(Math.round(b)), min: a, max: b },
      { id: "t3", label: "A statement piece", note: money(Math.round(b)) + " and up", min: b, max: Infinity },
      { id: "any", label: "Show me everything", note: "No budget limit", min: 0, max: Infinity }
    ];
  }

  function opts(list, key, q, sub) {
    var body = root.querySelector(".gd-body");
    body.innerHTML = '<p class="gd-k">' + sub + '</p><h2 class="gd-q">' + q + '</h2><div class="gd-opts">' +
      list.map(function (o, i) { return '<button class="gd-opt" style="--i:' + i + '" data-v="' + o.id + '"><span>' + o.label + '</span><small>' + (o.note || "") + '</small></button>'; }).join("") + "</div>";
    body.querySelectorAll(".gd-opt").forEach(function (b) {
      b.onclick = function () { ans[key] = b.dataset.v; step++; render(); };
    });
  }

  function results() {
    var T = tiers().filter(function (t) { return t.id === ans.budget; })[0];
    var fits = all.filter(function (p) {
      var catOk = ans.who === "any" || p.category === ans.who || p.category === "unisex";
      return catOk && p.price >= T.min - 0.01 && p.price <= T.max + 0.01 && p.stock > 0;
    });
    // exact category first, then unisex
    fits.sort(function (a, b) { return (b.category === ans.who) - (a.category === ans.who) || a.price - b.price; });
    var pick = fits.slice(0, 3), body = root.querySelector(".gd-body");
    if (!pick.length) {
      body.innerHTML = '<p class="gd-k">No exact match</p><h2 class="gd-q">Nothing in that range right now.</h2><button class="btn" id="gd-redo">Try again</button>';
      body.querySelector("#gd-redo").onclick = function () { ans = {}; step = 0; render(); }; return;
    }
    var who = { men: "for him", women: "for her", unisex: "unisex", any: "for anyone" }[ans.who];
    body.innerHTML = '<p class="gd-k">Your matches · ' + who + ' · ' + T.label.toLowerCase() + '</p><h2 class="gd-q">We picked ' + (pick.length === 1 ? "this one" : "these " + pick.length) + " for you.</h2>" +
      '<div class="gd-res">' + pick.map(function (p, i) {
        return '<button class="gd-card" style="--i:' + i + '" data-id="' + p.id + '"><span class="gd-img"><img src="' + esc(p.image_url || "") + '" alt="' + esc(p.name) + '"></span><b>' + esc(p.name) + '</b><span>' + money(p.price) + '</span><small>' + categoryLabel(p.category) + '</small></button>';
      }).join("") + '</div><button class="gd-redo" id="gd-redo">Start over</button>';
    body.querySelector("#gd-redo").onclick = function () { ans = {}; step = 0; render(); };
    body.querySelectorAll(".gd-card").forEach(function (c) {
      c.onclick = function (e) {
        pick.forEach(function (p) { if (window.productsById) productsById[p.id] = p; });
        close(true); setTimeout(function () { Journey.open(Number(c.dataset.id), null, e, pick); }, 350);
      };
    });
  }

  function render() {
    root.querySelectorAll(".gd-dots b").forEach(function (d, i) { d.classList.toggle("on", i <= step); });
    root.querySelector(".gd-back").style.visibility = step > 0 ? "visible" : "hidden";
    if (step === 0) opts([{ id: "men", label: "For him" }, { id: "women", label: "For her" }, { id: "unisex", label: "Unisex" }, { id: "any", label: "Surprise me" }], "who", "Who is it for?", "Guide me");
    else if (step === 1) opts(tiers(), "budget", "What feels right for your budget?", "Almost there");
    else results();
  }

  async function open(ev) {
    if (!root) build();
    if (!all) {
      try { var d = await api(shopPath("/products")); all = d.products; }
      catch (e) { toast(e.message || "Could not load perfumes"); return; }
    }
    if (!all.length) { toast("No perfumes yet."); return; }
    ans = {}; step = 0;
    root.style.setProperty("--ox", (ev && ev.clientX || innerWidth / 2) + "px"); root.style.setProperty("--oy", (ev && ev.clientY || innerHeight / 2) + "px");
    root.hidden = false; document.documentElement.classList.add("jy-lock");
    render(); root.classList.remove("in", "out"); void root.offsetWidth; root.classList.add("in");
  }
  function close(keepLock) {
    if (!root || root.hidden) return;
    root.classList.remove("in"); root.classList.add("out");
    setTimeout(function () { root.hidden = true; root.classList.remove("out"); if (keepLock !== true) document.documentElement.classList.remove("jy-lock"); }, reduce ? 0 : 450);
  }

  document.addEventListener("click", function (e) { var b = e.target.closest("[data-guide]"); if (b) { e.preventDefault(); open(e); } });
  // floating pill on the shop page
  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("shop-bar")) return;
    var f = document.createElement("button"); f.className = "guide-fab"; f.type = "button"; f.setAttribute("data-guide", "");
    f.innerHTML = '<span aria-hidden="true">&#10022;</span> Find your fragrance'; document.body.appendChild(f);
  });
  window.Guide = { open: open, close: close };
})();
