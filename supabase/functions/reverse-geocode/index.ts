import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ReverseGeocodePayload {
  buildingName: string;
  area: string;
  fullAddress: string;
  pincode: string;
  hasSpecificPlace: boolean;
}

interface CachedRow {
  payload: ReverseGeocodePayload;
  provider: string;
  created_at: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";

const CACHE_MAX_AGE_DAYS = 60;

// Google Places types that are purely commercial — we never want these as a "building name"
// because the user's building is almost certainly behind/beside them, not at the POI itself.
const COMMERCIAL_TYPES = new Set([
  "restaurant", "food", "cafe", "bar", "bakery", "meal_delivery", "meal_takeaway",
  "store", "shopping_mall", "supermarket", "convenience_store", "clothing_store",
  "electronics_store", "hardware_store", "furniture_store", "shoe_store",
  "jewelry_store", "liquor_store", "book_store", "bicycle_store", "car_dealer",
  "car_rental", "car_repair", "car_wash", "gas_station", "parking",
  "atm", "bank", "pharmacy", "doctor", "dentist", "hospital", "veterinary_care",
  "hair_care", "beauty_salon", "spa", "gym", "laundry", "movie_theater",
  "night_club", "casino", "bowling_alley",
]);

const admin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

async function tryGoogle(lat: number, lng: number): Promise<{ payload: ReverseGeocodePayload; provider: string } | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    // Step 1: Reverse Geocoding API for address components
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findResult = (types: string[]) => data.results.find((r: any) =>
      Array.isArray(r.types) && types.some((t) => r.types.includes(t)),
    );

    // premise/subpremise/point_of_interest are the most specific — they carry building names
    const premise = findResult(["premise", "subpremise", "point_of_interest", "establishment"]);
    const route = findResult(["route", "street_address"]) ?? data.results[0];

    let buildingName = "";
    if (premise) {
      buildingName = premise.formatted_address?.split(",")[0] || "";
    }

    // Step 2: If geocoding didn't surface a building name, try Places Nearby Search within 60m.
    // Filter out known commercial types so a nearby shop/restaurant is never surfaced as the
    // user's "building name" — only residential buildings, societies, and named structures pass.
    if (!buildingName) {
      try {
        const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=60&key=${GOOGLE_MAPS_API_KEY}`;
        const placesRes = await fetch(placesUrl);
        if (placesRes.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const placesData: any = await placesRes.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const places: any[] = Array.isArray(placesData.results) ? placesData.results : [];
          // Take the first result whose meaningful types are not all commercial.
          const best = places.find((p) => {
            const types: string[] = Array.isArray(p.types) ? p.types : [];
            return !types.every((t) => COMMERCIAL_TYPES.has(t) || t === "point_of_interest" || t === "establishment");
          });
          if (best?.name) buildingName = best.name;
        }
      } catch {
        // ignore — we still have address from geocoding
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const components: any[] = route.address_components ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const get = (type: string) => components.find((c: any) => Array.isArray(c.types) && c.types.includes(type))?.long_name || "";

    const neighbourhood = get("neighborhood") || get("sublocality_level_2") || get("sublocality_level_1") || get("sublocality");
    const locality = get("locality") || get("postal_town");
    const state = get("administrative_area_level_1");
    const pincode = get("postal_code").replace(/\s/g, "");

    const area = buildingName || neighbourhood || locality || "";
    const fullAddress = (route.formatted_address as string) || [neighbourhood, locality, state].filter(Boolean).join(", ");

    return {
      provider: "google",
      payload: {
        buildingName,
        area,
        fullAddress,
        pincode,
        hasSpecificPlace: !!buildingName,
      },
    };
  } catch {
    return null;
  }
}

async function tryOsm(lat: number, lng: number): Promise<{ payload: ReverseGeocodePayload; provider: string } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&namedetails=1&extratags=1&zoom=19&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { "User-Agent": "supreme-waffle/1.0 (delivery picker)" } });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const a = data.address ?? {};
    let buildingName: string = a.amenity || a.shop || a.building || a.house_name || data.namedetails?.name || data.name || "";

    if (!buildingName) {
      try {
        const overpassQuery = `[out:json][timeout:6];(node(around:80,${lat},${lng})["name"];way(around:80,${lat},${lng})["name"];);out tags center 25;`;
        const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: overpassQuery,
        });
        if (overpassRes.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const op: any = await overpassRes.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const elements: any[] = Array.isArray(op?.elements) ? op.elements : [];
          const scored = elements
            .map((el) => {
              const name: string = el.tags?.name || el.tags?.["name:en"] || "";
              if (!name) return null;
              const elLat = el.lat ?? el.center?.lat;
              const elLng = el.lon ?? el.center?.lon;
              if (typeof elLat !== "number" || typeof elLng !== "number") return null;
              const dLat = (elLat - lat) * 111000;
              const dLng = (elLng - lng) * 111000 * Math.cos((lat * Math.PI) / 180);
              const dist = Math.sqrt(dLat * dLat + dLng * dLng);
              const tags = el.tags || {};
              const priority =
                tags.shop ? 0 :
                tags.amenity ? 1 :
                tags.building && tags.building !== "yes" ? 2 :
                tags.tourism ? 3 :
                tags.office ? 4 :
                tags.leisure ? 5 :
                tags.healthcare ? 6 :
                tags.craft ? 7 :
                tags.building === "yes" ? 8 :
                9;
              return { name, dist, priority };
            })
            .filter((x): x is { name: string; dist: number; priority: number } => x !== null)
            .sort((x, y) => (x.priority - y.priority) || (x.dist - y.dist));
          if (scored.length > 0 && scored[0].dist < 80) {
            buildingName = scored[0].name;
          }
        }
      } catch {
        // ignore
      }
    }

    const area = buildingName || a.neighbourhood || a.quarter || a.suburb || a.town || a.city || a.county || "";
    const parts: string[] = [];
    if (a.house_number) parts.push(a.house_number);
    if (a.road) parts.push(a.road);
    if (a.neighbourhood) parts.push(a.neighbourhood);
    if (a.quarter && a.quarter !== a.neighbourhood) parts.push(a.quarter);
    if (a.suburb && a.suburb !== a.neighbourhood && a.suburb !== a.quarter) parts.push(a.suburb);
    const city = a.city || a.town || a.village || "";
    if (city) parts.push(city);
    if (a.state) parts.push(a.state);
    const pincode = (a.postcode || "").toString().replace(/\s/g, "");

    return {
      provider: "osm",
      payload: {
        buildingName,
        area,
        fullAddress: parts.join(", "),
        pincode,
        hasSpecificPlace: !!buildingName,
      },
    };
  } catch {
    return null;
  }
}

function keyForLatLng(lat: number, lng: number): { latKey: string; lngKey: string } {
  return { latKey: lat.toFixed(5), lngKey: lng.toFixed(5) };
}

async function readCache(lat: number, lng: number): Promise<CachedRow | null> {
  if (!admin) return null;
  const { latKey, lngKey } = keyForLatLng(lat, lng);
  const { data, error } = await admin
    .from("reverse_geocode_cache")
    .select("payload, provider, created_at")
    .eq("lat_key", latKey)
    .eq("lng_key", lngKey)
    .maybeSingle();
  if (error || !data) return null;
  const ageDays = (Date.now() - new Date(data.created_at).getTime()) / 86_400_000;
  if (ageDays > CACHE_MAX_AGE_DAYS) return null;
  return data as CachedRow;
}

async function writeCache(lat: number, lng: number, provider: string, payload: ReverseGeocodePayload) {
  if (!admin) return;
  const { latKey, lngKey } = keyForLatLng(lat, lng);
  await admin
    .from("reverse_geocode_cache")
    .upsert({ lat_key: latKey, lng_key: lngKey, payload, provider, created_at: new Date().toISOString() }, {
      onConflict: "lat_key,lng_key",
    });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const lat = Number(body.lat);
    const lng = Number(body.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return new Response(JSON.stringify({ error: "lat and lng required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const cached = await readCache(lat, lng);
    if (cached) {
      return new Response(JSON.stringify({ ...cached.payload, provider: cached.provider, cached: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const result =
      (await tryGoogle(lat, lng)) ||
      (await tryOsm(lat, lng));

    if (!result) {
      return new Response(JSON.stringify({
        buildingName: "",
        area: "",
        fullAddress: "",
        pincode: "",
        hasSpecificPlace: false,
        provider: "none",
        cached: false,
      }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    writeCache(lat, lng, result.provider, result.payload).catch(() => {});

    return new Response(JSON.stringify({ ...result.payload, provider: result.provider, cached: false }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
