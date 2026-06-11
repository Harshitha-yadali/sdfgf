import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

export const TAKEAWAY_FEE = 10;
export const FREE_DELIVERY_THRESHOLD = 299;

const RESTAURANT_LAT = 16.4724;
const RESTAURANT_LNG = 80.6516;

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
  deliveryLat?: number | null;
  deliveryLng?: number | null;
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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeExpectedDeliveryFee(subtotal: number, lat: number | null | undefined, lng: number | null | undefined): number {
  if (subtotal >= FREE_DELIVERY_THRESHOLD) return 0;
  if (lat == null || lng == null) return 30;
  const km = haversineKm(RESTAURANT_LAT, RESTAURANT_LNG, lat, lng);
  if (km <= 3) return 30;
  if (km <= 7) return 50;
  return 70;
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

  const subtotal = roundCurrency(Number(input.subtotal ?? 0));
  const expectedDeliveryFee = roundCurrency(
    computeExpectedDeliveryFee(subtotal, input.deliveryLat, input.deliveryLng),
  );
  const submittedDeliveryFee = roundCurrency(Number(input.deliveryFee ?? 0));

  if (Math.abs(submittedDeliveryFee - expectedDeliveryFee) > 0.01) {
    throw new Error("Delivery fee mismatch");
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
