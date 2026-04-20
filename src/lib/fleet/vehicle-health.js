import { getExpiryStatus } from "@/lib/fleet-utils";
import { OIL_SERVICE_LABEL, TIMING_SERVICE_LABEL } from "./constants";
import { createDefaultVehicleDocCollections } from "./supabase-fleet";
import { getCustomServiceCycleStatus, normalizeServiceHistoryItem } from "./service-history";

export function computeVehicleHealthIndex(vehicle, documentsByVehicle) {
  const insuranceStatus = getExpiryStatus(vehicle.insuranceExpiry);
  const inspectionStatus = getExpiryStatus(vehicle.inspectionExpiry);
  const docs =
    documentsByVehicle[String(vehicle.id)] ||
    createDefaultVehicleDocCollections(vehicle.insuranceExpiry, vehicle.inspectionExpiry);
  const missingDocs = Object.values(docs || {}).filter((docVal) => {
    const docsArr = Array.isArray(docVal) ? docVal : [docVal];
    return !docsArr.some((d) => d?.uploaded);
  }).length;

  const oilStatus = getCustomServiceCycleStatus(
    vehicle,
    OIL_SERVICE_LABEL,
    vehicle?.oilChangeIntervalKm,
    3000
  );
  const timingStatus = getCustomServiceCycleStatus(
    vehicle,
    TIMING_SERVICE_LABEL,
    vehicle?.timingBeltIntervalKm,
    10000
  );

  let score = 100;

  [oilStatus, timingStatus].filter(Boolean).forEach((item) => {
    if (item.status === "late") score -= 22;
    else if (item.status === "warning") score -= 10;
  });

  if (insuranceStatus.status === "late") score -= 15;
  else if (insuranceStatus.status === "warning") score -= 8;

  if (inspectionStatus.status === "late") score -= 15;
  else if (inspectionStatus.status === "warning") score -= 8;

  score -= missingDocs * 6;
  if (!vehicle.driver) score -= 8;

  const serviceRecords = (Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [])
    .map(normalizeServiceHistoryItem)
    .filter((entry) => entry.isServiceRecord);

  if (serviceRecords.length === 0) score -= 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}
