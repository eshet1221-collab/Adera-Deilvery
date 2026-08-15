(() => {
  "use strict";

  const tierOptionsEl = document.getElementById("callTierOptions");
  const distanceRange = document.getElementById("callDistance");
  const distanceValue = document.getElementById("callDistanceValue");
  const calcTotal = document.getElementById("callTotal");
  const calcBreakdown = document.getElementById("callBreakdown");
  const calcSavings = document.getElementById("callSavings");

  const form = document.getElementById("callOrderForm");
  const submitBtn = document.getElementById("callOrderSubmit");
  const errorEl = document.getElementById("callOrderError");

  const callFormSection = document.getElementById("callFormSection");
  const callAssignSection = document.getElementById("callAssignSection");

  const assignCourierBlock = document.getElementById("assignCourierBlock");
  const assignDoneBlock = document.getElementById("assignDoneBlock");
  const assignDoneMessage = document.getElementById("assignDoneMessage");
  const matchSearch = document.getElementById("callMatchSearch");
  const matchResults = document.getElementById("callMatchResults");
  const matchError = document.getElementById("callMatchError");

  let tiers = [];
  let tiersByKey = {};
  let currentOrderId = null;
  let matchSearchDebounce = null;

  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function currentTierKey() {
    const checked = form.querySelector('input[name="tier"]:checked');
    return checked ? checked.value : null;
  }

  function renderTierOptions() {
    tierOptionsEl.innerHTML = tiers
      .map(
        (tier, i) => `
        <label class="tier-pill" data-tier="${tier.key}">
          <input type="radio" name="tier" value="${tier.key}" ${i === 0 ? "checked" : ""}>
          <span>${tier.label}</span>
        </label>`
      )
      .join("");

    tierOptionsEl.querySelectorAll('input[name="tier"]').forEach((input) => {
      input.addEventListener("change", updatePreview);
    });
  }

  function updatePreview() {
    const tierKey = currentTierKey();
    const km = Number(distanceRange.value);
    distanceValue.textContent = `${km} km`;

    if (!tierKey || !tiersByKey[tierKey]) {
      calcTotal.textContent = "—";
      calcBreakdown.textContent = "Choose a tier and distance";
      calcSavings.textContent = "";
      return;
    }

    const tier = tiersByKey[tierKey];
    const billableKm = Math.max(0, km - 2);
    const total = Math.round(tier.base + billableKm * tier.rate);

    calcTotal.textContent = total.toLocaleString("en-US");
    calcBreakdown.textContent =
      billableKm > 0
        ? `${tier.base} birr base + ${billableKm} km × ${tier.rate} birr`
        : `${tier.base} birr flat — within the first 2 km`;
    calcSavings.textContent = `${tier.label} · ${tier.transport}`;
  }

  async function loadTiers() {
    try {
      const res = await fetch("/api/tiers");
      if (!res.ok) throw new Error("Could not load pricing");
      const data = await res.json();
      tiers = data.tiers || [];
      tiersByKey = Object.fromEntries(tiers.map((t) => [t.key, t]));
      renderTierOptions();
      updatePreview();
    } catch (err) {
      showError(
        "Couldn't reach the Adera Delivery API. Is the server running? (This page needs `npm start` in /server — it won't work opened as a plain file.)"
      );
    }
  }

  distanceRange.addEventListener("input", updatePreview);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");

    const tierKey = currentTierKey();
    if (!tierKey) {
      showError(
        tiers.length
          ? "Choose a tier first."
          : "The tier list never loaded, so there's nothing to select — check the API is reachable (see message above, or refresh the page) before submitting."
      );
      return;
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const payload = {
      tier: tierKey,
      distanceKm: Number(distanceRange.value),
      itemDescription: document.getElementById("callItemDescription").value.trim(),
      senderName: document.getElementById("callSenderName").value.trim(),
      senderPhone: document.getElementById("callSenderPhone").value.trim(),
      recipientName: document.getElementById("callRecipientName").value.trim(),
      recipientPhone: document.getElementById("callRecipientPhone").value.trim(),
      pickupAddress: document.getElementById("callPickupAddress").value.trim(),
      dropoffAddress: document.getElementById("callDropoffAddress").value.trim(),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    try {
      const data = await fetchJson("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      showAssignStep(data.order);
    } catch (err) {
      showError(err.message || "Something went wrong. Please try again.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit order";
    }
  });

  function showAssignStep(order) {
    currentOrderId = order.id;

    document.getElementById("callTrackingCode").textContent = order.trackingCode;
    const callOtp = document.getElementById("callOtp");
    if (order.otpCode) {
      document.getElementById("callOtpLabel").textContent = "Delivery code (OTP)";
      callOtp.textContent = order.otpCode;
      callOtp.classList.remove("otp-fallback-text");
    } else {
      document.getElementById("callOtpLabel").textContent = "Delivery code";
      callOtp.textContent = "Sent by SMS to the recipient";
      callOtp.classList.add("otp-fallback-text");
    }
    document.getElementById("callTrackLink").href = `track.html?code=${encodeURIComponent(order.trackingCode)}`;

    assignCourierBlock.hidden = false;
    assignDoneBlock.hidden = true;
    matchSearch.value = "";
    matchError.hidden = true;
    matchResults.innerHTML = `<p class="empty-state">Type to search couriers.</p>`;

    callFormSection.hidden = true;
    callAssignSection.hidden = false;
    callAssignSection.scrollIntoView({ behavior: "smooth", block: "start" });

    matchSearch.focus();
    searchCouriersForMatch("");
  }

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

  function renderMatchResults(couriers, total) {
    if (!couriers.length) {
      matchResults.innerHTML = `<p class="empty-state">No active couriers match — register one on the <a href="couriers.html">Couriers</a> page.</p>`;
      return;
    }
    matchResults.innerHTML = couriers
      .map(
        (c) => `
        <button type="button" class="match-result" data-courier-id="${c.id}">
          <strong>${esc(c.fullName)}</strong>
          <span>${esc(c.phone)} · ${esc(c.tierCapability.join(", "))}</span>
        </button>`
      )
      .join("") + (total > couriers.length ? `<p class="match-more">+ ${total - couriers.length} more — keep typing to narrow it down</p>` : "");
  }

  matchResults.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-courier-id]");
    if (!btn) return;
    matchError.hidden = true;
    const courierName = btn.querySelector("strong")?.textContent || "the courier";
    try {
      await fetchJson(`/api/orders/${currentOrderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "matched", courierId: Number(btn.dataset.courierId) }),
      });
      assignCourierBlock.hidden = true;
      assignDoneMessage.textContent = `Assigned to ${courierName} — they've been matched to this order.`;
      assignDoneBlock.hidden = false;
    } catch (err) {
      matchError.textContent = err.message;
      matchError.hidden = false;
    }
  });

  document.getElementById("callNewOrder").addEventListener("click", () => {
    form.reset();
    updatePreview();
    currentOrderId = null;
    callAssignSection.hidden = true;
    callFormSection.hidden = false;
    callFormSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  loadTiers();
})();
