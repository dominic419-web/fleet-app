import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function jsonError(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !anonKey) {
    return jsonError("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY", 500);
  }
  if (!serviceRoleKey) {
    return jsonError("Missing SUPABASE_SERVICE_ROLE_KEY on the server", 500);
  }

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonError("Missing Authorization: Bearer <access_token>", 401);
  }
  const accessToken = authHeader.slice(7).trim();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const companyIdRaw = body?.company_id ?? body?.companyId ?? "";
  const companyId = String(companyIdRaw || "").trim();
  if (!companyId) return jsonError("company_id is required", 400);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: userWrap, error: userErr } = await userClient.auth.getUser();
  const user = userWrap?.user || null;
  if (userErr || !user?.id) {
    if (userErr) console.error("/api/company/switch getUser error:", userErr);
    return NextResponse.json({ error: "Unauthorized", detail: userErr?.message || null }, { status: 401 });
  }

  // Enforce membership is active.
  const { data: membership, error: membershipErr } = await userClient
    .from("company_members")
    .select("company_id,role,status")
    .eq("company_id", companyId)
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (membershipErr) {
    console.error("/api/company/switch membership query error:", membershipErr);
    return NextResponse.json(
      { error: "Failed to verify membership", detail: membershipErr.message || String(membershipErr) },
      { status: 500 }
    );
  }
  if (!membership?.company_id || membership.status !== "active") {
    return jsonError("Not a member of this company", 403);
  }

  // Update app_metadata.company_id so JWT carries the current company context.
  const { data: updated, error: updateErr } = await adminClient.auth.admin.updateUserById(user.id, {
    app_metadata: { ...(user.app_metadata || {}), company_id: companyId },
  });

  if (updateErr) {
    console.error("/api/company/switch updateUserById error:", updateErr);
    return NextResponse.json({ error: "Failed to update user context", detail: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    company_id: companyId,
    role: membership.role,
    user_id: user.id,
    updated_at: updated?.user?.updated_at || null,
  });
}

