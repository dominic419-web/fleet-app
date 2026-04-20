export function formatKmHu(value) {
  return Number(value || 0).toLocaleString("hu-HU");
}

export function formatCurrencyHu(value) {
  return Number(value || 0).toLocaleString("hu-HU", {
    style: "currency",
    currency: "HUF",
    maximumFractionDigits: 0,
  });
}
