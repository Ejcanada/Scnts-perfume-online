// orders.js - admin sees the orders that customers placed on the website

var orders = [];
var statusFilter = "all";
var STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"];
var BADGE = { pending: "low", paid: "info", shipped: "ship", delivered: "ok", cancelled: "out" };

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function statusBadge(st) {
  return '<span class="badge ' + (BADGE[st] || "low") + '">' + esc(cap(st)) + "</span>";
}

function count(st) {
  return orders.filter(function (o) { return o.status === st; }).length;
}

function drawCards() {
  var live = orders.filter(function (o) { return o.status !== "cancelled"; });
  var value = live.reduce(function (s, o) { return s + Number(o.total); }, 0);
  document.getElementById("order-cards").innerHTML =
    '<div class="stat"><div class="n">' + orders.length + '</div><div class="l">All orders</div></div>' +
    '<div class="stat attn"><div class="n">' + count("pending") + '</div><div class="l">Pending (need action)</div></div>' +
    '<div class="stat"><div class="n">' + count("shipped") + '</div><div class="l">On the way</div></div>' +
    '<div class="stat"><div class="n">' + count("delivered") + '</div><div class="l">Delivered</div></div>' +
    '<div class="stat"><div class="n">' + money(value) + '</div><div class="l">Order value (not cancelled)</div></div>';
}

function drawChips() {
  var tabs = [["all", "All", orders.length]].concat(STATUSES.map(function (s) { return [s, cap(s), count(s)]; }));
  document.getElementById("status-chips").innerHTML = tabs.map(function (t) {
    return '<button class="chip' + (statusFilter === t[0] ? " active" : "") + '" data-st="' + t[0] + '">' + t[1] + " (" + t[2] + ")</button>";
  }).join("");
}

function visibleOrders() {
  var q = document.getElementById("search").value.trim().toLowerCase().replace(/^#/, "");
  return orders.filter(function (o) {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (!q) return true;
    var who = o.user ? (o.user.name + " " + o.user.email).toLowerCase() : "";
    return String(o.id) === q || who.indexOf(q) !== -1;
  });
}

function drawOrders() {
  drawCards();
  drawChips();
  var list = visibleOrders();
  var box = document.getElementById("order-list");
  if (!list.length) {
    box.innerHTML = '<p class="empty">' + (orders.length ? "No orders match." : "No customer orders yet.") + "</p>";
    return;
  }
  box.innerHTML = list.map(function (o) {
    var who = o.user ? "<strong>" + esc(o.user.name) + "</strong><br><small>" + esc(o.user.email) + "</small>" : "User " + o.user_id;
    var qty = 0;
    var items = o.order_items.map(function (i) {
      qty += i.quantity;
      var name = i.product ? i.product.name : "Perfume " + i.product_id;
      return "<tr><td>" + esc(name) + "</td><td>" + i.quantity + "</td><td>" + money(i.price) + "</td><td>" + money(i.price * i.quantity) + "</td></tr>";
    }).join("");
    var options = STATUSES.map(function (s) {
      return '<option value="' + s + '"' + (s === o.status ? " selected" : "") + ">" + cap(s) + "</option>";
    }).join("");
    var locked = o.status === "cancelled";
    return '<div class="box order-card st-' + esc(o.status) + '">' +
      '<div class="o-main">' +
        '<div class="o-head"><span class="o-id">Order #' + o.id + "</span> " + statusBadge(o.status) +
        '<span class="o-date">' + esc(dateTimeText(o.created_at)) + "</span></div>" +
        '<div class="o-who">' + who + "</div>" +
        '<div class="table-wrap"><table><thead><tr><th>Perfume</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead><tbody>' + items + "</tbody></table></div>" +
      "</div>" +
      '<div class="o-side">' +
        '<div class="l">Total (' + qty + (qty === 1 ? " perfume" : " perfumes") + ')</div><div class="o-total">' + money(o.total) + "</div>" +
        '<label for="st-' + o.id + '">Order status</label>' +
        '<select id="st-' + o.id + '" data-order="' + o.id + '"' + (locked ? " disabled" : "") + ">" + options + "</select>" +
        '<p class="o-hint">' + (locked ? "Cancelled orders can't be changed." : "Cancelling puts the perfumes back in stock.") + "</p>" +
      "</div></div>";
  }).join("");
}

async function loadOrders() {
  var data = await api("/orders/all");
  orders = data.orders;
  drawOrders();
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = await requireRole(["admin"]);
  if (!user) return;

  document.getElementById("search").addEventListener("input", drawOrders);
  document.getElementById("status-chips").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-st]");
    if (!b) return;
    statusFilter = b.dataset.st;
    drawOrders();
  });

  document.getElementById("order-list").addEventListener("change", async function (e) {
    var sel = e.target.closest("select[data-order]");
    if (!sel) return;
    var id = Number(sel.dataset.order);
    var o = orders.find(function (x) { return x.id === id; });
    var next = sel.value;
    hideMsg("msg");
    if (next === "cancelled" && !confirm("Cancel order #" + id + "?\n\nThe perfumes go back to stock. A cancelled order cannot be changed again.")) {
      sel.value = o.status;
      return;
    }
    try {
      await api("/orders/" + id + "/status", "PATCH", { status: next });
      toast("Order #" + id + " is now " + next);
      await loadOrders();      // stock may have changed, and totals/counters too
    } catch (err) {
      showMsg("msg", err.message, "error");
      try { await loadOrders(); } catch (e2) { drawOrders(); }
    }
  });

  try { await loadOrders(); } catch (err) {
    document.getElementById("order-list").innerHTML = "";
    showMsg("msg", err.message, "error");
  }
});
