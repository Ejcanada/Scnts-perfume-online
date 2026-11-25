// admin.js - admin page: manage perfumes and orders

var editId = null;
var STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"];
var adminProducts = {};

function formValue(id) { return document.getElementById(id).value.trim(); }

function resetForm() {
  editId = null;
  document.getElementById("product-form").reset();
  document.getElementById("form-title").textContent = "Add a perfume";
  document.getElementById("save-btn").textContent = "Add perfume";
  document.getElementById("cancel-btn").style.display = "none";
}

async function loadAdminProducts() {
  var data = await api("/products");
  adminProducts = {};
  data.products.forEach(function (p) { adminProducts[p.id] = p; });
  document.getElementById("product-rows").innerHTML = data.products.map(function (p) {
    return "<tr><td>" + p.id + "</td><td>" + esc(p.name) + "</td><td>" + esc(p.brand) + "</td><td>" + categoryLabel(p.category) +
      "</td><td>" + money(p.price) + "</td><td>" + p.stock + "</td><td>" +
      '<button class="btn btn-outline btn-small" data-act="edit" data-id="' + p.id + '">Edit</button> ' +
      '<button class="btn btn-danger btn-small" data-act="delete" data-id="' + p.id + '">Delete</button></td></tr>';
  }).join("");
}

async function loadAdminOrders() {
  var data = await api("/orders/all");
  var rows = document.getElementById("order-rows");
  if (!data.orders.length) {
    rows.innerHTML = '<tr><td colspan="5" class="empty">No orders yet.</td></tr>';
    return;
  }
  rows.innerHTML = data.orders.map(function (o) {
    var options = STATUSES.map(function (s) {
      return '<option value="' + s + '"' + (s === o.status ? " selected" : "") + ">" + s + "</option>";
    }).join("");
    var who = o.user ? esc(o.user.name) + "<br><small>" + esc(o.user.email) + "</small>" : "User " + o.user_id;
    return "<tr><td>#" + o.id + "</td><td>" + who + "</td><td>" + money(o.total) + "</td><td>" +
      new Date(o.created_at).toLocaleDateString() + '</td><td><select data-order="' + o.id + '">' + options + "</select></td></tr>";
  }).join("");
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = getUser();
  if (!user || user.role !== "admin") {
    document.getElementById("admin-content").style.display = "none";
    document.getElementById("not-admin").style.display = "block";
    return;
  }

  try {
    await loadAdminProducts();
    await loadAdminOrders();
  } catch (err) {
    showMsg("msg", err.message, "error");
  }

  document.getElementById("cancel-btn").onclick = resetForm;

  document.getElementById("product-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    hideMsg("msg");
    var body = {
      name: formValue("f-name"),
      brand: formValue("f-brand"),
      description: formValue("f-description") || null,
      price: Number(formValue("f-price")),
      size_ml: Number(formValue("f-size")),
      category: formValue("f-category"),
      stock: Number(formValue("f-stock") || 0),
      image_url: formValue("f-image") || null
    };
    try {
      if (editId) {
        await api("/products/" + editId, "PATCH", body);
        showMsg("msg", "Perfume updated.", "success");
      } else {
        await api("/products", "POST", body);
        showMsg("msg", "Perfume added.", "success");
      }
      resetForm();
      await loadAdminProducts();
    } catch (err) {
      showMsg("msg", err.message, "error");
    }
  });

  document.getElementById("product-rows").addEventListener("click", async function (e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var id = Number(btn.dataset.id);
    var p = adminProducts[id];
    hideMsg("msg");

    if (btn.dataset.act === "edit") {
      editId = id;
      document.getElementById("f-name").value = p.name;
      document.getElementById("f-brand").value = p.brand;
      document.getElementById("f-description").value = p.description || "";
      document.getElementById("f-price").value = p.price;
      document.getElementById("f-size").value = p.size_ml;
      document.getElementById("f-category").value = p.category;
      document.getElementById("f-stock").value = p.stock;
      document.getElementById("f-image").value = p.image_url || "";
      document.getElementById("form-title").textContent = "Edit perfume #" + id;
      document.getElementById("save-btn").textContent = "Save changes";
      document.getElementById("cancel-btn").style.display = "inline-block";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    if (btn.dataset.act === "delete") {
      if (!confirm("Delete " + p.name + "?")) return;
      try {
        await api("/products/" + id, "DELETE");
        showMsg("msg", "Perfume deleted.", "success");
        await loadAdminProducts();
      } catch (err) {
        showMsg("msg", err.message, "error");
      }
    }
  });

  document.getElementById("order-rows").addEventListener("change", async function (e) {
    var sel = e.target.closest("select[data-order]");
    if (!sel) return;
    try {
      await api("/orders/" + sel.dataset.order + "/status", "PATCH", { status: sel.value });
      toast("Order status updated");
    } catch (err) {
      showMsg("msg", err.message, "error");
    }
  });
});
