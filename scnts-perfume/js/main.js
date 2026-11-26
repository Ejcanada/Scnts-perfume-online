// main.js - shared things for every page: header, footer, cart helpers

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function money(n) {
  return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toast(text) {
  var t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 2200);
}

function showMsg(id, text, type) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "msg show " + (type || "error");
}

function hideMsg(id) {
  var el = document.getElementById(id);
  if (el) el.className = "msg";
}

// ---------- reseller shop link (shop.html?r=name) ----------
function resellerSlug() {
  try { return localStorage.getItem("scnts_reseller") || ""; } catch (e) { return ""; }
}

(function rememberReseller() {
  var r = new URLSearchParams(location.search).get("r");
  if (r === null) return;
  r = r.trim().toLowerCase();
  if (r === resellerSlug()) return;
  try {
    if (r) localStorage.setItem("scnts_reseller", r); else localStorage.removeItem("scnts_reseller");
    localStorage.removeItem("scnts_cart");        // prices are different in another shop
  } catch (e) {}
})();

// add ?reseller=... so the prices are the reseller's prices
function shopPath(path) {
  var r = resellerSlug();
  return r ? path + (path.indexOf("?") === -1 ? "?" : "&") + "reseller=" + encodeURIComponent(r) : path;
}

async function showShopBanner() {
  var box = document.getElementById("shop-banner");
  var r = resellerSlug();
  if (!box || !r) return;
  try {
    var info = await api("/reseller/shop-info/" + encodeURIComponent(r));
    box.innerHTML = '<div class="shop-banner">You are shopping at <strong>' + esc(info.name) + "'s shop</strong></div>";
  } catch (e) {
    try { localStorage.removeItem("scnts_reseller"); } catch (e2) {}     // the link does not work anymore
  }
}
document.addEventListener("DOMContentLoaded", showShopBanner);

// ---------- cart (saved in the browser) ----------
function getCart() {
  try { return JSON.parse(localStorage.getItem("scnts_cart")) || []; } catch (e) { return []; }
}

function saveCart(cart) {
  try { localStorage.setItem("scnts_cart", JSON.stringify(cart)); } catch (e) {}
  updateCartCount();
}

function cartCount() {
  return getCart().reduce(function (sum, i) { return sum + i.qty; }, 0);
}

function updateCartCount() {
  var el = document.getElementById("cart-count");
  if (el) el.textContent = cartCount();
}

function addToCart(p, qty) {
  if (!requireLogin()) return;   // guests must log in first
  qty = qty || 1;
  var cart = getCart();
  var item = cart.find(function (i) { return i.id === p.id; });
  if (item) {
    item.qty = Math.min(20, item.qty + qty);
  } else {
    cart.push({ id: p.id, name: p.name, price: p.price, image_url: p.image_url, qty: Math.min(20, qty) });
  }
  saveCart(cart);
  toast(p.name + " added to cart");
}

function categoryLabel(c) {
  if (c === "men") return "For him";
  if (c === "women") return "For her";
  return "Unisex";
}

// ---------- product card used by Home, Shop and Favorites ----------
function productImage(p) {
  var img = p.image_url ? '<img src="' + esc(p.image_url) + '" alt="' + esc(p.name) + '" onerror="this.style.display=\'none\'">' : "";
  return '<div class="pimg">SCNTS' + img + "</div>";
}

function productCard(p, isFav) {
  return '<div class="card">' +
    '<div style="position:relative">' + productImage(p) +
    '<button class="heart ' + (isFav ? "on" : "") + '" data-act="fav" data-id="' + p.id + '" title="Favorite">' + (isFav ? "♥" : "♡") + "</button></div>" +
    '<div class="card-body">' +
    '<span class="brand">' + esc(p.brand) + " · " + categoryLabel(p.category) + "</span>" +
    "<h3>" + esc(p.name) + "</h3>" +
    '<span class="tag">' + esc(p.size_ml) + " ml" + (p.stock <= 0 ? " · Out of stock" : "") + "</span>" +
    '<span class="price">' + money(p.price) + "</span>" +
    '<div class="card-actions">' +
    '<a class="btn btn-outline btn-small" href="product.html?id=' + p.id + '">View</a>' +
    '<button class="btn btn-small" data-act="cart" data-id="' + p.id + '"' + (p.stock <= 0 ? " disabled" : "") + ">Add to cart</button>" +
    "</div></div></div>";
}

// ---------- header and footer ----------
function buildLayout() {
  if (document.body.dataset.layout === "none") return;
  var user = getUser();
  var page = location.pathname.split("/").pop() || "index.html";
  var loggedIn = !!getToken();
  var role = user ? user.role : "";
  var isStaff = loggedIn && (role === "employee" || role === "admin");
  var links = [];
  if (isStaff) {
    // Staff menu: only work pages. No shop, cart, favorites, my orders, about or contact.
    links.push(["pos.html", "POS"], ["promos.html", "Promos"], ["myshop.html", "My Shop"], ["earnings.html", "Earnings"], ["inventory.html", "Inventory"]);
    if (role === "admin") {
      links.push(["orders.html", "Orders"], ["sales.html", "Sales"], ["reports.html", "Reports"], ["staff.html", "Staff"], ["admin.html", "Products"]);
    }
  } else {
    // Customer / guest menu
    links.push(["index.html", "Home"], ["shop.html", "Shop"]);
    if (loggedIn) links.push(["favorites.html", "Favorites"], ["my-orders.html", "My orders"]);
    links.push(["about.html", "About"], ["contact.html", "Contact"]);
  }

  var nav = links.map(function (l) {
    return '<a href="' + l[0] + '"' + (page === l[0] ? ' class="active"' : "") + ">" + l[1] + "</a>";
  }).join("");

  var header = document.getElementById("site-header");
  if (header) {
    header.className = "site-header" + (isStaff ? " staff-nav" : "");
    header.innerHTML = '<div class="container nav">' +
      '<a class="logo" href="' + (isStaff ? "pos.html" : "index.html") + '">SCNTS</a>' +
      '<button class="menu-btn" id="menu-btn" aria-label="Menu">☰</button>' +
      '<div class="nav-links" id="nav-links">' + nav +
      (loggedIn
        ? (isStaff ? "" : '<a class="cart-link" href="cart.html">Cart<span id="cart-count">0</span></a>') +
          '<a href="#" id="logout-link">Logout' + (user ? " (" + esc(user.name.split(" ")[0]) + ")" : "") + "</a>"
        : '<a href="login.html">Login / Sign up</a>') +
      "</div></div>";
    document.getElementById("menu-btn").onclick = function () {
      document.getElementById("nav-links").classList.toggle("open");
    };
    var lo = document.getElementById("logout-link");
    if (lo) lo.onclick = function (e) { e.preventDefault(); logout(); };
  }

  var footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "site-footer";
    footer.innerHTML = '<div class="container">© ' + new Date().getFullYear() + " SCNTS Perfume. All rights reserved.</div>";
  }
  updateCartCount();
}

// Staff (employee / admin) have no customer cart, favorites or "my orders": send them to the POS
(function keepStaffOut() {
  var u = getUser();
  var page = location.pathname.split("/").pop();
  var customerOnly = ["cart.html", "checkout.html", "favorites.html", "my-orders.html"];
  if (u && (u.role === "employee" || u.role === "admin") && customerOnly.indexOf(page) !== -1) location.replace("pos.html");
})();

// Ask the server who we are (so a new role shows without logging in again)
async function refreshUser() {
  if (!getToken()) return null;
  try {
    var me = await api("/auth/me");
    var old = getUser();
    localStorage.setItem("scnts_user", JSON.stringify(me));
    if (!old || old.role !== me.role) buildLayout();
    return me;
  } catch (e) {
    return getUser();
  }
}

// For staff pages: returns the user, or shows the "not allowed" box and returns null
async function requireRole(roles) {
  var u = await refreshUser();
  var ok = u && roles.indexOf(u.role) !== -1;
  var content = document.getElementById("staff-content");
  var denied = document.getElementById("denied");
  if (content) content.style.display = ok ? "block" : "none";
  if (denied) denied.style.display = ok ? "none" : "block";
  return ok ? u : null;
}

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function timeText(iso) {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" });
}

function dateTimeText(iso) {
  return new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
}

document.addEventListener("DOMContentLoaded", buildLayout);

// plain words for a promo, used on the Promos page and in the POS
function promoText(p) {
  var who = p.scope === "product" ? (p.product ? p.product.name : "one perfume") :
            p.scope === "category" ? "any perfume " + categoryLabel(p.category).toLowerCase() : "any perfume";
  var t = p.promo_type;
  if (t === "bundle") return p.buy_qty + " for " + money(p.value) + " (" + who + ")";
  if (t === "buy_get") return "Buy " + p.buy_qty + ", get " + p.get_qty + " free (" + who + ")";
  if (t === "percent") return Number(p.value) + "% off" + (p.min_qty > 1 ? " when you buy " + p.min_qty + "+" : "") + " (" + who + ")";
  return money(p.value) + " off each" + (p.min_qty > 1 ? " when you buy " + p.min_qty + "+" : "") + " (" + who + ")";
}
