import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Search, Phone, MessageCircle, ArrowLeft, Package, Bell, PartyPopper, Clock, ChefHat, Users, Sparkles, ArrowRight, Star, CheckCircle, Wallet, BadgeCheck, User, XCircle, MapPin, Navigation } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { clearPendingOnlineOrder, readPendingOnlineOrder } from '../lib/pendingOnlineOrder';
import { getCompletedOrderLabel, getPaymentMethodLabel, getPendingPaymentLabel, getReadyOrderLabel, getServiceModeLabel, isAwaitingCounterPayment, isAwaitingOnlinePayment, isDineInOrder } from '../lib/orderLabels';
import { fetchAccessibleOrderDetails } from '../lib/orderLookup';
import { reconcileRazorpayPayment } from '../lib/razorpay';
import { playOrderCompleteSound, playPickupReadyAlert } from '../lib/sounds';
import type { Order, OrderItem, MenuItem } from '../types';
import OrderTimeline from '../components/OrderTimeline';
import { useAuth } from '../contexts/AuthContext';
import { useCart } from '../contexts/CartContext';
import { readGuestOrderSnapshot, updateGuestOrderSnapshot } from '../lib/guestOrderSnapshot';

function PrepCountdown({ confirmedAt, estimatedMinutes }: { confirmedAt: string; estimatedMinutes: number }) {
  const [remaining, setRemaining] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const readyAt = new Date(confirmedAt).getTime() + estimatedMinutes * 60_000;

    function tick() {
      const left = Math.max(0, Math.floor((readyAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && intervalRef.current) clearInterval(intervalRef.current);
    }

    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [confirmedAt, estimatedMinutes]);

  if (remaining <= 0) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6 text-center backdrop-blur-sm">
        <Clock size={24} strokeWidth={2.2} className="mx-auto mb-2 text-amber-400" />
        <p className="text-[14px] font-semibold text-amber-400">Almost ready! Just a moment...</p>
      </div>
    );
  }

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const totalSecs = estimatedMinutes * 60;
  const progress = Math.max(0, Math.min(100, ((totalSecs - remaining) / totalSecs) * 100));

  return (
    <div className="rounded-2xl border border-brand-border bg-brand-surface p-6">
      <p className="mb-3 text-center text-[12px] font-semibold uppercase tracking-wider text-brand-text-dim">
        Estimated ready in
      </p>
      <div className="mb-4 flex items-center justify-center gap-2">
        <div className="min-w-[64px] rounded-xl bg-brand-surface-light px-4 py-3 text-center">
          <span className="text-3xl font-black tabular-nums text-white">
            {String(mins).padStart(2, '0')}
          </span>
          <p className="mt-0.5 text-[12px] font-semibold uppercase text-brand-text-dim">min</p>
        </div>
        <span className="px-1 text-2xl font-black tabular-nums text-brand-text-dim">:</span>
        <div className="min-w-[64px] rounded-xl bg-brand-surface-light px-4 py-3 text-center">
          <span className="text-3xl font-black tabular-nums text-white">
            {String(secs).padStart(2, '0')}
          </span>
          <p className="mt-0.5 text-[12px] font-semibold uppercase text-brand-text-dim">sec</p>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-brand-surface-light">
        <div
          className="h-2 rounded-full bg-brand-gold transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-3 text-center text-[12px] font-semibold text-brand-text-dim">
        Your waffles are being freshly made
      </p>
    </div>
  );
}

function getItemCustomizations(item: Pick<OrderItem, 'customizations'>) {
  return Array.isArray(item.customizations) ? item.customizations : [];
}

function getItemLineTotal(item: Pick<OrderItem, 'quantity' | 'unit_price' | 'customizations'>) {
  const customizationTotal = getItemCustomizations(item).reduce((sum, customization) => sum + customization.price, 0);
  return (item.unit_price + customizationTotal) * item.quantity;
}

export default function TrackOrderPage() {
  const { orderId: paramOrderId } = useParams<{ orderId: string }>();
  const { user } = useAuth();
  const [searchId, setSearchId] = useState(paramOrderId || '');
  const [order, setOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showReadyBanner, setShowReadyBanner] = useState(false);
  const [queueAhead, setQueueAhead] = useState<number | null>(null);
  const [specials, setSpecials] = useState<MenuItem[]>([]);
  const [reconcilingPayment, setReconcilingPayment] = useState(false);
  const prevStatusRef = useRef<string | null>(null);
  const pickupAlertPlayedRef = useRef(false);
  const reconciledPendingOrderRef = useRef<string | null>(null);
  const { clearCart } = useCart();

  useEffect(() => {
    setSearchId(paramOrderId || '');
  }, [paramOrderId]);

  useEffect(() => {
    void loadSpecials();
  }, []);

  useEffect(() => {
    if (!order) return;

    async function loadQueuePosition(currentOrder: Order) {
      const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lt('placed_at', currentOrder.placed_at)
        .or('total.lte.0,order_type.eq.delivery,payment_status.eq.paid');

      setQueueAhead(count || 0);
    }

    if (order.order_type === 'pickup' && order.status === 'packed') {
      setShowReadyBanner(true);
      if (!pickupAlertPlayedRef.current) {
        pickupAlertPlayedRef.current = true;
        playPickupReadyAlert();
      }
    } else {
      setShowReadyBanner(false);
    }

    if (user && order.status === 'pending' && !isAwaitingCounterPayment(order)) {
      void loadQueuePosition(order);
    } else {
      setQueueAhead(null);
    }

    if (prevStatusRef.current && prevStatusRef.current !== order.status) {
      if (order.status === 'packed') {
        playOrderCompleteSound();
      }
    }
    prevStatusRef.current = order.status;
  }, [order, user]);

  useEffect(() => {
    if (!order?.order_id || !user) return;

    const channel = supabase
      .channel(`track-${order.order_id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `order_id=eq.${order.order_id}` }, (payload) => {
        const updated = payload.new as Order;
        setOrder(updated);
        if (updated.order_type === 'pickup' && updated.status === 'packed') {
          setShowReadyBanner(true);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [order?.order_id, user]);

  useEffect(() => {
    if (!order || user || !order.customer_email) return;
    if (['delivered', 'cancelled', 'expired'].includes(order.status)) return;

    let isMounted = true;

    const refreshGuestOrder = async () => {
      try {
        const { order: freshOrder, items } = await fetchAccessibleOrderDetails(order.order_id, order.customer_email);
        if (!isMounted) {
          return;
        }

        updateGuestOrderSnapshot(order.order_id, freshOrder);
        setOrder((currentOrder) => currentOrder && currentOrder.order_id === freshOrder.order_id
          ? freshOrder
          : currentOrder);
        setOrderItems(items);
      } catch (error) {
        console.error('Failed to poll guest order status', error);
      }
    };

    void refreshGuestOrder();
    const interval = setInterval(() => {
      void refreshGuestOrder();
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [order, user]);

  useEffect(() => {
    if (!order) return;

    const pendingRecoveryOrderId = readPendingOnlineOrder();
    if (pendingRecoveryOrderId === order.order_id && order.payment_provider === 'razorpay' && order.payment_status === 'paid') {
      clearPendingOnlineOrder(order.order_id);
      clearCart();
      return;
    }

    if (order.payment_status === 'failed' || order.status === 'cancelled' || order.status === 'expired') {
      clearPendingOnlineOrder(order.order_id);
    }
  }, [clearCart, order]);

  useEffect(() => {
    if (!order || !isAwaitingOnlinePayment(order)) {
      setReconcilingPayment(false);
      return;
    }

    if (reconciledPendingOrderRef.current === order.order_id) {
      return;
    }

    reconciledPendingOrderRef.current = order.order_id;
    setReconcilingPayment(true);

    void (async () => {
      try {
        const reconciliation = await reconcileRazorpayPayment(order.order_id, order.customer_email);

        if (reconciliation.paymentState === 'paid') {
          setOrder((currentOrder) => currentOrder && currentOrder.order_id === order.order_id
            ? {
                ...currentOrder,
                payment_status: 'paid',
                payment_provider: 'razorpay',
                payment_method: reconciliation.paymentMethod ?? currentOrder.payment_method,
                status: (reconciliation.orderStatus as Order['status'] | undefined) ?? currentOrder.status,
              }
            : currentOrder);
          return;
        }

        if (reconciliation.paymentState === 'failed') {
          clearPendingOnlineOrder(order.order_id);
          setOrder((currentOrder) => currentOrder && currentOrder.order_id === order.order_id
            ? {
                ...currentOrder,
                payment_status: 'failed',
                status: reconciliation.orderStatus === 'expired'
                  ? 'expired'
                  : (reconciliation.orderStatus as Order['status'] | undefined) ?? currentOrder.status,
              }
            : currentOrder);
        }
      } catch (reconciliationError) {
        console.error('Failed to reconcile Razorpay payment', reconciliationError);
      } finally {
        setReconcilingPayment(false);
      }
    })();
  }, [order]);

  async function loadSpecials() {
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('is_available', true)
      .order('rating', { ascending: false })
      .limit(6);
    if (data) setSpecials(data);
  }

  const fetchOrder = useCallback(async (id: string) => {
    const normalizedId = id.trim().toUpperCase();

    setLoading(true);
    setSearched(true);
    setShowReadyBanner(false);
    setQueueAhead(null);
    setOrderItems([]);
    prevStatusRef.current = null;
    pickupAlertPlayedRef.current = false;

    if (!user) {
      const guestOrder = readGuestOrderSnapshot(normalizedId);

      if (!guestOrder?.customer_email) {
        setOrder(guestOrder);
        setLoading(false);
        return;
      }

      setOrder(guestOrder);

      try {
        const { order: freshOrder, items } = await fetchAccessibleOrderDetails(normalizedId, guestOrder.customer_email);
        updateGuestOrderSnapshot(normalizedId, freshOrder);
        setOrder(freshOrder);
        setOrderItems(items);
      } catch (error) {
        console.error('Failed to load guest order', error);
      } finally {
        setLoading(false);
      }

      return;
    }

    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .eq('order_id', normalizedId)
      .maybeSingle();

    if (data) {
      setOrder(data);
      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', data.id);
      setOrderItems(items || []);
    } else {
      setOrder(null);
      setOrderItems([]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (paramOrderId) {
      void fetchOrder(paramOrderId);
    }
  }, [paramOrderId, fetchOrder]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchId.trim()) fetchOrder(searchId);
  }

  const isReadyForPickup = order?.order_type === 'pickup' && order?.status === 'packed';
  const isDeliveryPacked = order?.order_type === 'delivery' && order?.status === 'packed';
  const isDelivered = order?.status === 'delivered';
  const isCancelled = order?.status === 'cancelled';
  const isExpired = order?.status === 'expired';
  const isOnlinePaymentPending = order ? isAwaitingOnlinePayment(order) : false;
  const isCounterPaymentPending = order ? isAwaitingCounterPayment(order) : false;
  const isCounterPaymentPendingBeforeConfirmation = isCounterPaymentPending && order?.status === 'pending';
  const isCounterPaymentPaidAndQueued = !!order && order.order_type === 'pickup' && order.payment_status === 'paid' && order.status === 'pending';
  const isInQueue = order?.status === 'pending' && !isCounterPaymentPendingBeforeConfirmation && !isOnlinePaymentPending;
  const isPreparing = order?.status === 'preparing';
  const isActive = order && !['cancelled', 'expired', 'delivered'].includes(order.status) && !isReadyForPickup && !isCounterPaymentPendingBeforeConfirmation && !isOnlinePaymentPending;
  const showCountdown = isActive && order.estimated_minutes && (order.accepted_at || order.confirmed_at) && ['confirmed', 'preparing'].includes(order.status);
  const serviceModeLabel = order ? getServiceModeLabel(order) : '';
  const readyOrderLabel = order ? getReadyOrderLabel(order) : '';
  const completedOrderLabel = order ? getCompletedOrderLabel(order) : '';
  const isDineIn = order ? isDineInOrder(order) : false;
  const timelineStatus = order
    ? (isCounterPaymentPaidAndQueued ? 'confirmed' : order.status)
    : 'pending';

  return (
    <div className="min-h-screen bg-brand-bg">
      <div className="section-padding py-10">
        <Link
          to="/"
          className="group mb-8 inline-flex items-center gap-2 text-[14px] font-semibold text-brand-text-dim transition-colors hover:text-brand-gold"
        >
          <ArrowLeft size={16} strokeWidth={2.2} className="transition-transform group-hover:-translate-x-0.5" />
          Back to Home
        </Link>

        <h1 className="mb-8 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Track Your Order
        </h1>

        <form onSubmit={handleSearch} className="mb-10 flex max-w-lg gap-3">
          <div className="relative flex-1">
            <Search
              size={18}
              strokeWidth={2.2}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-text-dim"
            />
            <input
              type="text"
              value={searchId}
              onChange={(e) => setSearchId(e.target.value.toUpperCase())}
              placeholder="Enter Order ID (e.g. SW-1)"
              className="input-field pl-10 uppercase"
            />
          </div>
          <button type="submit" className="btn-primary px-6">
            Track
          </button>
        </form>

        {!user && (
          <div className="max-w-lg py-12 text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-brand-surface">
              <User size={32} className="text-brand-text-dim" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-white">Sign in to track your order</h3>
            <p className="text-[14px] font-medium text-brand-text-muted mb-6">
              Order tracking is available for the account that placed the order.
            </p>
            <Link to="/auth" state={{ from: paramOrderId ? `/track/${paramOrderId}` : '/track' }} className="btn-primary">
              Sign In
            </Link>
          </div>
        )}

        {user && loading && (
          <div className="max-w-lg animate-pulse space-y-4">
            <div className="h-8 w-36 rounded-lg bg-brand-surface-light" />
            <div className="h-44 rounded-2xl bg-brand-surface-light" />
          </div>
        )}

        {user && !loading && searched && !order && (
          <div className="max-w-lg py-20 text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-brand-surface">
              <Package size={32} className="text-brand-text-dim" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-white">Order not found</h3>
            <p className="text-[14px] font-medium text-brand-text-muted">
              Please check the order ID and try again
            </p>
          </div>
        )}

        {order && (
          <div className="max-w-lg space-y-6 animate-fade-in">

            {isOnlinePaymentPending && (
              <div className="relative overflow-hidden rounded-2xl bg-sky-500 p-6 text-center text-white shadow-elevated animate-scale-in backdrop-blur">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.12),transparent)]" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-surface-strong/80 backdrop-blur-sm">
                    <Clock size={32} className={reconcilingPayment ? 'animate-spin' : ''} />
                  </div>
                  <h2 className="mb-2 text-2xl font-black">Payment Processing</h2>
                  <p className="text-[14px] text-sky-100">
                    {reconcilingPayment
                      ? 'We are checking your online payment now. If money was debited, this order will update automatically.'
                      : 'Your online payment is still being verified. No further action is needed if money was debited.'}
                  </p>
                </div>
              </div>
            )}

            {isCounterPaymentPendingBeforeConfirmation && (
              <div className="relative overflow-hidden rounded-2xl bg-amber-500 p-6 text-center text-white shadow-elevated animate-scale-in backdrop-blur">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.12),transparent)]" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-surface-strong/80 backdrop-blur-sm">
                    <Wallet size={32} />
                  </div>
                  <h2 className="mb-2 text-2xl font-black">Awaiting Counter Payment</h2>
                  <p className="text-[14px] text-amber-100">
                    Show your order ID at the counter and complete payment. Your order will join the kitchen queue after staff confirms payment.
                  </p>
                </div>
              </div>
            )}

            {showReadyBanner && isReadyForPickup && (
              <div className="relative overflow-hidden rounded-2xl bg-emerald-500 p-6 text-center text-white shadow-elevated animate-scale-in backdrop-blur">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.12),transparent)]" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-surface-strong/80 backdrop-blur-sm">
                    <Bell size={32} className="animate-bounce" />
                  </div>
                  <h2 className="mb-2 text-2xl font-black">{readyOrderLabel}!</h2>
                  <p className="mb-4 text-[14px] text-emerald-100">
                    Show order {order.order_id} at the counter for your {serviceModeLabel.toLowerCase()} order
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-full bg-brand-surface-strong/80 px-4 py-2 text-[14px] font-semibold backdrop-blur-sm">
                    <PartyPopper size={16} />
                    Enjoy your waffles!
                  </div>
                </div>
              </div>
            )}

            {isDeliveryPacked && (
              <div className="relative overflow-hidden rounded-2xl bg-sky-500 p-6 text-center text-white shadow-elevated animate-scale-in backdrop-blur">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.12),transparent)]" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-surface-strong/80 backdrop-blur-sm">
                    <Package size={32} />
                  </div>
                  <h2 className="mb-2 text-2xl font-black">Order Packed</h2>
                  <p className="text-[14px] text-sky-100">
                    Your order is packed and will move to the next delivery step shortly
                  </p>
                </div>
              </div>
            )}

            {isInQueue && (
              <div className="relative overflow-hidden rounded-2xl bg-orange-500 p-6 text-center text-white shadow-elevated animate-scale-in backdrop-blur">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.12),transparent)]" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-surface-strong/80 backdrop-blur-sm">
                    <Users size={32} />
                  </div>
                  <h2 className="mb-2 text-2xl font-black">{isCounterPaymentPaidAndQueued ? 'Order Confirmed' : 'Your Order is in Queue'}</h2>
                  <p className="text-[14px] text-orange-100 mb-3">
                    {isCounterPaymentPaidAndQueued
                      ? 'Payment confirmed. Your order is now waiting in the kitchen queue.'
                      : 'Please wait while our chef accepts your order'}
                  </p>
                  {queueAhead !== null && queueAhead > 0 && (
                    <div className="inline-flex items-center gap-2 rounded-full bg-brand-surface-strong/80 px-4 py-2 text-[14px] font-semibold backdrop-blur-sm">
                      <Clock size={14} />
                      {queueAhead} order{queueAhead !== 1 ? 's' : ''} ahead of you
                    </div>
                  )}
                  {queueAhead === 0 && (
                    <div className="inline-flex items-center gap-2 rounded-full bg-brand-surface-strong/80 px-4 py-2 text-[14px] font-semibold backdrop-blur-sm">
                      <Clock size={14} />
                      You're next in line!
                    </div>
                  )}
                </div>
              </div>
            )}

            {isPreparing && (
              <div className="relative overflow-hidden rounded-2xl bg-amber-500 p-6 text-center text-white shadow-elevated animate-scale-in backdrop-blur">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.12),transparent)]" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-surface-strong/80 backdrop-blur-sm">
                    <ChefHat size={32} className="animate-pulse" />
                  </div>
                  <h2 className="mb-2 text-2xl font-black">Your Order is Being Prepared</h2>
                  <p className="text-[14px] text-amber-100">
                    {order.estimated_minutes
                      ? `Please wait, your food will be ready in about ${order.estimated_minutes} minutes`
                      : 'Your food is being freshly prepared'}
                  </p>
                </div>
              </div>
            )}

            {isCancelled && (
              <div className="relative overflow-hidden rounded-2xl bg-red-500 p-6 text-center text-white shadow-elevated animate-scale-in backdrop-blur">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.12),transparent)]" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-surface-strong/80 backdrop-blur-sm">
                    <XCircle size={32} />
                  </div>
                  <h2 className="mb-2 text-2xl font-black">Order Cancelled</h2>
                  <p className="text-[14px] text-red-100">
                    This order was cancelled by the restaurant
                  </p>
                </div>
              </div>
            )}

            {isExpired && (
              <div className="relative overflow-hidden rounded-2xl bg-orange-500 p-6 text-center text-white shadow-elevated animate-scale-in backdrop-blur">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.12),transparent)]" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-surface-strong/80 backdrop-blur-sm">
                    <Clock size={32} />
                  </div>
                  <h2 className="mb-2 text-2xl font-black">Order Expired</h2>
                  <p className="text-[14px] text-orange-100">
                    This order was not confirmed in time
                  </p>
                </div>
              </div>
            )}

            {order.order_type === 'delivery' && order.status === 'out_for_delivery' && (
              <DeliveryLiveTracker order={order} />
            )}

            {isDelivered && (
              <div className="relative overflow-hidden rounded-2xl p-6 text-center shadow-elevated">
                <div className="absolute inset-0 bg-gradient-to-br from-brand-gold/10 to-brand-gold/[0.02] border border-brand-gold/20 rounded-2xl" />
                <div className="relative">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-gold/15 border border-brand-gold/20">
                    <CheckCircle size={32} className="text-brand-gold" />
                  </div>
                  <h2 className="mb-2 text-2xl font-black text-white">
                    {order.order_type === 'pickup' ? 'Enjoy Your Food!' : 'Order Delivered!'}
                  </h2>
                  <p className="text-[14px] text-brand-text-muted mb-3">
                    {order.order_type === 'pickup'
                      ? 'Thank you for dining with us. We hope you love every bite!'
                      : 'Your waffles have arrived. Enjoy every bite!'}
                  </p>
                  <div className="inline-flex items-center gap-2 bg-brand-gold/10 border border-brand-gold/20 rounded-full px-4 py-2 text-brand-gold text-[13px] font-bold">
                    <Star size={14} fill="currentColor" />
                    We'd love to see you again soon!
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-brand-border bg-brand-surface p-6 transition-shadow duration-300">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-brand-text-dim">Order</p>
                  <p className="text-2xl font-black tabular-nums text-white">
                    {order.order_id}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-[12px] font-semibold capitalize ${
                      isOnlinePaymentPending
                        ? 'bg-sky-500/10 text-sky-400'
                        : isCounterPaymentPendingBeforeConfirmation
                        ? 'bg-amber-500/10 text-amber-400'
                        : order.status === 'delivered'
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : order.status === 'cancelled' || order.status === 'expired'
                          ? 'bg-red-500/10 text-red-400'
                          : isReadyForPickup
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-brand-gold/10 text-brand-gold'
                    }`}
                  >
                    {isOnlinePaymentPending
                      ? 'payment processing'
                      : isCounterPaymentPendingBeforeConfirmation
                      ? 'payment pending'
                      : isCounterPaymentPaidAndQueued
                      ? 'confirmed'
                      : isReadyForPickup
                      ? readyOrderLabel
                      : order.status === 'delivered'
                        ? completedOrderLabel
                        : order.status.replace('_', ' ')}
                  </span>
                  <p className="mt-1 text-[12px] font-semibold text-brand-text-dim">{serviceModeLabel}</p>
                </div>
              </div>

              <OrderTimeline
                currentStatus={timelineStatus}
                orderType={order.order_type}
                pickupOption={order.pickup_option}
                paymentMethod={order.payment_method}
                paymentProvider={order.payment_provider}
                paymentStatus={order.payment_status}
                total={order.total}
                variant={order.order_type === 'delivery' ? 'horizontal' : 'vertical'}
              />
            </div>

            {showCountdown && (
              <PrepCountdown
                confirmedAt={(order.accepted_at || order.confirmed_at)!}
                estimatedMinutes={order.estimated_minutes!}
              />
            )}

            {isActive && !showCountdown && !isInQueue && !isPreparing && (
              <div className="rounded-2xl bg-brand-gold/10 p-6 backdrop-blur-sm">
                <p className="text-[14px] leading-relaxed text-brand-text-muted">
                  {order.order_type === 'delivery'
                    ? order.status === 'out_for_delivery'
                      ? 'Our delivery partner is on the way with your waffles.'
                      : order.status === 'packed'
                        ? 'Your order is packed and will move to delivery shortly.'
                        : 'Your order is being prepared. Estimated delivery time: ~30 minutes'
                    : isDineIn
                      ? 'We are preparing your dine-in order. We will notify you when it is ready to serve.'
                      : 'We are preparing your takeaway order. You will be notified when it is ready for pickup.'}
                </p>
              </div>
            )}

            {orderItems.length > 0 && (
              <div className="rounded-2xl border border-brand-border bg-brand-surface p-6 transition-shadow duration-300">
                <h3 className="mb-4 text-[14px] font-bold uppercase tracking-wider text-white">
                  Order Details
                </h3>
                <div className="space-y-3">
                  {orderItems.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3 text-[14px]">
                      <div>
                        <span className="text-brand-text-muted">
                          {item.quantity}x {item.item_name}
                        </span>
                        {getItemCustomizations(item).length > 0 && (
                          <div className="mt-1 space-y-1">
                            {getItemCustomizations(item).map((customization, index) => (
                              <p key={`${item.id}-${index}`} className="text-[12px] text-brand-text-dim">
                                {customization.group_name}: {customization.option_name}
                                {customization.price > 0 ? ` (+₹${customization.price})` : ''}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="font-semibold tabular-nums text-white">
                        {'\u20B9'}{getItemLineTotal(item).toFixed(0)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-brand-border pt-3">
                    <span className="font-bold text-white">Total</span>
                    <span className="text-lg font-bold tabular-nums text-brand-gold">
                      {'\u20B9'}{order.total}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[13px] text-brand-text-dim">Service</span>
                    <span className="text-[13px] font-bold text-white">
                      {serviceModeLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[13px] text-brand-text-dim">Payment</span>
                    <span className={`inline-flex items-center gap-1.5 text-[13px] font-bold ${
                      order.payment_status === 'paid' ? 'text-emerald-400' : 'text-brand-text-muted'
                    }`}>
                      {order.payment_status === 'paid'
                        ? <><BadgeCheck size={14} /> {getPaymentMethodLabel(order)}</>
                        : <><Wallet size={14} /> {getPendingPaymentLabel(order)}</>
                      }
                    </span>
                  </div>
                </div>
              </div>
            )}

            {(isDelivered || isReadyForPickup) && specials.length > 0 && (
              <TrackPageSpecials items={specials} />
            )}

            <div className="rounded-2xl border border-brand-border bg-brand-surface p-6 transition-shadow duration-300">
              <h3 className="mb-4 text-[14px] font-bold uppercase tracking-wider text-white">
                Need Help?
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <a
                  href="tel:+919876543210"
                  className="flex items-center justify-center gap-2 rounded-xl border border-brand-border py-3 text-[14px] font-semibold text-brand-text-muted transition-all duration-200 hover:border-brand-gold hover:text-brand-gold"
                >
                  <Phone size={16} strokeWidth={2.2} />
                  Call Us
                </a>
                <a
                  href={`https://wa.me/919876543210?text=Hi, I need help with order ${order.order_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-[14px] font-semibold text-white transition-all duration-200 hover:bg-emerald-600"
                >
                  <MessageCircle size={16} strokeWidth={2.2} />
                  WhatsApp
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeliveryLiveTracker({ order }: { order: Order }) {
  const eta = (() => {
    if (order.confirmed_at && order.estimated_minutes) {
      const readyAt = new Date(order.confirmed_at).getTime() + order.estimated_minutes * 60_000;
      const deliveryMs = readyAt + 20 * 60_000;
      const minsLeft = Math.max(5, Math.ceil((deliveryMs - Date.now()) / 60_000));
      return minsLeft <= 45 ? `~${minsLeft} min` : '~20 min';
    }
    return '~20 min';
  })();

  return (
    <div className="rounded-2xl overflow-hidden border border-sky-500/25 shadow-elevated animate-scale-in">
      {/* Road animation */}
      <div className="relative h-44 overflow-hidden bg-gradient-to-b from-[#0a1628] to-[#0d1f3c]">
        {/* Stars */}
        <div className="absolute inset-0 opacity-40">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="absolute w-0.5 h-0.5 bg-white rounded-full"
              style={{ left: `${(i * 37 + 11) % 100}%`, top: `${(i * 23 + 7) % 55}%`, opacity: 0.4 + (i % 3) * 0.2 }}
            />
          ))}
        </div>

        {/* Buildings silhouette */}
        <div className="absolute bottom-16 left-0 right-0 flex items-end opacity-20">
          {[28, 40, 22, 50, 34, 18, 44, 26, 38].map((h, i) => (
            <div key={i} className="flex-1 bg-sky-300" style={{ height: `${h}px` }} />
          ))}
        </div>

        {/* Road */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-[#1a2035]">
          {/* Road edge lines */}
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-yellow-400/30" />
          {/* Dashed center line - animated scrolling */}
          <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 h-1 overflow-hidden">
            <div className="flex animate-road-scroll w-[200%]">
              {[...Array(24)].map((_, i) => (
                <div key={i} className="flex-shrink-0 h-full w-8 mx-3 bg-yellow-400/50 rounded-full" />
              ))}
            </div>
          </div>
          {/* Road edge bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-900/60" />
        </div>

        {/* Restaurant pin (left) */}
        <div className="absolute left-4 bottom-12 flex flex-col items-center gap-1">
          <div className="w-10 h-10 rounded-xl bg-brand-gold/20 border border-brand-gold/40 flex items-center justify-center text-lg">
            🍽️
          </div>
          <p className="text-[8px] font-bold text-brand-gold/80 uppercase tracking-wide">Restaurant</p>
        </div>

        {/* Delivery home pin (right) */}
        <div className="absolute right-4 bottom-12 flex flex-col items-center gap-1">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-lg">
            🏠
          </div>
          <p className="text-[8px] font-bold text-emerald-400/80 uppercase tracking-wide">Your Home</p>
        </div>

        {/* Scooter - centered, animated */}
        <div className="absolute left-1/2 bottom-[22px] -translate-x-1/2 flex flex-col items-center animate-ride">
          <div className="relative">
            {/* Glow effect */}
            <div className="absolute -inset-2 bg-sky-400/20 rounded-full blur-md" />
            <div className="relative text-3xl">🛵</div>
          </div>
          {/* Dot trail */}
          <div className="flex gap-1 mt-1">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="w-1 h-1 rounded-full bg-sky-400/60" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
        </div>

        {/* Status badge */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2">
          <div className="inline-flex items-center gap-1.5 bg-sky-500/20 border border-sky-500/40 backdrop-blur-sm rounded-full px-3 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            <span className="text-[11px] font-bold text-sky-300 uppercase tracking-wider">Live Tracking</span>
          </div>
        </div>
      </div>

      {/* ETA strip */}
      <div className="bg-sky-500/10 border-y border-sky-500/20 px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-400 mb-0.5">
            Estimated Arrival
          </p>
          <p className="text-3xl font-black text-white tabular-nums">{eta}</p>
          <p className="text-[12px] text-brand-text-dim mt-0.5">
            Your waffles are on their way!
          </p>
        </div>
        <div className="w-14 h-14 rounded-2xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center">
          <Navigation size={24} className="text-sky-400" />
        </div>
      </div>

      {/* Delivery partner card */}
      <div className="bg-brand-surface px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-sky-500/30 to-sky-700/30 border-2 border-sky-500/40 flex items-center justify-center text-xl">
              🛵
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-brand-surface" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-white truncate">Supreme Delivery Express</p>
            <div className="flex items-center gap-1 mt-0.5">
              <Star size={11} fill="#D8B24E" className="text-brand-gold flex-shrink-0" />
              <span className="text-[12px] text-brand-text-dim font-semibold">4.9</span>
              <span className="text-brand-text-dim text-[12px]">·</span>
              <span className="text-[12px] text-brand-text-dim truncate">Your delivery partner</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href="tel:+919876543210"
            className="w-10 h-10 rounded-full border border-brand-border bg-brand-surface-light flex items-center justify-center hover:border-brand-gold/50 hover:text-brand-gold transition-colors"
            title="Call"
          >
            <Phone size={16} className="text-brand-text-muted" />
          </a>
          <a
            href={`https://wa.me/919876543210?text=Hi, I need help with order ${order.order_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center hover:bg-emerald-600 transition-colors"
            title="WhatsApp"
          >
            <MessageCircle size={16} className="text-white" />
          </a>
        </div>
      </div>

      {/* Address */}
      {order.address && (
        <div className="px-5 py-3 bg-brand-surface border-t border-brand-border flex items-start gap-2.5">
          <MapPin size={14} className="text-brand-text-dim mt-0.5 flex-shrink-0" />
          <p className="text-[12px] text-brand-text-dim font-medium leading-relaxed">
            Delivering to: <span className="text-brand-text-muted">{order.address}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function TrackPageSpecials({ items }: { items: MenuItem[] }) {
  return (
    <div className="rounded-2xl border border-brand-gold/15 bg-gradient-to-b from-brand-gold/[0.04] to-transparent p-5 text-left animate-fade-in">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-brand-gold/10 rounded-lg flex items-center justify-center">
          <Sparkles size={16} className="text-brand-gold" />
        </div>
        <div>
          <h3 className="text-[14px] font-bold text-white">Today's Top Picks</h3>
          <p className="text-[12px] text-brand-text-dim font-medium">Craving more? Try these favorites</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5 mb-4">
        {items.slice(0, 3).map((item) => (
          <Link
            key={item.id}
            to="/menu"
            className="group rounded-xl overflow-hidden border border-brand-border bg-brand-surface hover:border-brand-gold/30 transition-all"
          >
            <div className="aspect-square overflow-hidden">
              <img
                src={item.image_url}
                alt={item.name}
                loading="lazy"
                width={200}
                height={200}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
              />
            </div>
            <div className="p-2">
              <p className="text-[11px] font-bold text-white truncate leading-tight">{item.name}</p>
              <p className="text-[12px] font-extrabold text-brand-gold mt-0.5">{'\u20B9'}{item.price}</p>
            </div>
          </Link>
        ))}
      </div>

      {items.length > 3 && (
        <div className="space-y-2 mb-4">
          {items.slice(3, 6).map((item) => (
            <Link
              key={item.id}
              to="/menu"
              className="flex items-center gap-3 rounded-xl bg-brand-surface border border-brand-border p-2.5 hover:border-brand-gold/20 transition-all group"
            >
              <img
                src={item.image_url}
                alt={item.name}
                loading="lazy"
                width={44}
                height={44}
                className="w-11 h-11 rounded-lg object-cover shrink-0 group-hover:scale-105 transition-transform"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-white truncate">{item.name}</p>
                <p className="text-[12px] font-semibold text-brand-text-dim">{'\u20B9'}{item.price}</p>
              </div>
              <ArrowRight size={14} className="text-brand-text-dim group-hover:text-brand-gold shrink-0 transition-colors" />
            </Link>
          ))}
        </div>
      )}

      <Link
        to="/menu"
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-gold/10 border border-brand-gold/20 text-brand-gold text-[13px] font-bold hover:bg-brand-gold/15 transition-all"
      >
        View Full Menu
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
