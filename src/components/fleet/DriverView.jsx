"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogOut } from "lucide-react";

const formatKmHu = (value) => Number(value || 0).toLocaleString("hu-HU");

export default function DriverView({
  vehicle,
  kmValue,
  onKmChange,
  onSubmitKm,
  saving,
  onLogout,
  loadError = "",
}) {
  return (
    <div className="min-h-screen w-full px-4 py-8 md:px-8">
      {loadError ? (
        <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {loadError}
        </div>
      ) : null}
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="fleet-heading text-2xl font-bold tracking-tight md:text-3xl">Saját autóm</h1>
        <Button
          type="button"
          variant="secondary"
          className="fleet-primary-btn rounded-2xl sm:shrink-0"
          onClick={onLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Kilépés
        </Button>
      </header>

      {!vehicle ? (
        <Card className="fleet-card rounded-3xl border-white/10">
          <CardContent className="py-10 text-center text-sm text-slate-400">
            Nincs hozzárendelt jármű. Kérd meg a flotta adminisztrátort a hozzárendeléshez.
          </CardContent>
        </Card>
      ) : (
        <Card className="fleet-card max-w-xl rounded-3xl border-white/10">
          <CardHeader>
            <CardTitle className="text-lg text-white">{vehicle.name || "Jármű"}</CardTitle>
            <p className="text-sm text-slate-400">
              Rendszám: <span className="font-medium text-slate-200">{vehicle.plate || "—"}</span>
            </p>
            <p className="text-sm text-slate-400">
              Jelenlegi km:{" "}
              <span className="font-semibold text-cyan-200">{formatKmHu(vehicle.currentKm)} km</span>
            </p>
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
                className="fleet-input rounded-2xl"
                disabled={saving}
              />
            </div>
            <Button
              type="button"
              className="fleet-primary-btn w-full rounded-2xl sm:w-auto"
              disabled={saving}
              onClick={onSubmitKm}
            >
              {saving ? "Mentés..." : "Km rögzítése"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
