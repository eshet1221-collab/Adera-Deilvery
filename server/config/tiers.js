// Single source of truth for tier pricing, taken from Section 4 / Section 10
// of the business plan: total = base fare (covers first 2km) + (km beyond 2) * per-km rate.
// commission % is also from Section 10 ("Platform Commission") — used to
// compute what a courier actually takes home per delivery.
const TIERS = {
  express: {
    label: "Express",
    transport: "On foot / taxi / train",
    base: 60,
    rate: 15,
    commission: 20,
  },
  standard: {
    label: "Standard",
    transport: "Bicycle / motor scooter",
    base: 80,
    rate: 15,
    commission: 20,
  },
  secure: {
    label: "Secure",
    transport: "Vetted courier / private car",
    base: 180,
    rate: 25,
    commission: 15,
  },
  cargo: {
    label: "Cargo",
    transport: "Suzuki / Isuzu",
    base: 600,
    rate: 80,
    commission: 12,
  },
};

const FREE_KM = 2; // first 2 km are covered by the base fare

function priceFor(tierKey, distanceKm) {
  const tier = TIERS[tierKey];
  if (!tier) return null;
  const billableKm = Math.max(0, distanceKm - FREE_KM);
  return Math.round((tier.base + billableKm * tier.rate) * 100) / 100;
}

// What the courier actually keeps after the platform's commission.
function earningsFor(tierKey, priceBirr) {
  const tier = TIERS[tierKey];
  if (!tier) return null;
  return Math.round(priceBirr * (1 - tier.commission / 100) * 100) / 100;
}

module.exports = { TIERS, FREE_KM, priceFor, earningsFor };
