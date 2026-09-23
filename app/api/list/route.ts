import { NextResponse, type NextRequest } from "next/server";
import { parseListInput, rankProvided } from "@/lib/core/modeB";
import { DEFAULT_WEIGHTS } from "@/lib/config";
import { isValidPoint } from "@/lib/core/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.csvText || typeof b.csvText !== "string") {
      return NextResponse.json({ error: "csvText requerido" }, { status: 400 });
    }
    if (!isValidPoint(b.refPoint)) {
      return NextResponse.json({ error: "refPoint {lat,lng} requerido" }, { status: 400 });
    }
    const { listings, warnings } = parseListInput(b.csvText);
    const result = await rankProvided(listings, {
      refPoint: b.refPoint,
      maxDistKm: Number(b.maxDistKm ?? 10),
      minAreaM2: Number(b.minAreaM2 ?? 0),
      minBedrooms: Number(b.minBedrooms ?? 0),
      minPrice: Number(b.minPrice ?? 0),
      maxPrice: Number(b.maxPrice ?? 0),
      weights: b.weights ?? DEFAULT_WEIGHTS,
      distanceMode: b.distanceMode === "google_driving" ? "google_driving" : "haversine",
      topN: Number(b.topN ?? 10),
    });
    return NextResponse.json({ ...result, warnings, parsed: listings.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
