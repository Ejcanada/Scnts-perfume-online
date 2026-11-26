// cart.js - cart page

function drawCart() {
  var cart = getCart();
  var box = document.getElementById("cart-items");
  var totalEl = document.getElementById("cart-total");
  var checkoutBtn = document.getElementById("checkout-btn");

  if (!cart.length) {
    box.innerHTML = '<p class="empty">Your cart is empty. <a href="shop.html">Go to the shop</a></p>';
    totalEl.textContent = money(0);
    checkoutBtn.style.display = "none";
    return;
  }
  checkoutBtn.style.display = "inline-block";

  var total = 0;
  box.innerHTML = cart.map(function (i) {
    total += i.price * i.qty;
    return '<div class="cart-row">' + productImage(i) +
      '<div class="info"><strong>' + esc(i.name) + "</strong><br><span class=\"price\">" + money(i.price) + "</span></div>" +
      '<div class="qty"><button data-act="minus" data-id="' + i.id + '">−</button><span>' + i.qty +
      '</span><button data-act="plus" data-id="' + i.id + '">+</button></div>' +
      '<button class="btn btn-danger btn-small" data-act="remove" data-id="' + i.id + '">Remove</button></div>';
  }).join("");
  totalEl.textContent = money(total);
}

document.addEventListener("DOMContentLoaded", function () {
  drawCart();
  document.getElementById("cart-items").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var id = Number(btn.dataset.id);
    var cart = getCart();
    var item = cart.find(function (i) { return i.id === id; });
    if (!item) return;
    if (btn.dataset.act === "plus") item.qty = Math.min(20, item.qty + 1);
    if (btn.dataset.act === "minus") item.qty = Math.max(1, item.qty - 1);
    if (btn.dataset.act === "remove") cart = cart.filter(function (i) { return i.id !== id; });
    saveCart(cart);
    drawCart();
  });
});
