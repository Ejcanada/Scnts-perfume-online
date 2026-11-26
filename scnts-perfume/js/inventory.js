// inventory.js - stock list (everyone on staff), restock/adjust/history (admin)

var stockProducts = [];
var isAdminUser = false;
var action = null;   // { type: "restock" | "adjust", product }

var REASONS = {
  sale: "Sold (POS)", online_order: "Online order", restock: "Restocked", count: "Stock count",
  damaged: "Damaged or lost", adjustment: "Other fix", void: "Sale voided", order_cancelled: "Order cancelled"
};

function stockBadge(n) {
  if (n <= 0) return '<span class="badge out">Sold out</span>';
  if (n <= 5) return '<span class="badge low">' + n + " left</span>";
  return '<span class="badge ok">' + n + "</span>";
}

function drawStock() {
  var q = document.getElementById("search").value.trim().toLowerCase();
  var f = document.getElementById("filter").value;
  var list = stockProducts.filter(function (p) {
    if (q && p.name.toLowerCase().indexOf(q) === -1) return false;
    if (f === "low") return p.stock > 0 && p.stock <= 5;
    if (f === "out") return p.stock <= 0;
    return true;
  });
  document.getElementById("stock-rows").innerHTML = list.map(function (p) {
    var buttons = isAdminUser
      ? '<button class="btn btn-small" data-act="restock" data-id="' + p.id + '">+ Restock</button> ' +
        '<button class="btn btn-outline btn-small" data-act="adjust" data-id="' + p.id + '">Count / fix</button>'
      : "";
    return "<tr><td><strong>" + esc(p.name) + "</strong></td><td>" + categoryLabel(p.category) + "</td><td>" + money(p.price) +
      "</td><td>" + stockBadge(p.stock) + "</td><td>" + buttons + "</td></tr>";
  }).join("") || '<tr><td colspan="5" class="empty">No perfume found.</td></tr>';

  var units = stockProducts.reduce(function (s, p) { return s + p.stock; }, 0);
  var value = stockProducts.reduce(function (s, p) { return s + p.stock * p.price; }, 0);
  var low = stockProducts.filter(function (p) { return p.stock > 0 && p.stock <= 5; }).length;
  var out = stockProducts.filter(function (p) { return p.stock <= 0; }).length;
  document.getElementById("stock-cards").innerHTML =
    '<div class="stat"><div class="n">' + stockProducts.length + '</div><div class="l">Perfumes</div></div>' +
    '<div class="stat"><div class="n">' + units + '</div><div class="l">Bottles in stock</div></div>' +
    '<div class="stat"><div class="n">' + money(value) + '</div><div class="l">Stock value (selling price)</div></div>' +
    '<div class="stat"><div class="n">' + low + '</div><div class="l">Low stock</div></div>' +
    '<div class="stat"><div class="n">' + out + '</div><div class="l">Sold out</div></div>';
}

async function loadStock() {
  var data = await api("/products");
  stockProducts = data.products.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  drawStock();
  if (isAdminUser) {
    var sel = document.getElementById("h-product");
    var keep = sel.value;
    sel.innerHTML = '<option value="">All perfumes</option>' + stockProducts.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + " (" + categoryLabel(p.category) + ")</option>";
    }).join("");
    sel.value = keep;
  }
}

async function loadHistory() {
  var id = document.getElementById("h-product").value;
  var data = await api("/inventory/movements?limit=100" + (id ? "&product_id=" + id : ""));
  document.getElementById("history-rows").innerHTML = data.movements.map(function (m) {
    var cls = m.qty_change < 0 ? "neg" : "pos-num";
    return "<tr><td>" + dateTimeText(m.created_at) + "</td><td>" + esc(m.product ? m.product.name : "") + '</td><td class="' + cls + '">' +
      (m.qty_change > 0 ? "+" : "") + m.qty_change + "</td><td>" + m.stock_after + "</td><td>" + esc(REASONS[m.reason] || m.reason) +
      "</td><td>" + esc(m.user ? m.user.name : "") + "</td><td>" + esc(m.note || "") + "</td></tr>";
  }).join("") || '<tr><td colspan="7" class="empty">No stock changes yet.</td></tr>';
}

function openAction(type, product) {
  action = { type: type, product: product };
  document.getElementById("action-box").style.display = "block";
  document.getElementById("reason-wrap").style.display = type === "adjust" ? "block" : "none";
  var qty = document.getElementById("a-qty");
  if (type === "restock") {
    document.getElementById("action-title").textContent = "Restock: " + product.name + " (now " + product.stock + ")";
    document.getElementById("qty-label").textContent = "How many bottles did you add?";
    qty.min = 1; qty.value = "";
  } else {
    document.getElementById("action-title").textContent = "Count / fix: " + product.name + " (system says " + product.stock + ")";
    document.getElementById("qty-label").textContent = "How many bottles are really there?";
    qty.min = 0; qty.value = product.stock;
  }
  document.getElementById("a-note").value = "";
  qty.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = await requireRole(["employee", "admin"]);
  if (!user) return;
  isAdminUser = user.role === "admin";
  document.getElementById("act-head").textContent = isAdminUser ? "Actions" : "";
  if (isAdminUser) document.getElementById("history-box").style.display = "block";

  document.getElementById("search").addEventListener("input", drawStock);
  document.getElementById("filter").addEventListener("change", drawStock);
  document.getElementById("h-product").addEventListener("change", loadHistory);

  document.getElementById("stock-rows").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var p = stockProducts.find(function (x) { return x.id === Number(b.dataset.id); });
    hideMsg("msg");
    openAction(b.dataset.act, p);
  });

  document.getElementById("a-cancel").addEventListener("click", function () {
    action = null;
    document.getElementById("action-box").style.display = "none";
  });

  document.getElementById("action-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!action) return;
    hideMsg("msg");
    var qty = parseInt(document.getElementById("a-qty").value, 10);
    var note = document.getElementById("a-note").value.trim() || null;
    try {
      var res;
      if (action.type === "restock") {
        res = await api("/inventory/" + action.product.id + "/restock", "POST", { quantity: qty, note: note });
        showMsg("msg", res.name + " restocked. Now " + res.stock + " in stock.", "success");
      } else {
        res = await api("/inventory/" + action.product.id + "/adjust", "POST",
          { new_stock: qty, reason: document.getElementById("a-reason").value, note: note });
        showMsg("msg", res.name + " fixed. Difference: " + (res.difference > 0 ? "+" : "") + res.difference + ". Now " + res.stock + ".", "success");
      }
      action = null;
      document.getElementById("action-box").style.display = "none";
      await loadStock();
      await loadHistory();
    } catch (err) {
      showMsg("msg", err.message, "error");
    }
  });

  try {
    await loadStock();
    if (isAdminUser) await loadHistory();
  } catch (err) {
    showMsg("msg", err.message, "error");
  }
});
