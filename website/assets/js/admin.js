(() => {
  "use strict";

  const ordersBody = document.getElementById("ordersBody");
  const orderSearch = document.getElementById("orderSearch");
  const orderStatusFilter = document.getElementById("orderStatusFilter");
  const orderTierFilter = document.getElementById("orderTierFilter");
  const ordersPrev = document.getElementById("ordersPrev");
  const ordersNext = document.getElementById("ordersNext");
  const ordersPageInfo = document.getElementById("ordersPageInfo");

  const otpDialog = document.getElementById("otpDialog");
  const otpForm = document.getElementById("otpForm");
  const otpInput = document.getElementById("otpInput");
  const otpError = document.getElementById("otpError");
  const otpCancel = document.getElementById("otpCancel");

  const proofDialog = document.getElementById("proofDialog");
  const proofForm = document.getElementById("proofForm");
  const proofInput = document.getElementById("proofInput");
  const proofError = document.getElementById("proofError");
  const proofCancel = document.getElementById("proofCancel");

  const matchDialog = document.getElementById("matchDialog");
  const matchSearch = document.getElementById("matchSearch");
  const matchResults = document.getElementById("matchResults");
  const matchError = document.getElementById("matchError");
  const matchCancel = document.getElementById("matchCancel");

  const STATUS_LABELS = {
    pending: "Pending",
    matched: "Matched",
    picked_up: "Picked up",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };

  let pendingOtpOrderId = null;
  let pendingProofOrderId = null;
  let pendingMatchOrderId = null;
  let pendingMatchOrder = null;
  let matchSearchDebounce = null;
  let ordersCache = [];

  const ordersState = { page: 1, pageSize: 25, totalPages: 1, total: 0 };

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

  /* ---------- orders: search + filter + pagination ---------- */
  async function loadOrders() {
    ordersBody.innerHTML = `<tr><td colspan="9" class="empty-state">Loading orders…</td></tr>`;
    const params = new URLSearchParams({ page: ordersState.page, pageSize: ordersState.pageSize });
    if (orderSearch.value.trim()) params.set("q", orderSearch.value.trim());
    if (orderStatusFilter.value) params.set("status", orderStatusFilter.value);
    if (orderTierFilter.value) params.set("tier", orderTierFilter.value);

    try {
      const data = await fetchJson(`/api/orders?${params}`);
      ordersState.page = data.page;
      ordersState.totalPages = data.totalPages;
      ordersState.total = data.total;
      renderOrders(data.orders || []);
      renderPagination();
    } catch (err) {
      ordersBody.innerHTML = `<tr><td colspan="9" class="empty-state">${esc(err.message)}</td></tr>`;
    }
  }

  function renderPagination() {
    const { page, totalPages, total } = ordersState;
    ordersPageInfo.textContent = total
      ? `Page ${page} of ${totalPages} — ${total.toLocaleString("en-US")} order${total === 1 ? "" : "s"}`
      : "No orders match";
    ordersPrev.disabled = page <= 1;
    ordersNext.disabled = page >= totalPages;
  }

  function resetToFirstPage() {
    ordersState.page = 1;
    loadOrders();
  }

  orderSearch.addEventListener("input", debounce(resetToFirstPage, 300));
  orderStatusFilter.addEventListener("change", resetToFirstPage);
  orderTierFilter.addEventListener("change", resetToFirstPage);
  ordersPrev.addEventListener("click", () => {
    if (ordersState.page > 1) {
      ordersState.page -= 1;
      loadOrders();
    }
  });
  ordersNext.addEventListener("click", () => {
    if (ordersState.page < ordersState.totalPages) {
      ordersState.page += 1;
      loadOrders();
    }
  });

  function actionCell(order) {
    switch (order.status) {
      case "pending":
        return `
          <div class="row-actions">
            <button class="btn btn-primary btn-sm" data-action="match" data-id="${order.id}">Match courier</button>
          </div>
          <button class="link-btn" data-action="cancel" data-id="${order.id}">cancel</button>`;
      case "matched":
        return `
          <div class="row-actions">
            <button class="btn btn-primary btn-sm" data-action="pickup" data-id="${order.id}">Mark picked up</button>
          </div>
          <button class="link-btn" data-action="cancel" data-id="${order.id}">cancel</button>`;
      case "picked_up":
        return order.proofSubmitted
          ? `
          <div class="row-actions">
            <button class="btn btn-primary btn-sm" data-action="deliver" data-id="${order.id}">Confirm delivery</button>
          </div>
          <button class="link-btn" data-action="cancel" data-id="${order.id}">cancel</button>`
          : `
          <div class="row-actions">
            <button class="btn btn-primary btn-sm" data-action="proof" data-id="${order.id}">Upload proof</button>
          </div>
          <button class="link-btn" data-action="cancel" data-id="${order.id}">cancel</button>`;
      default:
        return "—";
    }
  }

  function proofCell(order) {
    if (!order.proofSubmitted) return order.status === "delivered" ? "—" : "Not yet";
    return `<a href="${esc(order.proofUrl)}" target="_blank" rel="noopener">View ✓</a>`;
  }

  function paymentCell(order) {
    if (order.paymentMethod === "cod") return `Cash on delivery`;
    const label = { pending: "Awaiting payment", escrowed: "Escrowed", settled: "Settled" }[order.paymentStatus] || order.paymentStatus;
    return `Prepaid · ${esc(label)}`;
  }

  function renderOrders(orders) {
    ordersCache = orders;
    if (!orders.length) {
      ordersBody.innerHTML = `<tr><td colspan="9" class="empty-state">No orders match — try a different search, or book one from the <a href="order.html">Ship</a> page.</td></tr>`;
      return;
    }
    ordersBody.innerHTML = orders
      .map(
        (o) => `
        <tr data-order-row="${o.id}">
          <td><a class="tracking-code" href="/track.html?code=${encodeURIComponent(o.trackingCode)}" target="_blank" rel="noopener">${esc(o.trackingCode)}</a></td>
          <td>${esc(o.tier)}</td>
          <td class="wrap-cell">${esc(o.pickupAddress)} → ${esc(o.dropoffAddress)}</td>
          <td>${Math.round(o.priceBirr).toLocaleString("en-US")} birr</td>
          <td>${paymentCell(o)}</td>
          <td><span class="status-badge status-${o.status}">${STATUS_LABELS[o.status] || o.status}</span></td>
          <td>${esc(o.courierName || "—")}</td>
          <td>${proofCell(o)}</td>
          <td>${actionCell(o)}</td>
        </tr>`
      )
      .join("");
  }

  ordersBody.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === "match") {
      openMatchDialog(id);
    } else if (action === "pickup") {
      await updateStatus(id, "picked_up");
    } else if (action === "cancel") {
      if (confirm("Cancel this order?")) await updateStatus(id, "cancelled");
    } else if (action === "deliver") {
      openOtpDialog(id);
    } else if (action === "proof") {
      openProofDialog(id);
    }
  });

  async function updateStatus(id, status, extra = {}) {
    try {
      await fetchJson(`/api/orders/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      await loadOrders();
    } catch (err) {
      alert(err.message);
    }
  }

  /* ---------- match-a-courier dialog (search-as-you-type) ---------- */
  function openMatchDialog(orderId) {
    pendingMatchOrderId = orderId;
    pendingMatchOrder = ordersCache.find((o) => o.id === orderId) || null;
    matchSearch.value = "";
    matchError.hidden = true;
    matchResults.innerHTML = `<p class="empty-state">Type to search couriers.</p>`;
    matchDialog.showModal();
    matchSearch.focus();
    searchCouriersForMatch("");
  }

  matchCancel.addEventListener("click", () => matchDialog.close());

  matchSearch.addEventListener("input", () => {
    clearTimeout(matchSearchDebounce);
    matchSearchDebounce = setTimeout(() => searchCouriersForMatch(matchSearch.value.trim()), 250);
  });

  async function searchCouriersForMatch(term) {
    const params = new URLSearchParams({ status: "active", pageSize: "8" });
    if (term) params.set("q", term);
    try {
      const data = await fetchJson(`/api/couriers?${params}`);
      renderMatchResults(data.couriers || [], data.total || 0);
    } catch (err) {
      matchResults.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`;
    }
  }

  // COD buffer check is a UX nicety only — the server (PATCH /:id/status)
  // enforces the real 18%-of-price minimum-balance rule and rejects an
  // underfunded match with a 409, surfaced via matchError below either way.
  const COD_COMMISSION_RATE = 0.18;

  function renderMatchResults(couriers, total) {
    if (!couriers.length) {
      matchResults.innerHTML = `<p class="empty-state">No active couriers match — register one on the <a href="couriers.html">Couriers</a> page.</p>`;
      return;
    }
    const isCod = pendingMatchOrder?.paymentMethod === "cod";
    const requiredBuffer = isCod ? Math.round(pendingMatchOrder.priceBirr * COD_COMMISSION_RATE * 100) / 100 : 0;

    matchResults.innerHTML = couriers
      .map((c) => {
        const insufficient = isCod && c.walletBalanceBirr < requiredBuffer;
        return `
        <button type="button" class="match-result" data-courier-id="${c.id}" ${insufficient ? "disabled" : ""}>
          <strong>${esc(c.fullName)}</strong>
          <span>${esc(c.phone)} · ${esc(c.tierCapability.join(", "))} · Wallet: ${Math.round(c.walletBalanceBirr).toLocaleString("en-US")} birr${
            insufficient ? ` <span class="amount-negative">(needs ${requiredBuffer.toLocaleString("en-US")} birr for this COD order)</span>` : ""
          }</span>
        </button>`;
      })
      .join("") + (total > couriers.length ? `<p class="match-more">+ ${total - couriers.length} more — keep typing to narrow it down</p>` : "");
  }

  matchResults.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-courier-id]");
    if (!btn) return;
    matchError.hidden = true;
    try {
      await fetchJson(`/api/orders/${pendingMatchOrderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "matched", courierId: Number(btn.dataset.courierId) }),
      });
      matchDialog.close();
      await loadOrders();
    } catch (err) {
      matchError.textContent = err.message;
      matchError.hidden = false;
    }
  });

  /* ---------- OTP dialog ---------- */
  function openOtpDialog(orderId) {
    pendingOtpOrderId = orderId;
    otpInput.value = "";
    otpError.hidden = true;
    otpDialog.showModal();
    otpInput.focus();
  }

  otpCancel.addEventListener("click", () => otpDialog.close());

  otpForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    otpError.hidden = true;
    try {
      await fetchJson(`/api/orders/${pendingOtpOrderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "delivered", otp: otpInput.value.trim() }),
      });
      otpDialog.close();
      await loadOrders();
    } catch (err) {
      otpError.textContent = err.message;
      otpError.hidden = false;
    }
  });

  /* ---------- proof dialog ---------- */
  function openProofDialog(orderId) {
    pendingProofOrderId = orderId;
    proofForm.reset();
    proofError.hidden = true;
    proofDialog.showModal();
  }

  proofCancel.addEventListener("click", () => proofDialog.close());

  proofForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    proofError.hidden = true;

    const file = proofInput.files[0];
    if (!file) {
      proofError.textContent = "Choose a photo or video first.";
      proofError.hidden = false;
      return;
    }

    const formData = new FormData();
    formData.append("proof", file);

    try {
      // No Content-Type header here on purpose — the browser sets the
      // multipart boundary itself when the body is a FormData instance.
      await fetchJson(`/api/orders/${pendingProofOrderId}/proof`, { method: "POST", body: formData });
      proofDialog.close();
      await loadOrders();
    } catch (err) {
      proofError.textContent = err.message;
      proofError.hidden = false;
    }
  });

  document.getElementById("refreshOrders").addEventListener("click", loadOrders);

  loadOrders();
})();
