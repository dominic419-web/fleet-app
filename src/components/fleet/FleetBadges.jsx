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
    return (
      <Badge
        className="rounded-full border border-violet-300/40 bg-violet-500/20 text-violet-50 shadow-[0_0_22px_rgba(167,139,250,0.22)]"
      >
        Közeleg
      </Badge>
    );
  }

  if (status === "missing") {
    return (
      <Badge
        variant="outline"
        className="rounded-full border border-sky-300/35 bg-sky-500/10 text-sky-50 shadow-[0_0_22px_rgba(56,189,248,0.18)]"
      >
        Hiányzik
      </Badge>
    );
  }

  if (status === "unknown") {
    return (
      <Badge
        variant="outline"
        className="rounded-full border border-white/18 bg-white/5 text-slate-100 shadow-[0_0_16px_rgba(148,163,184,0.12)]"
      >
        Nincs adat
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className="rounded-full border border-emerald-300/25 bg-emerald-500/10 text-emerald-50 shadow-[0_0_18px_rgba(16,185,129,0.14)]"
    >
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
