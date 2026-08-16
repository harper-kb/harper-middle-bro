import "server-only";

const FETCH_TIMEOUT_MS = 8_000;

function cleanMunicipality(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let city = value.trim();
  if (!city) return null;
  city = city.replace(
    /\s+(?:city|town|village|borough|municipality|municipio|census designated place|CDP)$/i,
    "",
  );
  if (!city) return null;
  if (city === city.toUpperCase()) {
    city = city
      .toLowerCase()
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }
  return city;
}

async function reverseGeocodeWithGoogle(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const params = new URLSearchParams({
    latlng: `${latitude},${longitude}`,
    key,
  });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  );
  if (!response.ok) return null;

  const data = (await response.json()) as {
    status?: string;
    results?: {
      address_components?: {
        long_name?: string;
        types?: string[];
      }[];
    }[];
  };
  if (data.status !== "OK") return null;

  const components = data.results?.flatMap(
    (result) => result.address_components ?? [],
  );
  if (!components) return null;

  for (const type of [
    "locality",
    "postal_town",
    "administrative_area_level_3",
  ]) {
    const match = components.find((component) =>
      component.types?.includes(type),
    );
    const city = cleanMunicipality(match?.long_name);
    if (city) return city;
  }
  return null;
}

async function reverseGeocodeWithCensus(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const params = new URLSearchParams({
    x: String(longitude),
    y: String(latitude),
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    format: "json",
  });
  const response = await fetch(
    `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?${params}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  );
  if (!response.ok) return null;

  const data = (await response.json()) as {
    result?: {
      geographies?: Record<string, { NAME?: string }[] | undefined>;
    };
  };
  const geographies = data.result?.geographies;
  if (!geographies) return null;

  for (const layer of [
    "Incorporated Places",
    "Census Designated Places",
    "County Subdivisions",
  ]) {
    const rawName = geographies[layer]?.[0]?.NAME;
    if (
      layer === "County Subdivisions" &&
      typeof rawName === "string" &&
      /\b(?:CCD|county|district|division|precinct)\b/i.test(rawName)
    ) {
      continue;
    }
    const city = cleanMunicipality(rawName);
    if (city) return city;
  }
  return null;
}

export async function reverseGeocodeCity(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  try {
    const googleCity = await reverseGeocodeWithGoogle(latitude, longitude);
    if (googleCity) return googleCity;
  } catch {
    // Fall through to the existing keyless Census provider.
  }

  try {
    return await reverseGeocodeWithCensus(latitude, longitude);
  } catch {
    return null;
  }
}
