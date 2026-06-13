/*
  # Reverse-geocode result cache

  Stores normalised reverse-geocode lookups keyed on rounded lat/lng so repeat
  pin drops on the location picker do not re-hit the upstream provider
  (Mappls / Google / OSM Nominatim). Keeps cost near zero and the picker fast.

  ## Tables
    - `reverse_geocode_cache`
      - `lat_key` text, lat rounded to 5 decimal places (~1 m)
      - `lng_key` text, lng rounded to 5 decimal places (~1 m)
      - `payload` jsonb with the normalised provider response
      - `provider` text, which upstream answered (mappls | google | osm)
      - `created_at` timestamptz, used to expire stale entries

  ## Security
    - RLS enabled.
    - SELECT allowed for `anon` + `authenticated` so the picker can read cache hits
      directly without calling the edge function for already-seen pins.
    - INSERT/UPDATE only via service-role (the edge function), no public write policy.
*/

CREATE TABLE IF NOT EXISTS reverse_geocode_cache (
  lat_key text NOT NULL,
  lng_key text NOT NULL,
  payload jsonb NOT NULL,
  provider text NOT NULL DEFAULT 'osm',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lat_key, lng_key)
);

CREATE INDEX IF NOT EXISTS idx_reverse_geocode_cache_created_at
  ON reverse_geocode_cache (created_at DESC);

ALTER TABLE reverse_geocode_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reverse_geocode_cache'
      AND policyname = 'reverse_geocode_cache_select_anon'
  ) THEN
    CREATE POLICY "reverse_geocode_cache_select_anon"
      ON reverse_geocode_cache
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;
