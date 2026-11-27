// checkout.js - review the cart and place the order

document.addEventListener("DOMContentLoaded", function () {
  var cart = getCart();
  var list = document.getElementById("summary");
  var btn = document.getElementById("place-btn");

  if (!cart.length) {
    list.innerHTML = '<p class="empty">Your cart is empty. <a href="shop.html">Go to the shop</a></p>';
    btn.style.display = "none";
    document.getElementById("total-line").style.display = "none";
    return;
  }

  var total = 0;
  list.innerHTML = cart.map(function (i) {
    total += i.price * i.qty;
    return '<div class="cart-row"><div class="info"><strong>' + esc(i.name) + "</strong><br>" +
      i.qty + " × " + money(i.price) + '</div><div class="price">' + money(i.price * i.qty) + "</div></div>";
  }).join("");
  document.getElementById("total").textContent = money(total);

  // payment method: GCash, MariBank or GoTyme (only the ones the shop turned on)
  var methods = [];
  var chosen = "";
  loadPayMethods().then(function (m) {
    methods = m;
    var area = document.getElementById("pay-area");
    if (!m.length) return;
    area.innerHTML = '<h3 class="pay-title">How do you want to pay?</h3>' + payPicker(m, "") + '<div id="pay-preview"></div>';
    area.addEventListener("click", function (e) {
      var c = e.target.closest(".pay-card");
      if (!c) return;
      chosen = c.dataset.method;
      area.querySelectorAll(".pay-card").forEach(function (x) { x.classList.toggle("on", x === c); });
      var acct = methods.find(function (x) { return x.method === chosen; });
      document.getElementById("pay-preview").innerHTML = '<p class="pay-hint">You will see where to send ' + money(total) + " after you place the order.</p>";
      btn.textContent = "Place order and pay with " + (acct ? acct.label : "");
    });
  });

  btn.addEventListener("click", async function () {
    hideMsg("msg");
    if (methods.length && !chosen) { showMsg("msg", "Please choose how you want to pay.", "error"); return; }
    btn.disabled = true;
    try {
      var items = getCart().map(function (i) { return { product_id: i.id, quantity: i.qty }; });
      var order = await api("/orders", "POST", { items: items, reseller: resellerSlug() || null, payment_method: chosen || null });
      saveCart([]);
      var box = document.getElementById("checkout-box");
      if (chosen) {
        var acct = methods.find(function (x) { return x.method === chosen; });
        box.innerHTML = '<h2>Order #' + esc(order.id) + " placed</h2><p class=\"sub\">Now send " + money(order.total) + " to finish your order.</p>" +
          payPanel(acct, order.total) + refForm(order.id) + '<p class="sub" style="margin-top:16px">You can also do this later in <a href="my-orders.html">My orders</a>.</p>';
        document.addEventListener("scnts-paid", function () {
          box.querySelector(".ref-form button").style.display = "none";
          box.insertAdjacentHTML("beforeend", '<a class="btn" href="my-orders.html" style="margin-top:14px">See my orders</a>');
        }, { once: true });
      } else {
        box.innerHTML = '<h2>Thank you!</h2><p class="sub">Your order #' + esc(order.id) + " was placed. Total: " + money(order.total) +
          '.</p><a class="btn" href="my-orders.html">See my orders</a>';
      }
    } catch (err) {
      showMsg("msg", err.message, "error");
      btn.disabled = false;
    }
  });
});
