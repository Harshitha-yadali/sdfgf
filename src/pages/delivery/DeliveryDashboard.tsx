import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck, LogOut, MapPin, Navigation, Phone, Package, CheckCircle,
  Clock, Loader2, RefreshCw, User, ShoppingBag,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../components/Toast';
import type { Order } from '../../types';

interface OrderItemRow {
  id: string;
  order_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  customizations: { group_name: string; option_name: string; price: number }[] | null;
}

const DELIVERY_ACTIVE_STATUSES = ['confirmed', 'preparing', 'packed', 'out_for_delivery'] as const;

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m ago`;
}

function StatusBadge({ status }: { status: Order['status'] }) {
  if (status === 'packed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400">
        <Package size={10} /> Ready for Pickup
      </span>
    );
  }
  if (status === 'out_for_delivery') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-sky-500/10 text-sky-400">
        <Truck size={10} /> Out for Delivery
      </span>
    );
  }
  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400">
        <Clock size={10} /> Confirmed
      </span>
    );
  }
  if (status === 'preparing') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-orange-500/10 text-orange-400">
        <Clock size={10} /> Preparing
      </span>
    );
  }
  return null;
}

export default function DeliveryDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [itemsMap, setItemsMap] = useState<Record<string, OrderItemRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const { profile, signOut } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('order_type', 'delivery')
      .in('status', [...DELIVERY_ACTIVE_STATUSES])
      .order('placed_at', { ascending: true });

    if (error || !mountedRef.current) return;

    const fetchedOrders = (data ?? []) as Order[];
    setOrders(fetchedOrders);
    setLoading(false);

    const ids = fetchedOrders.map((o) => o.id);
    if (!ids.length) { setItemsMap({}); return; }

    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', ids);

    if (!mountedRef.current) return;

    const map: Record<string, OrderItemRow[]> = {};
    (items ?? []).forEach((item) => {
      const oi = item as OrderItemRow;
      if (!map[oi.order_id]) map[oi.order_id] = [];
      map[oi.order_id].push(oi);
    });
    setItemsMap(map);
  }, []);

  useEffect(() => {
    void loadOrders();

    const channel = supabase
      .channel('delivery-orders-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `order_type=eq.delivery`,
      }, () => { void loadOrders(); })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [loadOrders]);

  async function updateOrderStatus(order: Order, newStatus: 'out_for_delivery' | 'delivered') {
    if (updatingId) return;
    setUpdatingId(order.id);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus, ...(newStatus === 'delivered' ? { completed_at: new Date().toISOString() } : {}) })
        .eq('id', order.id);

      if (error) throw error;

      if (newStatus === 'delivered') {
        showToast(`Order ${order.order_id} marked delivered!`);
        setOrders((prev) => prev.filter((o) => o.id !== order.id));
      } else {
        showToast(`Order ${order.order_id} is out for delivery`);
        setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, status: newStatus } : o));
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update order', 'error');
    } finally {
      if (mountedRef.current) setUpdatingId(null);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/delivery/login', { replace: true });
  }

  const packed = orders.filter((o) => o.status === 'packed');
  const outForDelivery = orders.filter((o) => o.status === 'out_for_delivery');
  const upcoming = orders.filter((o) => o.status === 'confirmed' || o.status === 'preparing');

  function OrderCard({ order }: { order: Order }) {
    const items = itemsMap[order.id] ?? [];
    const isUpdating = updatingId === order.id;
    const mapsHref = order.delivery_lat != null && order.delivery_lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${order.delivery_lat},${order.delivery_lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`;

    return (
      <div className={`rounded-2xl border p-4 transition-all ${
        order.status === 'packed'
          ? 'bg-emerald-500/5 border-emerald-500/20'
          : order.status === 'out_for_delivery'
            ? 'bg-sky-500/5 border-sky-500/20'
            : 'bg-brand-surface border-brand-border'
      }`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white text-[15px]">{order.order_id}</span>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-[12px] text-brand-text-dim mt-0.5">{timeAgo(order.placed_at)}</p>
          </div>
          <span className="font-bold text-brand-gold text-lg tabular-nums flex-shrink-0">
            ₹{order.total}
          </span>
        </div>

        {/* Customer */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-1.5 text-[13px] text-brand-text-muted">
            <User size={13} className="text-brand-text-dim flex-shrink-0" />
            <span className="font-semibold text-white">{order.customer_name}</span>
          </div>
          {order.customer_phone && (
            <a
              href={`tel:${order.customer_phone}`}
              className="flex items-center gap-1 px-2 py-1 bg-brand-surface-light rounded-lg text-[12px] font-semibold text-brand-gold hover:bg-brand-surface transition-colors"
            >
              <Phone size={12} />
              {order.customer_phone}
            </a>
          )}
        </div>

        {/* Address + Navigate */}
        <div className="flex items-start gap-2 mb-3 bg-brand-surface-light rounded-xl px-3 py-2.5">
          <MapPin size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-brand-text-muted leading-snug flex-1">{order.address}</p>
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-[11px] font-bold transition-colors shadow-sm shadow-sky-500/30"
          >
            <Navigation size={11} />
            Navigate
          </a>
        </div>

        {/* Items */}
        {items.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <span className="text-[12px] font-bold text-brand-gold bg-brand-gold/10 rounded-md px-1.5 py-0.5 tabular-nums flex-shrink-0">
                    ×{item.quantity}
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-white leading-snug">{item.item_name}</p>
                    {item.customizations && item.customizations.length > 0 && (
                      <p className="text-[11px] text-brand-text-dim mt-0.5">
                        {item.customizations.map((c) => c.option_name).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
                <span className="text-[12px] text-brand-text-dim tabular-nums flex-shrink-0">
                  ₹{item.unit_price * item.quantity}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Action button */}
        {order.status === 'packed' && (
          <button
            onClick={() => void updateOrderStatus(order, 'out_for_delivery')}
            disabled={isUpdating}
            className="w-full py-3 rounded-xl font-bold text-[14px] bg-sky-500 hover:bg-sky-600 text-white transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 shadow-md shadow-sky-500/20"
          >
            {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
            Picked Up — Mark Out for Delivery
          </button>
        )}

        {order.status === 'out_for_delivery' && (
          <button
            onClick={() => void updateOrderStatus(order, 'delivered')}
            disabled={isUpdating}
            className="w-full py-3 rounded-xl font-bold text-[14px] bg-emerald-500 hover:bg-emerald-600 text-white transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20"
          >
            {isUpdating ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            Mark as Delivered
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-brand-surface/95 backdrop-blur-md border-b border-brand-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-sky-500/15 border border-sky-500/20 rounded-lg flex items-center justify-center">
              <Truck size={16} className="text-sky-400" />
            </div>
            <div>
              <h1 className="text-[14px] font-extrabold text-white leading-none">Delivery</h1>
              <p className="text-[11px] text-brand-text-dim leading-none mt-0.5">{profile?.full_name || 'Staff'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadOrders()}
              className="p-2 rounded-lg text-brand-text-dim hover:text-white hover:bg-brand-surface-light transition-colors"
              aria-label="Refresh"
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={() => void handleSignOut()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-brand-text-dim hover:text-red-400 hover:bg-red-500/10 text-[13px] font-semibold transition-colors"
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-sky-400" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-brand-surface rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ShoppingBag size={28} className="text-brand-text-dim" />
            </div>
            <p className="text-white font-bold text-lg">No active deliveries</p>
            <p className="text-brand-text-dim text-sm mt-1">New delivery orders will appear here</p>
          </div>
        ) : (
          <>
            {packed.length > 0 && (
              <section>
                <h2 className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-400 mb-3">
                  Ready for Pickup ({packed.length})
                </h2>
                <div className="space-y-3">
                  {packed.map((o) => <OrderCard key={o.id} order={o} />)}
                </div>
              </section>
            )}

            {outForDelivery.length > 0 && (
              <section>
                <h2 className="text-[11px] font-extrabold uppercase tracking-widest text-sky-400 mb-3">
                  Out for Delivery ({outForDelivery.length})
                </h2>
                <div className="space-y-3">
                  {outForDelivery.map((o) => <OrderCard key={o.id} order={o} />)}
                </div>
              </section>
            )}

            {upcoming.length > 0 && (
              <section>
                <h2 className="text-[11px] font-extrabold uppercase tracking-widest text-brand-text-dim mb-3">
                  Upcoming ({upcoming.length})
                </h2>
                <div className="space-y-3">
                  {upcoming.map((o) => <OrderCard key={o.id} order={o} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
