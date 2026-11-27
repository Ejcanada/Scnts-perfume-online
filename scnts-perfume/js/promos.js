// promos.js - staff make their own promos (2 for a price, buy and get free, % off, pesos off)

var me = null;
var promos = [];

function $(id) { return document.getElementById(id); }

function syncForm() {
  var t = $("p-type").value, s = $("p-scope").value;
  $("f-buy").style.display = (t === "bundle" || t === "buy_get") ? "" : "none";
  $("f-get").style.display = t === "buy_get" ? "" : "none";
  $("f-value").style.display = t === "buy_get" ? "none" : "";
  $("f-min").style.display = (t === "percent" || t === "amount") ? "" : "none";
  $("l-buy").textContent = t === "buy_get" ? "Buy how many" : "How many perfumes";
  $("l-value").textContent = t === "bundle" ? "Price for all of them (₱)" : t === "percent" ? "Percent off (%)" : "Pesos off each (₱)";
  $("f-cat").style.display = s === "category" ? "" : "none";
  $("f-prod").style.display = s === "product" ? "" : "none";
  var p = readForm();
  $("p-preview").textContent = "Preview: " + (p.name ? p.name + " - " : "") + promoText(Object.assign({ product: productFor(p.product_id), min_qty: p.min_qty }, p));
}

function productFor(id) {
  var o = $("p-prod").selectedOptions[0];
  return o ? { name: o.textContent } : null;
}

function readForm() {
  var t = $("p-type").value, s = $("p-scope").value;
  var o = {
    name: $("p-name").value.trim(), promo_type: t, scope: s,
    category: s === "category" ? $("p-cat").value : null,
    product_id: s === "product" && $("p-prod").value ? Number($("p-prod").value) : null,
    buy_qty: (t === "bundle" || t === "buy_get") ? Number($("p-buy").value) || null : null,
    get_qty: t === "buy_get" ? Number($("p-get").value) || null : null,
    value: t === "buy_get" ? null : ($("p-value").value === "" ? null : Number($("p-value").value)),
    min_qty: (t === "percent" || t === "amount") ? Number($("p-min").value) || 1 : 1,
    starts_on: $("p-start").value || null, ends_on: $("p-end").value || null,
    note: $("p-note").value.trim() || null
  };
  return o;
}

function status(p) {
  if (!p.is_active) return '<span class="badge out">Off</span>';
  if (p.live) return '<span class="badge ok">Running</span>';
  var t = today();
  return '<span class="badge low">' + (p.starts_on && t < p.starts_on ? "Starts " + esc(p.starts_on) : "Ended") + "</span>";
}

function drawList() {
  var box = $("promo-list");
  if (!promos.length) { box.innerHTML = '<p class="empty">No promos yet. Make your first one above.</p>'; return; }
  box.innerHTML = promos.map(function (p) {
    var mine = me.role === "admin" || p.created_by === me.id;
    var dates = (p.starts_on || p.ends_on) ? " · " + esc(p.starts_on || "now") + " to " + esc(p.ends_on || "no end") : "";
    var acts = mine ? '<div class="acts"><button class="btn btn-outline btn-small" data-toggle="' + p.id + '">' + (p.is_active ? "Turn off" : "Turn on") +
      '</button><button class="btn btn-danger btn-small" data-del="' + p.id + '">Delete</button></div>' : "";
    return '<div class="box promo-card' + (p.is_active ? "" : " off") + '"><div><h3>' + esc(p.name) + " " + status(p) + "</h3>" +
      "<div>" + esc(promoText(p)) + "</div>" +
      '<small>By ' + esc(p.creator ? p.creator.name : "unknown") + dates + (p.note ? " · " + esc(p.note) : "") + "</small></div>" + acts + "</div>";
  }).join("");
}

async function loadPromos() {
  var d = await api("/promos");
  promos = d.promos;
  drawList();
}

document.addEventListener("DOMContentLoaded", async function () {
  me = await requireRole(["employee", "admin"]);
  if (!me) return;

  try {
    var d = await api("/products");
    $("p-prod").innerHTML = d.products.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + "</option>"; }).join("");
  } catch (e) {}
  syncForm();
  Array.prototype.forEach.call($("promo-form").querySelectorAll("input,select"), function (el) {
    el.addEventListener("input", syncForm);
    el.addEventListener("change", syncForm);
  });

  $("promo-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    hideMsg("msg");
    var btn = $("p-save");
    btn.disabled = true;
    try {
      await api("/promos", "POST", readForm());
      toast("Promo saved");
      $("p-name").value = ""; $("p-note").value = ""; $("p-value").value = "";
      syncForm();
      await loadPromos();
    } catch (err) { showMsg("msg", err.message, "error"); }
    btn.disabled = false;
  });

  $("promo-list").addEventListener("click", async function (e) {
    var t = e.target.closest("button[data-toggle]"), x = e.target.closest("button[data-del]");
    if (!t && !x) return;
    hideMsg("msg");
    try {
      if (t) {
        var id = Number(t.dataset.toggle);
        var p = promos.find(function (q) { return q.id === id; });
        await api("/promos/" + id, "PATCH", { is_active: !p.is_active });
      } else {
        if (!confirm("Delete this promo? Old sales keep its name.")) return;
        await api("/promos/" + x.dataset.del, "DELETE");
      }
      await loadPromos();
    } catch (err) { showMsg("msg", err.message, "error"); }
  });

  try { await loadPromos(); } catch (err) { showMsg("msg", err.message, "error"); }
});
