ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_lat  numeric(10, 7),
  ADD COLUMN IF NOT EXISTS delivery_lng  numeric(10, 7);
