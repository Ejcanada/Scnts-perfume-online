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
async function loadShop() {
  var q = document.getElementById("search").value.trim();
  var cat = document.getElementById("category").value;
  var params = [];
  if (q) params.push("q=" + encodeURIComponent(q));
  if (cat) params.push("category=" + encodeURIComponent(cat));
  try {
    var data = await api("/products" + (params.length ? "?" + params.join("&") : ""));
    drawProducts(data.products, "grid", "No perfumes found.");
  } catch (err) {
    document.getElementById("grid").innerHTML = '<p class="empty">' + esc(err.message) + "</p>";
  }
}

function startShop() {
  var timer;
  document.getElementById("search").addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(loadShop, 300);
  });
  document.getElementById("category").addEventListener("change", loadShop);
  setupGridClicks("grid");
  loadFavIds().then(loadShop);
}
