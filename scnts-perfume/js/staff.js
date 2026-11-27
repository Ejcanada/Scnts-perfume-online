// staff.js - admin manages employee accounts

async function loadStaff() {
  var data = await api("/staff");
  document.getElementById("staff-rows").innerHTML = data.staff.map(function (s) {
    var actions = "";
    if (s.role === "employee") {
      actions = '<button class="btn btn-outline btn-small" data-act="toggle" data-id="' + s.id + '" data-active="' + s.is_active + '">' +
        (s.is_active ? "Deactivate" : "Activate") + "</button> " +
        '<button class="btn btn-outline btn-small" data-act="password" data-id="' + s.id + '">New password</button>';
    }
    return "<tr><td>" + esc(s.name) + "</td><td>" + esc(s.email) + "</td><td>" + esc(s.role) + "</td><td>" +
      (s.is_active ? '<span class="badge ok">Active</span>' : '<span class="badge out">Disabled</span>') + "</td><td>" + actions + "</td></tr>";
  }).join("");
}

document.addEventListener("DOMContentLoaded", async function () {
  var user = await requireRole(["admin"]);
  if (!user) return;

  document.getElementById("staff-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    hideMsg("msg");
    try {
      await api("/staff", "POST", {
        name: document.getElementById("s-name").value.trim(),
        email: document.getElementById("s-email").value.trim(),
        password: document.getElementById("s-pass").value
      });
      showMsg("msg", "Employee added. Give her the email and password so she can log in.", "success");
      document.getElementById("staff-form").reset();
      loadStaff();
    } catch (err) {
      showMsg("msg", err.message, "error");
    }
  });

  document.getElementById("staff-rows").addEventListener("click", async function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    hideMsg("msg");
    try {
      if (b.dataset.act === "toggle") {
        await api("/staff/" + b.dataset.id, "PATCH", { is_active: b.dataset.active !== "true" });
      } else {
        var pw = prompt("Type the new password (at least 6 characters):");
        if (!pw) return;
        await api("/staff/" + b.dataset.id, "PATCH", { password: pw });
        showMsg("msg", "Password changed.", "success");
      }
      loadStaff();
    } catch (err) {
      showMsg("msg", err.message, "error");
    }
  });

  try { await loadStaff(); } catch (err) { showMsg("msg", err.message, "error"); }
});
