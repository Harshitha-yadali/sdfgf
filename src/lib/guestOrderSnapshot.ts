import type { Order, OrderStatus, OrderType, PaymentMethod, PaymentProvider, PickupOption } from '../types';

const GUEST_ORDER_SNAPSHOT_KEY = 'supreme-waffle-guest-order-snapshots';
const GUEST_ORDER_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

type StoredGuestOrderSnapshot = Order & {
  stored_at: number;
};

interface StoreGuestOrderSnapshotInput {
  orderId: string;
  customerName: string;
  customerEmail: string;
  orderType: OrderType;
  pickupOption: PickupOption;
  address: string;
  pincode: string;
  deliveryFee: number;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentProvider: PaymentProvider;
  paymentStatus: string;
  status?: OrderStatus;
}

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function normalizeOrderId(orderId: string) {
  return orderId.trim().toUpperCase();
}

function toOrder(snapshot: StoredGuestOrderSnapshot): Order {
  const order: Order = { ...snapshot };
  return order;
}

function readStoredSnapshots() {
  if (!canUseSessionStorage()) return [];

  const rawValue = window.sessionStorage.getItem(GUEST_ORDER_SNAPSHOT_KEY);
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredGuestOrderSnapshot>[];
    if (!Array.isArray(parsed)) {
      window.sessionStorage.removeItem(GUEST_ORDER_SNAPSHOT_KEY);
      return [];
    }

    const now = Date.now();
    return parsed.filter((snapshot): snapshot is StoredGuestOrderSnapshot => (
      typeof snapshot.order_id === 'string'
      && typeof snapshot.stored_at === 'number'
      && now - snapshot.stored_at <= GUEST_ORDER_SNAPSHOT_TTL_MS
    ));
  } catch {
    window.sessionStorage.removeItem(GUEST_ORDER_SNAPSHOT_KEY);
    return [];
  }
}

function writeStoredSnapshots(snapshots: StoredGuestOrderSnapshot[]) {
  if (!canUseSessionStorage()) return;
  window.sessionStorage.setItem(GUEST_ORDER_SNAPSHOT_KEY, JSON.stringify(snapshots));
}

export function storeGuestOrderSnapshot(input: StoreGuestOrderSnapshotInput) {
  if (!canUseSessionStorage()) return null;

  const orderId = normalizeOrderId(input.orderId);
  if (!orderId) return null;

  const now = new Date();
  const placedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const snapshot: StoredGuestOrderSnapshot = {
    id: `guest-${orderId}`,
    order_id: orderId,
    customer_name: input.customerName,
    customer_phone: '',
    customer_email: input.customerEmail,
    address: input.address,
    pincode: input.pincode,
    order_type: input.orderType,
    pickup_option: input.pickupOption,
    delivery_fee: input.orderType === 'delivery' ? input.deliveryFee : 0,
    takeaway_fee: input.orderType === 'pickup' && input.pickupOption === 'takeaway' ? 10 : 0,
    subtotal: input.subtotal,
    discount: input.discount,
    total: input.total,
    payment_method: input.paymentMethod,
    payment_provider: input.paymentProvider,
    payment_status: input.paymentStatus,
    counter_payment_method: null,
    cash_received_amount: null,
    online_received_amount: null,
    paid_amount: input.paymentStatus === 'paid' ? input.total : null,
    review_reward_coupon_id: null,
    review_reward_discount_amount: null,
    razorpay_order_id: null,
    razorpay_payment_id: null,
    razorpay_signature: null,
    payment_verified_at: input.paymentStatus === 'paid' ? placedAt : null,
    status: input.status ?? 'pending',
    placed_at: placedAt,
    confirmed_at: null,
    accepted_at: null,
    completed_at: null,
    estimated_minutes: null,
    queue_position: null,
    expires_at: expiresAt,
    created_at: placedAt,
    stored_at: Date.now(),
  };

  const snapshots = readStoredSnapshots().filter((stored) => normalizeOrderId(stored.order_id) !== orderId);
  snapshots.unshift(snapshot);
  writeStoredSnapshots(snapshots.slice(0, 5));
  return toOrder(snapshot);
}

export function readGuestOrderSnapshot(orderId: string | null | undefined) {
  const normalizedOrderId = normalizeOrderId(orderId || '');
  if (!normalizedOrderId) return null;

  const snapshot = readStoredSnapshots().find((stored) => normalizeOrderId(stored.order_id) === normalizedOrderId);
  return snapshot ? toOrder(snapshot) : null;
}

export function updateGuestOrderSnapshot(orderId: string, updates: Partial<Order>) {
  const normalizedOrderId = normalizeOrderId(orderId);
  if (!normalizedOrderId) return null;

  const snapshots = readStoredSnapshots();
  const snapshotIndex = snapshots.findIndex((stored) => normalizeOrderId(stored.order_id) === normalizedOrderId);
  if (snapshotIndex === -1) return null;

  const updatedSnapshot: StoredGuestOrderSnapshot = {
    ...snapshots[snapshotIndex],
    ...updates,
    order_id: normalizedOrderId,
    stored_at: Date.now(),
  };
  snapshots[snapshotIndex] = updatedSnapshot;
  writeStoredSnapshots(snapshots);
  return toOrder(updatedSnapshot);
}
