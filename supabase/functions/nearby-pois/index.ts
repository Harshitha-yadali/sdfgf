import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Poi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: string;
}

const MAPPLS_CLIENT_ID = Deno.env.get("MAPPLS_CLIENT_ID") ?? "";
const MAPPLS_CLIENT_SECRET = Deno.env.get("MAPPLS_CLIENT_SECRET") ?? "";
const MAPPLS_REST_KEY = Deno.env.get("MAPPLS_REST_KEY") ?? "";
const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";

let mapplsToken = "";
let mapplsTokenExpiresAt = 0;

async function getMapplsToken(): Promise<string> {
  if (!MAPPLS_CLIENT_ID || !MAPPLS_CLIENT_SECRET) return "";
  const now = Date.now();
  if (mapplsToken && now < mapplsTokenExpiresAt) return mapplsToken;
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: MAPPLS_CLIENT_ID,
    client_secret: MAPPLS_CLIENT_SECRET,
  });
  const res = await fetch("https://outpost.mappls.com/api/security/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) return "";
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) return "";
  mapplsToken = data.access_token;
  mapplsTokenExpiresAt = now + Math.max(60_000, ((data.expires_in ?? 86_400) - 600) * 1000);
  return mapplsToken;
}

async function tryMappls(centerLat: number, centerLng: number, radiusMeters: number): Promise<Poi[] | null> {
  const token = await getMapplsToken();
  if (!token) return null;
  try {
    const restKey = MAPPLS_REST_KEY || MAPPLS_CLIENT_ID;
    const url = `https://atlas.mappls.com/api/places/nearby/json?keywords=residency,apartment,building,store,shop,restaurant,school,hospital,bank,atm&refLocation=${centerLat},${centerLng}&radius=${Math.round(radiusMeters)}&page=1&itemCount=30`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = data?.suggestedLocations ?? data?.results ?? [];
    void restKey;
    return list
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any, idx: number): Poi | null => {
        const lat = Number(p.latitude ?? p.lat);
        const lng = Number(p.longitude ?? p.lng ?? p.lon);
        const name: string = p.placeName || p.name || p.poi_name || "";
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) return null;
        return {
          id: `mappls-${p.eLoc || p.placeId || idx}`,
          name,
          lat,
          lng,
          kind: p.type || p.category || "place",
        };
      })
      .filter((p): p is Poi => p !== null);
  } catch {
    return null;
  }
}

async function tryGoogle(centerLat: number, centerLng: number, radiusMeters: number): Promise<Poi[] | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${centerLat},${centerLng}&radius=${Math.round(radiusMeters)}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = data.results ?? [];
    return list
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any): Poi | null => {
        const lat = Number(p.geometry?.location?.lat);
        const lng = Number(p.geometry?.location?.lng);
        const name: string = p.name || "";
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) return null;
        return {
          id: `google-${p.place_id}`,
          name,
          lat,
          lng,
          kind: Array.isArray(p.types) ? p.types[0] : "place",
        };
      })
      .filter((p): p is Poi => p !== null);
  } catch {
    return null;
  }
}

async function tryOverpass(minLat: number, minLng: number, maxLat: number, maxLng: number): Promise<Poi[] | null> {
  try {
    const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
    const query = `[out:json][timeout:8];(node[name](${bbox});way[name](${bbox}););out tags center 60;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elements: any[] = Array.isArray(data?.elements) ? data.elements : [];
    return elements
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((el: any): Poi | null => {
        const name: string = el.tags?.name || el.tags?.["name:en"] || "";
        if (!name) return null;
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        const tags = el.tags ?? {};
        const kind = tags.shop || tags.amenity || tags.tourism || tags.office || tags.leisure || tags.healthcare || tags.craft || tags.building || "place";
        return { id: `osm-${el.type}-${el.id}`, name, lat, lng, kind };
      })
      .filter((p): p is Poi => p !== null);
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const minLat = Number(body.minLat);
    const minLng = Number(body.minLng);
    const maxLat = Number(body.maxLat);
    const maxLng = Number(body.maxLng);

    if (![minLat, minLng, maxLat, maxLng].every(Number.isFinite)) {
      return new Response(JSON.stringify({ error: "minLat/minLng/maxLat/maxLng required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const dLatMeters = (maxLat - minLat) * 111000;
    const dLngMeters = (maxLng - minLng) * 111000 * Math.cos((centerLat * Math.PI) / 180);
    const radius = Math.min(2000, Math.max(80, Math.sqrt(dLatMeters * dLatMeters + dLngMeters * dLngMeters) / 2));

    const result =
      (await tryMappls(centerLat, centerLng, radius)) ||
      (await tryGoogle(centerLat, centerLng, radius)) ||
      (await tryOverpass(minLat, minLng, maxLat, maxLng)) ||
      [];

    // Provider-aware filter: keep results inside the bbox
    const filtered = result.filter((p) =>
      p.lat >= minLat && p.lat <= maxLat && p.lng >= minLng && p.lng <= maxLng
    );

    return new Response(JSON.stringify({ pois: filtered, provider: filtered.length > 0 ? filtered[0].id.split("-")[0] : "none" }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
