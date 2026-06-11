import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

export const TAKEAWAY_FEE = 10;

export type CheckoutOrderType = "pickup" | "delivery";
export type CheckoutPickupOption = "dine_in" | "takeaway";

interface DeliveryZoneRow {
  area_name: string;
  delivery_fee: number;
  min_order: number;
  estimated_time: number;
}

interface ResolveCheckoutFulfillmentInput {
  orderType: CheckoutOrderType;
  pickupOption: CheckoutPickupOption;
  address: string;
  pincode: string;
  deliveryFee: number;
  subtotal: number;
}

interface ResolveCheckoutFulfillmentResult {
  orderType: CheckoutOrderType;
  pickupOption: CheckoutPickupOption;
  address: string;
  pincode: string;
  deliveryFee: number;
  takeawayFee: number;
  deliveryZone: DeliveryZoneRow | null;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function formatCurrency(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export async function resolveCheckoutFulfillment(
  adminClient: SupabaseClient,
  input: ResolveCheckoutFulfillmentInput,
): Promise<ResolveCheckoutFulfillmentResult> {
  if (input.orderType !== "delivery") {
    return {
      orderType: "pickup",
      pickupOption: input.pickupOption === "dine_in" ? "dine_in" : "takeaway",
      address: "",
      pincode: "",
      deliveryFee: 0,
      takeawayFee: input.pickupOption === "takeaway" ? TAKEAWAY_FEE : 0,
      deliveryZone: null,
    };
  }

  const address = input.address.trim();
  const pincode = input.pincode.replace(/\D/g, "").slice(0, 6);

  if (!address) {
    throw new Error("Delivery address is required");
  }

  if (pincode.length !== 6) {
    throw new Error("A valid 6-digit pincode is required for delivery");
  }

  const { data, error } = await adminClient
    .from("delivery_zones")
    .select("area_name, delivery_fee, min_order, estimated_time")
    .eq("pincode", pincode)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const zone: DeliveryZoneRow = data
    ? (data as DeliveryZoneRow)
    : { area_name: "Your Area", delivery_fee: 0, min_order: 0, estimated_time: 0 };

  const expectedDeliveryFee = roundCurrency(Number(zone.delivery_fee ?? 0));
  const minimumOrder = roundCurrency(Number(zone.min_order ?? 0));
  const submittedDeliveryFee = roundCurrency(Number(input.deliveryFee ?? 0));

  if (Math.abs(submittedDeliveryFee - expectedDeliveryFee) > 0.01) {
    throw new Error("Delivery fee mismatch");
  }

  if (roundCurrency(Number(input.subtotal ?? 0)) < minimumOrder) {
    throw new Error(`Minimum order for ${zone.area_name || "this area"} is ₹${formatCurrency(minimumOrder)}`);
  }

  return {
    orderType: "delivery",
    pickupOption: "takeaway",
    address,
    pincode,
    deliveryFee: expectedDeliveryFee,
    takeawayFee: 0,
    deliveryZone: zone,
  };
}
