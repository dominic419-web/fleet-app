"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function TestPage() {
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState("")

  useEffect(() => {
    fetchVehicles()
  }, [])

  async function fetchVehicles() {
    setLoading(true)
    setErrorText("")

    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .order("id", { ascending: true })

    if (error) {
      console.error("Supabase hiba:", error)
      setErrorText(error.message)
    } else {
      setVehicles(data || [])
    }

    setLoading(false)
  }

  return (
    <div style={{ padding: "24px", color: "white" }}>
      <h1>Vehicles teszt</h1>

      {loading && <p>Töltés...</p>}

      {!loading && errorText && (
        <p>Hiba történt: {errorText}</p>
      )}

      {!loading && !errorText && vehicles.length === 0 && (
        <p>Nincs jármű az adatbázisban.</p>
      )}

      {!loading && !errorText && vehicles.map((vehicle) => (
        <div key={vehicle.id} style={{ marginBottom: "12px" }}>
          {vehicle.plate} - {vehicle.brand} - {vehicle.model} - {vehicle.mileage} km
        </div>
      ))}
    </div>
  )
}