import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }) {
  if (status === "late") {
    return <Badge variant="destructive">Szerviz lejárt</Badge>;
  }

  if (status === "warning") {
    return <Badge className="rounded-full">Közeledik</Badge>;
  }

  return (
    <Badge variant="secondary" className="rounded-full">
      Rendben
    </Badge>
  );
}

export function ExpiryBadge({ status }) {
  if (status === "late") {
    return <Badge variant="destructive">Lejárt</Badge>;
  }

  if (status === "warning") {
    return <Badge className="rounded-full">Közeleg</Badge>;
  }

  if (status === "missing") {
    return (
      <Badge variant="outline" className="rounded-full border-white/20 text-white">
        Hiányzik
      </Badge>
    );
  }

  if (status === "unknown") {
    return (
      <Badge variant="outline" className="rounded-full border-white/20 text-white">
        Nincs adat
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="rounded-full">
      Rendben
    </Badge>
  );
}

export function NotificationTypeBadge({ type }) {
  const map = {
    serviceWarning: "Szerviz",
    serviceLate: "Szerviz",
    insuranceWarning: "Biztosítás",
    insuranceLate: "Biztosítás",
    inspectionWarning: "Műszaki",
    inspectionLate: "Műszaki",
    ownerMissing: "Sofőr",
    driverMissing: "Sofőr",
    docMissing: "Dokumentum",
    docLate: "Dokumentum",
    docWarning: "Dokumentum",
  };

  const destructive =
    type === "serviceLate" ||
    type === "insuranceLate" ||
    type === "inspectionLate" ||
    type === "ownerMissing" ||
    type === "driverMissing" ||
    type === "docLate";

  if (destructive) {
    return <Badge variant="destructive">{map[type]}</Badge>;
  }

  return <Badge className="rounded-full">{map[type]}</Badge>;
}
