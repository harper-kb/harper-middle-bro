import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeVerifiedUsAddress } from "@/lib/validate-contact.server";

afterEach(() => vi.unstubAllGlobals());

describe("approved Census company geocoder", () => {
  it("returns coordinates only from an exact address-range match", async () => {
    const fetchMock =
      vi.fn<(input: RequestInfo | URL) => Promise<Response>>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            addressMatches: [
              {
                matchedAddress: "5440 S 21ST ST, OMAHA, NE, 68107",
                coordinates: {
                  x: -95.943114635323,
                  y: 41.203377066077,
                },
                addressComponents: {
                  city: "OMAHA",
                  state: "NE",
                  zip: "68107",
                },
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      geocodeVerifiedUsAddress(
        "5440 South 21st Street, Omaha, Nebraska 68107",
      ),
    ).resolves.toEqual({
      latitude: 41.203377066077,
      longitude: -95.943114635323,
      matchedAddress: "5440 S 21ST ST, OMAHA, NE, 68107",
      provider: "census",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "geocoding.geo.census.gov/geocoder/locations/onelineaddress",
    );
  });

  it("returns null when Census cannot match the complete address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ result: { addressMatches: [] } }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      geocodeVerifiedUsAddress("Unknown address"),
    ).resolves.toBeNull();
  });
});
