import { NextResponse } from "next/server";
import { reverseGeocodeCity } from "@/lib/location-city.server";
import { getSessionOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    latitude?: unknown;
    longitude?: unknown;
  } | null;
  const latitude = body?.latitude;
  const longitude = body?.longitude;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return NextResponse.json(
      { error: "Valid coordinates required" },
      { status: 400 },
    );
  }

  const city = await reverseGeocodeCity(latitude, longitude);
  return NextResponse.json(
    { city },
    { headers: { "Cache-Control": "no-store" } },
  );
}
