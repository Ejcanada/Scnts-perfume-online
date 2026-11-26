// pos.js - point of sale for employees and admin

var allProducts = [];
var sale = {};          // product id -> quantity
var custom = {};        // product id -> the staff's own selling price (only when different from the list price)
var livePromos = [];    // promos that are running now
var chosen = [];        // promo ids the staff ticked
var quote = null;       // price from the server: own prices + promos
var quoteSeq = 0;
var isReseller = false;   // employee = reseller: own shop prices and a fixed company price they cannot go under
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

function unitPrice(p) {
  return custom[p.id] !== undefined ? custom[p.id] : Number(p.price);
}

function saleTotal() {
  var total = 0;
  Object.keys(sale).forEach(function (id) { total += unitPrice(productById(Number(id))) * sale[id]; });
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
      var isCustom = custom[p.id] !== undefined;
      return '<div class="sale-line"><span class="nm">' + esc(p.name) +
        '<br><span class="price-edit"><input type="number" inputmode="decimal" min="' + (isReseller && p.company_price ? p.company_price : 1) + '" step="0.01" data-price="' + id + '" value="' + unitPrice(p) + '" aria-label="Selling price of ' + esc(p.name) + '">' +
        (isCustom ? '<span class="was">' + money(p.price) + '</span><button type="button" class="reset" data-reset="' + id + '">reset</button>' : "") +
        '</span><span class="line-off" data-off="' + id + '"></span></span>' +
        '<span class="qtybox"><button data-act="minus" data-id="' + id + '">−</button><span>' + sale[id] +
        '</span><button data-act="plus" data-id="' + id + '">+</button></span></div>';
    }).join("");
  }
  drawPromoPick();
  document.getElementById("record-btn").disabled = !ids.length;
  drawTiles();
  refreshQuote();
}

function drawPromoPick() {
  var box = document.getElementById("promo-pick");
  var wrap = document.getElementById("promo-wrap");
  wrap.style.display = livePromos.length && Object.keys(sale).length ? "" : "none";
  box.innerHTML = livePromos.map(function (p) {
    var on = chosen.indexOf(p.id) !== -1;
    return '<label class="' + (on ? "on" : "") + '"><input type="checkbox" data-promo="' + p.id + '"' + (on ? " checked" : "") + ' style="width:auto;margin-top:4px">' +
      "<span><strong>" + esc(p.name) + "</strong><small>" + esc(promoText(p)) + "</small></span></label>";
  }).join("");
}

// ask the server for the price, so the staff sees exactly what will be saved
async function refreshQuote() {
  var ids = Object.keys(sale);
  var seq = ++quoteSeq;
  if (!ids.length) { quote = null; drawTotals(); return; }
  drawTotals();                       // show a quick local total while we wait
  try {
    var q = await api("/pos/quote", "POST", { items: saleItems(), promo_ids: chosen });
    if (seq !== quoteSeq) return;     // an older answer, ignore
    quote = q;
  } catch (err) {
    if (seq !== quoteSeq) return;
    quote = null;
    showMsg("msg", err.message, "error");
  }
  drawTotals();
}

function saleItems() {
  return Object.keys(sale).map(function (id) {
    var it = { product_id: Number(id), quantity: sale[id] };
    if (custom[id] !== undefined) it.price = custom[id];
    return it;
  });
}

function drawTotals() {
  var el = document.getElementById("sale-total");
  var bd = document.getElementById("breakdown");
  Array.prototype.forEach.call(document.querySelectorAll("[data-off]"), function (n) { n.textContent = ""; });
  if (!quote) { el.textContent = money(saleTotal()); bd.innerHTML = ""; return; }
  el.textContent = money(quote.total);
  var rows = "";
  if (quote.promos.length || quote.price_adjust !== 0 || (isReseller && quote.profit !== undefined)) {
    rows += '<div class="row"><span>List price</span><span>' + money(quote.list_total) + "</span></div>";
    if (quote.price_adjust !== 0) {
      rows += '<div class="row ' + (quote.price_adjust < 0 ? "minus" : "plus") + '"><span>Your own prices</span><span>' +
        (quote.price_adjust < 0 ? "−" : "+") + money(Math.abs(quote.price_adjust)) + "</span></div>";
    }
    quote.promos.forEach(function (a) {
      rows += '<div class="row minus"><span>' + esc(a.name) + "</span><span>−" + money(a.discount) + "</span></div>";
    });
  }
  if (isReseller && quote.profit !== undefined) {
    rows += '<div class="row"><span>Company price</span><span>' + money(quote.company_total) + '</span></div>' +
      '<div class="row minus"><span><strong>Your earnings on this sale</strong></span><span><strong>' + money(quote.profit) + "</strong></span></div>";
  }
  chosen.forEach(function (id) {
    var p = livePromos.find(function (x) { return x.id === id; });
    if (p && !quote.promos.some(function (a) { return a.promo_id === id; })) {
      rows += '<div class="row"><span>' + esc(p.name) + '</span><span>not used yet</span></div>';
    }
  });
  bd.innerHTML = rows;
  quote.lines.forEach(function (l) {
    var n = document.querySelector('[data-off="' + l.product_id + '"]');
    if (n && l.discount > 0) n.textContent = "promo −" + money(l.discount);
    else if (n && l.custom) n.textContent = "own price (no promo)";
  });
}

async function loadProducts() {
  var data = await api("/products");
  allProducts = data.products;
  if (isReseller) {
    try {
      var shop = await api("/reseller/shop");
      var byId = {};
      shop.products.forEach(function (r) { byId[r.product_id] = r; });
      allProducts.forEach(function (p) {
        var r = byId[p.id];
        if (r) { p.price = r.price; p.company_price = r.company_price; }
      });
    } catch (e) { showMsg("msg", e.message, "error"); }
  }
  // remove sale lines for perfumes that no longer exist or have no stock
  Object.keys(sale).forEach(function (id) {
    var p = productById(Number(id));
    if (!p || sale[id] > p.stock) { delete sale[id]; delete custom[id]; }
  });
  drawSale();
}

async function loadPromos() {
  try {
    var d = await api("/promos");
    livePromos = d.promos.filter(function (p) { return p.live; });
    chosen = chosen.filter(function (id) { return livePromos.some(function (p) { return p.id === id; }); });
  } catch (e) { livePromos = []; }
}

function promoNote(s) {
  var bits = (s.sale_promos || []).map(function (p) { return esc(p.promo_name) + " −" + money(p.discount); });
  var own = (s.sale_items || []).some(function (i) { return i.list_price !== null && Number(i.list_price) !== Number(i.price); });
  if (own) bits.push("own price");
  return bits.length ? "<br><small>" + bits.join(" · ") + "</small>" : "";
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
    items += promoNote(s);
    var voided = s.status === "voided";
    return '<tr class="' + (voided ? "row-void" : "") + '"><td>' + timeText(s.created_at) + "</td><td>" +
      esc(s.employee ? s.employee.name : "") + "</td><td>" + items + "</td><td>" + esc(s.payment_method) +
      '</td><td>' + money(s.total) + (voided ? ' <span class="badge out keep">VOIDED</span>' : "") + "</td></tr>";
  }).join("");
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = await requireRole(["employee", "admin"]);
  if (!user) return;
  isReseller = user.role === "employee";

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
    hideMsg("msg");
    drawSale();
  });

  document.getElementById("sale-lines").addEventListener("change", function (e) {
    var inp = e.target.closest("input[data-price]");
    if (!inp) return;
    var id = Number(inp.dataset.price), p = productById(id);
    var v = Number(inp.value);
    var lowest = isReseller && p.company_price ? Number(p.company_price) : 1;
    if (!(v >= lowest)) { toast("Lowest price is " + money(lowest) + (isReseller ? " (company price)" : "")); delete custom[id]; }
    else if (v === Number(p.price)) delete custom[id];
    else custom[id] = Math.round(v * 100) / 100;
    hideMsg("msg");
    drawSale();
  });

  document.getElementById("promo-pick").addEventListener("change", function (e) {
    var c = e.target.closest("input[data-promo]");
    if (!c) return;
    var id = Number(c.dataset.promo);
    chosen = chosen.filter(function (x) { return x !== id; });
    if (c.checked) chosen.push(id);
    hideMsg("msg");
    drawSale();
  });

  document.getElementById("sale-lines").addEventListener("click", function (e) {
    var r = e.target.closest("button[data-reset]");
    if (r) { delete custom[Number(r.dataset.reset)]; drawSale(); return; }
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var id = Number(b.dataset.id);
    var p = productById(id);
    if (b.dataset.act === "plus") {
      if (sale[id] + 1 > p.stock) { toast("Only " + p.stock + " in stock"); return; }
      sale[id] += 1;
    } else {
      sale[id] -= 1;
      if (sale[id] <= 0) { delete sale[id]; delete custom[id]; }
    }
    drawSale();
  });

  document.getElementById("pay-options").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-pay]");
    if (!b) return;
    payment = b.dataset.pay;
    Array.prototype.forEach.call(document.querySelectorAll("#pay-options button"), function (x) { x.classList.toggle("active", x === b); });
  });

  document.getElementById("clear-btn").addEventListener("click", function () { sale = {}; custom = {}; chosen = []; hideMsg("msg"); drawSale(); });

  document.getElementById("record-btn").addEventListener("click", async function () {
    var ids = Object.keys(sale);
    if (!ids.length) return;
    if (!quote) { showMsg("msg", "The price could not be checked. Please try again.", "error"); refreshQuote(); return; }
    var lines = quote.lines.map(function (l) {
      return l.quantity + " × " + l.name + " @ " + money(l.price) + (l.custom ? " (your price)" : "");
    }).join("\n");
    var promoLines = quote.promos.map(function (a) { return "\n" + a.name + ": −" + money(a.discount); }).join("");
    if (!confirm("Record this sale?\n\n" + lines + promoLines + "\n\nTotal: " + money(quote.total) + " (" + payment + ")")) return;

    var btn = document.getElementById("record-btn");
    btn.disabled = true;
    hideMsg("msg");
    try {
      var items = saleItems();
      var note = document.getElementById("sale-note").value.trim();
      var res = await api("/pos/sales", "POST", { items: items, payment_method: payment, note: note || null, promo_ids: chosen });
      showMsg("msg", "Sale #" + res.id + " recorded: " + money(res.total) + " (" + payment + ")", "success");
      sale = {}; custom = {}; chosen = [];
      document.getElementById("sale-note").value = "";
      await loadPromos();
      await loadProducts();
      await loadToday();
    } catch (err) {
      showMsg("msg", err.message, "error");
      await loadPromos();
      await loadProducts();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  try {
    await loadPromos();
    await loadProducts();
    await loadToday();
  } catch (err) {
    showMsg("msg", err.message, "error");
  }
});
