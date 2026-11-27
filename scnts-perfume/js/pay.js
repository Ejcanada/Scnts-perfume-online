// pay.js - shared payment pieces: GCash, MariBank and GoTyme
// The customer sends the exact amount to the shop account, then types the reference number from the receipt.

var PAY_BRAND = {
  gcash: { label: "GCash", mono: "G", cls: "gcash", app: "Open GCash" },
  maribank: { label: "MariBank", mono: "M", cls: "maribank", app: "Open MariBank" },
  gotyme: { label: "GoTyme", mono: "Go", cls: "gotyme", app: "Open GoTyme" }
};

var PAY_STATUS = {
  unpaid: ["Waiting for payment", "low"],
  submitted: ["Checking your payment", "info"],
  confirmed: ["Payment confirmed", "ok"],
  rejected: ["Payment not found", "out"]
};

function payBrand(m) { return PAY_BRAND[m] || { label: m, mono: "?", cls: "other" }; }

function payStatusBadge(st) {
  var s = PAY_STATUS[st] || PAY_STATUS.unpaid;
  return '<span class="badge ' + s[1] + '">' + s[0] + "</span>";
}

async function loadPayMethods() {
  try {
    var d = await api("/payments/methods");
    return d.methods || [];
  } catch (e) { return []; }
}

// the radio cards the customer taps
function payPicker(methods, selected) {
  return '<div class="pay-pick" id="pay-pick">' + methods.map(function (m) {
    var b = payBrand(m.method);
    return '<button type="button" class="pay-card ' + b.cls + (selected === m.method ? " on" : "") + '" data-method="' + esc(m.method) + '">' +
      '<span class="pay-mono">' + b.mono + "</span><span class=\"pay-name\">" + esc(m.label || b.label) + '</span><i class="pay-tick"></i></button>';
  }).join("") + "</div>";
}

// the screen that shows where to send the money
function payPanel(m, amount) {
  var b = payBrand(m.method);
  var qr = m.qr_url ? '<div class="pay-qr"><img src="' + esc(m.qr_url) + '" alt="' + esc(b.label) + ' QR code"><small>Scan with ' + esc(b.label) + "</small></div>" : "";
  return '<div class="pay-panel ' + b.cls + '">' +
    '<div class="pay-head"><span class="pay-mono">' + b.mono + '</span><div><strong>Send with ' + esc(m.label || b.label) + '</strong><small>Open your ' + esc(b.label) + " app and send exactly this amount</small></div></div>" +
    '<div class="pay-amount"><span>Amount to send</span><b>' + money(amount) + '</b><button type="button" class="copy" data-copy="' + Number(amount).toFixed(2) + '">Copy</button></div>' +
    '<div class="pay-grid">' + qr + '<div class="pay-acct">' +
      '<div class="pay-row"><span>Account name</span><b>' + esc(m.account_name) + "</b></div>" +
      '<div class="pay-row"><span>Account number</span><b class="num">' + esc(m.account_number) + '</b><button type="button" class="copy" data-copy="' + esc(String(m.account_number).replace(/[^0-9]/g, "")) + '">Copy</button></div>' +
      (m.instructions ? '<p class="pay-note">' + esc(m.instructions) + "</p>" : "") +
    "</div></div></div>";
}

// copy buttons
document.addEventListener("click", function (e) {
  var b = e.target.closest("button.copy");
  if (!b) return;
  var text = b.dataset.copy;
  function done() { var o = b.textContent; b.textContent = "Copied"; b.classList.add("done"); setTimeout(function () { b.textContent = o; b.classList.remove("done"); }, 1400); }
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else done();
});

// reference box + send button. Calls onDone() after the reference is saved.
function refForm(orderId, onDone) {
  return '<form class="ref-form" data-order="' + orderId + '"><label>After you send it, type the reference number from your receipt</label>' +
    '<div class="ref-row"><input name="ref" maxlength="40" placeholder="Reference no. (example: 1234 567 890123)" required>' +
    '<button class="btn" type="submit">I have paid</button></div><div class="msg"></div></form>';
}

document.addEventListener("submit", async function (e) {
  var f = e.target.closest("form.ref-form");
  if (!f) return;
  e.preventDefault();
  var msg = f.querySelector(".msg");
  var btn = f.querySelector("button");
  var ref = f.elements.ref.value.trim();
  btn.disabled = true;
  try {
    await api("/orders/" + f.dataset.order + "/payment", "POST", { reference: ref });
    msg.textContent = "Thank you! We got your reference. We will confirm your payment soon.";
    msg.className = "msg show success";
    document.dispatchEvent(new CustomEvent("scnts-paid", { detail: { order: f.dataset.order } }));
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "msg show error";
    btn.disabled = false;
  }
});

// the payment part inside one order (for My orders and after checkout)
function orderPayBlock(o, methods) {
  if (!o.payment_method) return "";
  var st = o.payment_status || "unpaid";
  var b = payBrand(o.payment_method);
  var head = '<div class="pay-line"><span class="pay-mono sm ' + b.cls + '">' + b.mono + "</span><span>" + esc(b.label) + "</span>" + payStatusBadge(st) +
    (o.payment_reference ? "<small>Ref: " + esc(o.payment_reference) + "</small>" : "") + "</div>";
  if (o.status !== "pending" || st === "confirmed" || st === "submitted") return '<div class="pay-block">' + head + "</div>";
  var acct = (methods || []).find(function (m) { return m.method === o.payment_method; });
  if (!acct) return '<div class="pay-block">' + head + '<p class="pay-note">This payment method is not available right now. Please contact the shop.</p></div>';
  return '<div class="pay-block">' + head + (st === "rejected" ? '<p class="pay-note warn">We could not find that payment. Please check the reference number and send it again.</p>' : "") +
    payPanel(acct, o.total) + refForm(o.id) + "</div>";
}
