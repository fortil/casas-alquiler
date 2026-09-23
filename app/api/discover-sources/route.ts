import { NextResponse, type NextRequest } from "next/server";
import { runDiscovery } from "@/lib/core/discovery/pipeline";
import { hasSerpProvider } from "@/lib/providers/serpSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    if (!hasSerpProvider()) {
      return NextResponse.json(
        { error: "Configura BRIGHTDATA_SERP_ZONE (y BRIGHTDATA_API_KEY) para buscar sitios nuevos" },
        { status: 400 },
      );
    }
    const b = await req.json().catch(() => ({}));
    const result = await runDiscovery({
      cities: b.cities ?? ["jamundi", "cali"],
      propertyType: b.propertyType === "apartamento" ? "apartamento" : "casa",
      maxQueries: Number(b.maxQueries ?? 12),
      maxCandidates: Number(b.maxCandidates ?? 20),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
