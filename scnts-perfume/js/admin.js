// admin.js - Products page: add, edit and delete perfumes (orders are in orders.js)

var editId = null;
var adminProducts = {};
var companyPrices = {};

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
  try { companyPrices = (await api("/products/company-prices")).prices; } catch (e) { companyPrices = {}; }
  adminProducts = {};
  data.products.forEach(function (p) { adminProducts[p.id] = p; });
  document.getElementById("product-rows").innerHTML = data.products.map(function (p) {
    return "<tr><td>" + p.id + "</td><td>" + esc(p.name) + "</td><td>" + esc(p.brand) + "</td><td>" + categoryLabel(p.category) +
      "</td><td>" + money(p.price) + "</td><td>" + money(companyPrices[p.id] === undefined ? 250 : companyPrices[p.id]) + "</td><td>" + p.stock + "</td><td>" +
      '<button class="btn btn-outline btn-small" data-act="edit" data-id="' + p.id + '">Edit</button> ' +
      '<button class="btn btn-danger btn-small" data-act="delete" data-id="' + p.id + '">Delete</button></td></tr>';
  }).join("");
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = (await refreshUser()) || getUser();
  if (!user || user.role !== "admin") {
    document.getElementById("admin-content").style.display = "none";
    document.getElementById("not-admin").style.display = "block";
    return;
  }

  try {
    await loadAdminProducts();
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
      company_price: Number(formValue("f-company") === "" ? 250 : formValue("f-company")),
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
      document.getElementById("f-company").value = companyPrices[id] === undefined ? 250 : companyPrices[id];
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
});
