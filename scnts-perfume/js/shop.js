// shop.js - used by shop.html, index.html (featured) and favorites.html

var productsById = {};
var favIds = new Set();

async function loadFavIds() {
  if (!getToken()) { favIds = new Set(); return; }   // guests have no favorites
  try {
    var data = await api("/favorites");
    favIds = new Set(data.favorites.map(function (f) { return f.product_id; }));
  } catch (e) {
    favIds = new Set();
  }
}

function drawProducts(list, gridId, emptyText) {
  var grid = document.getElementById(gridId);
  if (!list.length) {
    grid.innerHTML = '<p class="empty">' + esc(emptyText || "No perfumes found.") + "</p>";
    return;
  }
  list.forEach(function (p) { productsById[p.id] = p; });
  grid.innerHTML = list.map(function (p) { return productCard(p, favIds.has(p.id)); }).join("");
}

// Clicks on the heart and the Add to cart buttons
function setupGridClicks(gridId, afterFavChange) {
  document.getElementById(gridId).addEventListener("click", async function (e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var id = Number(btn.dataset.id);
    var product = productsById[id];

    if (btn.dataset.act === "cart") {
      addToCart(product, 1);
    }

    if (btn.dataset.act === "fav") {
      if (!requireLogin()) return;
      try {
        if (favIds.has(id)) {
          await api("/favorites/" + id, "DELETE");
          favIds.delete(id);
        } else {
          await api("/favorites/" + id, "POST");
          favIds.add(id);
        }
        btn.classList.toggle("on", favIds.has(id));
        btn.textContent = favIds.has(id) ? "♥" : "♡";
        if (afterFavChange) afterFavChange(id);
      } catch (err) {
        toast(err.message);
      }
    }
  });
}

// ---------- shop page ----------
// Ticker speed in pixels per second. Lower number = slower.
var TICKER_SPEED = 45;

async function loadShop() {
  var q = document.getElementById("search").value.trim();
  var cat = document.getElementById("category").value;
  var sort = (document.getElementById("sort") || {}).value || "";
  var params = [];
  if (q) params.push("q=" + encodeURIComponent(q));
  if (cat) params.push("category=" + encodeURIComponent(cat));
  var grid = document.getElementById("grid");
  if (!grid.children.length || grid.querySelector(".empty")) grid.innerHTML = new Array(8).join('<div class="card skel"><div class="pimg"></div><div class="card-body"><i></i><i></i></div></div>');
  try {
    var data = await api(shopPath("/products" + (params.length ? "?" + params.join("&") : "")));
    var list = data.products.slice();
    if (sort === "low") list.sort(function (a, b) { return a.price - b.price; });
    else if (sort === "high") list.sort(function (a, b) { return b.price - a.price; });
    else if (sort === "az") list.sort(function (a, b) { return String(a.name).localeCompare(b.name); });
    drawProducts(list, "grid", "No perfumes found. Try another name or category.");
    Array.prototype.forEach.call(grid.querySelectorAll(".card"), function (c, i) { c.style.setProperty("--i", i); });
    var n = document.getElementById("count"); if (n) n.textContent = list.length + (list.length === 1 ? " fragrance" : " fragrances");
    var h = document.getElementById("hero-count"); if (h && !q && !cat) h.textContent = list.length;
    var t = document.getElementById("ticker-track");
    if (t && !q && !cat && list.length) { var row = list.map(function (p) { return "<span>" + esc(p.name) + "</span><em>\u2726</em>"; }).join(""); t.innerHTML = row + row; t.style.animationDuration = Math.max(20, Math.round((t.scrollWidth / 2) / TICKER_SPEED)) + "s"; }
  } catch (err) {
    grid.innerHTML = '<p class="empty">' + esc(err.message) + "</p>";
  }
}

function startShop() {
  var timer;
  document.getElementById("search").addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(loadShop, 300);
  });
  document.getElementById("category").addEventListener("change", loadShop);
  var so = document.getElementById("sort"); if (so) so.addEventListener("change", loadShop);
  // category chips drive the (hidden) select so the old logic keeps working
  var chips = document.querySelectorAll(".chip[data-cat]");
  function syncChips() { var v = document.getElementById("category").value; chips.forEach(function (c) { c.classList.toggle("on", c.dataset.cat === v); c.setAttribute("aria-pressed", c.dataset.cat === v); }); }
  chips.forEach(function (c) { c.addEventListener("click", function () { document.getElementById("category").value = c.dataset.cat; syncChips(); loadShop(); }); });
  syncChips();
  setupGridClicks("grid");
  loadFavIds().then(loadShop);
}
