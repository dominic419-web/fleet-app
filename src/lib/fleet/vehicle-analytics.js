import { todayIso } from "@/lib/fleet-utils";
import { WARNING_THRESHOLD_KM } from "./constants";

export function buildFleetHealthScore(vehicles, notifications) {
  const warningCount = vehicles.filter((item) => item.status === "warning").length;
  const lateCount = vehicles.filter((item) => item.status === "late").length;
  const docsCount = notifications.filter((item) => item.category === "docs").length;
  const legalLateCount = notifications.filter(
    (item) => item.category === "legal" && item.status === "late"
  ).length;

  const rawScore = 100 - lateCount * 14 - warningCount * 5 - docsCount * 2 - legalLateCount * 6;
  const value = Math.max(18, Math.min(100, rawScore));

  return {
    value,
    label:
      value >= 85 ? "Stabil flotta" : value >= 70 ? "Figyelmet kér" : "Beavatkozás kell",
    warningCount,
    lateCount,
    docsCount,
    legalLateCount,
  };
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function buildFleetHealthTrend(score, vehicles, notifications) {
  const monthLabels = [
    "Jan",
    "Feb",
    "Már",
    "Ápr",
    "Máj",
    "Jún",
    "Júl",
    "Aug",
    "Szept",
    "Okt",
    "Nov",
    "Dec",
  ];
  const now = new Date();

  const docPressure = notifications.filter((item) => item.category === "docs").length;
  const legalPressure = notifications.filter((item) => item.category === "legal").length;
  const servicePressure = vehicles.filter(
    (item) => item.status === "warning" || item.status === "late"
  ).length;
  const pressure = Math.min(12, servicePressure * 2 + legalPressure * 0.7 + docPressure * 0.35);

  const offsets = [-8.4, -6.1, -4.9, -3.2, -1.7, 0];

  return offsets.map((offset, index) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const seasonal = Math.sin((index + 1) * 0.85) * 1.8;
    const scoreValue = clamp(Math.round(score.value + offset - pressure * 0.18 + seasonal), 18, 100);

    return {
      month: monthLabels[d.getMonth()],
      score: scoreValue,
      alerts: Math.max(
        0,
        Math.round(servicePressure + legalPressure * 0.35 + docPressure * 0.2 - (5 - index) * 0.45)
      ),
    };
  });
}

export function buildPredictiveService(vehicle) {
  if (!vehicle) return null;

  const history = Array.isArray(vehicle.serviceHistory)
    ? vehicle.serviceHistory
        .filter((entry) => entry?.date && entry?.km !== null && entry?.km !== undefined)
        .map((entry) => ({
          ...entry,
          km: Number(entry.km),
          dateObj: new Date(`${entry.date}T00:00:00`),
        }))
        .filter((entry) => Number.isFinite(entry.km) && !Number.isNaN(entry.dateObj.getTime()))
        .sort((a, b) => a.dateObj - b.dateObj)
    : [];

  let avgKmPerDay = 0;
  let confidence = "Becsült modell";

  if (history.length >= 2) {
    const first = history[0];
    const last = history[history.length - 1];
    const dayDiff = Math.max(1, Math.round((last.dateObj - first.dateObj) / 86400000));
    const kmDiff = Math.max(0, last.km - first.km);

    if (kmDiff > 0) {
      avgKmPerDay = kmDiff / dayDiff;
      confidence = "Valós timeline alapján";
    }
  }

  if (!avgKmPerDay || !Number.isFinite(avgKmPerDay)) {
    const cycleUsed = Math.max(0, Number(vehicle.currentKm || 0) - Number(vehicle.lastServiceKm || 0));
    avgKmPerDay = clamp(cycleUsed / 90 || 42, 18, 140);
  }

  const roundedAvg = Math.round(avgKmPerDay * 10) / 10;
  const remainingKm = Number(vehicle.remainingKm || 0);
  const nextThresholdKm = Math.max(0, remainingKm);
  const criticalKmWindow = Math.max(0, remainingKm - 1000);

  const toFutureDate = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };

  const daysToService =
    remainingKm <= 0 ? 0 : Math.max(1, Math.ceil(nextThresholdKm / Math.max(roundedAvg, 1)));
  const daysToCritical =
    remainingKm <= 1000 ? 0 : Math.max(1, Math.ceil(criticalKmWindow / Math.max(roundedAvg, 1)));

  return {
    avgKmPerDay: roundedAvg,
    confidence,
    predictedDate: remainingKm <= 0 ? todayIso() : toFutureDate(daysToService),
    criticalDate: remainingKm <= 1000 ? todayIso() : toFutureDate(daysToCritical),
    daysToService,
    daysToCritical,
    riskLabel:
      remainingKm <= 0
        ? "Lejárt"
        : remainingKm <= 1000
          ? "Kritikus"
          : remainingKm <= WARNING_THRESHOLD_KM
            ? "Közelgő"
            : "Stabil",
    recommendation:
      remainingKm <= 0
        ? "A jármű már túlfutotta a szervizciklust. Prioritásként kezeld."
        : remainingKm <= 1000
          ? "Rövid időn belül kritikus állapotba kerülhet. Foglalj szervizidőpontot."
          : remainingKm <= WARNING_THRESHOLD_KM
            ? "A következő hetekben elérheti a szervizküszöböt. Érdemes előre tervezni."
            : "A jármű még stabil, de a használati trend alapján már becsülhető a következő szervizablak.",
  };
}
