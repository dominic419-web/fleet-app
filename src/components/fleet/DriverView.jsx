"use client";

import React, { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Activity,
  CarFront,
  Camera,
  ClipboardList,
  FileText,
  Gauge,
  LogOut,
  ReceiptText,
} from "lucide-react";
import { formatKmHu } from "@/lib/fleet/formatters-hu";

export default function DriverView({
  vehicles = [],
  selectedVehicleId = null,
  onSelectVehicle,
  vehicle,
  registrationDoc = null,
  onOpenDocument,
  onDownloadDocument,
  journeyDraft,
  onJourneyDraftChange,
  activeJourney = null,
  onStartJourney,
  onStopJourney,
  journeySaving = false,
  expenseDraft,
  onExpenseDraftChange,
  receiptFile,
  onReceiptFileChange,
  expenses = [],
  onOpenExpense,
  aiFile,
  onAiFileChange,
  onRunAi,
  aiSaving = false,
  onSubmitExpense,
  expenseSaving = false,
  kmValue,
  onKmChange,
  onSubmitKm,
  saving,
  onLogout,
  loadError = "",
}) {
  const list = Array.isArray(vehicles) ? vehicles : [];
  const multi = list.length > 1;
  const hasRegistration = Boolean(registrationDoc?.uploaded);
  const hasActiveJourney = Boolean(activeJourney?.id);
  const expenseList = useMemo(() => (Array.isArray(expenses) ? expenses : []), [expenses]);

  const firstDraftExpense = useMemo(
    () => expenseList.find((e) => e?.status === "draft_ai") || null,
    [expenseList]
  );

  const [activePanel, setActivePanel] = useState(null);
  const detailsRef = useRef(null);

  const activityItems = useMemo(() => {
    const items = [];

    if (hasActiveJourney) {
      items.push({
        key: "active-journey",
        title: "Folyamatban lévő út",
        detail: "Az út aktív. Lezárás után a NAV napló frissül.",
        tone: "warning",
        date: activeJourney?.started_at ? String(activeJourney.started_at).slice(0, 16) : "",
      });
    }

    if (!hasRegistration) {
      items.push({
        key: "missing-registration",
        title: "Hiányzó forgalmi",
        detail: "A forgalmi engedély nincs feltöltve ehhez a járműhöz.",
        tone: "danger",
        date: "",
      });
    }

    if (firstDraftExpense) {
      items.push({
        key: `draft-${firstDraftExpense.id}`,
        title: "AI draft vár ellenőrzésre",
        detail: "Nyisd meg és javítsd, majd jóváhagyd.",
        tone: "warning",
        date: String(firstDraftExpense.occurred_at || "").slice(0, 10),
      });
    }

    expenseList
      .slice(0, 6)
      .filter((e) => e?.status !== "draft_ai")
      .forEach((e) => {
        const isFuel = e?.expense_type === "fuel";
        items.push({
          key: `expense-${e.id}`,
          title: isFuel ? "Tankolás rögzítve" : "Költség rögzítve",
          detail: `${Number(e.gross_amount || 0).toLocaleString("hu-HU")} ${e.currency || "HUF"}${
            e.station_name ? ` • ${e.station_name}` : ""
          }`,
          tone: "ok",
          date: String(e.occurred_at || "").slice(0, 10),
        });
      });

    return items.slice(0, 10);
  }, [activeJourney, expenseList, firstDraftExpense, hasActiveJourney, hasRegistration]);

  const toneChipClass = (tone) => {
    if (tone === "ok") return "driver-chip driver-chip--ok";
    if (tone === "warning") return "driver-chip driver-chip--warning";
    if (tone === "danger") return "driver-chip driver-chip--danger";
    return "driver-chip driver-chip--neutral";
  };

  const scrollToRef = (ref) => {
    const node = ref?.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openPanel = (key) => {
    setActivePanel((prev) => (prev === key ? null : key));
    requestAnimationFrame(() => scrollToRef(detailsRef));
  };

  return (
    <div className="driver-shell min-h-screen w-full">
      <div className="driver-shell__inner px-4 pb-10 pt-4 md:px-8">
        {loadError ? (
          <div className="mb-4 rounded-2xl border border-red-500/35 bg-red-500/12 px-4 py-3 text-sm text-red-100">
            {loadError}
          </div>
        ) : null}

        <header className="driver-header sticky top-0 z-30 -mx-4 mb-5 border-b border-white/10 bg-slate-950/80 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Sofőr mód</div>
              <div className="truncate text-xl font-bold text-white">Napi teendők</div>
            </div>

            <Button
              type="button"
              variant="secondary"
              className="driver-cta driver-cta--secondary h-11 rounded-2xl px-4"
              onClick={onLogout}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Kilépés
            </Button>
          </div>
        </header>

        {list.length === 0 ? (
          <div className="mx-auto max-w-xl">
            <Card className="driver-card rounded-3xl">
              <CardContent className="py-10 text-center text-sm text-slate-200">
                Nincs hozzárendelt jármű. Kérd meg a flotta adminisztrátort a hozzárendeléshez.
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="mx-auto flex max-w-xl flex-col gap-4">
            {multi ? (
              <div className="driver-card rounded-3xl border border-white/10 bg-slate-950/40 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Válassz járművet
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {list.map((v) => {
                    const active = String(v.id) === String(selectedVehicleId);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => onSelectVehicle?.(v.id)}
                        className={`rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-cyan-300/40 ${
                          active
                            ? "border-cyan-300/35 bg-cyan-300/10"
                            : "border-white/10 bg-slate-950/40 hover:border-white/18 hover:bg-white/6"
                        }`}
                      >
                        <div className="font-semibold text-white">{v.name || "Jármű"}</div>
                        <div className="mt-0.5 text-xs text-slate-300">{v.plate || "—"}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {!vehicle ? (
              <Card className="driver-card rounded-3xl">
                <CardContent className="py-10 text-center text-sm text-slate-200">
                  Válassz járművet a listából.
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col gap-4">
                {firstDraftExpense ? (
                  <div className="rounded-3xl border border-amber-400/25 bg-amber-400/10 p-4 text-amber-50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">AI draft vár ellenőrzésre</div>
                        <div className="mt-1 text-xs text-amber-100/90">
                          Kattints az ellenőrzésre, majd jóváhagyás.
                        </div>
                      </div>
                      <Button className="driver-cta h-11 rounded-2xl px-4" onClick={() => onOpenExpense?.(firstDraftExpense)}>
                        Ellenőrzés
                      </Button>
                    </div>
                  </div>
                ) : null}

                <Card className="driver-hero rounded-3xl">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm text-slate-200">
                          <CarFront className="h-4 w-4 text-cyan-200" />
                          <span className="truncate font-semibold">{vehicle.name || "Jármű"}</span>
                        </div>
                        <div className="mt-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                          {vehicle.plate || "—"}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className={toneChipClass(hasActiveJourney ? "warning" : "ok")}>
                          {hasActiveJourney ? "Út folyamatban" : "Nincs aktív út"}
                        </div>
                        <div className={toneChipClass(hasRegistration ? "ok" : "danger")}>
                          {hasRegistration ? "Forgalmi OK" : "Forgalmi hiányzik"}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                        Jelenlegi km
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <Gauge className="h-5 w-5 text-cyan-200" />
                        <div className="text-3xl font-black tracking-tight text-white">
                          {formatKmHu(vehicle.currentKm)}{" "}
                          <span className="text-base font-semibold text-slate-300">km</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    className={`driver-cta h-14 rounded-3xl ${activePanel === "km" ? "driver-cta--active" : ""}`}
                    onClick={() => openPanel("km")}
                  >
                    <Gauge className="mr-2 h-5 w-5" />
                    Km rögzítés
                  </Button>
                  <Button
                    type="button"
                    className={`driver-cta h-14 rounded-3xl ${activePanel === "journey" ? "driver-cta--active" : ""}`}
                    variant={hasActiveJourney ? "secondary" : "default"}
                    onClick={() => openPanel("journey")}
                  >
                    <ClipboardList className="mr-2 h-5 w-5" />
                    Útnapló
                  </Button>
                  <Button
                    type="button"
                    className={`driver-cta h-14 rounded-3xl ${activePanel === "expenses" ? "driver-cta--active" : ""}`}
                    variant="secondary"
                    onClick={() => openPanel("expenses")}
                  >
                    <ReceiptText className="mr-2 h-5 w-5" />
                    Költség
                  </Button>
                  <Button
                    type="button"
                    className={`driver-cta h-14 rounded-3xl ${activePanel === "ai" ? "driver-cta--active" : ""}`}
                    variant="secondary"
                    onClick={() => openPanel("ai")}
                  >
                    <Camera className="mr-2 h-5 w-5" />
                    Fotó → AI
                  </Button>
                  <Button
                    type="button"
                    className={`driver-cta h-14 rounded-3xl ${activePanel === "docs" ? "driver-cta--active" : ""}`}
                    variant="secondary"
                    onClick={() => openPanel("docs")}
                  >
                    <FileText className="mr-2 h-5 w-5" />
                    Forgalmi
                  </Button>
                  <Button
                    type="button"
                    className={`driver-cta h-14 rounded-3xl ${activePanel === "activity" ? "driver-cta--active" : ""}`}
                    variant="secondary"
                    onClick={() => openPanel("activity")}
                  >
                    <Activity className="mr-2 h-5 w-5" />
                    Aktivitás
                  </Button>
                </div>

                <div ref={detailsRef} className="scroll-mt-24">
                  {!activePanel ? (
                    <div className="rounded-3xl border border-white/10 bg-slate-950/40 px-4 py-4 text-sm text-slate-300">
                      Válassz egy opciót fent, és itt csak a kiválasztott rész fog megjelenni.
                    </div>
                  ) : null}

                  {activePanel === "km" ? (
                <Card className="driver-card rounded-3xl">
                  <CardHeader>
                    <CardTitle className="text-base text-white">Km rögzítés</CardTitle>
                    <p className="text-sm text-slate-300">Napi/havi óraállás rögzítése</p>
                  </CardHeader>
                  <CardContent className="space-y-4 border-t border-white/10 pt-6">
                    <div className="space-y-2">
                      <Label htmlFor="driver-km-input">Új óraállás (km)</Label>
                      <Input
                        id="driver-km-input"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={kmValue}
                        onChange={(e) => onKmChange(e.target.value)}
                        placeholder="pl. 185420"
                        className="driver-input rounded-2xl"
                        disabled={saving}
                      />
                    </div>
                    <Button type="button" className="driver-cta h-12 w-full rounded-2xl sm:w-auto" disabled={saving} onClick={onSubmitKm}>
                      {saving ? "Mentés..." : "Km mentése"}
                    </Button>
                  </CardContent>
                </Card>
                  ) : null}

                  {activePanel === "journey" ? (
                <Card className="driver-card rounded-3xl">
                  <CardHeader>
                    <CardTitle className="text-base text-white">Útnyilvántartás</CardTitle>
                    <p className="text-sm text-slate-300">Csak indítás és lezárás</p>
                  </CardHeader>
                  <CardContent className="space-y-4 border-t border-white/10 pt-6">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Út típusa</Label>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant={journeyDraft?.tripType === "business" ? "default" : "secondary"}
                            className={`driver-cta h-12 flex-1 rounded-2xl ${
                              journeyDraft?.tripType === "business" ? "driver-cta--active" : ""
                            }`}
                            disabled={journeySaving || hasActiveJourney}
                            onClick={() => onJourneyDraftChange?.((prev) => ({ ...prev, tripType: "business" }))}
                          >
                            Üzleti
                          </Button>
                          <Button
                            type="button"
                            variant={journeyDraft?.tripType === "private" ? "default" : "secondary"}
                            className={`driver-cta h-12 flex-1 rounded-2xl ${
                              journeyDraft?.tripType === "private" ? "driver-cta--active" : ""
                            }`}
                            disabled={journeySaving || hasActiveJourney}
                            onClick={() => onJourneyDraftChange?.((prev) => ({ ...prev, tripType: "private" }))}
                          >
                            Privát
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Induló km</Label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={journeyDraft?.startKm ?? ""}
                          onChange={(e) => onJourneyDraftChange?.((prev) => ({ ...prev, startKm: e.target.value }))}
                          placeholder={vehicle ? String(vehicle.currentKm ?? "") : ""}
                          className="driver-input rounded-2xl"
                          disabled={journeySaving || hasActiveJourney}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Indulás helye</Label>
                        <Input
                          value={journeyDraft?.startLocation ?? ""}
                          onChange={(e) => onJourneyDraftChange?.((prev) => ({ ...prev, startLocation: e.target.value }))}
                          placeholder="pl. Budapest, X utca 1."
                          className="driver-input rounded-2xl"
                          disabled={journeySaving || hasActiveJourney}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Érkezés helye</Label>
                        <Input
                          value={journeyDraft?.endLocation ?? ""}
                          onChange={(e) => onJourneyDraftChange?.((prev) => ({ ...prev, endLocation: e.target.value }))}
                          placeholder="pl. Gödöllő, Y utca 2."
                          className="driver-input rounded-2xl"
                          disabled={journeySaving || !hasActiveJourney}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Érkező km</Label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={journeyDraft?.endKm ?? ""}
                          onChange={(e) => onJourneyDraftChange?.((prev) => ({ ...prev, endKm: e.target.value }))}
                          placeholder="pl. 185520"
                          className="driver-input rounded-2xl"
                          disabled={journeySaving || !hasActiveJourney}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Státusz</Label>
                        <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
                          {hasActiveJourney ? "Folyamatban" : "Nincs aktív út"}
                        </div>
                        {!hasActiveJourney ? (
                          <div className="text-xs text-slate-400">Út lezárása csak aktív út esetén érhető el.</div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button type="button" className="driver-cta h-12 flex-1 rounded-2xl" disabled={journeySaving || hasActiveJourney} onClick={() => onStartJourney?.()}>
                        {journeySaving ? "Mentés..." : "Út indítása"}
                      </Button>
                      <Button type="button" variant="secondary" className="driver-cta driver-cta--secondary h-12 flex-1 rounded-2xl" disabled={journeySaving || !hasActiveJourney} onClick={() => onStopJourney?.()}>
                        {journeySaving ? "Mentés..." : "Út lezárása"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                  ) : null}

                  {activePanel === "docs" ? (
                <Card className="driver-card rounded-3xl">
                  <CardHeader>
                    <CardTitle className="text-base text-white">Dokumentumok</CardTitle>
                    <p className="text-sm text-slate-300">Forgalmi engedély</p>
                  </CardHeader>
                  <CardContent className="space-y-4 border-t border-white/10 pt-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-white">Forgalmi engedély</div>
                        <div className="mt-1 text-xs text-slate-300">
                          {hasRegistration
                            ? `Feltöltve${registrationDoc?.uploadedAt ? ` • ${registrationDoc.uploadedAt}` : ""}`
                            : "Hiányzik • kérd a flotta adminisztrátort"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="driver-cta driver-cta--secondary h-11 rounded-2xl px-4"
                          disabled={!hasRegistration}
                          onClick={() => onOpenDocument?.(registrationDoc)}
                        >
                          Megnyitás
                        </Button>
                        <Button
                          type="button"
                          className="driver-cta h-11 rounded-2xl px-4"
                          disabled={!hasRegistration}
                          onClick={() => onDownloadDocument?.(registrationDoc)}
                        >
                          Letöltés
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                  ) : null}

                  {activePanel === "expenses" ? (
                <Card className="driver-card rounded-3xl">
                  <CardHeader>
                    <CardTitle className="text-base text-white">Költségek / Tankolás</CardTitle>
                    <p className="text-sm text-slate-300">Manuális rögzítés</p>
                  </CardHeader>
                  <CardContent className="space-y-4 border-t border-white/10 pt-6">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Dátum</Label>
                        <Input type="date" value={expenseDraft?.occurredAt ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, occurredAt: e.target.value }))} className="driver-input rounded-2xl" disabled={expenseSaving} />
                      </div>
                      <div className="space-y-2">
                        <Label>Típus</Label>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            className={`driver-cta h-12 flex-1 rounded-2xl ${
                              expenseDraft?.expenseType === "fuel" ? "driver-cta--active" : ""
                            }`}
                            variant={expenseDraft?.expenseType === "fuel" ? "default" : "secondary"}
                            disabled={expenseSaving}
                            onClick={() => onExpenseDraftChange?.((p) => ({ ...p, expenseType: "fuel" }))}
                          >
                            Tankolás
                          </Button>
                          <Button
                            type="button"
                            className={`driver-cta h-12 flex-1 rounded-2xl ${
                              expenseDraft?.expenseType === "other" ? "driver-cta--active" : ""
                            }`}
                            variant={expenseDraft?.expenseType === "other" ? "default" : "secondary"}
                            disabled={expenseSaving}
                            onClick={() => onExpenseDraftChange?.((p) => ({ ...p, expenseType: "other" }))}
                          >
                            Egyéb
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Kút neve</Label>
                        <Input value={expenseDraft?.stationName ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, stationName: e.target.value }))} placeholder="pl. MOL" className="driver-input rounded-2xl" disabled={expenseSaving} />
                      </div>
                      <div className="space-y-2">
                        <Label>Helyszín</Label>
                        <Input value={expenseDraft?.stationLocation ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, stationLocation: e.target.value }))} placeholder="pl. Budapest" className="driver-input rounded-2xl" disabled={expenseSaving} />
                      </div>
                    </div>
                    {expenseDraft?.expenseType === "fuel" ? (
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label>Üzemanyag</Label>
                          <Input value={expenseDraft?.fuelType ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, fuelType: e.target.value }))} placeholder="pl. Dízel" className="driver-input rounded-2xl" disabled={expenseSaving} />
                        </div>
                        <div className="space-y-2">
                          <Label>Liter</Label>
                          <Input type="number" inputMode="decimal" min={0} value={expenseDraft?.liters ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, liters: e.target.value }))} placeholder="pl. 42.5" className="driver-input rounded-2xl" disabled={expenseSaving} />
                        </div>
                        <div className="space-y-2">
                          <Label>Egységár (Ft/l)</Label>
                          <Input type="number" inputMode="decimal" min={0} value={expenseDraft?.unitPrice ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, unitPrice: e.target.value }))} placeholder="pl. 615" className="driver-input rounded-2xl" disabled={expenseSaving} />
                        </div>
                      </div>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Bruttó összeg (Ft)</Label>
                        <Input type="number" inputMode="decimal" min={0} value={expenseDraft?.grossAmount ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, grossAmount: e.target.value }))} placeholder="pl. 25000" className="driver-input rounded-2xl" disabled={expenseSaving} />
                      </div>
                      <div className="space-y-2">
                        <Label>Km óraállás</Label>
                        <Input type="number" inputMode="numeric" min={0} value={expenseDraft?.odometerKm ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, odometerKm: e.target.value }))} placeholder="opcionális" className="driver-input rounded-2xl" disabled={expenseSaving} />
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Fizetés módja</Label>
                        <Input value={expenseDraft?.paymentMethod ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, paymentMethod: e.target.value }))} placeholder="pl. card / cash / fleet_card" className="driver-input rounded-2xl" disabled={expenseSaving} />
                      </div>
                      <div className="space-y-2">
                        <Label>Kártya utolsó 4 (opcionális)</Label>
                        <Input value={expenseDraft?.paymentCardLast4 ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, paymentCardLast4: e.target.value }))} placeholder="1234" className="driver-input rounded-2xl" disabled={expenseSaving} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Megjegyzés</Label>
                      <Input value={expenseDraft?.note ?? ""} onChange={(e) => onExpenseDraftChange?.((p) => ({ ...p, note: e.target.value }))} placeholder="opcionális" className="driver-input rounded-2xl" disabled={expenseSaving} />
                    </div>
                    <div className="space-y-2">
                      <Label>Bizonylat (opcionális)</Label>
                      <Input type="file" accept="image/*,application/pdf" className="driver-input rounded-2xl" disabled={expenseSaving} onChange={(e) => onReceiptFileChange?.(e.target.files?.[0] || null)} />
                      {receiptFile ? <div className="text-xs text-slate-400">{receiptFile.name}</div> : null}
                    </div>
                    <Button type="button" className="driver-cta h-12 w-full rounded-2xl sm:w-auto" disabled={expenseSaving} onClick={() => onSubmitExpense?.()}>
                      {expenseSaving ? "Mentés..." : "Költség mentése"}
                    </Button>
                  </CardContent>
                </Card>
                  ) : null}

                  {activePanel === "ai" ? (
                <Card className="driver-card rounded-3xl">
                  <CardHeader>
                    <CardTitle className="text-base text-white">Fotó → AI kitöltés</CardTitle>
                    <p className="text-sm text-slate-300">Bizonylat feldolgozása draftként</p>
                  </CardHeader>
                  <CardContent className="space-y-3 border-t border-white/10 pt-6">
                    <Input type="file" accept="image/*,application/pdf" className="driver-input rounded-2xl" disabled={aiSaving} onChange={(e) => onAiFileChange?.(e.target.files?.[0] || null)} />
                    {aiFile ? <div className="text-xs text-slate-400">{aiFile.name}</div> : null}
                    <Button type="button" className="driver-cta h-12 w-full rounded-2xl sm:w-auto" disabled={aiSaving} onClick={() => onRunAi?.()}>
                      {aiSaving ? "Feldolgozás..." : "AI kitöltés indítása"}
                    </Button>
                  </CardContent>
                </Card>
                  ) : null}

                  {activePanel === "activity" ? (
                <Card className="driver-card rounded-3xl">
                  <CardHeader>
                    <CardTitle className="text-base text-white">Legutóbbi aktivitás</CardTitle>
                    <p className="text-sm text-slate-300">Gyors áttekintés (utolsó 10)</p>
                  </CardHeader>
                  <CardContent className="space-y-3 border-t border-white/10 pt-6">
                    {activityItems.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                        Még nincs megjeleníthető aktivitás.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {activityItems.map((it) => (
                          <div key={it.key} className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold text-white">{it.title}</div>
                                <div className="mt-1 text-sm text-slate-300">{it.detail}</div>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-2">
                                <div className={toneChipClass(it.tone)}>
                                  {it.tone === "ok" ? "OK" : it.tone === "danger" ? "FIGYELEM" : "TEENDŐ"}
                                </div>
                                {it.date ? <div className="text-xs font-semibold text-slate-400">{it.date}</div> : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
