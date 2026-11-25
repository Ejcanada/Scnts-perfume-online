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

  btn.addEventListener("click", async function () {
    hideMsg("msg");
    btn.disabled = true;
    try {
      var items = getCart().map(function (i) { return { product_id: i.id, quantity: i.qty }; });
      var order = await api("/orders", "POST", { items: items });
      saveCart([]);
      document.getElementById("checkout-box").innerHTML =
        '<h2>Thank you!</h2><p class="sub">Your order #' + esc(order.id) + " was placed. Total: " + money(order.total) +
        '.</p><a class="btn" href="my-orders.html">See my orders</a>';
    } catch (err) {
      showMsg("msg", err.message, "error");
      btn.disabled = false;
    }
  });
});
