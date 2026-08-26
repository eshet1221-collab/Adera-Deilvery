(() => {
  "use strict";

  // Unlike admin.html, this page also hosts PUBLIC courier self-registration
  // (POST /api/couriers, no login) — so there's no page-wide redirect here.
  // Only the roster listing and status toggle need an admin session; if one
  // isn't present, the roster area shows a "log in as admin" prompt instead
  // while the register button/dialog stays fully usable regardless.
  const adminToken = localStorage.getItem("loyal-admin-token");

  const adminLogoutBtn = document.getElementById("adminLogout");
  if (adminToken) {
    adminLogoutBtn.hidden = false;
    adminLogoutBtn.addEventListener("click", async () => {
      try {
        await fetch("/api/admin/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } });
      } catch {
        // ignore — clear + redirect below regardless
      }
      localStorage.removeItem("loyal-admin-token");
      localStorage.removeItem("loyal-admin-username");
      window.location.href = "admin-login.html";
    });
  }

  const couriersBody = document.getElementById("couriersBody");
  const courierSearch = document.getElementById("courierSearch");
  const courierStatusFilter = document.getElementById("courierStatusFilter");
  const couriersPrev = document.getElementById("couriersPrev");
  const couriersNext = document.getElementById("couriersNext");
  const couriersPageInfo = document.getElementById("couriersPageInfo");

  const courierForm = document.getElementById("courierForm");
  const courierError = document.getElementById("courierError");
  const registerDialog = document.getElementById("registerDialog");
  const openRegisterDialog = document.getElementById("openRegisterDialog");
  const courierCancel = document.getElementById("courierCancel");

  openRegisterDialog.addEventListener("click", () => {
    courierError.hidden = true;
    registerDialog.showModal();
  });
  courierCancel.addEventListener("click", () => registerDialog.close());

  const state = { page: 1, pageSize: 25, totalPages: 1, total: 0 };

  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  // Used only by the public registration form below (POST /api/couriers) —
  // never carries an admin token.
  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // Used by the roster listing + status toggle, which are admin-only.
  async function adminFetchJson(url, options = {}) {
    if (!adminToken) {
      const err = new Error(
        `Log in as <a href="admin-login.html">admin</a> to view or manage the courier roster.`
      );
      err.notAdmin = true;
      throw err;
    }
    const res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${adminToken}` },
    });
    if (res.status === 401) {
      localStorage.removeItem("loyal-admin-token");
      localStorage.removeItem("loyal-admin-username");
      const err = new Error(
        `Your admin session expired — <a href="admin-login.html">log in again</a> to view the roster.`
      );
      err.notAdmin = true;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function loadCouriers() {
    couriersBody.innerHTML = `<tr><td colspan="9" class="empty-state">Loading couriers…</td></tr>`;
    const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
    if (courierSearch.value.trim()) params.set("q", courierSearch.value.trim());
    if (courierStatusFilter.value) params.set("status", courierStatusFilter.value);

    try {
      const data = await adminFetchJson(`/api/couriers?${params}`);
      state.page = data.page;
      state.totalPages = data.totalPages;
      state.total = data.total;
      renderCouriers(data.couriers || []);
      renderPagination();
    } catch (err) {
      // err.message may contain the deliberate <a> markup above (notAdmin
      // case) — safe to inject as-is since it's a literal string this file
      // wrote, not user input; err.notAdmin messages are the only ones with
      // markup, everything else is plain text from esc()-safe server errors.
      couriersBody.innerHTML = `<tr><td colspan="9" class="empty-state">${err.notAdmin ? err.message : esc(err.message)}</td></tr>`;
      if (err.notAdmin) {
        couriersPageInfo.textContent = "";
        couriersPrev.disabled = true;
        couriersNext.disabled = true;
      }
    }
  }

  function renderPagination() {
    const { page, totalPages, total } = state;
    couriersPageInfo.textContent = total
      ? `Page ${page} of ${totalPages} — ${total.toLocaleString("en-US")} courier${total === 1 ? "" : "s"}`
      : "No couriers match";
    couriersPrev.disabled = page <= 1;
    couriersNext.disabled = page >= totalPages;
  }

  function resetToFirstPage() {
    state.page = 1;
    loadCouriers();
  }

  courierSearch.addEventListener("input", debounce(resetToFirstPage, 300));
  courierStatusFilter.addEventListener("change", resetToFirstPage);
  couriersPrev.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      loadCouriers();
    }
  });
  couriersNext.addEventListener("click", () => {
    if (state.page < state.totalPages) {
      state.page += 1;
      loadCouriers();
    }
  });

  function renderCouriers(couriers) {
    if (!couriers.length) {
      couriersBody.innerHTML = `<tr><td colspan="9" class="empty-state">No couriers match — try a different search, or register one below.</td></tr>`;
      return;
    }
    couriersBody.innerHTML = couriers
      .map((c) => {
        // Suspended is system-managed (cleared only by the courier topping
        // up their own wallet, see server/routes/wallet.js) — the generic
        // admin toggle can't be used to bypass that, so it's disabled here
        // rather than offering an "Activate" button that would just 409.
        const nextStatus = c.status === "active" ? "inactive" : "active";
        const actionLabel = c.status === "active" ? "Deactivate" : "Activate";
        return `
        <tr>
          <td>${esc(c.fullName)}</td>
          <td>${esc(c.phone)}</td>
          <td>${esc(c.email)}</td>
          <td>${esc(c.faydaId)}</td>
          <td>
            ${c.photoUrl ? `<a href="${esc(c.photoUrl)}" target="_blank" rel="noopener">Photo</a>` : "—"}
            ${c.faydaIdPhotoUrl ? ` · <a href="${esc(c.faydaIdPhotoUrl)}" target="_blank" rel="noopener">ID</a>` : ""}
          </td>
          <td>${esc(c.tierCapability.join(", "))}</td>
          <td>${Math.round(c.walletBalanceBirr).toLocaleString("en-US")} birr</td>
          <td><span class="status-badge status-${esc(c.status)}">${esc(c.status)}</span></td>
          <td>${
            c.status === "suspended"
              ? `<span class="form-note">Courier must top up</span>`
              : `<button type="button" class="btn btn-ghost btn-sm" data-toggle-status="${c.id}" data-next-status="${nextStatus}">${actionLabel}</button>`
          }</td>
        </tr>`;
      })
      .join("");
  }

  couriersBody.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-toggle-status]");
    if (!btn) return;
    const id = btn.getAttribute("data-toggle-status");
    const nextStatus = btn.getAttribute("data-next-status");
    btn.disabled = true;
    try {
      await adminFetchJson(`/api/couriers/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      loadCouriers();
    } catch (err) {
      btn.disabled = false;
      alert(err.message);
    }
  });

  courierForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    courierError.hidden = true;

    const photoFile = document.getElementById("courierPhoto").files[0];
    const faydaIdPhotoFile = document.getElementById("courierFaydaIdPhoto").files[0];
    const tierCapability = Array.from(courierForm.querySelectorAll('input[name="courierTier"]:checked')).map((i) => i.value);

    const formData = new FormData();
    formData.set("fullName", document.getElementById("courierName").value.trim());
    formData.set("phone", document.getElementById("courierPhone").value.trim());
    formData.set("email", document.getElementById("courierEmail").value.trim());
    formData.set("gender", document.getElementById("courierGender").value);
    formData.set("faydaId", document.getElementById("courierFaydaId").value.trim());
    formData.set("password", document.getElementById("courierPassword").value);
    tierCapability.forEach((t) => formData.append("tierCapability", t));
    if (photoFile) formData.set("photo", photoFile);
    if (faydaIdPhotoFile) formData.set("faydaIdPhoto", faydaIdPhotoFile);

    try {
      // No Content-Type header here — the browser sets multipart/form-data
      // with the correct boundary itself; setting it manually breaks parsing.
      await fetchJson("/api/couriers", { method: "POST", body: formData });
      courierForm.reset();
      registerDialog.close();
      resetToFirstPage();
    } catch (err) {
      courierError.textContent = err.message;
      courierError.hidden = false;
    }
  });

  document.getElementById("refreshCouriers").addEventListener("click", loadCouriers);

  loadCouriers();
})();
