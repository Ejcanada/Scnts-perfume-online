// sales.js - admin: sales report of the walk-in (POS) sales, one day at a time

var dayInput, empSelect;

function shiftDay(day, n) {
  var t = new Date(day + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }

async function loadDay() {
  hideMsg("msg");
  var day = dayInput.value || today();
  var emp = empSelect.value ? "&employee_id=" + empSelect.value : "";
  try {
    var summary = await api("/pos/summary?date=" + day + emp);
    var list = await api("/pos/sales?date=" + day + emp);
    drawSummary(summary);
    drawSales(list.sales);
  } catch (err) {
    showMsg("msg", err.message, "error");
  }
}

function drawSummary(s) {
  document.getElementById("sum-cards").innerHTML =
    '<div class="stat"><div class="n">' + s.sales_count + '</div><div class="l">Sales</div></div>' +
    '<div class="stat"><div class="n">' + s.items_sold + '</div><div class="l">Perfumes sold</div></div>' +
    '<div class="stat"><div class="n">' + money(s.total) + '</div><div class="l">Total money</div></div>' +
    '<div class="stat"><div class="n">' + money(s.by_payment.cash) + '</div><div class="l">Cash</div></div>' +
    '<div class="stat"><div class="n">' + money(s.by_payment.gcash) + '</div><div class="l">GCash</div></div>' +
    '<div class="stat"><div class="n">' + money(s.by_payment.card) + '</div><div class="l">Card</div></div>' +
    '<div class="stat"><div class="n">' + money(s.by_payment.other) + '</div><div class="l">Other</div></div>' +
    '<div class="stat"><div class="n">' + s.voided_count + '</div><div class="l">Voided</div></div>';

  document.getElementById("emp-rows").innerHTML = s.by_employee.map(function (e) {
    return "<tr><td>" + esc(e.name) + "</td><td>" + e.sales_count + "</td><td>" + e.items_sold + "</td><td>" + money(e.total) + "</td></tr>";
  }).join("") || '<tr><td colspan="4" class="empty">No sales on this day.</td></tr>';
}

function drawSales(sales) {
  document.getElementById("sale-rows").innerHTML = sales.map(function (s) {
    var items = s.sale_items.map(function (i) { return i.quantity + " × " + esc(i.product ? i.product.name : "Perfume"); }).join(", ");
    var voided = s.status === "voided";
    var action = voided
      ? '<span class="keep" title="' + esc(s.void_reason || "") + '">' + esc(s.void_reason || "") + "</span>"
      : '<button class="btn btn-danger btn-small" data-void="' + s.id + '">Void</button>';
    return '<tr class="' + (voided ? "row-void" : "") + '"><td>#' + s.id + "</td><td>" + timeText(s.created_at) + "</td><td>" +
      esc(s.employee ? s.employee.name : "") + "</td><td>" + items + (s.note ? "<br><small>" + esc(s.note) + "</small>" : "") +
      "</td><td>" + esc(cap(s.payment_method)) + "</td><td>" + money(s.total) +
      (voided ? ' <span class="badge out keep">VOIDED</span>' : "") + '</td><td class="keep">' + action + "</td></tr>";
  }).join("") || '<tr><td colspan="7" class="empty">No sales on this day.</td></tr>';
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = await requireRole(["admin"]);
  if (!user) return;

  dayInput = document.getElementById("day");
  empSelect = document.getElementById("emp-filter");
  dayInput.value = today();

  // employees for the filter
  try {
    var staff = await api("/staff");
    staff.staff.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name + (s.role === "admin" ? " (admin)" : "");
      empSelect.appendChild(o);
    });
  } catch (e) { /* the filter just stays on "All employees" */ }

  dayInput.addEventListener("change", loadDay);
  empSelect.addEventListener("change", loadDay);
  document.getElementById("prev-day").addEventListener("click", function () { dayInput.value = shiftDay(dayInput.value || today(), -1); loadDay(); });
  document.getElementById("next-day").addEventListener("click", function () { dayInput.value = shiftDay(dayInput.value || today(), 1); loadDay(); });
  document.getElementById("today-btn").addEventListener("click", function () { dayInput.value = today(); loadDay(); });

  document.getElementById("sale-rows").addEventListener("click", async function (e) {
    var b = e.target.closest("button[data-void]");
    if (!b) return;
    var reason = prompt("Why are you voiding sale #" + b.dataset.void + "? (at least 3 letters)\nThe perfumes will be put back in stock.");
    if (!reason || reason.trim().length < 3) return;
    try {
      await api("/pos/sales/" + b.dataset.void + "/void", "POST", { reason: reason.trim() });
      showMsg("msg", "Sale #" + b.dataset.void + " voided and the stock was put back.", "success");
      loadDay();
    } catch (err) {
      showMsg("msg", err.message, "error");
    }
  });

  loadDay();
});
