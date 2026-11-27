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
  return "Perfume";
}

// ---------- product card used by Home, Shop and Favorites ----------
function productImage(p) {
  var img = p.image_url ? '<img src="' + esc(p.image_url) + '" alt="' + esc(p.name) + '" onerror="this.style.display=\'none\'">' : "";
  return '<div class="pimg">SCNTS' + img + "</div>";
}

function productCard(p, isFav) {
  return '<div class="card">' +
    '<div style="position:relative">' + productImage(p) +
    (p.stock <= 0 ? '<span class="badge soldout">Sold out</span>' : (p.stock <= 5 ? '<span class="badge">Only ' + p.stock + ' left</span>' : "")) +
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
  if (isStaff) { buildStaffShell(user, page); return; }
  document.body.classList.remove("staff-shell");
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
    if (asCustomer) links.push(["dashboard.html", "Back to staff"]);
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
      '<a class="logo" href="' + (isStaff ? "dashboard.html" : "index.html") + '" aria-label="SCNTS home">SCNTS</a>' +
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
      '<a class="d-mark" href="' + (isStaff ? "dashboard.html" : "index.html") + '" aria-hidden="true" tabindex="-1"></a></div>' +
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
          '<div class="d-tabs"><a href="shop.html?category=men">For him</a><a href="shop.html?category=women">For her</a></div>' +
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
            footCol("Shop", [["shop.html", "All fragrances"], ["shop.html?category=men", "For him"], ["shop.html?category=women", "For her"]]) +
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
  if (u && (u.role === "employee" || u.role === "admin") && customerOnly.indexOf(page) !== -1 && !resellerSlug()) location.replace("dashboard.html");
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


// ===============================================================
// Staff shell: sidebar + top bar (employee and admin pages)
// ===============================================================
var SI = {
  dashboard: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5" rx="2"/><rect x="13.5" y="11" width="7.5" height="10" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/></svg>',
  pos: '<svg viewBox="0 0 24 24"><path d="M3 4h2.5l2.2 11h10.6L20.5 7H6.4"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>',
  inventory: '<svg viewBox="0 0 24 24"><path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9"/></svg>',
  sales: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M16.5 7.5c-.6-1.4-2.3-2.2-4.5-2.2-2.6 0-4.2 1.2-4.2 3 0 4.2 9 2 9 6.3 0 1.9-1.9 3.2-4.8 3.2-2.4 0-4.2-.9-5-2.5"/></svg>',
  orders: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  promos: '<svg viewBox="0 0 24 24"><path d="M3 12.5V4h8.5l9 9-8.5 8.5z"/><circle cx="7.8" cy="8.3" r="1.3"/></svg>',
  myshop: '<svg viewBox="0 0 24 24"><path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5c0 1.7 1.3 3 2.7 3s2.6-1.3 2.6-3c0 1.7 1.3 3 2.7 3s2.7-1.3 2.7-3c0 1.7 1.3 3 2.6 3S20 11.2 20 9.5V20H4z"/></svg>',
  earnings: '<svg viewBox="0 0 24 24"><path d="M3 17l5.5-5.5 4 4L21 7"/><path d="M15 7h6v6"/></svg>',
  reports: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></svg>',
  staff: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.6 3.3-5.5 6.5-5.5s5.8 1.9 6.5 5.5"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.8c1.9.8 3 2.6 3.5 5.2"/></svg>',
  products: '<svg viewBox="0 0 24 24"><path d="M9.5 3h5v3h-5z"/><path d="M7 6h10l1.5 4v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9z"/><path d="M9 13h6"/></svg>',
  payments: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.5h18M7 15h3"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M10 4H5v16h5"/><path d="M15 8l4 4-4 4M19 12H9"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>'
};

function buildStaffShell(user, page) {
  var role = user ? user.role : "employee";
  var groups = [
    ["Overview", [["dashboard.html", "Dashboard", "dashboard"], ["pos.html", "POS", "pos"], ["inventory.html", "Inventory", "inventory"]]],
    ["Sell", [["promos.html", "Promos", "promos"], ["myshop.html", "My Shop", "myshop"], ["earnings.html", "Earnings", "earnings"]]]
  ];
  if (role === "admin") {
    groups.push(["Manage", [["orders.html", "Orders", "orders"], ["sales.html", "Sales", "sales"], ["reports.html", "Reports", "reports"],
      ["payments.html", "Payments", "payments"], ["staff.html", "Staff", "staff"], ["admin.html", "Products", "products"]]]);
  }
  document.body.classList.add("staff-shell");
  try { if (localStorage.getItem("scnts_side") === "min") document.body.classList.add("side-min"); } catch (e) {}

  var old = document.getElementById("sidebar");
  if (old) old.remove();
  var oldBack = document.getElementById("side-back");
  if (oldBack) oldBack.remove();
  var i = 0;
  var side = document.createElement("aside");
  side.id = "sidebar";
  side.className = "sidebar";
  side.innerHTML =
    '<a class="s-brand" href="dashboard.html"><span class="s-mark"></span><span class="s-name">Scnts<small>' + (role === "admin" ? "Admin" : "Staff") + '</small></span></a>' +
    '<button type="button" class="s-collapse" id="s-collapse" aria-label="Collapse menu">' + SI.chev + "</button>" +
    '<nav class="s-nav">' + groups.map(function (g) {
      return '<div class="s-group">' + g[0] + "</div>" + g[1].map(function (l) {
        return '<a class="s-link' + (page === l[0] ? " active" : "") + '" href="' + l[0] + '" style="--i:' + (i++) + '" title="' + l[1] + '">' + SI[l[2]] + "<span>" + l[1] + "</span></a>";
      }).join("");
    }).join("") + "</nav>" +
    '<div class="s-foot"><div class="s-tip"><b>Tip</b><span>Record every sale in POS so stock stays right.</span></div></div>';
  var back = document.createElement("div");
  back.id = "side-back";
  back.className = "side-back";
  document.body.insertBefore(back, document.body.firstChild);
  document.body.insertBefore(side, document.body.firstChild);

  var first = user && user.name ? user.name.split(" ")[0] : "";
  var initial = first ? first.charAt(0).toUpperCase() : "S";
  var header = document.getElementById("site-header");
  if (header) {
    header.className = "site-header top-bar";
    header.innerHTML =
      '<div class="tb-left"><button type="button" class="tb-menu" id="tb-menu" aria-label="Open menu"><i></i><i></i><i></i></button>' +
      '<div class="tb-hello"><strong>Welcome back, ' + esc(first || "there") + '!</strong><span>Here is the summary of your shop</span></div></div>' +
      '<form class="tb-search" id="tb-search">' + SI.search + '<input id="tb-q" type="search" placeholder="Search perfumes in inventory..." autocomplete="off"></form>' +
      '<div class="tb-right">' +
        '<a class="tb-bell" id="tb-bell" href="dashboard.html#alerts" aria-label="Low stock alerts" title="Low stock alerts">' + SI.bell + '<b id="tb-bell-n" hidden>0</b></a>' +
        '<div class="tb-user"><span class="tb-av">' + esc(initial) + '</span><span class="tb-who"><strong>' + esc(user ? user.name : "") + "</strong><em>" + (role === "admin" ? "Owner" : "Employee") + "</em></span></div>" +
        '<button type="button" class="tb-logout" id="tb-logout">' + SI.out + "<span>Logout</span></button>" +
      "</div>";
    document.getElementById("tb-logout").onclick = function () { logout(); };
    document.getElementById("tb-search").onsubmit = function (e) {
      e.preventDefault();
      var q = document.getElementById("tb-q").value.trim();
      location.href = "inventory.html" + (q ? "?q=" + encodeURIComponent(q) : "");
    };
  }
  function setSide(open) {
    document.body.classList.toggle("side-open", open);
  }
  document.getElementById("tb-menu").onclick = function () { setSide(!document.body.classList.contains("side-open")); };
  back.onclick = function () { setSide(false); };
  side.addEventListener("click", function (e) { if (e.target.closest("a.s-link")) setSide(false); });
  document.getElementById("s-collapse").onclick = function () {
    var min = document.body.classList.toggle("side-min");
    try { localStorage.setItem("scnts_side", min ? "min" : "full"); } catch (e) {}
  };
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") setSide(false); });

  var footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "site-footer mini";
    footer.innerHTML = '<div class="container">© ' + new Date().getFullYear() + " SCNTS Perfume · Staff area</div>";
  }
  staffAlertCount();
}

// number on the bell = perfumes with 5 or fewer left
async function staffAlertCount() {
  try {
    var data = await api("/products");
    var n = data.products.filter(function (p) { return p.stock <= 5; }).length;
    var b = document.getElementById("tb-bell-n");
    if (b && n) { b.textContent = n; b.hidden = false; }
  } catch (e) {}
}
