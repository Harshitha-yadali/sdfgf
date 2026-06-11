import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChefHat, LogOut, Clock, Check, Flame, Package, Users, Timer,
  Store, Truck, Volume2, VolumeX, Bell, Zap, Wallet, BadgeCheck, Copy,
  Plus, PlusCircle, MapPin, Navigation,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getCompletedOrderLabel, getPendingPaymentLabel, getReadyOrderLabel, getServiceModeLabel, isAwaitingCounterPayment, isAwaitingOnlinePayment, isDineInOrder } from '../../lib/orderLabels';
import { markOrderPaid } from '../../lib/markOrderPaid';
import { markOrderReady } from '../../lib/markOrderReady';
import { playNewOrderAlert, playAcceptSound, playOrderCompleteSound } from '../../lib/sounds';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../contexts/AuthContext';
import ChefNewOrder from './ChefNewOrder';
import type { Category, CounterPaymentMethod, MenuItem, Order } from '../../types';

interface OrderItemRow {
  id: string;
  order_id: string;
  menu_item_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  customizations: { group_name: string; option_name: string; price: number }[] | null;
}

type Tab = 'payments' | 'queue' | 'preparing' | 'pendingPayment' | 'done' | 'newOrder';
type PaymentCategory = 'all' | 'before' | 'after';
type PaymentDraft = {
  method: CounterPaymentMethod;
  cashReceived: string;
  onlineReceived: string;
};
type AddItemDraft = {
  categoryId: string;
  menuItemId: string;
  quantity: string;
};
type ChefCategory = Pick<Category, 'id' | 'name' | 'display_order'>;
type ChefMenuItem = Pick<MenuItem, 'id' | 'name' | 'price' | 'is_available' | 'category_id' | 'display_order'>;

const ACTIVE_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'packed'] as const;
const CHEF_REFRESH_DEBOUNCE_MS = 250;
const CHEF_POLL_INTERVAL_MS = 5000;

function getExtraItemCategories(categories: ChefCategory[], items: ChefMenuItem[]) {
  const categoryIdsWithItems = new Set(items.map((item) => item.category_id).filter(Boolean));
  const knownCategories = categories.filter((category) => categoryIdsWithItems.has(category.id));
  const knownCategoryIds = new Set(knownCategories.map((category) => category.id));
  const fallbackCategories = Array.from(categoryIdsWithItems)
    .filter((categoryId) => !knownCategoryIds.has(categoryId))
    .map((categoryId, index) => ({
      id: categoryId,
      name: `Category ${knownCategories.length + index + 1}`,
      display_order: Number.MAX_SAFE_INTEGER,
    }));

  return [...knownCategories, ...fallbackCategories];
}

export default function ChefDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItemsMap, setOrderItemsMap] = useState<Record<string, OrderItemRow[]>>({});
  const [menuCategories, setMenuCategories] = useState<ChefCategory[]>([]);
  const [menuItems, setMenuItems] = useState<ChefMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('queue');
  const [paymentCategory, setPaymentCategory] = useState<PaymentCategory>('all');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [newOrderFlash, setNewOrderFlash] = useState(false);
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, PaymentDraft>>({});
  const [activeAddItemOrderId, setActiveAddItemOrderId] = useState<string | null>(null);
  const [addItemDrafts, setAddItemDrafts] = useState<Record<string, AddItemDraft>>({});
  const [addingItemOrderId, setAddingItemOrderId] = useState<string | null>(null);
  const [completingOrderId, setCompletingOrderId] = useState<string | null>(null);
  const [handoffOrderId, setHandoffOrderId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { signOut } = useAuth();
  const prevQueueCountRef = useRef(0);
  const prevPaymentCountRef = useRef(0);
  const initialLoadRef = useRef(true);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOrders = useCallback(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [activeOrdersResult, deliveredOrdersResult] = await Promise.all([
      supabase
        .from('orders')
        .select('*')
        .in('status', [...ACTIVE_ORDER_STATUSES])
        .order('placed_at', { ascending: true }),
      supabase
        .from('orders')
        .select('*')
        .eq('status', 'delivered')
        .gte('placed_at', todayIso)
        .order('placed_at', { ascending: false }),
    ]);

    const firstError = activeOrdersResult.error || deliveredOrdersResult.error;
    if (firstError) {
      console.error('Failed to load chef orders', firstError);
      showToast(firstError.message || 'Failed to load kitchen orders', 'error');
    }

    const data = [...(activeOrdersResult.data || []), ...(deliveredOrdersResult.data || [])];

    if (data && data.length > 0) {
      const queueCount = data.filter((o) => o.status === 'pending' && !isAwaitingOnlinePayment(o) && !isAwaitingCounterPayment(o)).length;
      const paymentWaitingCount = data.filter((o) => isAwaitingCounterPayment(o) && !['cancelled', 'expired', 'delivered'].includes(o.status)).length;
      const hasNewQueueOrder = queueCount > prevQueueCountRef.current;
      const hasNewPaymentOrder = paymentWaitingCount > prevPaymentCountRef.current;

      if (!initialLoadRef.current && soundEnabled && (hasNewQueueOrder || hasNewPaymentOrder)) {
        playNewOrderAlert();
        setNewOrderFlash(true);
        setTab(hasNewQueueOrder ? 'queue' : 'payments');
        if (flashTimeoutRef.current) {
          clearTimeout(flashTimeoutRef.current);
        }
        flashTimeoutRef.current = setTimeout(() => setNewOrderFlash(false), 2000);
      }

      prevQueueCountRef.current = queueCount;
      prevPaymentCountRef.current = paymentWaitingCount;
      initialLoadRef.current = false;
      setOrders(data);

      const ids = data.map((o) => o.id);
      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', ids);

      if (itemsError) {
        console.error('Failed to load chef order items', itemsError);
        showToast(itemsError.message || 'Failed to load order items', 'error');
      }

      const map: Record<string, OrderItemRow[]> = {};
      (items || []).forEach((item) => {
        if (!map[item.order_id]) map[item.order_id] = [];
        map[item.order_id].push(item as OrderItemRow);
      });
      setOrderItemsMap(map);
    } else {
      initialLoadRef.current = false;
      prevQueueCountRef.current = 0;
      prevPaymentCountRef.current = 0;
      setOrders(data || []);
      setOrderItemsMap({});
    }
    setLoading(false);
  }, [showToast, soundEnabled]);

  const loadMenuItems = useCallback(async () => {
    const [categoriesResult, menuItemsResult] = await Promise.all([
      supabase
        .from('categories')
        .select('id, name, display_order')
        .order('display_order', { ascending: true }),
      supabase
        .from('menu_items')
        .select('id, name, price, is_available, category_id, display_order')
        .eq('is_available', true)
        .order('display_order', { ascending: true }),
    ]);

    if (categoriesResult.error) {
      console.error('Failed to load chef menu categories', categoriesResult.error);
      showToast(categoriesResult.error.message || 'Failed to load categories for extras', 'error');
    } else {
      setMenuCategories((categoriesResult.data || []) as ChefCategory[]);
    }

    if (menuItemsResult.error) {
      console.error('Failed to load chef menu items', menuItemsResult.error);
      showToast(menuItemsResult.error.message || 'Failed to load menu items for extras', 'error');
      return;
    }

    setMenuItems((menuItemsResult.data || []) as ChefMenuItem[]);
  }, [showToast]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      void loadOrders();
    }, CHEF_REFRESH_DEBOUNCE_MS);
  }, [loadOrders]);

  useEffect(() => {
    void loadOrders();
    void loadMenuItems();

    const channel = supabase
      .channel('chef-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        scheduleRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        scheduleRefresh();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          scheduleRefresh();
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleRefresh();
        }
      });

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadOrders();
      }
    };

    pollingIntervalRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        scheduleRefresh();
      }
    }, CHEF_POLL_INTERVAL_MS);

    document.addEventListener('visibilitychange', refreshIfVisible);
    window.addEventListener('focus', refreshIfVisible);
    window.addEventListener('online', refreshIfVisible);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      document.removeEventListener('visibilitychange', refreshIfVisible);
      window.removeEventListener('focus', refreshIfVisible);
      window.removeEventListener('online', refreshIfVisible);
      supabase.removeChannel(channel);
    };
  }, [loadOrders, loadMenuItems, scheduleRefresh]);

  async function acceptOrder(order: Order) {
    if (acceptingOrderId === order.id) return;
    setAcceptingOrderId(order.id);

    const items = orderItemsMap[order.id] || [];
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const estimatedMinutes = Math.max(5, Math.ceil(totalItems * 2.5));
    const now = new Date().toISOString();

    const { error } = await supabase.from('orders').update({
      status: 'preparing',
      confirmed_at: now,
      accepted_at: now,
      estimated_minutes: estimatedMinutes,
      queue_position: null,
    }).eq('id', order.id);

    if (error) {
      console.error('Failed to accept order', error);
      showToast(error.message || 'Failed to move order to preparing', 'error');
      setAcceptingOrderId(null);
      return;
    }

    try {
      setTab('preparing');
      showToast('Order moved to preparing');
      if (soundEnabled) playAcceptSound();
      await loadOrders();
    } finally {
      setAcceptingOrderId(null);
    }
  }

  async function completeOrder(order: Order) {
    if (completingOrderId === order.id) return;
    setCompletingOrderId(order.id);

    try {
      const result = await markOrderReady(order.order_id);
      showToast(getReadyOrderLabel(order) === 'Ready to Serve' ? 'Order marked ready to serve' : 'Order marked ready for pickup');

      if (soundEnabled) playOrderCompleteSound();
      await loadOrders();

      if (order.order_type === 'pickup' && result.readyEmailSent === false) {
        showToast('Order updated, but ready email failed', 'error');
      }
    } catch (error) {
      console.error('Failed to mark order complete', error);
      showToast('Failed to mark order complete', 'error');
    } finally {
      setCompletingOrderId(null);
    }
  }

  async function markPickedUp(order: Order) {
    if (handoffOrderId === order.id) return;
    setHandoffOrderId(order.id);

    const { error } = await supabase.from('orders').update({
      status: 'delivered',
    }).eq('id', order.id);

    if (error) {
      console.error('Failed to mark order as picked up', error);
      showToast('Failed to update pickup status', 'error');
      setHandoffOrderId(null);
      return;
    }

    try {
      const awaitingPaymentAfterHandoff = isAwaitingCounterPayment(order);
      setOrders((current) => current.map((currentOrder) => (
        currentOrder.id === order.id
          ? { ...currentOrder, status: 'delivered' }
          : currentOrder
      )));
      setTab(awaitingPaymentAfterHandoff ? 'pendingPayment' : 'done');
      showToast('Pickup marked successfully');
      await loadOrders();
    } finally {
      setHandoffOrderId(null);
    }
  }

  async function markPaymentCollected(
    order: Order,
    counterPaymentMethod: CounterPaymentMethod,
    cashReceivedAmount?: number,
    onlineReceivedAmount?: number,
  ) {
    if (payingOrderId === order.id) return;
    setPayingOrderId(order.id);

    try {
      const result = await markOrderPaid(order.order_id, {
        counterPaymentMethod,
        cashReceivedAmount,
        onlineReceivedAmount,
      });
      showToast(
        counterPaymentMethod === 'cash'
          ? 'Cash payment marked as paid'
          : counterPaymentMethod === 'split'
            ? 'Cash and UPI payment marked as paid'
            : 'Online payment marked as paid',
      );
      setPaymentDrafts((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      setOrders((current) => current.map((currentOrder) => (
        currentOrder.id === order.id
          ? getOptimisticPaidOrder(currentOrder, counterPaymentMethod, cashReceivedAmount, onlineReceivedAmount)
          : currentOrder
      )));
      if (order.status === 'delivered') {
        setTab('done');
      }
      setPayingOrderId(null);
      void loadOrders();

      if (result.receiptEmailSent === false) {
        showToast('Payment updated, but receipt email failed', 'error');
      }
    } catch (error) {
      console.error('Failed to mark payment as paid', error);
      showToast('Failed to mark payment as paid', 'error');
    } finally {
      setPayingOrderId(null);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/chef/login');
  }

  function copyOrderId(orderId: string) {
    navigator.clipboard.writeText(orderId);
    showToast('Order ID copied');
  }

  function updatePaymentDraft(order: Order, patch: Partial<PaymentDraft>) {
    setPaymentDrafts((current) => {
      const existing = current[order.id] || getDefaultPaymentDraft(order);

      return {
        ...current,
        [order.id]: {
          ...existing,
          ...patch,
        },
      };
    });
  }

  function getFirstExtraItemCategoryId() {
    const categoryIdsWithItems = new Set(menuItems.map((item) => item.category_id).filter(Boolean));
    return menuCategories.find((category) => categoryIdsWithItems.has(category.id))?.id ||
      menuItems[0]?.category_id ||
      '';
  }

  function getFirstMenuItemIdForCategory(categoryId: string) {
    return menuItems.find((item) => item.category_id === categoryId)?.id || '';
  }

  function getDefaultAddItemDraft(): AddItemDraft {
    const categoryId = getFirstExtraItemCategoryId();

    return {
      categoryId,
      menuItemId: getFirstMenuItemIdForCategory(categoryId) || menuItems[0]?.id || '',
      quantity: '1',
    };
  }

  function normalizeAddItemDraft(draft: Partial<AddItemDraft>): AddItemDraft {
    const selectedItem = menuItems.find((item) => item.id === draft.menuItemId);
    const categoryId = draft.categoryId || selectedItem?.category_id || getFirstExtraItemCategoryId();
    const categoryItems = categoryId
      ? menuItems.filter((item) => item.category_id === categoryId)
      : menuItems;
    const menuItemId = categoryItems.some((item) => item.id === draft.menuItemId)
      ? draft.menuItemId || ''
      : categoryItems[0]?.id || menuItems[0]?.id || '';

    return {
      categoryId,
      menuItemId,
      quantity: draft.quantity || '1',
    };
  }

  function updateAddItemDraft(order: Order, patch: Partial<AddItemDraft>) {
    setAddItemDrafts((current) => {
      const existing = current[order.id] || getDefaultAddItemDraft();
      const nextDraft = {
        ...existing,
        ...patch,
      };

      if (patch.categoryId && patch.categoryId !== existing.categoryId) {
        nextDraft.menuItemId = getFirstMenuItemIdForCategory(patch.categoryId);
      }

      return {
        ...current,
        [order.id]: normalizeAddItemDraft(nextDraft),
      };
    });
  }

  function openAddItemPanel(order: Order) {
    setActiveAddItemOrderId(order.id);
    updateAddItemDraft(order, addItemDrafts[order.id] || getDefaultAddItemDraft());
  }

  async function addItemToOrder(order: Order) {
    if (addingItemOrderId === order.id) return;

    const draft = normalizeAddItemDraft(addItemDrafts[order.id] || getDefaultAddItemDraft());
    const selectedItem = menuItems.find((item) => item.id === draft.menuItemId);
    const quantity = Math.max(1, Number.parseInt(draft.quantity || '1', 10) || 1);

    if (!selectedItem) {
      showToast('Choose an item to add', 'error');
      return;
    }

    setAddingItemOrderId(order.id);

    const { data, error } = await supabase.rpc('add_staff_order_item', {
      p_order_id: order.id,
      p_menu_item_id: selectedItem.id,
      p_quantity: quantity,
    });

    if (error) {
      console.error('Failed to add item to order', error);
      const missingRpc = error.code === 'PGRST202' || error.message?.includes('add_staff_order_item');
      showToast(
        missingRpc
          ? 'Run the latest Supabase migration before adding extras to orders'
          : error.message || 'Failed to add item to order',
        'error',
      );
      setAddingItemOrderId(null);
      return;
    }

    try {
      const result = data as { lineTotal?: number; paymentStatus?: string } | null;
      const addedAmount = Number(result?.lineTotal || 0);
      const reopenedPayment = result?.paymentStatus === 'pending' && order.payment_status === 'paid' && addedAmount > 0;

      showToast(reopenedPayment ? 'Item added. Collect the remaining payment.' : 'Item added to order');
      setActiveAddItemOrderId(null);
      setAddItemDrafts((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      await loadOrders();
    } finally {
      setAddingItemOrderId(null);
    }
  }

  const activePaymentOrders = orders.filter((o) => isAwaitingCounterPayment(o) && !['cancelled', 'expired', 'delivered'].includes(o.status));
  const collectFirstPaymentOrders = activePaymentOrders.filter((o) => o.status === 'pending');
  const afterDiningPaymentOrders = activePaymentOrders.filter((o) => o.status !== 'pending');
  const pendingPaymentOrders = orders
    .filter((o) => isAwaitingCounterPayment(o) && o.status === 'delivered')
    .sort((a, b) => getDoneOrderTime(b) - getDoneOrderTime(a));
  const filteredPaymentOrders = paymentCategory === 'before'
    ? collectFirstPaymentOrders
    : paymentCategory === 'after'
      ? afterDiningPaymentOrders
      : activePaymentOrders;
  const paymentCategoryOptions: { key: PaymentCategory; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: activePaymentOrders.length },
    { key: 'before', label: 'Collect First', count: collectFirstPaymentOrders.length },
    { key: 'after', label: 'After Dining', count: afterDiningPaymentOrders.length },
  ];
  const queueOrders = orders.filter((o) => o.status === 'pending' && !isAwaitingOnlinePayment(o) && !isAwaitingCounterPayment(o));
  const preparingOrders = orders.filter((o) => o.status === 'preparing' || o.status === 'confirmed');
  const doneOrders = orders.filter((o) => o.status === 'packed' || o.status === 'delivered');
  const todayDone = doneOrders
    .filter((o) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(o.placed_at) >= today;
    })
    .sort((a, b) => getDoneOrderTime(b) - getDoneOrderTime(a));
  const settledDoneOrders = todayDone.filter((o) => !(o.status === 'delivered' && isAwaitingCounterPayment(o)));

  const tabs: { key: Tab; label: string; count: number; icon: typeof Clock }[] = [
    { key: 'payments', label: 'Pay', count: activePaymentOrders.length, icon: Wallet },
    { key: 'queue', label: 'Queue', count: queueOrders.length, icon: Users },
    { key: 'preparing', label: 'Making', count: preparingOrders.length, icon: Flame },
    { key: 'pendingPayment', label: 'Due', count: pendingPaymentOrders.length, icon: Wallet },
    { key: 'done', label: 'Done', count: settledDoneOrders.length, icon: Check },
  ];

  const displayOrders = tab === 'payments'
    ? filteredPaymentOrders
    : tab === 'queue'
      ? queueOrders
      : tab === 'preparing'
        ? preparingOrders
        : tab === 'pendingPayment'
          ? pendingPaymentOrders
          : settledDoneOrders;
  const extraItemCategories = getExtraItemCategories(menuCategories, menuItems);
  const paymentEmptyTitle = activePaymentOrders.length === 0
    ? 'No counter payments waiting'
    : paymentCategory === 'before'
      ? 'No collect-first payments'
      : paymentCategory === 'after'
        ? 'No after-dining payments'
        : 'No payments in this category';

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-brand-text-dim text-sm font-medium">Loading kitchen...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <header className={`sticky top-0 z-50 border-b border-brand-border px-4 py-3 transition-colors duration-300 ${
        newOrderFlash ? 'bg-orange-500/20' : 'bg-brand-surface'
      }`}>
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
              newOrderFlash
                ? 'bg-orange-500 animate-bounce-subtle'
                : 'bg-orange-500/10 border border-orange-500/20'
            }`}>
              <ChefHat size={20} className={newOrderFlash ? 'text-white' : 'text-orange-400'} />
            </div>
            <div>
              <h1 className="font-bold text-[15px] text-white leading-tight">Kitchen</h1>
              <p className="text-[11px] text-brand-text-dim font-medium">The Supreme Waffle</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab('newOrder')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-bold transition-all ${
                tab === 'newOrder'
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                  : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
              }`}
            >
              <PlusCircle size={16} />
              <span className="hidden sm:inline">New Order</span>
            </button>
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg transition-colors ${
                soundEnabled ? 'text-orange-400 bg-orange-500/10' : 'text-brand-text-dim hover:bg-brand-surface-light/60'
              }`}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button
              onClick={handleSignOut}
              className="p-2 text-brand-text-dim hover:text-orange-400 transition-colors rounded-lg hover:bg-brand-surface-light/60"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {tab === 'newOrder' ? (
        <div className="max-w-5xl mx-auto flex flex-col" style={{ minHeight: 'calc(100vh - 57px)' }}>
          <ChefNewOrder
            onClose={() => setTab('queue')}
            onOrderCreated={(orderId) => {
              showToast(`Order ${orderId} created — now in queue`);
              setTab('queue');
              void loadOrders();
            }}
          />
        </div>
      ) : (
        <>
          <div className="sticky top-[57px] z-40 bg-brand-bg/95 backdrop-blur-sm border-b border-brand-border">
            <div className="max-w-5xl mx-auto px-4 py-2">
              <div className="grid grid-cols-5 gap-2 mb-2">
                <StatCard label="Pay" value={activePaymentOrders.length} color="rose" />
                <StatCard label="Queue" value={queueOrders.length} color="orange" />
                <StatCard label="Making" value={preparingOrders.length} color="amber" />
                <StatCard label="Ready" value={doneOrders.filter(o => o.status === 'packed').length} color="emerald" />
                <StatCard label="Done" value={settledDoneOrders.filter(o => o.status === 'delivered').length} color="blue" />
              </div>
              <div className="grid grid-cols-5 gap-2">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-bold transition-all ${
                      tab === t.key
                        ? t.key === 'payments' || t.key === 'pendingPayment'
                          ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'
                          : t.key === 'queue'
                          ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                          : t.key === 'preparing'
                          ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                          : 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                        : 'bg-brand-surface text-brand-text-dim border border-brand-border'
                    }`}
                  >
                    <t.icon size={14} />
                    <span className="hidden sm:inline">{t.label}</span>
                    <span className="sm:hidden">{t.label.slice(0, 4)}</span>
                    {t.count > 0 && (
                      <span className={`min-w-[18px] h-4 flex items-center justify-center rounded-full text-[10px] font-black px-1 ${
                        tab === t.key ? 'bg-black/20' : 'bg-brand-surface-light'
                      }`}>
                        {t.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <main className="max-w-5xl mx-auto px-4 py-4 pb-20 space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 lg:items-start">
            {tab === 'payments' && activePaymentOrders.length > 0 && (
              <div className="grid grid-cols-3 gap-2 lg:col-span-2">
                {paymentCategoryOptions.map((category) => (
                  <button
                    key={category.key}
                    onClick={() => setPaymentCategory(category.key)}
                    className={`rounded-xl border px-2 py-2 text-[12px] font-bold transition-colors ${
                      paymentCategory === category.key
                        ? 'border-rose-400 bg-rose-500 text-white'
                        : 'border-brand-border bg-brand-surface text-brand-text-muted hover:border-rose-400/40'
                    }`}
                  >
                    <span className="block leading-tight">{category.label}</span>
                    <span className={`mt-1 inline-flex min-w-[22px] justify-center rounded-full px-1.5 py-0.5 text-[11px] ${
                      paymentCategory === category.key ? 'bg-black/20' : 'bg-brand-surface-light'
                    }`}>
                      {category.count}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {displayOrders.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center lg:col-span-2">
            <div className="w-16 h-16 bg-brand-surface rounded-2xl flex items-center justify-center mb-4">
              {tab === 'payments' || tab === 'pendingPayment' ? <Wallet size={28} className="text-brand-text-dim" /> :
               tab === 'queue' ? <Users size={28} className="text-brand-text-dim" /> :
               tab === 'preparing' ? <Flame size={28} className="text-brand-text-dim" /> :
               <Check size={28} className="text-brand-text-dim" />}
            </div>
            <p className="text-brand-text-muted font-semibold">
              {tab === 'payments' ? paymentEmptyTitle :
               tab === 'pendingPayment' ? 'No done orders waiting for payment' :
               tab === 'queue' ? 'No orders in queue' :
               tab === 'preparing' ? 'No orders being prepared' :
               'No completed orders today'}
            </p>
            {tab === 'payments' && (
              <p className="text-brand-text-dim text-[12px] mt-1">
                {activePaymentOrders.length === 0
                  ? 'Counter cash and UPI orders will appear here until marked paid'
                  : 'Switch payment category to view another group'}
              </p>
            )}
            {tab === 'pendingPayment' && (
              <p className="text-brand-text-dim text-[12px] mt-1">
                Orders marked served or picked up with an amount due will stay here until payment is collected
              </p>
            )}
            {tab === 'queue' && (
              <p className="text-brand-text-dim text-[12px] mt-1">
                New orders will appear here with a sound alert
              </p>
            )}
            </div>
            )}

            {displayOrders.map((order, idx) => {
          const items = orderItemsMap[order.id] || [];
          const isPaymentPending = isAwaitingCounterPayment(order);
          const isQueue = order.status === 'pending' && !isPaymentPending;
          const isPreparing = order.status === 'preparing' || order.status === 'confirmed';
          const isReady = order.status === 'packed';
          const canAddItems = !['cancelled', 'expired', 'delivered'].includes(order.status);
          const canStartBeforePayment = isPaymentPending && order.status === 'pending' && isDineInOrder(order);
          const totalQty = items.reduce((s, i) => s + i.quantity, 0);
          const paymentDraft = paymentDrafts[order.id] || getDefaultPaymentDraft(order);
          const addItemDraft = normalizeAddItemDraft(addItemDrafts[order.id] || getDefaultAddItemDraft());
          const categoryMenuItems = addItemDraft.categoryId
            ? menuItems.filter((item) => item.category_id === addItemDraft.categoryId)
            : menuItems;
          const selectedAddMenuItem = categoryMenuItems.find((item) => item.id === addItemDraft.menuItemId);
          const addItemQuantity = Math.max(1, Number.parseInt(addItemDraft.quantity || '1', 10) || 1);
          const addItemLineTotal = selectedAddMenuItem ? roundCurrency(Number(selectedAddMenuItem.price || 0) * addItemQuantity) : 0;
          const paidAmount = getOrderPaidAmount(order);
          const totalDue = getOrderAmountDue(order);
          const hasPartialPayment = paidAmount > 0 && totalDue > 0;
          const hasCashInput = paymentDraft.cashReceived.trim().length > 0;
          const hasOnlineInput = paymentDraft.onlineReceived.trim().length > 0;
          const enteredCashAmount = Number(paymentDraft.cashReceived);
          const enteredOnlineAmount = Number(paymentDraft.onlineReceived);
          const hasValidCashAmount = Number.isFinite(enteredCashAmount);
          const hasValidOnlineAmount = Number.isFinite(enteredOnlineAmount);
          const roundedEnteredCashAmount = hasValidCashAmount ? roundCurrency(enteredCashAmount) : 0;
          const roundedEnteredOnlineAmount = hasValidOnlineAmount ? roundCurrency(enteredOnlineAmount) : 0;
          const remainingCash = Math.max(0, roundCurrency(totalDue - roundedEnteredCashAmount));
          const changeDue = Math.max(0, roundCurrency(roundedEnteredCashAmount - totalDue));
          const splitReceivedTotal = roundCurrency(roundedEnteredCashAmount + roundedEnteredOnlineAmount);
          const remainingSplit = Math.max(0, roundCurrency(totalDue - splitReceivedTotal));
          const splitOverage = Math.max(0, roundCurrency(splitReceivedTotal - totalDue));
          const canMarkCashPaid = totalDue <= 0 || (hasCashInput && hasValidCashAmount && roundedEnteredCashAmount >= totalDue);
          const canMarkSplitPaid = totalDue <= 0 || (
            hasCashInput &&
            hasOnlineInput &&
            hasValidCashAmount &&
            hasValidOnlineAmount &&
            roundedEnteredCashAmount > 0 &&
            roundedEnteredOnlineAmount > 0 &&
            splitReceivedTotal >= totalDue
          );

          return (
            <div
              key={order.id}
              className={`rounded-2xl border p-4 transition-all animate-fade-in ${
                isPaymentPending
                  ? 'bg-brand-surface border-rose-500/30 shadow-lg shadow-rose-500/5'
                  : isQueue
                  ? 'bg-brand-surface border-orange-500/30 shadow-lg shadow-orange-500/5'
                  : isPreparing
                  ? 'bg-brand-surface border-amber-500/20'
                  : isReady
                  ? 'bg-emerald-500/5 border-emerald-500/30'
                  : 'bg-brand-surface border-brand-border opacity-70'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isQueue && (
                      <span className="w-7 h-7 bg-orange-500 text-white rounded-lg flex items-center justify-center text-[12px] font-black">
                        #{idx + 1}
                      </span>
                    )}
                    {isPaymentPending && (
                      <span className="w-7 h-7 bg-rose-500 text-white rounded-lg flex items-center justify-center">
                        <Wallet size={14} />
                      </span>
                    )}
                    {isPreparing && (
                      <span className="w-7 h-7 bg-amber-500/20 text-amber-400 rounded-lg flex items-center justify-center">
                        <Flame size={14} />
                      </span>
                    )}
                    <span className="font-black text-xl text-white">{order.order_id}</span>
                    <button
                      onClick={() => copyOrderId(order.order_id)}
                      className="p-1.5 rounded-lg text-brand-text-dim hover:text-brand-gold hover:bg-brand-surface-light/60 transition-colors"
                      aria-label={`Copy order ID ${order.order_id}`}
                    >
                      <Copy size={14} />
                    </button>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                      isPaymentPending ? 'bg-rose-500/10 text-rose-400' :
                      isQueue ? 'bg-orange-500/10 text-orange-400' :
                      isPreparing ? 'bg-amber-500/10 text-amber-400' :
                      isReady ? 'bg-emerald-500/10 text-emerald-400' :
                      'bg-brand-text-dim/10 text-brand-text-dim'
                    }`}>
                      {isPaymentPending ? 'Payment Pending' : isQueue ? 'In Queue' : isPreparing ? 'Preparing' : isReady ? getReadyOrderLabel(order) : getCompletedOrderLabel(order)}
                    </span>
                  </div>
                  <p className="text-[13px] text-brand-text-dim mt-1">
                    {order.customer_name} -- {getTimeAgo(order.placed_at)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="font-bold text-brand-gold text-lg tabular-nums">{'\u20B9'}{order.total}</span>
                  {hasPartialPayment && (
                    <p className="text-[11px] font-semibold text-rose-300">
                      Due {'\u20B9'}{formatMoney(totalDue)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3 text-[12px] flex-wrap">
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg font-bold uppercase tracking-wider ${
                  order.order_type === 'pickup'
                    ? 'bg-brand-gold/10 text-brand-gold'
                    : 'bg-sky-500/10 text-sky-400'
                }`}>
                  {order.order_type === 'pickup' ? <Store size={12} /> : <Truck size={12} />}
                  {getServiceModeLabel(order)}
                </span>
                <span className="text-brand-text-dim">{totalQty} item{totalQty !== 1 ? 's' : ''}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg font-bold ${
                  order.payment_status === 'paid'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : isPaymentPending
                      ? 'bg-rose-500/10 text-rose-400'
                      : 'bg-red-500/10 text-red-400'
                }`}>
                  {order.payment_status === 'paid' ? <BadgeCheck size={12} /> : <Wallet size={12} />}
                  {order.payment_status === 'paid'
                    ? getCounterPaymentBadgeLabel(order)
                    : order.payment_method === 'upi' ? 'UPI Pending' : 'Cash Pending'}
                </span>
                {isPaymentPending && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/10 text-rose-300 font-bold">
                    {getPaymentCategoryLabel(order)}
                  </span>
                )}
              </div>

              {order.order_type === 'delivery' && order.address && (
                <div className="flex items-start gap-2 mb-3 bg-sky-500/5 border border-sky-500/15 rounded-xl px-3 py-2.5">
                  <MapPin size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[12px] text-brand-text-muted leading-snug flex-1">{order.address}</p>
                  <a
                    href={
                      order.delivery_lat != null && order.delivery_lng != null
                        ? `https://www.google.com/maps/dir/?api=1&destination=${order.delivery_lat},${order.delivery_lng}`
                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 rounded-lg text-[11px] font-bold transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Navigation size={11} />
                    Navigate
                  </a>
                </div>
              )}

              {isPaymentPending && (
                <div className="rounded-xl border-2 border-rose-500/20 bg-rose-500/5 p-3 mb-3">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-2">
                      <Wallet size={16} className="text-rose-400" />
                      <div>
                        <p className="text-[13px] font-bold text-rose-400">
                          {getPendingPaymentLabel(order)}
                        </p>
                        <p className="text-[11px] text-brand-text-dim">
                          Choose how this order was paid, then confirm it here. -- {order.order_id} -- Due {'\u20B9'}{formatMoney(totalDue)}
                        </p>
                        {hasPartialPayment && (
                          <p className="text-[11px] text-brand-text-dim">
                            Already paid {'\u20B9'}{formatMoney(paidAmount)} of {'\u20B9'}{formatMoney(order.total)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => updatePaymentDraft(order, {
                          method: 'cash',
                          cashReceived: paymentDraft.cashReceived || getDefaultCashReceived(order),
                          onlineReceived: '',
                        })}
                        className={`px-3 py-2 rounded-lg border text-[12px] font-bold transition-colors ${
                          paymentDraft.method === 'cash'
                            ? 'border-emerald-400 bg-emerald-500 text-white'
                            : 'border-rose-500/20 bg-brand-surface text-brand-text-muted hover:border-rose-400/40'
                        }`}
                      >
                        Hand Cash
                      </button>
                      <button
                        onClick={() => updatePaymentDraft(order, {
                          method: 'online',
                          cashReceived: '',
                          onlineReceived: formatMoney(totalDue),
                        })}
                        className={`px-3 py-2 rounded-lg border text-[12px] font-bold transition-colors ${
                          paymentDraft.method === 'online'
                            ? 'border-sky-400 bg-sky-500 text-white'
                            : 'border-rose-500/20 bg-brand-surface text-brand-text-muted hover:border-rose-400/40'
                        }`}
                      >
                        UPI
                      </button>
                      <button
                        onClick={() => updatePaymentDraft(order, {
                          method: 'split',
                          cashReceived: '',
                          onlineReceived: '',
                        })}
                        className={`px-3 py-2 rounded-lg border text-[12px] font-bold transition-colors ${
                          paymentDraft.method === 'split'
                            ? 'border-brand-gold bg-brand-gold text-brand-bg'
                            : 'border-rose-500/20 bg-brand-surface text-brand-text-muted hover:border-rose-400/40'
                        }`}
                      >
                        Cash + UPI
                      </button>
                    </div>

                    {paymentDraft.method === 'cash' && (
                      <div className="rounded-lg border border-rose-500/20 bg-brand-surface/70 p-3 space-y-2">
                        <label className="block">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-text-dim">
                            Cash Received
                          </span>
                          <input
                            type="number"
                            min={totalDue > 0 ? totalDue : 0}
                            step="0.01"
                            value={paymentDraft.cashReceived}
                            onChange={(event) => updatePaymentDraft(order, { cashReceived: event.target.value })}
                            placeholder={`₹${formatMoney(totalDue)}`}
                            className="mt-1.5 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-white outline-none transition-colors focus:border-emerald-400"
                          />
                        </label>
                        <div className="flex items-center justify-between text-[11px] text-brand-text-dim">
                          <span>Total due</span>
                          <span className="font-semibold text-white">{'\u20B9'}{formatMoney(totalDue)}</span>
                        </div>
                        {hasCashInput && (
                          <p className={`text-[11px] font-semibold ${
                            remainingCash > 0 ? 'text-rose-300' : 'text-emerald-300'
                          }`}>
                            {remainingCash > 0
                              ? `Need ₹${formatMoney(remainingCash)} more`
                              : changeDue > 0
                                ? `Return ₹${formatMoney(changeDue)} change`
                                : 'Exact cash received'}
                          </p>
                        )}
                      </div>
                    )}

                    {paymentDraft.method === 'online' && (
                      <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2">
                        <p className="text-[11px] text-sky-200">
                          Use this when the customer has already paid by UPI or another online counter payment.
                        </p>
                      </div>
                    )}

                    {paymentDraft.method === 'split' && (
                      <div className="rounded-lg border border-brand-gold/20 bg-brand-surface/70 p-3 space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-text-dim">
                              Cash
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={paymentDraft.cashReceived}
                              onChange={(event) => updatePaymentDraft(order, { cashReceived: event.target.value })}
                              placeholder="0"
                              className="mt-1.5 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-white outline-none transition-colors focus:border-emerald-400"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-text-dim">
                              UPI
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={paymentDraft.onlineReceived}
                              onChange={(event) => updatePaymentDraft(order, { onlineReceived: event.target.value })}
                              placeholder="0"
                              className="mt-1.5 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-white outline-none transition-colors focus:border-sky-400"
                            />
                          </label>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-brand-text-dim">
                          <span>Total due</span>
                          <span className="font-semibold text-white">{'\u20B9'}{formatMoney(totalDue)}</span>
                        </div>
                        {(hasCashInput || hasOnlineInput) && (
                          <p className={`text-[11px] font-semibold ${
                            remainingSplit > 0 ? 'text-rose-300' : 'text-emerald-300'
                          }`}>
                            {remainingSplit > 0
                              ? `Need ₹${formatMoney(remainingSplit)} more`
                              : splitOverage > 0
                                ? `Collected ₹${formatMoney(splitOverage)} extra`
                                : 'Cash and UPI cover this bill'}
                          </p>
                        )}
                      </div>
                    )}

                    {canStartBeforePayment && (
                      <button
                        onClick={() => acceptOrder(order)}
                        disabled={acceptingOrderId === order.id}
                        className="w-full px-3 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-[12px] font-bold hover:bg-amber-500/20 transition-colors active:scale-95 flex items-center justify-center gap-1 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Zap size={12} />
                        {acceptingOrderId === order.id ? 'Starting...' : 'Start Preparing, Collect Later'}
                      </button>
                    )}

                    <button
                      onClick={() => markPaymentCollected(
                        order,
                        paymentDraft.method,
                        (paymentDraft.method === 'cash' || paymentDraft.method === 'split') && hasValidCashAmount
                          ? roundedEnteredCashAmount
                          : undefined,
                        paymentDraft.method === 'split' && hasValidOnlineAmount
                          ? roundedEnteredOnlineAmount
                          : paymentDraft.method === 'online'
                            ? totalDue
                            : undefined,
                      )}
                      disabled={
                        payingOrderId === order.id ||
                        (paymentDraft.method === 'cash' && !canMarkCashPaid) ||
                        (paymentDraft.method === 'split' && !canMarkSplitPaid)
                      }
                      className="w-full px-3 py-2.5 rounded-lg bg-emerald-500 text-white text-[12px] font-bold hover:bg-emerald-600 transition-colors active:scale-95 flex items-center justify-center gap-1 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Check size={12} />
                      {payingOrderId === order.id
                        ? 'Marking...'
                        : paymentDraft.method === 'cash'
                          ? 'Mark Cash Paid'
                          : paymentDraft.method === 'split'
                            ? 'Mark Cash + UPI Paid'
                            : 'Mark UPI Paid'}
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-brand-text-dim">
                    {canStartBeforePayment
                      ? 'For dine-in, you can start preparing now and collect payment after serving.'
                      : order.status === 'pending'
                      ? 'After payment is marked, this order moves into the chef queue.'
                      : 'After payment is marked, this order stays in its current kitchen stage.'}
                  </p>
                </div>
              )}

              {order.payment_status !== 'paid' && !isPaymentPending && (isQueue || isPreparing || isReady) && (
                <div className="rounded-xl border-2 border-red-500/20 bg-red-500/5 p-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Wallet size={16} className="text-red-400" />
                    <div>
                      <p className="text-[13px] font-bold text-red-400">
                        {order.payment_method === 'upi' ? 'UPI Payment Pending' : 'Cash Pending'}
                      </p>
                      <p className="text-[11px] text-brand-text-dim">
                        {order.payment_method === 'upi'
                          ? 'Payment still needs confirmation in the payments panel'
                          : 'Cash still needs to be collected in the payments panel'} -- Due {'\u20B9'}{formatMoney(totalDue)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {items.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {items.map((item) => (
                    <div key={item.id} className="bg-brand-surface-light/60 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between text-[13px]">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 bg-brand-gold/20 rounded-md flex items-center justify-center text-[11px] font-black text-brand-gold tabular-nums shrink-0">
                            {item.quantity}x
                          </span>
                          <span className="text-white font-semibold">{item.item_name}</span>
                        </div>
                        <span className="text-brand-text-dim text-[12px] tabular-nums">{'\u20B9'}{Number(item.unit_price) * item.quantity}</span>
                      </div>
                      {item.customizations && item.customizations.length > 0 && (
                        <div className="mt-1.5 ml-8 space-y-0.5">
                          {item.customizations.map((c, i) => (
                            <p key={i} className="text-[11px] text-brand-text-dim">
                              {c.group_name}: <span className="text-brand-text-muted">{c.option_name}</span>
                              {c.price > 0 && <span className="text-brand-gold ml-1">(+{'\u20B9'}{c.price})</span>}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-brand-surface-light/60 rounded-lg px-3 py-3 mb-3 text-center">
                  <p className="text-[12px] text-brand-text-dim">Loading items...</p>
                </div>
              )}

              {canAddItems && (
                <div className="mb-3">
                  {activeAddItemOrderId === order.id ? (
                    <div className="rounded-xl border border-brand-gold/20 bg-brand-gold/5 p-3 space-y-3">
                      <div className="space-y-2">
                        <label className="block">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-text-dim">
                            Category
                          </span>
                          <select
                            value={addItemDraft.categoryId}
                            onChange={(event) => updateAddItemDraft(order, { categoryId: event.target.value })}
                            disabled={extraItemCategories.length === 0}
                            className="mt-1.5 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-white outline-none transition-colors focus:border-brand-gold disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {extraItemCategories.length === 0 ? (
                              <option value="">No categories available</option>
                            ) : (
                              extraItemCategories.map((category) => (
                                <option key={category.id} value={category.id}>
                                  {category.name}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                        <div className="grid grid-cols-[1fr_76px] gap-2">
                          <label className="block min-w-0">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-text-dim">
                              Extra item
                            </span>
                            <select
                              value={addItemDraft.menuItemId}
                              onChange={(event) => updateAddItemDraft(order, { menuItemId: event.target.value })}
                              disabled={categoryMenuItems.length === 0}
                              className="mt-1.5 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-white outline-none transition-colors focus:border-brand-gold disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {categoryMenuItems.length === 0 ? (
                                <option value="">No items in category</option>
                              ) : (
                                categoryMenuItems.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.name} - {'\u20B9'}{formatMoney(Number(item.price || 0))}
                                  </option>
                                ))
                              )}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-text-dim">
                              Qty
                            </span>
                            <input
                              type="number"
                              min="1"
                              max="99"
                              value={addItemDraft.quantity}
                              onChange={(event) => updateAddItemDraft(order, { quantity: event.target.value })}
                              className="mt-1.5 w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-white outline-none transition-colors focus:border-brand-gold"
                            />
                          </label>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="text-brand-text-dim">
                          Adds {'\u20B9'}{formatMoney(addItemLineTotal)} to this order
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setActiveAddItemOrderId(null)}
                            className="rounded-lg border border-brand-border px-3 py-1.5 font-bold text-brand-text-muted transition-colors hover:border-red-500/30 hover:text-red-300"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => addItemToOrder(order)}
                            disabled={!selectedAddMenuItem || addingItemOrderId === order.id}
                            className="rounded-lg bg-brand-gold px-3 py-1.5 font-bold text-brand-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {addingItemOrderId === order.id ? 'Adding...' : 'Add'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => openAddItemPanel(order)}
                      disabled={menuItems.length === 0}
                      className="w-full rounded-xl border border-dashed border-brand-gold/30 bg-brand-gold/5 px-3 py-2.5 text-[12px] font-bold text-brand-gold transition-colors hover:bg-brand-gold/10 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-1.5"
                    >
                      <Plus size={14} />
                      Add Extra Item
                    </button>
                  )}
                </div>
              )}

              {isPreparing && order.accepted_at && order.estimated_minutes && (
                <PrepTimer acceptedAt={order.accepted_at} estimatedMinutes={order.estimated_minutes} />
              )}

              {isQueue && (
                <button
                  onClick={() => acceptOrder(order)}
                  disabled={acceptingOrderId === order.id}
                  className="w-full mt-2 py-3.5 rounded-xl font-bold text-[14px] bg-orange-500 text-white hover:bg-orange-600 transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
                >
                  <Zap size={18} />
                  {acceptingOrderId === order.id ? 'Starting...' : 'Accept & Start Preparing'}
                </button>
              )}

              {isPreparing && (
                <button
                  onClick={() => completeOrder(order)}
                  disabled={completingOrderId === order.id}
                  className="w-full mt-2 py-3.5 rounded-xl font-bold text-[14px] bg-emerald-500 text-white hover:bg-emerald-600 transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Package size={18} />
                  {completingOrderId === order.id ? 'Updating...' : 'Mark Complete'}
                </button>
              )}

              {isReady && (
                <button
                  onClick={() => markPickedUp(order)}
                  disabled={handoffOrderId === order.id}
                  className="w-full mt-2 py-3.5 rounded-xl font-bold text-[14px] bg-brand-gold text-brand-bg hover:brightness-110 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Check size={18} />
                  {handoffOrderId === order.id
                    ? 'Updating...'
                    : getCompletedOrderLabel(order) === 'Served' ? 'Mark Served' : 'Customer Picked Up'}
                </button>
              )}
            </div>
          );
        })}
      </main>

      {activePaymentOrders.length > 0 && tab !== 'payments' && tab !== 'newOrder' && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
          <button
            onClick={() => setTab('payments')}
            className="flex items-center gap-2 bg-rose-500 text-white px-5 py-3 rounded-full font-bold text-[14px] shadow-elevated shadow-rose-500/30 hover:bg-rose-600 transition-all active:scale-95"
          >
            <Wallet size={16} />
            {activePaymentOrders.length} payment{activePaymentOrders.length !== 1 ? 's' : ''} waiting
          </button>
        </div>
      )}

      {queueOrders.length > 0 && tab !== 'queue' && tab !== 'newOrder' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
          <button
            onClick={() => setTab('queue')}
            className="flex items-center gap-2 bg-orange-500 text-white px-5 py-3 rounded-full font-bold text-[14px] shadow-elevated shadow-orange-500/30 hover:bg-orange-600 transition-all active:scale-95"
          >
            <Bell size={16} className="animate-bounce" />
            {queueOrders.length} order{queueOrders.length !== 1 ? 's' : ''} waiting
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };

  return (
    <div className={`rounded-xl border px-3 py-2 text-center ${colorMap[color]}`}>
      <p className="text-lg font-black tabular-nums">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
    </div>
  );
}

function getTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function getDoneOrderTime(order: Order) {
  return new Date(order.completed_at || order.placed_at).getTime();
}

function getDefaultCounterPaymentMethod(order: Order): CounterPaymentMethod {
  if (order.counter_payment_method === 'split') return 'split';
  if (order.counter_payment_method === 'online' || order.counter_payment_method === 'cash') {
    return order.counter_payment_method;
  }
  return order.payment_method === 'upi' ? 'online' : 'cash';
}

function getDefaultPaymentDraft(order: Order): PaymentDraft {
  const method = getDefaultCounterPaymentMethod(order);
  const amountDue = getOrderAmountDue(order);

  return {
    method,
    cashReceived: method === 'cash' ? formatMoney(amountDue) : '',
    onlineReceived: method === 'online' ? formatMoney(amountDue) : '',
  };
}

function getOptimisticPaidOrder(
  order: Order,
  counterPaymentMethod: CounterPaymentMethod,
  cashReceivedAmount?: number,
  onlineReceivedAmount?: number,
): Order {
  const amountDue = getOrderAmountDue(order);
  const cashDelta = counterPaymentMethod === 'cash' || counterPaymentMethod === 'split'
    ? Number(cashReceivedAmount ?? (counterPaymentMethod === 'cash' ? amountDue : 0))
    : 0;
  const onlineDelta = counterPaymentMethod === 'online'
    ? Number(onlineReceivedAmount ?? amountDue)
    : counterPaymentMethod === 'split'
      ? Number(onlineReceivedAmount ?? 0)
      : 0;
  const nextCashAmount = roundCurrency(Number(order.cash_received_amount ?? 0) + cashDelta);
  const nextOnlineAmount = roundCurrency(Number(order.online_received_amount ?? 0) + onlineDelta);
  const resolvedCounterPaymentMethod: CounterPaymentMethod = nextCashAmount > 0 && nextOnlineAmount > 0
    ? 'split'
    : nextOnlineAmount > 0
      ? 'online'
      : 'cash';

  return {
    ...order,
    payment_status: 'paid',
    payment_provider: null,
    payment_method: resolvedCounterPaymentMethod === 'cash' ? 'cod' : 'upi',
    payment_verified_at: new Date().toISOString(),
    counter_payment_method: resolvedCounterPaymentMethod,
    cash_received_amount: nextCashAmount > 0 ? nextCashAmount : null,
    online_received_amount: nextOnlineAmount > 0 ? nextOnlineAmount : null,
    paid_amount: roundCurrency(Number(order.total || 0)),
  };
}

function getDefaultCashReceived(order: Order) {
  const amountDue = getOrderAmountDue(order);
  return amountDue > 0 ? formatMoney(amountDue) : '';
}

function getOrderPaidAmount(order: Order) {
  const total = roundCurrency(Number(order.total || 0));
  const explicitPaidAmount = Number(order.paid_amount ?? 0);

  if (Number.isFinite(explicitPaidAmount) && explicitPaidAmount > 0) {
    return Math.min(total, roundCurrency(explicitPaidAmount));
  }

  return order.payment_status === 'paid' ? total : 0;
}

function getOrderAmountDue(order: Order) {
  return Math.max(0, roundCurrency(Number(order.total || 0) - getOrderPaidAmount(order)));
}

function getCounterPaymentBadgeLabel(order: Order) {
  if (order.counter_payment_method === 'split') return 'Cash + UPI Paid';
  if (order.counter_payment_method === 'online') return 'UPI Paid';
  if (order.counter_payment_method === 'cash') return 'Cash Paid';
  return 'Paid';
}

function getPaymentCategoryLabel(order: Order) {
  if (order.status === 'pending') {
    return isDineInOrder(order) ? 'Collect first or later' : 'Collect first';
  }

  return isDineInOrder(order) ? 'Collect after dining' : 'Collect remaining';
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMoney(value: number) {
  const rounded = roundCurrency(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function PrepTimer({ acceptedAt, estimatedMinutes }: { acceptedAt: string; estimatedMinutes: number }) {
  const [remaining, setRemaining] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const readyAt = new Date(acceptedAt).getTime() + estimatedMinutes * 60_000;

    function tick() {
      const left = Math.max(0, Math.floor((readyAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && intervalRef.current) clearInterval(intervalRef.current);
    }

    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [acceptedAt, estimatedMinutes]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const totalSecs = estimatedMinutes * 60;
  const elapsed = totalSecs - remaining;
  const progress = Math.min(100, (elapsed / totalSecs) * 100);

  return (
    <div className={`rounded-xl p-3 mb-2 border ${
      remaining <= 0
        ? 'bg-red-500/5 border-red-500/20'
        : 'bg-amber-500/5 border-amber-500/10'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`flex items-center gap-1.5 text-[12px] font-semibold ${
          remaining <= 0 ? 'text-red-400' : 'text-amber-400'
        }`}>
          <Timer size={13} />
          {remaining > 0 ? 'Time remaining' : 'Time is up!'}
        </div>
        <span className={`text-[14px] font-black tabular-nums ${
          remaining <= 0 ? 'text-red-400' : 'text-amber-400'
        }`}>
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </span>
      </div>
      <div className="h-1.5 bg-brand-surface-light rounded-full overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all duration-1000 ${
            remaining <= 0 ? 'bg-red-500' : 'bg-amber-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
