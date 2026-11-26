// earnings.js - a reseller sees what she sold and earned; admin sees all resellers

var me = null, current = null;

function $(id) { return document.getElementById(id); }
function shift(day, n) { var t = new Date(day + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function presetDates(p) {
  var t = today();
  if (p === "today") return [t, t];
  if (p === "week") return [shift(t, -6), t];
  if (p === "month") return [t.slice(0, 8) + "01", t];
  if (p === "year") return [t.slice(0, 4) + "-01-01", t];
  var first = t.slice(0, 8) + "01", lastEnd = shift(first, -1);
  return [lastEnd.slice(0, 8) + "01", lastEnd];
}
function stat(n, l, cls) { return '<div class="stat ' + (cls || "") + '"><div class="n">' + n + '</div><div class="l">' + l + "</div></div>"; }
function table(h, r, empty) {
  if (!r.length) return '<p class="empty" style="padding:14px 0">' + esc(empty) + "</p>";
  return '<div class="table-wrap"><table><thead><tr>' + h.map(function (x) { return "<th>" + x + "</th>"; }).join("") + "</tr></thead><tbody>" + r.join("") + "</tbody></table></div>";
}

function draw(d) {
  var html = '<p class="sub period-line">' + esc(d.period.start) + " to " + esc(d.period.end) + "</p>";
  var one = me.role !== "admin" || $("who").value;
  var rs = d.resellers;

  if (one) {
    var r = rs[0] || { walkin: { sales: 0, units: 0, revenue: 0, company: 0, profit: 0 }, shop: { sales: 0, units: 0, revenue: 0, company: 0, profit: 0 },
      total_revenue: 0, total_profit: 0, give_company: 0, company_owes: 0, net_to_company: 0, shop_pending_orders: 0, shop_pending_value: 0 };
    html += '<div class="cards">' +
      stat(money(r.total_profit), "My earnings (markup)", "big") +
      stat(money(r.total_revenue), "Total sold") +
      stat(r.walkin.units + r.shop.units, "Perfumes sold") +
      stat(money(r.walkin.company + r.shop.company), "Company price total") + "</div>";
    html += '<div class="box"><h2>How much to settle with the company</h2>' +
      '<div class="breakdown"><div class="row"><span>Walk-in sales: company price you hold (give to company)</span><span>' + money(r.give_company) + "</span></div>" +
      '<div class="row"><span>Shop-link orders: your markup (company holds the cash, owes you)</span><span class="minus">−' + money(r.company_owes) + "</span></div>" +
      '<div class="row"><strong>' + (r.net_to_company >= 0 ? "You give the company" : "The company gives you") + "</strong><strong>" + money(Math.abs(r.net_to_company)) + "</strong></div></div>" +
      (r.shop_pending_orders ? '<p class="sub">' + r.shop_pending_orders + " shop order(s) worth " + money(r.shop_pending_value) + " are still pending. They count after they are paid.</p>" : "") + "</div>";
    html += '<div class="two-col"><div class="box"><h2>Walk-in (POS)</h2>' + table(["Sales", "Perfumes", "Sold", "Company price", "My earnings"],
      ["<tr><td>" + r.walkin.sales + "</td><td>" + r.walkin.units + "</td><td>" + money(r.walkin.revenue) + "</td><td>" + money(r.walkin.company) + "</td><td>" + money(r.walkin.profit) + "</td></tr>"], "") + "</div>" +
      '<div class="box"><h2>My shop link</h2>' + table(["Orders", "Perfumes", "Sold", "Company price", "My earnings"],
      ["<tr><td>" + r.shop.sales + "</td><td>" + r.shop.units + "</td><td>" + money(r.shop.revenue) + "</td><td>" + money(r.shop.company) + "</td><td>" + money(r.shop.profit) + "</td></tr>"], "") + "</div></div>";
    html += '<div class="box"><h2>My walk-in sales</h2>' + table(["#", "Time", "Perfumes", "Payment", "Sold", "Company price", "Earned"],
      d.sales.map(function (s) {
        return "<tr><td>#" + s.id + "</td><td>" + esc(s.at) + "</td><td>" + esc(s.items) + (s.promo ? "<br><small>promo −" + money(s.promo) + "</small>" : "") + "</td><td>" + esc(s.payment) +
          "</td><td>" + money(s.revenue) + "</td><td>" + money(s.company) + "</td><td>" + money(s.profit) + "</td></tr>";
      }), "No walk-in sales in this period.") + "</div>";
    html += '<div class="box"><h2>Orders from my shop link</h2>' + table(["#", "Time", "Customer", "Status", "Perfumes", "Sold", "Company price", "Earned"],
      d.orders.map(function (o) {
        return "<tr><td>#" + o.id + "</td><td>" + esc(o.at) + "</td><td>" + esc(o.customer) + "</td><td>" + esc(o.status) + "</td><td>" + o.units +
          "</td><td>" + money(o.revenue) + "</td><td>" + money(o.company) + "</td><td>" + (o.status === "pending" ? "<small>after paid</small>" : money(o.profit)) + "</td></tr>";
      }), "No orders from your shop link in this period.") + "</div>";
  } else {
    var t = d.totals;
    html += '<div class="cards">' + stat(money(t.revenue), "Total sold by resellers") + stat(money(t.profit), "Resellers\' earnings (markup)", "big") +
      stat(money(t.give_company), "Resellers hold for company (walk-in)") + stat(money(t.company_owes), "Company owes (shop orders)") +
      stat(money(t.net_to_company), "Net to collect from resellers") + "</div>";
    html += '<div class="box"><h2>By reseller</h2>' + table(["Reseller", "Walk-in sales", "Shop orders", "Total sold", "Earnings", "Give company", "Company owes", "Net to collect"],
      rs.map(function (r) {
        return "<tr><td><strong>" + esc(r.name) + "</strong></td><td>" + r.walkin.sales + " (" + money(r.walkin.revenue) + ")</td><td>" + r.shop.sales + " (" + money(r.shop.revenue) + ")" +
          (r.shop_pending_orders ? "<br><small>" + r.shop_pending_orders + " pending</small>" : "") + "</td><td>" + money(r.total_revenue) + "</td><td>" + money(r.total_profit) + "</td><td>" + money(r.give_company) +
          "</td><td>" + money(r.company_owes) + "</td><td><strong>" + money(r.net_to_company) + "</strong></td></tr>";
      }), "No reseller sales in this period.") +
      '<p class="sub" style="margin:10px 0 0">Walk-in: the reseller holds the cash, so she gives the company price. Shop orders: SCNTS holds the cash, so SCNTS owes her the markup. "Net to collect" = give company − company owes (minus means SCNTS pays her). Pick a reseller above to see every sale.</p></div>';
  }
  $("report").innerHTML = html;
}

async function load() {
  hideMsg("msg");
  var url = "/reseller/summary?start=" + $("from").value + "&end=" + $("to").value + ($("who").value ? "&reseller_id=" + $("who").value : "");
  $("report").innerHTML = '<p class="empty">Loading...</p>';
  try { current = await api(url); draw(current); }
  catch (err) { $("report").innerHTML = ""; showMsg("msg", err.message, "error"); }
}

document.addEventListener("DOMContentLoaded", async function () {
  me = await requireRole(["employee", "admin"]);
  if (!me) return;
  if (me.role === "admin") {
    $("e-title").textContent = "Reseller Earnings";
    $("e-sub").textContent = "What every reseller sold, the fixed company price, and their markup. Pick one reseller to see all their sales.";
    $("who-wrap").style.display = "";
    try {
      var st = await api("/staff");
      st.staff.filter(function (s) { return s.role === "employee"; }).forEach(function (s) {
        var o = document.createElement("option"); o.value = s.id; o.textContent = s.name; $("who").appendChild(o);
      });
    } catch (e) {}
  }
  function setDates(p) { var d = presetDates(p); $("from").value = d[0]; $("to").value = d[1]; }
  setDates("month");
  $("presets").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-p]"); if (!b) return;
    Array.prototype.forEach.call(document.querySelectorAll("#presets .chip"), function (c) { c.classList.toggle("active", c === b); });
    setDates(b.dataset.p); load();
  });
  $("show-btn").addEventListener("click", load);
  $("who").addEventListener("change", load);
  $("print-btn").addEventListener("click", function () { window.print(); });
  load();
});
