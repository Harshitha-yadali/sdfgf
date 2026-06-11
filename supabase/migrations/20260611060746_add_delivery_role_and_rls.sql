-- Step 1: Drop the old CHECK constraint and add a new one that includes 'delivery'
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('customer', 'chef', 'admin', 'delivery'));

-- Step 2: RLS — delivery staff can view delivery orders and update their status
CREATE POLICY "Delivery staff can view delivery orders" ON orders
  FOR SELECT TO authenticated
  USING (
    order_type = 'delivery'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('delivery', 'admin')
    )
  );

CREATE POLICY "Delivery staff can update delivery order status" ON orders
  FOR UPDATE TO authenticated
  USING (
    order_type = 'delivery'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('delivery', 'admin')
    )
  )
  WITH CHECK (
    order_type = 'delivery'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('delivery', 'admin')
    )
  );

-- Step 3: Delivery staff can view order items for delivery orders
CREATE POLICY "Delivery staff can view delivery order items" ON order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.order_type = 'delivery'
        AND EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
            AND profiles.role IN ('delivery', 'admin')
        )
    )
  );
