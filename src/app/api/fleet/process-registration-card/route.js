import { NextResponse } from "next/server";

/**
 * Proxies the registration card Edge Function so the browser calls same-origin `/api/...`
 * instead of `https://<ref>.supabase.co/functions/v1/...` (avoids many ad-block / network / CORS edge cases).
 */
export async function POST(request) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!base || !anonKey) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY on the server" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ error: "Missing Authorization: Bearer <access_token>" }, { status: 401 });
  }

  let bodyText;
  try {
    bodyText = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const incomingUrl = new URL(request.url);
  const aiQsRaw = incomingUrl.searchParams.get("ai_provider");
  const aiQs =
    aiQsRaw && ["openai", "gemini", "auto"].includes(String(aiQsRaw).toLowerCase().trim())
      ? String(aiQsRaw).toLowerCase().trim()
      : "";
  if (aiQs) {
    try {
      const parsed = bodyText ? JSON.parse(bodyText) : {};
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed.ai_provider == null || String(parsed.ai_provider).trim() === "")
      ) {
        parsed.ai_provider = aiQs;
        bodyText = JSON.stringify(parsed);
      }
    } catch {
      /* keep original bodyText */
    }
  }

  const origin = String(base).replace(/\/$/, "");
  const upstreamUrlObj = new URL(`${origin}/functions/v1/process-registration-card`);
  if (aiQs) upstreamUrlObj.searchParams.set("ai_provider", aiQs);
  const upstreamUrl = upstreamUrlObj.toString();

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: bodyText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Could not reach Supabase Edge Functions", detail: message },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";

  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": contentType },
  });
}

