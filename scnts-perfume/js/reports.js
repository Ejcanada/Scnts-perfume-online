// reports.js - admin: summary report of sales, orders and stock (on screen, Excel, or print)

var current = null;   // the report that is on the screen

function shift(day, n) {
  var t = new Date(day + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function presetDates(p) {
  var t = today();
  if (p === "today") return [t, t];
  if (p === "yesterday") return [shift(t, -1), shift(t, -1)];
  if (p === "week") return [shift(t, -6), t];
  if (p === "month") return [t.slice(0, 8) + "01", t];
  if (p === "year") return [t.slice(0, 4) + "-01-01", t];
  // last month
  var first = t.slice(0, 8) + "01";
  var lastEnd = shift(first, -1);
  return [lastEnd.slice(0, 8) + "01", lastEnd];
}

function stat(n, l, cls) { return '<div class="stat ' + (cls || "") + '"><div class="n">' + n + '</div><div class="l">' + l + "</div></div>"; }

function simpleTable(headers, rows, empty) {
  if (!rows.length) return '<p class="empty" style="padding:18px 0">' + esc(empty || "Nothing in this period.") + "</p>";
  return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (h) { return "<th>" + h + "</th>"; }).join("") +
    "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>";
}

function dayLabel(d) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });
}

function drawChart(daily) {
  var max = Math.max.apply(null, daily.map(function (d) { return d.total; }).concat([1]));
  var bars = daily.map(function (d) {
    var h1 = Math.round(d.walkin_total / max * 100), h2 = Math.round(d.online_total / max * 100);
    var tip = dayLabel(d.date) + ": " + money(d.total) + " (walk-in " + money(d.walkin_total) + ", online " + money(d.online_total) + ")";
    return '<div class="bar" title="' + esc(tip) + '"><div class="stack"><i class="on" style="height:' + h2 + '%"></i><i class="wk" style="height:' + h1 + '%"></i></div>' +
      '<span>' + (daily.length <= 31 ? dayLabel(d.date).replace(/^\w+ /, "") : "") + "</span></div>";
  }).join("");
  return '<div class="chart-legend"><span><i class="wk"></i> Walk-in</span><span><i class="on"></i> Online</span></div><div class="chart">' + bars + "</div>";
}

function draw(r) {
  var k = r.kpis, p = r.period;
  var html = "";
  html += '<div class="print-head"><div class="ph-title">SCNTS Perfume - Business Summary</div>' +
    "<div>Period: " + esc(p.start) + " to " + esc(p.end) + " (" + p.days + (p.days === 1 ? " day" : " days") + ")</div>" +
    "<div>Created " + esc(r.generated_at) + " by " + esc(r.generated_by) + "</div></div>";
  html += '<p class="sub period-line">' + esc(p.start) + " to " + esc(p.end) + " · " + p.days + (p.days === 1 ? " day" : " days") + "</p>";

  html += '<div class="cards">' +
    stat(money(k.total_revenue), "Total revenue", "big") +
    stat(money(k.walkin_total), "Walk-in revenue (" + k.walkin_count + " sales)") +
    stat(money(k.online_total), "Online revenue (" + k.online_count + " orders)") +
    stat(k.items_sold, "Perfumes sold") +
    stat(money(k.average_sale), "Average walk-in sale") +
    stat(k.pending_count, "Online orders pending", k.pending_count ? "attn" : "") +
    stat(k.voided_count, "Voided walk-in sales", k.voided_count ? "attn" : "") +
    stat(k.new_customers, "New customer accounts") +
    stat(money(k.stock_value), "Stock value now") +
    stat(k.low_count + " / " + k.out_count, "Low / sold out now", (k.low_count || k.out_count) ? "attn" : "") +
    "</div>";

  html += '<div class="box"><h2>Highlights</h2><ul class="insights">' + r.insights.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div>";

  html += '<div class="box"><h2>Revenue by day</h2>' + drawChart(r.daily) + "</div>";

  html += '<div class="box"><h2>Best selling perfumes</h2>' + simpleTable(
    ["#", "Perfume", "For", "Walk-in", "Online", "Total units", "Revenue"],
    r.perfumes.slice(0, 10).map(function (a, i) {
      return "<tr><td>" + (i + 1) + "</td><td><strong>" + esc(a.name) + "</strong></td><td>" + esc(a.category_label) + "</td><td>" + a.walkin_units +
        "</td><td>" + a.online_units + "</td><td>" + a.units + "</td><td>" + money(a.revenue) + "</td></tr>";
    }), "No sales in this period.") +
    (r.perfumes.length > 10 ? '<p class="sub no-print" style="margin:10px 0 0">Top 10 shown. The Excel file has all ' + r.perfumes.length + " perfumes.</p>" : "") + "</div>";

  html += '<div class="two-col">' +
    '<div class="box"><h2>By category</h2>' + simpleTable(["For", "Units", "Revenue"], r.categories.map(function (c) {
      return "<tr><td>" + esc(c.category) + "</td><td>" + c.units + "</td><td>" + money(c.revenue) + "</td></tr>";
    })) + "</div>" +
    '<div class="box"><h2>Walk-in payments</h2>' + simpleTable(["Method", "Sales", "Total"], r.payments.map(function (c) {
      return "<tr><td>" + esc(c.method) + "</td><td>" + c.count + "</td><td>" + money(c.total) + "</td></tr>";
    })) + "</div></div>";

  html += '<div class="two-col">' +
    '<div class="box"><h2>Employees</h2>' + simpleTable(["Employee", "Sales", "Perfumes", "Total", "Voided"], r.employees.map(function (e) {
      return "<tr><td>" + esc(e.name) + "</td><td>" + e.sales + "</td><td>" + e.items + "</td><td>" + money(e.total) + "</td><td>" + e.voided + "</td></tr>";
    }), "No walk-in sales in this period.") + "</div>" +
    '<div class="box"><h2>Online orders</h2>' + simpleTable(["Status", "Orders", "Value"], r.order_status.map(function (s) {
      return "<tr><td>" + esc(s.status) + "</td><td>" + s.count + "</td><td>" + money(s.total) + "</td></tr>";
    })) + "</div></div>";

  var alerts = r.inventory.filter(function (i) { return i.status !== "OK"; });
  html += '<div class="box"><h2>Stock to watch</h2>' + simpleTable(["Perfume", "For", "In stock", "Status", "Sold in period", "Days left*"],
    alerts.map(function (i) {
      return "<tr><td><strong>" + esc(i.name) + "</strong></td><td>" + esc(i.category) + "</td><td>" + i.stock + "</td><td>" +
        (i.status === "Sold out" ? '<span class="badge out">Sold out</span>' : '<span class="badge low">Low</span>') + "</td><td>" + i.sold + "</td><td>" +
        (i.days_left === null ? "-" : i.days_left) + "</td></tr>";
    }), "Every perfume has enough stock.") +
    '<p class="sub" style="margin:10px 0 0">* Estimated from how fast it sold in this period.</p></div>';

  html += '<div class="box"><h2>Stock changes in this period</h2>' + simpleTable(["Reason", "Times", "Bottles added", "Bottles taken out"],
    r.movement_summary.map(function (m) {
      return "<tr><td>" + esc(m.reason) + "</td><td>" + m.count + "</td><td>" + m.units_in + "</td><td>" + m.units_out + "</td></tr>";
    }), "No stock changes in this period.") + "</div>";

  html += '<p class="sub no-print">Revenue counts walk-in sales that are not voided and online orders that are paid, shipped or delivered. Pending, cancelled and voided are not counted. There are no cost prices, so this is sales, not profit.</p>';
  document.getElementById("report").innerHTML = html;
}

async function loadReport() {
  hideMsg("msg");
  var from = document.getElementById("from").value, to = document.getElementById("to").value;
  document.getElementById("report").innerHTML = '<p class="empty">Making your report...</p>';
  try {
    current = await api("/reports/summary?start=" + from + "&end=" + to);
    draw(current);
  } catch (err) {
    current = null;
    document.getElementById("report").innerHTML = "";
    showMsg("msg", err.message, "error");
  }
}

async function downloadExcel() {
  var from = document.getElementById("from").value, to = document.getElementById("to").value;
  var btn = document.getElementById("excel-btn");
  var label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing...";
  hideMsg("msg");
  try {
    var res = await fetch("/reports/export?start=" + from + "&end=" + to, { headers: { Authorization: "Bearer " + getToken() } });
    if (!res.ok) {
      var d = null;
      try { d = await res.json(); } catch (e) {}
      throw new Error(d ? errorText(d) : "Server error (code " + res.status + ")");
    }
    var blob = await res.blob();
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "SCNTS-report-" + from + "_to_" + to + ".xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast("Excel report downloaded");
  } catch (err) {
    showMsg("msg", err.message, "error");
  }
  btn.disabled = false;
  btn.textContent = label;
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = await requireRole(["admin"]);
  if (!user) return;

  function setDates(p) {
    var d = presetDates(p);
    document.getElementById("from").value = d[0];
    document.getElementById("to").value = d[1];
  }
  setDates("month");

  document.getElementById("presets").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-p]");
    if (!b) return;
    Array.prototype.forEach.call(document.querySelectorAll("#presets .chip"), function (c) { c.classList.toggle("active", c === b); });
    setDates(b.dataset.p);
    loadReport();
  });
  function customDates() {
    Array.prototype.forEach.call(document.querySelectorAll("#presets .chip"), function (c) { c.classList.remove("active"); });
  }
  document.getElementById("from").addEventListener("change", customDates);
  document.getElementById("to").addEventListener("change", customDates);
  document.getElementById("show-btn").addEventListener("click", loadReport);
  document.getElementById("excel-btn").addEventListener("click", downloadExcel);
  document.getElementById("print-btn").addEventListener("click", function () {
    if (!current) { showMsg("msg", "Show a report first, then print it.", "info"); return; }
    window.print();
  });

  loadReport();
});
