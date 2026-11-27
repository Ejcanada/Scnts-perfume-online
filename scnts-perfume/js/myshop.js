// myshop.js - a reseller's own shop link and own prices (never under the company price)

var rows = [];

function $(id) { return document.getElementById(id); }

function effective(r, inputVal) {
  var v = inputVal === "" ? r.normal_price : Number(inputVal);
  return Math.max(v, 0);
}

function drawRows() {
  var q = $("search").value.trim().toLowerCase();
  $("price-rows").innerHTML = rows.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) !== -1; }).map(function (r) {
    return "<tr><td><strong>" + esc(r.name) + "</strong><br><small>" + categoryLabel(r.category) + " · " + r.size_ml + " ml</small></td>" +
      "<td>" + money(r.normal_price) + "</td><td>" + money(r.company_price) + "</td>" +
      '<td><input type="number" inputmode="decimal" min="' + r.company_price + '" step="0.01" data-id="' + r.product_id + '" value="' + (r.edit === undefined ? "" : r.edit) + '" placeholder="' + r.normal_price + '"></td>' +
      '<td class="markup" data-markup="' + r.product_id + '"></td></tr>';
  }).join("");
  rows.forEach(function (r) { showMarkup(r); });
}

function showMarkup(r) {
  var cell = document.querySelector('[data-markup="' + r.product_id + '"]');
  if (!cell) return;
  var v = effective(r, r.edit === undefined ? "" : r.edit);
  var m = v - r.company_price;
  cell.className = "markup" + (m < 0 ? " bad" : "");
  cell.textContent = m < 0 ? "Too low (min " + money(r.company_price) + ")" : "+" + money(m);
}

async function load() {
  var d = await api("/reseller/shop");
  if (d.main) {
    // admin: the shop link IS the main shop, with the normal prices from Products
    $("shop-link").value = location.origin + "/shop.html";
    $("open-link").href = "shop.html?r=";
    $("link-note").textContent = "This is the main SCNTS shop. Customers see the normal prices from Products. Orders from it are not tagged to anyone.";
    $("prices-box").style.display = "none";
    $("main-note").style.display = "block";
    return;
  }
  var link = location.origin + "/shop.html?r=" + d.slug;
  $("shop-link").value = link;
  $("open-link").href = "shop.html?r=" + d.slug;
  rows = d.products;
  rows.forEach(function (r) { r.edit = r.own_price === null || r.own_price === undefined ? "" : r.own_price; r.saved = r.edit; });
  drawRows();
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = await requireRole(["employee", "admin"]);
  if (!user) return;

  $("copy-btn").addEventListener("click", async function () {
    try { await navigator.clipboard.writeText($("shop-link").value); toast("Link copied"); }
    catch (e) { $("shop-link").select(); document.execCommand("copy"); toast("Link copied"); }
  });
  $("search").addEventListener("input", drawRows);
  $("price-rows").addEventListener("input", function (e) {
    var inp = e.target.closest("input[data-id]");
    if (!inp) return;
    var r = rows.find(function (x) { return x.product_id === Number(inp.dataset.id); });
    r.edit = inp.value;
    showMarkup(r);
  });

  $("save-btn").addEventListener("click", async function () {
    hideMsg("msg");
    var changes = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (String(r.edit) === String(r.saved)) continue;
      if (r.edit === "") { changes.push({ product_id: r.product_id, price: null }); continue; }
      var v = Number(r.edit);
      if (!(v >= r.company_price)) { showMsg("msg", "The lowest price for " + r.name + " is " + money(r.company_price) + " (company price).", "error"); return; }
      changes.push({ product_id: r.product_id, price: v });
    }
    if (!changes.length) { showMsg("msg", "Nothing changed.", "info"); return; }
    var btn = $("save-btn");
    btn.disabled = true;
    try {
      await api("/reseller/shop/prices", "PUT", { prices: changes });
      toast("Prices saved");
      await load();
    } catch (err) { showMsg("msg", err.message, "error"); }
    btn.disabled = false;
  });

  try { await load(); } catch (err) { showMsg("msg", err.message, "error"); }
});
