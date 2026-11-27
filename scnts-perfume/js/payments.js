// payments.js - admin sets the GCash / MariBank / GoTyme accounts

var accounts = [];

function drawAccounts() {
  document.getElementById("pay-accounts").innerHTML = accounts.map(function (a, i) {
    var b = payBrand(a.method);
    return '<form class="box acct ' + b.cls + (a.is_active ? " live" : "") + '" data-method="' + a.method + '" style="--k:' + i + '">' +
      '<div class="acct-head"><span class="pay-mono">' + b.mono + "</span><h2>" + esc(a.label) + '</h2>' +
      '<label class="switch"><input type="checkbox" name="is_active"' + (a.is_active ? " checked" : "") + '><span></span></label></div>' +
      '<label>Account name</label><input name="account_name" maxlength="80" value="' + esc(a.account_name) + '" placeholder="Name on the account">' +
      '<label>Account / mobile number</label><input name="account_number" maxlength="40" value="' + esc(a.account_number) + '" placeholder="Example: 0917 123 4567">' +
      '<label>QR code image (optional)</label><input name="qr_url" maxlength="300" value="' + esc(a.qr_url || "") + '" placeholder="images/gcash-qr.png or https://...">' +
      '<label>Note for the customer (optional)</label><input name="instructions" maxlength="300" value="' + esc(a.instructions || "") + '" placeholder="Example: Send the exact amount only">' +
      '<div class="acct-actions"><button class="btn" type="submit">Save</button><button class="btn btn-outline" type="button" data-preview="' + a.method + '">Preview</button></div>' +
      '<div class="msg"></div><div class="acct-preview"></div></form>';
  }).join("");
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = await requireRole(["admin"]);
  if (!user) return;
  try {
    accounts = (await api("/payments/accounts")).accounts;
    drawAccounts();
  } catch (err) { showMsg("msg", err.message, "error"); return; }

  function read(form) {
    return {
      account_name: form.elements.account_name.value, account_number: form.elements.account_number.value,
      qr_url: form.elements.qr_url.value || null, instructions: form.elements.instructions.value || null,
      is_active: form.elements.is_active.checked
    };
  }
  var box = document.getElementById("pay-accounts");
  box.addEventListener("submit", async function (e) {
    e.preventDefault();
    var f = e.target, msg = f.querySelector(".msg");
    try {
      var res = await api("/payments/accounts/" + f.dataset.method, "PUT", read(f));
      msg.textContent = "Saved. " + (res.is_active ? "Customers can pay with " + res.label + " now." : res.label + " is off.");
      msg.className = "msg show success";
      f.classList.toggle("live", res.is_active);
    } catch (err) {
      msg.textContent = err.message; msg.className = "msg show error";
      f.elements.is_active.checked = false;
    }
  });
  box.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-preview]");
    if (!b) return;
    var f = b.closest("form"), d = read(f);
    d.method = f.dataset.method; d.label = payBrand(d.method).label;
    f.querySelector(".acct-preview").innerHTML = '<p class="pay-hint">This is what the customer sees:</p>' + payPanel(d, 250);
  });
});
