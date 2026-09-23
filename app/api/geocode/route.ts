import { NextResponse, type NextRequest } from "next/server";
import { geocodeQuery } from "@/lib/core/geocode";
import { hasGoogleKey } from "@/lib/providers/googlemaps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query) return NextResponse.json({ error: "query requerido" }, { status: 400 });
    if (!hasGoogleKey()) {
      return NextResponse.json(
        { error: "GOOGLE_MAPS_API_KEY no configurada" },
        { status: 400 },
      );
    }
    const g = await geocodeQuery(query);
    if (!g) return NextResponse.json({ error: "Sin resultados" }, { status: 404 });
    return NextResponse.json(g);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
