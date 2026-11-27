// api.js - helper that talks to the FastAPI backend (same domain, so no URL needed)

function getToken() {
  try { return localStorage.getItem("scnts_token"); } catch (e) { return null; }
}

function getUser() {
  try { return JSON.parse(localStorage.getItem("scnts_user")); } catch (e) { return null; }
}

// Pages that need a login. Everything else can be opened as a guest.
var PROTECTED_PAGES = ["cart.html", "checkout.html", "my-orders.html", "favorites.html", "admin.html",
  "dashboard.html", "payments.html", "pos.html", "inventory.html", "sales.html", "staff.html", "orders.html", "reports.html", "promos.html", "myshop.html", "earnings.html"];

function currentPage() {
  return location.pathname.split("/").pop() || "index.html";
}

function isProtectedPage() {
  return PROTECTED_PAGES.indexOf(currentPage()) !== -1;
}

function goToLogin() {
  location.href = "login.html?next=" + encodeURIComponent(currentPage() + location.search) + "&msg=login";
}

// Use this before add to cart, favorites or checkout. Guests are sent to the login page.
function requireLogin() {
  if (getToken()) return true;
  goToLogin();
  return false;
}

function clearSession() {
  try {
    localStorage.removeItem("scnts_token");
    localStorage.removeItem("scnts_user");
    localStorage.removeItem("scnts_cart");
  } catch (e) {}
}

function logout() {
  clearSession();
  location.href = "index.html";
}

// Guests can look at the shop, but these pages need a login
if (isProtectedPage() && !getToken()) {
  location.replace("login.html?next=" + encodeURIComponent(currentPage()) + "&msg=login");
}

// Turn an API error into a short message
function errorText(data) {
  if (!data || !data.detail) return "Something went wrong. Please try again.";
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) {
    return data.detail.map(function (e) {
      var field = e.loc && e.loc.length ? e.loc[e.loc.length - 1] : "";
      return field + ": " + e.msg;
    }).join(". ");
  }
  return "Something went wrong. Please try again.";
}

async function api(path, method, body) {
  var options = { method: method || "GET", headers: {} };
  var token = getToken();
  if (token) options.headers["Authorization"] = "Bearer " + token;
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  var res;
  try {
    res = await fetch(path, options);
  } catch (e) {
    throw new Error("Cannot reach the server.");
  }

  var data = null;
  try {
    data = await res.json();
  } catch (e) {
    if (!res.ok) throw new Error("Server error (code " + res.status + ")");
  }

  // The token ran out or is not valid anymore
  if (res.status === 401 && token) {
    clearSession();
    if (isProtectedPage()) goToLogin(); else location.reload();
    throw new Error("Session expired. Please log in again.");
  }
  if (!res.ok) throw new Error(errorText(data));
  return data;
}
