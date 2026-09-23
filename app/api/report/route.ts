import { NextResponse, type NextRequest } from "next/server";
import { buildReport, reportFilename, type ReportMeta } from "@/lib/core/report";
import type { ScoredListing } from "@/lib/core/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const top: ScoredListing[] = b.top ?? [];
    const meta: ReportMeta = b.meta;
    const md = buildReport(top, meta);
    const filename = reportFilename(b.tema ?? "casas-alquiler");
    return new NextResponse(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
