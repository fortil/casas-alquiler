import { NextResponse, type NextRequest } from "next/server";
import { searchStored } from "@/lib/core/query";
import { DEFAULT_WEIGHTS } from "@/lib/config";
import { isValidPoint } from "@/lib/core/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!isValidPoint(b.refPoint)) {
      return NextResponse.json({ error: "refPoint {lat,lng} requerido" }, { status: 400 });
    }
    const result = await searchStored({
      cities: b.cities ?? [],
      refPoint: b.refPoint,
      maxDistKm: Number(b.maxDistKm ?? 10),
      minAreaM2: Number(b.minAreaM2 ?? 0),
      minBedrooms: Number(b.minBedrooms ?? 0),
      minPrice: Number(b.minPrice ?? 0),
      maxPrice: Number(b.maxPrice ?? 0),
      weights: b.weights ?? DEFAULT_WEIGHTS,
      distanceMode: b.distanceMode === "google_driving" ? "google_driving" : "haversine",
      southernCaliOnly: !!b.southernCaliOnly,
      southernZones: b.southernZones,
      topN: Number(b.topN ?? 10),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
