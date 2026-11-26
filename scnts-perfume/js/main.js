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
// The reseller shop only lasts while the customer keeps browsing from that link (in this tab).
// Opening the main SCNTS link directly (typed, bookmarked, or from another site) is always the main shop.
function resellerSlug() {
  try { return sessionStorage.getItem("scnts_reseller") || ""; } catch (e) { return ""; }
}

(function rememberReseller() {
  var old = resellerSlug();
  var fromThisSite = false;
  try { fromThisSite = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}
  var r = new URLSearchParams(location.search).get("r");
  var next;
  if (r !== null) next = r.trim().toLowerCase();       // ?r=name opens that shop, ?r= opens the main shop
  else next = fromThisSite ? old : "";                  // no link given: keep it only while moving around the site
  try { localStorage.removeItem("scnts_reseller"); } catch (e) {}   // old versions saved it here for good
  if (next === old) return;
  try {
    if (next) sessionStorage.setItem("scnts_reseller", next); else sessionStorage.removeItem("scnts_reseller");
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
    try { sessionStorage.removeItem("scnts_reseller"); } catch (e2) {}     // the link does not work anymore
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
  var n = cartCount();
  Array.prototype.forEach.call(document.querySelectorAll("[data-cart-count]"), function (el) {
    el.textContent = n;
    el.style.display = n > 0 ? "" : "none";
  });
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
var SHOP_EMAIL = "Perfumescnts@gmail.com";
var ANNOUNCE = [
  "Elevate your confidence with our exquisite fragrances",
  "Eau de perfume, for him and for her",
  "Questions about a scent? Call 0956 896 3077"
];
var ICON_BAG = '<svg class="ico-bag" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 8.5h13l-1 11.5h-11z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/></svg>';

function footCol(title, rows) {
  return '<div class="foot-col"><h4>' + title + "</h4>" + rows.map(function (r) { return '<a href="' + r[0] + '">' + r[1] + "</a>"; }).join("") + "</div>";
}

var CUSTOMER_PAGES = ["index.html", "shop.html", "product.html", "about.html", "contact.html", "cart.html", "checkout.html", "favorites.html", "my-orders.html", ""];

function buildLayout() {
  if (document.body.dataset.layout === "none") return;
  var user = getUser();
  var page = location.pathname.split("/").pop() || "index.html";
  var loggedIn = !!getToken();
  var role = user ? user.role : "";
  var staffAccount = loggedIn && (role === "employee" || role === "admin");
  // On a reseller shop link the page looks like a normal customer shop, even when the reseller is logged in to preview it
  var asCustomer = staffAccount && !!resellerSlug() && CUSTOMER_PAGES.indexOf(page) !== -1;
  var isStaff = staffAccount && !asCustomer;
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
    if (asCustomer) links.push(["pos.html", "Back to staff"]);
  }

  var nav = links.map(function (l) {
    return '<a href="' + l[0] + '"' + (page === l[0] ? ' class="active"' : "") + ">" + l[1] + "</a>";
  }).join("");

  var showCart = loggedIn && !isStaff;
  var firstName = user ? esc(user.name.split(" ")[0]) : "";
  var accountLink = loggedIn
    ? '<a href="#" id="logout-link">Logout' + (user ? " (" + firstName + ")" : "") + "</a>"
    : '<a href="login.html">Login / Sign up</a>';

  // announcement strip above the header (customer pages only)
  var header = document.getElementById("site-header");
  if (header && !isStaff && !document.getElementById("announce")) {
    var bar = document.createElement("div");
    bar.className = "announce";
    bar.id = "announce";
    bar.innerHTML = ANNOUNCE.map(function (t) { return "<span>" + t + "</span>"; }).join("");
    header.parentNode.insertBefore(bar, header);
  }

  if (header) {
    header.className = "site-header" + (isStaff ? " staff-nav" : "");
    header.innerHTML = '<div class="container nav">' +
      '<a class="logo" href="' + (isStaff ? "pos.html" : "index.html") + '" aria-label="SCNTS home">SCNTS</a>' +
      '<div class="nav-links" id="nav-links">' + nav + accountLink + "</div>" +
      '<div class="nav-tools">' +
        (showCart ? '<a class="cart-link" href="cart.html" aria-label="Cart">' + ICON_BAG + '<span id="cart-count" data-cart-count>0</span></a>' : "") +
        '<button class="menu-btn" id="menu-btn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="drawer"><i></i><i></i></button>' +
      "</div></div>";
    var lo = header.querySelector("#logout-link");
    if (lo) lo.onclick = function (e) { e.preventDefault(); logout(); };
  }

  // full-screen menu for phones and tablets
  if (header && !document.getElementById("drawer")) {
    var d = document.createElement("div");
    d.className = "drawer";
    d.id = "drawer";
    d.setAttribute("aria-hidden", "true");
    d.innerHTML =
      '<div class="d-top"><button class="d-close" id="drawer-close" type="button"><span class="x" aria-hidden="true"></span>Close</button>' +
      '<a class="d-mark" href="' + (isStaff ? "pos.html" : "index.html") + '" aria-hidden="true" tabindex="-1"></a></div>' +
      '<nav class="d-list" aria-label="Main menu">' +
      links.map(function (l, i) {
        return '<a class="d-link' + (page === l[0] ? " active" : "") + '" style="--i:' + i + '" href="' + l[0] + '"><span>' + l[1] + '</span><i class="chev" aria-hidden="true"></i></a>';
      }).join("") +
      (showCart ? '<a class="d-link" style="--i:' + links.length + '" href="cart.html"><span>Cart <b data-cart-count>0</b></span><i class="chev" aria-hidden="true"></i></a>' : "") +
      "</nav>" +
      '<div class="d-bottom">' +
        '<div class="d-account">' + (loggedIn
          ? '<a href="#" id="drawer-logout">Logout' + (user ? " (" + firstName + ")" : "") + "</a>"
          : '<a href="login.html">Log in</a><a href="login.html">Create an account</a>') + "</div>" +
        (isStaff ? "" :
          '<div class="d-tabs"><a href="shop.html?category=men">For him</a><a href="shop.html?category=women">For her</a><a href="shop.html?category=unisex">Unisex</a></div>' +
          '<div class="d-contact"><a href="mailto:' + SHOP_EMAIL + '">' + SHOP_EMAIL + '</a><a href="tel:+639568963077">0956 896 3077</a></div>') +
      "</div>";
    document.body.appendChild(d);

    var btn = document.getElementById("menu-btn");
    function setMenu(open) {
      d.classList.toggle("open", open);
      d.setAttribute("aria-hidden", open ? "false" : "true");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      document.documentElement.classList.toggle("menu-open", open);
      if (open) document.getElementById("drawer-close").focus(); else if (document.activeElement && d.contains(document.activeElement)) btn.focus();
    }
    btn.onclick = function () { setMenu(true); };
    document.getElementById("drawer-close").onclick = function () { setMenu(false); };
    d.addEventListener("click", function (e) { if (e.target.closest("a.d-link, .d-tabs a, .d-contact a, .d-account a:not(#drawer-logout)")) setMenu(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && d.classList.contains("open")) setMenu(false); });
    window.addEventListener("resize", function () { if (window.innerWidth > 1080 && d.classList.contains("open")) setMenu(false); });
    var dl = document.getElementById("drawer-logout");
    if (dl) dl.onclick = function (e) { e.preventDefault(); logout(); };
  }

  var footer = document.getElementById("site-footer");
  if (footer) {
    var year = new Date().getFullYear();
    if (isStaff) {
      footer.className = "site-footer";
      footer.innerHTML = '<div class="container">© ' + year + " SCNTS Perfume. All rights reserved.</div>";
    } else {
      footer.className = "site-footer rich";
      footer.innerHTML =
        '<div class="container foot">' +
          '<div class="foot-cols">' +
            footCol("Customer care", [["contact.html", "Contact us"], ["my-orders.html", "My orders"], ["favorites.html", "Favorites"], [loggedIn ? "#" : "login.html", loggedIn ? "Logout" : "Log in"]]) +
            footCol("The house", [["index.html", "Home"], ["about.html", "Our story"], ["contact.html", "Contact"]]) +
            footCol("Shop", [["shop.html", "All fragrances"], ["shop.html?category=men", "For him"], ["shop.html?category=women", "For her"], ["shop.html?category=unisex", "Unisex"]]) +
          "</div>" +
          '<div class="foot-cta"><p class="foot-script">Stay close to the house</p>' +
            "<p>Questions about a scent or an order? Reach us here.</p>" +
            '<a class="btn" href="mailto:' + SHOP_EMAIL + '">Email us</a>' +
            '<div class="foot-phones"><a href="tel:+639568963077">0956 896 3077</a><a href="tel:+639331344997">0933 134 4997</a></div></div>' +
        "</div>" +
        '<div class="container foot-base"><span class="foot-brand"><i class="foot-emblem" aria-hidden="true"></i><span class="wordmark">Scnts</span></span>' +
        "<span>© " + year + " SCNTS Perfume. All rights reserved.</span></div>";
      var fl = footer.querySelector('a[href="#"]');
      if (fl) fl.onclick = function (e) { e.preventDefault(); logout(); };
    }
  }
  updateCartCount();
}

// Staff (employee / admin) have no customer cart, favorites or "my orders": send them to the POS
(function keepStaffOut() {
  var u = getUser();
  var page = location.pathname.split("/").pop();
  var customerOnly = ["cart.html", "checkout.html", "favorites.html", "my-orders.html"];
  if (u && (u.role === "employee" || u.role === "admin") && customerOnly.indexOf(page) !== -1 && !resellerSlug()) location.replace("pos.html");
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
