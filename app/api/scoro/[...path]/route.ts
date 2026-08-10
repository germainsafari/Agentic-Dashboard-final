import { NextRequest, NextResponse } from "next/server";
import { scoroFetch } from "@/lib/scoro";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const endpoint = params.path.join("/");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data = await scoroFetch(endpoint, body);
  if (!data) {
    return NextResponse.json(
      { error: "scoro unreachable or key missing", endpoint },
      { status: 502 }
    );
  }
  return NextResponse.json(data);
}
