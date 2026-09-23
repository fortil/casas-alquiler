import { NextResponse, type NextRequest } from "next/server";
import { runCrawl } from "@/lib/core/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const result = await runCrawl(
      {
        cities: b.cities ?? ["jamundi", "cali"],
        propertyType: b.propertyType === "apartamento" ? "apartamento" : "casa",
        maxPagesPerSource: Number(b.maxPagesPerSource ?? 20),
        maxPerSource: Number(b.maxPerSource ?? 0),
        includeHardSources: !!b.includeHardSources,
      },
      {
        geocode: b.geocode !== false,
        egress: b.useBrightData ? "brightdata" : "local",
      },
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
