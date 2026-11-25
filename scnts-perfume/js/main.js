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
  var links = [["index.html", "Home"], ["shop.html", "Shop"]];
  if (loggedIn) links.push(["favorites.html", "Favorites"], ["my-orders.html", "My orders"]);
  links.push(["about.html", "About"], ["contact.html", "Contact"]);
  if (loggedIn && user && user.role === "admin") links.push(["admin.html", "Admin"]);

  var nav = links.map(function (l) {
    return '<a href="' + l[0] + '"' + (page === l[0] ? ' class="active"' : "") + ">" + l[1] + "</a>";
  }).join("");

  var header = document.getElementById("site-header");
  if (header) {
    header.className = "site-header";
    header.innerHTML = '<div class="container nav">' +
      '<a class="logo" href="index.html">SCNTS</a>' +
      '<button class="menu-btn" id="menu-btn" aria-label="Menu">☰</button>' +
      '<div class="nav-links" id="nav-links">' + nav +
      (loggedIn
        ? '<a class="cart-link" href="cart.html">Cart<span id="cart-count">0</span></a>' +
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

document.addEventListener("DOMContentLoaded", buildLayout);
