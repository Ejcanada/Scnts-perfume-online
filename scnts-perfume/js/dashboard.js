// dashboard.js - summary of inventory, sales and alerts

function shortMoney(n) {
  n = Number(n);
  if (n >= 1000000) return "₱" + (n / 1000000).toFixed(1) + "M";
  if (n >= 10000) return "₱" + (n / 1000).toFixed(1) + "k";
  return money(n);
}

// numbers count up when the page opens
function countUp(root) {
  Array.prototype.forEach.call(root.querySelectorAll("[data-count]"), function (el) {
    var end = Number(el.dataset.count), kind = el.dataset.kind || "int";
    var t0 = null, dur = 1100;
    function fmt(v) { return kind === "money" ? money(v) : Math.round(v).toLocaleString("en-PH"); }
    function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(end * e);
      if (p < 1) requestAnimationFrame(step);
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) el.textContent = fmt(end); else requestAnimationFrame(step);
  });
}

function statCard(icon, label, value, kind, hint, tone) {
  return '<div class="d-card ' + (tone || "") + '"><span class="d-ico">' + icon + '</span><div class="d-lbl">' + label + '</div>' +
    '<div class="d-val" data-count="' + value + '" data-kind="' + kind + '">0</div><div class="d-hint">' + hint + "</div></div>";
}

// donut chart made with SVG circles
function donut(parts, centerTop, centerBottom) {
  var total = parts.reduce(function (s, p) { return s + p.v; }, 0) || 1;
  var R = 70, C = 2 * Math.PI * R, off = 0;
  var rings = parts.map(function (p, i) {
    var len = (p.v / total) * C;
    var c = '<circle class="seg" cx="90" cy="90" r="' + R + '" stroke="' + p.color + '" stroke-dasharray="' + len + " " + (C - len) + '" stroke-dashoffset="' + (-off) + '" style="--d:' + (i * .15) + 's"></circle>';
    off += len;
    return c;
  }).join("");
  return '<div class="donut"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="' + R + '" class="track"></circle>' + rings + "</svg>" +
    '<div class="donut-mid"><b>' + centerTop + "</b><span>" + centerBottom + "</span></div></div>";
}

function legend(parts) {
  return '<ul class="legend">' + parts.map(function (p) {
    return '<li><i style="background:' + p.color + '"></i><span>' + p.label + "</span><b>" + p.v + "</b></li>";
  }).join("") + "</ul>";
}

// bars for the last 14 days, with a hover label
function salesChart(daily) {
  var max = Math.max.apply(null, daily.map(function (d) { return d.total; }).concat([1]));
  var W = 640, H = 220, pad = 26, bw = (W - pad * 2) / daily.length;
  var pts = daily.map(function (d, i) {
    var h = (d.total / max) * (H - 60);
    return { x: pad + i * bw + bw * .18, w: bw * .64, h: Math.max(h, d.total ? 4 : 2), d: d, i: i };
  });
  var line = pts.map(function (p, i) { return (i ? "L" : "M") + (p.x + p.w / 2).toFixed(1) + " " + (H - 30 - p.h).toFixed(1); }).join(" ");
  var bars = pts.map(function (p) {
    var day = p.d.date.slice(5).replace("-", "/");
    return '<g class="bar" style="--d:' + (p.i * .05) + 's"><rect class="hit" x="' + (p.x - 4) + '" y="0" width="' + (p.w + 8) + '" height="' + H + '"></rect>' +
      '<rect class="col" x="' + p.x.toFixed(1) + '" y="' + (H - 30 - p.h).toFixed(1) + '" width="' + p.w.toFixed(1) + '" height="' + p.h.toFixed(1) + '" rx="5"></rect>' +
      '<text class="tick" x="' + (p.x + p.w / 2).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + (p.i % 2 === 0 ? day : "") + "</text>" +
      '<g class="tip"><rect x="' + (p.x + p.w / 2 - 52).toFixed(1) + '" y="' + Math.max(2, H - 30 - p.h - 44).toFixed(1) + '" width="104" height="36" rx="8"></rect>' +
      '<text x="' + (p.x + p.w / 2).toFixed(1) + '" y="' + Math.max(2, H - 30 - p.h - 44 + 15).toFixed(1) + '" text-anchor="middle" class="t1">' + money(p.d.total) + "</text>" +
      '<text x="' + (p.x + p.w / 2).toFixed(1) + '" y="' + Math.max(2, H - 30 - p.h - 44 + 29).toFixed(1) + '" text-anchor="middle" class="t2">' + p.d.count + (p.d.count === 1 ? " sale" : " sales") + "</text></g></g>";
  }).join("");
  return '<svg class="schart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none"><defs><linearGradient id="gcol" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe29a"/><stop offset="1" stop-color="#d6246e"/></linearGradient></defs>' +
    '<line class="grid" x1="' + pad + '" x2="' + (W - pad) + '" y1="' + (H - 30) + '" y2="' + (H - 30) + '"></line>' + bars + '<path class="trend" d="' + line + '" pathLength="1"></path></svg>';
}

function stockBar(stock, max) {
  var pct = Math.max(4, Math.min(100, (stock / max) * 100));
  return '<span class="sbar"><i style="--w:' + pct + '%" class="' + (stock <= 0 ? "out" : stock <= 2 ? "crit" : "low") + '"></i></span>';
}

function drawDash(d) {
  var inv = d.inventory, s = d.sales;
  var tiles =
    statCard("₱", "Inventory value", inv.retail_value, "money", "At selling prices · " + inv.units + " bottles") +
    statCard("◈", "Products", inv.products, "int", inv.healthy + " healthy stock") +
    statCard("▲", "Low stock", inv.low, "int", "Need restock soon", inv.low ? "warn" : "") +
    statCard("✕", "Sold out", inv.out, "int", "Zero bottles left", inv.out ? "bad" : "") +
    statCard("☀", "Sales today", s.today.total, "money", s.today.count + " sales · " + s.voided_today.count + " voided") +
    statCard("7d", "Last 7 days", s.week.total, "money", s.week.count + " sales") +
    statCard("30d", "Last 30 days", s.month.total, "money", s.month.count + " sales");
  if (d.scope === "all") {
    var pend = (d.orders.counts.pending || 0);
    tiles += statCard("✉", "Web orders", d.orders.total, "int", pend + " pending", pend ? "warn" : "") +
      statCard("✓", "Payments to check", d.to_verify.length, "int", "Customers who sent a reference", d.to_verify.length ? "warn" : "");
  }

  var health = [
    { label: "Healthy (" + (d.low_threshold + 1) + "+)", v: inv.healthy, color: "var(--ok)" },
    { label: "Low (1–" + d.low_threshold + ")", v: inv.low, color: "var(--gold)" },
    { label: "Sold out", v: inv.out, color: "var(--danger)" }
  ];
  var cats = d.categories.map(function (c) {
    var max = Math.max.apply(null, d.categories.map(function (x) { return x.units; }).concat([1]));
    return '<div class="catrow"><span>' + esc(categoryLabel(c.category)) + '</span><span class="cbar"><i style="--w:' + Math.max(4, c.units / max * 100) + '%"></i></span><b>' + c.units + " bottles</b></div>";
  }).join("");

  var maxStock = d.low_threshold;
  var alerts = d.alerts.length
    ? '<div class="table-wrap"><table class="alert-table"><thead><tr><th>Perfume</th><th>Left</th><th>Level</th><th></th></tr></thead><tbody>' + d.alerts.map(function (p) {
        return '<tr class="' + (p.stock <= 0 ? "is-out" : "is-low") + '"><td><span class="dot-live"></span><strong>' + esc(p.name) + "</strong><br><small>" + esc(p.brand) + " · " + categoryLabel(p.category) + "</small></td>" +
          "<td><b>" + p.stock + "</b></td><td>" + stockBar(p.stock, maxStock) + "</td>" +
          '<td><a class="btn btn-small" href="inventory.html?q=' + encodeURIComponent(p.name) + '">' + (d.scope === "all" ? "Restock" : "View") + "</a></td></tr>";
      }).join("") + "</tbody></table></div>"
    : '<p class="all-good"><span>✓</span> All perfumes are well stocked.</p>';

  var topMax = Math.max.apply(null, d.top.map(function (t) { return t.qty; }).concat([1]));
  var top = d.top.length ? d.top.map(function (t, i) {
    return '<div class="toprow"><span class="rank">' + (i + 1) + "</span><span class=\"tn\">" + esc(t.name) + '</span><span class="cbar"><i style="--w:' + (t.qty / topMax * 100) + '%"></i></span><b>' + t.qty + "</b></div>";
  }).join("") : '<p class="empty">No sales yet.</p>';

  var payParts = d.payments.map(function (p, i) {
    var colors = ["var(--gold)", "var(--rose)", "var(--violet)", "var(--ok)", "#8fb0ff", "#c9a0ff"];
    return { label: payBrand(p.method).label === p.method ? p.method.charAt(0).toUpperCase() + p.method.slice(1) : payBrand(p.method).label, v: Math.round(p.total), color: colors[i % colors.length] };
  });
  var paySum = payParts.reduce(function (a, p) { return a + p.v; }, 0);

  var html = '<div class="d-cards">' + tiles + "</div>" +
    '<div class="d-grid">' +
      '<section class="d-box wide"><header><h2>Sales, last 14 days</h2><span class="pill">' + money(d.daily.reduce(function (a, x) { return a + x.total; }, 0)) + "</span></header>" + salesChart(d.daily) + "</section>" +
      '<section class="d-box"><header><h2>Stock health</h2></header><div class="donut-wrap">' + donut(health, inv.products, "perfumes") + legend(health) + "</div></section>" +
      '<section class="d-box wide" id="alerts"><header><h2>Low stock alert <span class="alert-count ' + (d.alerts.length ? "on" : "") + '">' + d.alerts.length + "</span></h2><span class=\"pill\">" + d.low_threshold + " or fewer</span></header>" + alerts + "</section>" +
      '<section class="d-box"><header><h2>Stock by category</h2></header>' + cats + "</section>" +
      '<section class="d-box"><header><h2>Top sellers · 30 days</h2></header>' + top + "</section>" +
      '<section class="d-box"><header><h2>How customers paid</h2></header>' + (paySum ? '<div class="donut-wrap">' + donut(payParts, shortMoney(paySum), "30 days") + legend(payParts.map(function (p) { return { label: p.label, v: shortMoney(p.v), color: p.color }; })) + "</div>" : '<p class="empty">No payments yet.</p>') + "</section>";

  if (d.scope === "all") {
    html += '<section class="d-box"><header><h2>Payments to check</h2><a class="pill link" href="orders.html">Open orders</a></header>' +
      (d.to_verify.length ? d.to_verify.map(function (o) {
        var b = payBrand(o.payment_method);
        return '<a class="verify" href="orders.html"><span class="pay-mono sm ' + b.cls + '">' + b.mono + '</span><span class="vm"><b>Order #' + o.id + "</b><small>" + esc(o.user ? o.user.name : "") + " · Ref " + esc(o.payment_reference || "") + "</small></span><strong>" + money(o.total) + "</strong></a>";
      }).join("") : '<p class="all-good"><span>✓</span> Nothing waiting.</p>') + "</section>" +
      '<section class="d-box wide"><header><h2>Recent stock movement</h2><a class="pill link" href="inventory.html">See all</a></header><div class="table-wrap"><table><tbody>' +
      d.movements.map(function (m) {
        return "<tr><td>" + esc(m.product ? m.product.name : "") + '</td><td class="' + (m.qty_change < 0 ? "neg" : "pos-num") + '">' + (m.qty_change > 0 ? "+" : "") + m.qty_change + "</td><td>" + esc(m.reason.replace("_", " ")) + "</td><td>now " + m.stock_after + "</td><td>" + esc(dateTimeText(m.created_at)) + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
  }
  html += "</div>";
  var root = document.getElementById("dash");
  root.innerHTML = html;
  countUp(root);
  Array.prototype.forEach.call(root.querySelectorAll(".d-card, .d-box"), function (el, i) { el.style.setProperty("--k", i); });
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = await requireRole(["employee", "admin"]);
  if (!user) return;
  try {
    drawDash(await api("/dashboard"));
    if (location.hash === "#alerts") { var a = document.getElementById("alerts"); if (a) setTimeout(function () { a.scrollIntoView({ behavior: "smooth", block: "center" }); }, 400); }
  } catch (err) {
    document.getElementById("dash").innerHTML = "";
    showMsg("msg", err.message, "error");
  }
});
