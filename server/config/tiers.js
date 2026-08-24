// Single source of truth for tier pricing, taken from Section 4 / Section 10
// of the business plan: total = base fare (covers first 2km) + (km beyond 2) * per-km rate.
const TIERS = {
  express: {
    label: "Express",
    transport: "On foot / taxi / train",
    base: 60,
    rate: 15,
  },
  standard: {
    label: "Standard",
    transport: "Bicycle / motor scooter",
    base: 80,
    rate: 15,
  },
  secure: {
    label: "Secure",
    transport: "Vetted courier / private car",
    base: 180,
    rate: 25,
  },
  cargo: {
    label: "Cargo",
    transport: "Suzuki / Isuzu",
    base: 600,
    rate: 80,
  },
};

const FREE_KM = 2; // first 2 km are covered by the base fare

// Flat platform commission on every delivery, regardless of tier (Payment &
// Commission Management spec, Section A) — replaces the old per-tier rates.
const COMMISSION_RATE = 0.18;

function priceFor(tierKey, distanceKm) {
  const tier = TIERS[tierKey];
  if (!tier) return null;
  const billableKm = Math.max(0, distanceKm - FREE_KM);
  return Math.round((tier.base + billableKm * tier.rate) * 100) / 100;
}

// What the courier actually keeps after the platform's flat commission.
function earningsFor(priceBirr) {
  return Math.round(priceBirr * (1 - COMMISSION_RATE) * 100) / 100;
}

module.exports = { TIERS, FREE_KM, COMMISSION_RATE, priceFor, earningsFor };
