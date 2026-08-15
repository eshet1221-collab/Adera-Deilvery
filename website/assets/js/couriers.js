(() => {
  "use strict";

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

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function loadCouriers() {
    couriersBody.innerHTML = `<tr><td colspan="8" class="empty-state">Loading couriers…</td></tr>`;
    const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
    if (courierSearch.value.trim()) params.set("q", courierSearch.value.trim());
    if (courierStatusFilter.value) params.set("status", courierStatusFilter.value);

    try {
      const data = await fetchJson(`/api/couriers?${params}`);
      state.page = data.page;
      state.totalPages = data.totalPages;
      state.total = data.total;
      renderCouriers(data.couriers || []);
      renderPagination();
    } catch (err) {
      couriersBody.innerHTML = `<tr><td colspan="8" class="empty-state">${esc(err.message)}</td></tr>`;
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
      couriersBody.innerHTML = `<tr><td colspan="8" class="empty-state">No couriers match — try a different search, or register one below.</td></tr>`;
      return;
    }
    couriersBody.innerHTML = couriers
      .map((c) => {
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
          <td><span class="status-badge status-${esc(c.status)}">${esc(c.status)}</span></td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-toggle-status="${c.id}" data-next-status="${nextStatus}">${actionLabel}</button></td>
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
      await fetchJson(`/api/couriers/${id}/status`, {
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
