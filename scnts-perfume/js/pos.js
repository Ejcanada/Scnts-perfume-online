// pos.js - point of sale for employees and admin

var allProducts = [];
var sale = {};          // product id -> quantity
var payment = "cash";
var category = "";

function productById(id) {
  return allProducts.find(function (p) { return p.id === id; });
}

function drawTiles() {
  var q = document.getElementById("search").value.trim().toLowerCase();
  var list = allProducts.filter(function (p) {
    return (!category || p.category === category) && (!q || p.name.toLowerCase().indexOf(q) !== -1);
  });
  var box = document.getElementById("tiles");
  if (!list.length) { box.innerHTML = '<p class="empty">No perfume found.</p>'; return; }
  box.innerHTML = list.map(function (p) {
    var left = p.stock - (sale[p.id] || 0);
    return '<button class="tile' + (p.stock <= 5 ? " low" : "") + '" data-id="' + p.id + '"' + (left <= 0 ? " disabled" : "") + ">" +
      '<span class="t-name">' + esc(p.name) + "</span>" +
      '<span class="tag">' + categoryLabel(p.category) + "</span>" +
      '<span class="t-price">' + money(p.price) + "</span>" +
      '<span class="t-stock">' + (p.stock <= 0 ? "SOLD OUT" : "Stock: " + p.stock) + "</span></button>";
  }).join("");
}

function saleTotal() {
  var total = 0;
  Object.keys(sale).forEach(function (id) { total += productById(Number(id)).price * sale[id]; });
  return total;
}

function drawSale() {
  var ids = Object.keys(sale);
  var box = document.getElementById("sale-lines");
  if (!ids.length) {
    box.innerHTML = '<p class="empty">Nothing yet. Tap a perfume.</p>';
  } else {
    box.innerHTML = ids.map(function (id) {
      var p = productById(Number(id));
      return '<div class="sale-line"><span class="nm">' + esc(p.name) + "<br><small>" + money(p.price) + "</small></span>" +
        '<span class="qtybox"><button data-act="minus" data-id="' + id + '">−</button><span>' + sale[id] +
        '</span><button data-act="plus" data-id="' + id + '">+</button></span></div>';
    }).join("");
  }
  document.getElementById("sale-total").textContent = money(saleTotal());
  document.getElementById("record-btn").disabled = !ids.length;
  drawTiles();
}

async function loadProducts() {
  var data = await api("/products");
  allProducts = data.products;
  // remove sale lines for perfumes that no longer exist or have no stock
  Object.keys(sale).forEach(function (id) {
    var p = productById(Number(id));
    if (!p || sale[id] > p.stock) delete sale[id];
  });
  drawSale();
}

async function loadToday() {
  var day = today();
  var summary = await api("/pos/summary?date=" + day);
  var list = await api("/pos/sales?date=" + day);

  var cards = '<div class="stat"><div class="n">' + summary.sales_count + '</div><div class="l">Sales today</div></div>' +
    '<div class="stat"><div class="n">' + summary.items_sold + '</div><div class="l">Perfumes sold</div></div>' +
    '<div class="stat"><div class="n">' + money(summary.total) + '</div><div class="l">Total money</div></div>' +
    '<div class="stat"><div class="n">' + money(summary.by_payment.cash) + '</div><div class="l">Cash</div></div>' +
    '<div class="stat"><div class="n">' + money(summary.by_payment.gcash) + '</div><div class="l">GCash</div></div>';
  document.getElementById("today-cards").innerHTML = cards;

  var rows = document.getElementById("today-rows");
  if (!list.sales.length) { rows.innerHTML = '<tr><td colspan="5" class="empty">No sales yet today.</td></tr>'; return; }
  rows.innerHTML = list.sales.map(function (s) {
    var items = s.sale_items.map(function (i) { return i.quantity + " × " + esc(i.product ? i.product.name : "Perfume"); }).join(", ");
    var voided = s.status === "voided";
    return '<tr class="' + (voided ? "row-void" : "") + '"><td>' + timeText(s.created_at) + "</td><td>" +
      esc(s.employee ? s.employee.name : "") + "</td><td>" + items + "</td><td>" + esc(s.payment_method) +
      '</td><td>' + money(s.total) + (voided ? ' <span class="badge out keep">VOIDED</span>' : "") + "</td></tr>";
  }).join("");
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = await requireRole(["employee", "admin"]);
  if (!user) return;

  document.getElementById("search").addEventListener("input", drawTiles);

  document.getElementById("chips").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-cat]");
    if (!b) return;
    category = b.dataset.cat;
    Array.prototype.forEach.call(document.querySelectorAll("#chips .chip"), function (c) { c.classList.toggle("active", c === b); });
    drawTiles();
  });

  document.getElementById("tiles").addEventListener("click", function (e) {
    var b = e.target.closest("button.tile");
    if (!b) return;
    var id = Number(b.dataset.id);
    var p = productById(id);
    if ((sale[id] || 0) + 1 > p.stock) { toast("Only " + p.stock + " in stock"); return; }
    sale[id] = (sale[id] || 0) + 1;
    drawSale();
  });

  document.getElementById("sale-lines").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var id = Number(b.dataset.id);
    var p = productById(id);
    if (b.dataset.act === "plus") {
      if (sale[id] + 1 > p.stock) { toast("Only " + p.stock + " in stock"); return; }
      sale[id] += 1;
    } else {
      sale[id] -= 1;
      if (sale[id] <= 0) delete sale[id];
    }
    drawSale();
  });

  document.getElementById("pay-options").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-pay]");
    if (!b) return;
    payment = b.dataset.pay;
    Array.prototype.forEach.call(document.querySelectorAll("#pay-options button"), function (x) { x.classList.toggle("active", x === b); });
  });

  document.getElementById("clear-btn").addEventListener("click", function () { sale = {}; hideMsg("msg"); drawSale(); });

  document.getElementById("record-btn").addEventListener("click", async function () {
    var ids = Object.keys(sale);
    if (!ids.length) return;
    var lines = ids.map(function (id) { return sale[id] + " × " + productById(Number(id)).name; }).join("\n");
    if (!confirm("Record this sale?\n\n" + lines + "\n\nTotal: " + money(saleTotal()) + " (" + payment + ")")) return;

    var btn = document.getElementById("record-btn");
    btn.disabled = true;
    hideMsg("msg");
    try {
      var items = ids.map(function (id) { return { product_id: Number(id), quantity: sale[id] }; });
      var note = document.getElementById("sale-note").value.trim();
      var res = await api("/pos/sales", "POST", { items: items, payment_method: payment, note: note || null });
      showMsg("msg", "Sale #" + res.id + " recorded: " + money(res.total) + " (" + payment + ")", "success");
      sale = {};
      document.getElementById("sale-note").value = "";
      await loadProducts();
      await loadToday();
    } catch (err) {
      showMsg("msg", err.message, "error");
      await loadProducts();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  try {
    await loadProducts();
    await loadToday();
  } catch (err) {
    showMsg("msg", err.message, "error");
  }
});
