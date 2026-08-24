(() => {
  "use strict";

  const tierOptionsEl = document.getElementById("tierOptions");
  const distanceRange = document.getElementById("bookingDistance");
  const distanceValue = document.getElementById("bookingDistanceValue");
  const calcTotal = document.getElementById("bookingTotal");
  const calcBreakdown = document.getElementById("bookingBreakdown");
  const calcSavings = document.getElementById("bookingSavings");

  const form = document.getElementById("orderForm");
  const submitBtn = document.getElementById("orderSubmit");
  const errorEl = document.getElementById("orderError");

  const bookingSection = document.getElementById("bookingSection");
  const confirmSection = document.getElementById("confirmSection");

  const payNowPanel = document.getElementById("payNowPanel");
  const codNote = document.getElementById("codNote");
  const payAmount = document.getElementById("payAmount");
  const payReference = document.getElementById("payReference");
  const payError = document.getElementById("payError");
  const paySubmit = document.getElementById("paySubmit");
  const payConfirmed = document.getElementById("payConfirmed");

  let tiers = [];
  let tiersByKey = {};
  let currentOrderId = null;

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

    const paymentMethod = form.querySelector('input[name="paymentMethod"]:checked')?.value || "prepaid";

    const payload = {
      tier: tierKey,
      distanceKm: Number(distanceRange.value),
      itemDescription: document.getElementById("itemDescription").value.trim(),
      senderName: document.getElementById("senderName").value.trim(),
      senderPhone: document.getElementById("senderPhone").value.trim(),
      recipientName: document.getElementById("recipientName").value.trim(),
      recipientPhone: document.getElementById("recipientPhone").value.trim(),
      pickupAddress: document.getElementById("pickupAddress").value.trim(),
      dropoffAddress: document.getElementById("dropoffAddress").value.trim(),
      paymentMethod,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Booking…";

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create the order");

      showConfirmation(data.order);
    } catch (err) {
      showError(err.message || "Something went wrong. Please try again.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirm & get price";
    }
  });

  function showConfirmation(order) {
    currentOrderId = order.id;
    document.getElementById("confTrackingCode").textContent = order.trackingCode;
    const confOtp = document.getElementById("confOtp");
    if (order.otpCode) {
      document.getElementById("confOtpLabel").textContent = "Delivery code (OTP)";
      confOtp.textContent = order.otpCode;
      confOtp.classList.remove("otp-fallback-text");
    } else {
      // SMS is configured server-side — the code was texted to the
      // recipient instead of being handed back over the API.
      document.getElementById("confOtpLabel").textContent = "Delivery code";
      confOtp.textContent = "Sent by SMS to the recipient";
      confOtp.classList.add("otp-fallback-text");
    }
    document.getElementById("confTier").textContent = tiersByKey[order.tier]?.label || order.tier;
    document.getElementById("confPrice").textContent = `${Math.round(order.priceBirr).toLocaleString("en-US")} birr`;
    document.getElementById("confPickup").textContent = order.pickupAddress;
    document.getElementById("confDropoff").textContent = order.dropoffAddress;
    document.getElementById("confTrackLink").href = `track.html?code=${encodeURIComponent(order.trackingCode)}`;

    payReference.value = "";
    payError.textContent = "";
    payError.hidden = true;
    payConfirmed.hidden = true;
    paySubmit.hidden = false;
    payReference.hidden = false;
    if (order.paymentMethod === "prepaid") {
      payAmount.textContent = Math.round(order.priceBirr).toLocaleString("en-US");
      payNowPanel.hidden = false;
      codNote.hidden = true;
    } else {
      payNowPanel.hidden = true;
      codNote.hidden = false;
    }

    bookingSection.hidden = true;
    confirmSection.hidden = false;
    confirmSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  paySubmit.addEventListener("click", async () => {
    const reference = payReference.value.trim();
    payError.hidden = true;
    if (!reference) {
      payError.textContent = "Enter the transaction reference from your payment.";
      payError.hidden = false;
      return;
    }

    paySubmit.disabled = true;
    paySubmit.textContent = "Submitting…";
    try {
      const res = await fetch(`/api/orders/${currentOrderId}/payment-reference`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentReference: reference }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not confirm payment");

      paySubmit.hidden = true;
      payReference.hidden = true;
      payConfirmed.hidden = false;
    } catch (err) {
      payError.textContent = err.message || "Something went wrong. Please try again.";
      payError.hidden = false;
    } finally {
      paySubmit.disabled = false;
      paySubmit.textContent = "I've paid — submit reference";
    }
  });

  document.getElementById("confNewOrder").addEventListener("click", () => {
    form.reset();
    updatePreview();
    confirmSection.hidden = true;
    bookingSection.hidden = false;
    bookingSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  loadTiers();
})();
