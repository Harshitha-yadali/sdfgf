import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingCart, Search, Plus, Minus, Trash2, X, Check, ChevronRight,
  User, Phone, Mail, Store, Utensils, Loader2, ArrowLeft, Zap,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { createCounterOrder } from '../../lib/counterOrder';
import { useToast } from '../../components/Toast';
import type { Category, MenuItem, PickupOption } from '../../types';

interface ChefCartItem {
  menu_item: Pick<MenuItem, 'id' | 'name' | 'price' | 'category_id'>;
  quantity: number;
}

interface Props {
  onClose: () => void;
  onOrderCreated: (orderId: string) => void;
}

type Step = 'menu' | 'customer' | 'confirm';

function roundCurrency(v: number) {
  return Math.round(v * 100) / 100;
}

export default function ChefNewOrder({ onClose, onOrderCreated }: Props) {
  const [categories, setCategories] = useState<Pick<Category, 'id' | 'name' | 'display_order'>[]>([]);
  const [menuItems, setMenuItems] = useState<Pick<MenuItem, 'id' | 'name' | 'price' | 'is_available' | 'category_id' | 'display_order'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<ChefCartItem[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string>('');
  const [step, setStep] = useState<Step>('menu');

  // Customer info
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [pickupOption, setPickupOption] = useState<PickupOption>('dine_in');

  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  const loadMenu = useCallback(async () => {
    const [catResult, itemResult] = await Promise.all([
      supabase.from('categories').select('id, name, display_order').order('display_order', { ascending: true }),
      supabase.from('menu_items').select('id, name, price, is_available, category_id, display_order').eq('is_available', true).order('display_order', { ascending: true }),
    ]);

    if (catResult.data) {
      setCategories(catResult.data as typeof categories);
      if (catResult.data.length > 0) setActiveCategoryId(catResult.data[0].id);
    }
    if (itemResult.data) setMenuItems(itemResult.data as typeof menuItems);
    setLoading(false);
  }, []);

  useEffect(() => { void loadMenu(); }, [loadMenu]);

  function addToCart(item: typeof menuItems[0]) {
    setCart((prev) => {
      const existing = prev.find((c) => c.menu_item.id === item.id);
      if (existing) {
        return prev.map((c) => c.menu_item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { menu_item: item, quantity: 1 }];
    });
  }

  function setQty(itemId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.menu_item.id !== itemId));
    } else {
      setCart((prev) => prev.map((c) => c.menu_item.id === itemId ? { ...c, quantity: qty } : c));
    }
  }

  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);
  const subtotal = roundCurrency(cart.reduce((s, c) => s + Number(c.menu_item.price) * c.quantity, 0));

  const filteredItems = search.trim()
    ? menuItems.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()))
    : menuItems.filter((i) => i.category_id === activeCategoryId);

  const categoriesWithItems = new Set(menuItems.map((i) => i.category_id));
  const visibleCategories = categories.filter((c) => categoriesWithItems.has(c.id));

  function getItemQty(itemId: string) {
    return cart.find((c) => c.menu_item.id === itemId)?.quantity ?? 0;
  }

  function validateCustomer() {
    if (!customerName.trim()) return 'Customer name is required';
    const emailVal = customerEmail.trim();
    if (!emailVal) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) return 'Enter a valid email address';
    return null;
  }

  async function placeOrder() {
    const err = validateCustomer();
    if (err) { showToast(err, 'error'); return; }
    if (cart.length === 0) { showToast('Cart is empty', 'error'); return; }

    setSubmitting(true);
    try {
      const result = await createCounterOrder({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || '0000000000',
        customerEmail: customerEmail.trim(),
        orderType: 'pickup',
        pickupOption,
        address: '',
        pincode: '',
        deliveryFee: 0,
        subtotal,
        discount: 0,
        total: subtotal,
        paymentMethod: 'cod',
        items: cart.map((c) => ({
          menu_item_id: c.menu_item.id,
          item_name: c.menu_item.name,
          quantity: c.quantity,
          unit_price: Number(c.menu_item.price),
          customizations: [],
        })),
      });
      showToast(`Order ${result.appOrderId} placed`);
      onOrderCreated(result.appOrderId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to place order', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-orange-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Step header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-brand-border bg-brand-surface sticky top-0 z-10">
        <button
          onClick={step === 'menu' ? onClose : () => setStep(step === 'confirm' ? 'customer' : 'menu')}
          className="p-2 rounded-xl text-brand-text-dim hover:text-white hover:bg-brand-surface-light/60 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="font-bold text-white text-[15px]">New Counter Order</h2>
          <p className="text-[11px] text-brand-text-dim font-medium">
            {step === 'menu' ? 'Select items' : step === 'customer' ? 'Customer details' : 'Confirm order'}
          </p>
        </div>
        {step === 'menu' && cartCount > 0 && (
          <button
            onClick={() => setStep('customer')}
            className="flex items-center gap-2 bg-orange-500 text-white text-[13px] font-bold px-4 py-2 rounded-xl hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/20"
          >
            <ShoppingCart size={15} />
            {cartCount} · Next
          </button>
        )}
        {step === 'customer' && (
          <button
            onClick={() => {
              const err = validateCustomer();
              if (err) { showToast(err, 'error'); return; }
              setStep('confirm');
            }}
            className="flex items-center gap-2 bg-orange-500 text-white text-[13px] font-bold px-4 py-2 rounded-xl hover:bg-orange-600 transition-colors"
          >
            Review
            <ChevronRight size={15} />
          </button>
        )}
      </div>

      {/* Steps */}
      {step === 'menu' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Search */}
          <div className="px-4 py-3 border-b border-brand-border">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-dim" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items..."
                className="w-full bg-brand-surface-light border border-brand-border rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-brand-text-dim outline-none focus:border-orange-400 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-text-dim hover:text-white">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Category sidebar — hidden when searching */}
            {!search.trim() && (
              <div className="w-24 sm:w-28 shrink-0 border-r border-brand-border overflow-y-auto bg-brand-bg/60">
                {visibleCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategoryId(cat.id)}
                    className={`w-full text-left px-3 py-3 text-[12px] font-semibold border-b border-brand-border/50 transition-colors ${
                      activeCategoryId === cat.id
                        ? 'text-orange-400 bg-orange-500/10 border-l-2 border-l-orange-500'
                        : 'text-brand-text-dim hover:text-white hover:bg-brand-surface-light/40'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}

            {/* Item grid */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredItems.length === 0 && (
                <div className="text-center py-12 text-brand-text-dim text-sm">
                  {search ? 'No items match your search' : 'No items in this category'}
                </div>
              )}
              {filteredItems.map((item) => {
                const qty = getItemQty(item.id);
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all ${
                      qty > 0
                        ? 'border-orange-500/40 bg-orange-500/5'
                        : 'border-brand-border bg-brand-surface hover:border-brand-border-light'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-semibold truncate ${qty > 0 ? 'text-orange-200' : 'text-white'}`}>{item.name}</p>
                      <p className="text-brand-gold text-[12px] font-bold">&#8377;{Number(item.price)}</p>
                    </div>
                    {qty === 0 ? (
                      <button
                        onClick={() => addToCart(item)}
                        className="w-8 h-8 rounded-lg bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors shrink-0"
                      >
                        <Plus size={16} />
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => setQty(item.id, qty - 1)}
                          className="w-7 h-7 rounded-lg bg-brand-surface-light border border-brand-border text-white flex items-center justify-center hover:bg-red-500/20 hover:border-red-500/30 transition-colors"
                        >
                          <Minus size={13} />
                        </button>
                        <span className="w-7 text-center text-[13px] font-black text-orange-300 tabular-nums">{qty}</span>
                        <button
                          onClick={() => setQty(item.id, qty + 1)}
                          className="w-7 h-7 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-300 flex items-center justify-center hover:bg-orange-500/30 transition-colors"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cart summary bar */}
          {cartCount > 0 && (
            <div className="border-t border-brand-border bg-brand-surface px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-bold text-white">{cartCount} item{cartCount !== 1 ? 's' : ''}</p>
                  <p className="text-brand-gold font-bold text-[15px]">&#8377;{subtotal}</p>
                </div>
                <button
                  onClick={() => setStep('customer')}
                  className="flex items-center gap-2 bg-orange-500 text-white font-bold text-[14px] px-5 py-2.5 rounded-xl hover:bg-orange-600 transition-all active:scale-95 shadow-lg shadow-orange-500/20"
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'customer' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-4">
            <h3 className="text-[13px] font-bold text-brand-text-dim uppercase tracking-wider">Customer Info</h3>

            <div>
              <label className="block text-[12px] font-semibold text-brand-text-dim mb-1.5">
                Name <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-dim" />
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name"
                  autoFocus
                  className="w-full bg-brand-surface-light border border-brand-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-brand-text-dim outline-none focus:border-orange-400 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-brand-text-dim mb-1.5">
                Phone <span className="text-brand-text-dim">(optional)</span>
              </label>
              <div className="relative">
                <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-dim" />
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="10-digit mobile"
                  className="w-full bg-brand-surface-light border border-brand-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-brand-text-dim outline-none focus:border-orange-400 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-brand-text-dim mb-1.5">
                Email <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-dim" />
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="customer@example.com"
                  className="w-full bg-brand-surface-light border border-brand-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-brand-text-dim outline-none focus:border-orange-400 transition-colors"
                />
              </div>
              <p className="text-[11px] text-brand-text-dim mt-1">Order receipt will be sent to this email</p>
            </div>
          </div>

          <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-3">
            <h3 className="text-[13px] font-bold text-brand-text-dim uppercase tracking-wider">Service Type</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPickupOption('dine_in')}
                className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-[13px] font-bold transition-all ${
                  pickupOption === 'dine_in'
                    ? 'border-orange-400 bg-orange-500/10 text-orange-300'
                    : 'border-brand-border bg-brand-surface-light text-brand-text-muted hover:border-orange-400/30'
                }`}
              >
                <Utensils size={16} />
                Dine In
              </button>
              <button
                onClick={() => setPickupOption('takeaway')}
                className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-[13px] font-bold transition-all ${
                  pickupOption === 'takeaway'
                    ? 'border-orange-400 bg-orange-500/10 text-orange-300'
                    : 'border-brand-border bg-brand-surface-light text-brand-text-muted hover:border-orange-400/30'
                }`}
              >
                <Store size={16} />
                Takeaway
              </button>
            </div>
          </div>

          <button
            onClick={() => {
              const err = validateCustomer();
              if (err) { showToast(err, 'error'); return; }
              setStep('confirm');
            }}
            className="w-full py-3.5 rounded-xl bg-orange-500 text-white font-bold text-[15px] hover:bg-orange-600 transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
          >
            Review Order
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Customer summary */}
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-2">
            <h3 className="text-[13px] font-bold text-brand-text-dim uppercase tracking-wider mb-3">Customer</h3>
            <div className="flex items-center gap-2 text-[13px]">
              <User size={14} className="text-brand-text-dim shrink-0" />
              <span className="text-white font-semibold">{customerName}</span>
            </div>
            {customerPhone && (
              <div className="flex items-center gap-2 text-[13px]">
                <Phone size={14} className="text-brand-text-dim shrink-0" />
                <span className="text-brand-text-muted">{customerPhone}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-[13px]">
              <Mail size={14} className="text-brand-text-dim shrink-0" />
              <span className="text-brand-text-muted">{customerEmail}</span>
            </div>
            <div className="flex items-center gap-2 text-[13px]">
              {pickupOption === 'dine_in' ? <Utensils size={14} className="text-orange-400 shrink-0" /> : <Store size={14} className="text-orange-400 shrink-0" />}
              <span className="text-orange-300 font-semibold">{pickupOption === 'dine_in' ? 'Dine In' : 'Takeaway'}</span>
            </div>
          </div>

          {/* Items */}
          <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-bold text-brand-text-dim uppercase tracking-wider">Items</h3>
              <button
                onClick={() => setStep('menu')}
                className="text-[12px] text-orange-400 font-semibold hover:text-orange-300 transition-colors"
              >
                Edit
              </button>
            </div>
            {cart.map((c) => (
              <div key={c.menu_item.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-md bg-brand-gold/20 text-brand-gold text-[11px] font-black flex items-center justify-center shrink-0">
                    {c.quantity}x
                  </span>
                  <span className="text-[13px] text-white font-medium truncate">{c.menu_item.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[13px] text-brand-text-dim tabular-nums">&#8377;{roundCurrency(Number(c.menu_item.price) * c.quantity)}</span>
                  <button
                    onClick={() => setQty(c.menu_item.id, 0)}
                    className="p-1 rounded-lg text-brand-text-dim hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            <div className="border-t border-brand-border mt-3 pt-3 flex items-center justify-between">
              <span className="text-[13px] font-bold text-white">Total</span>
              <span className="text-brand-gold font-black text-lg tabular-nums">&#8377;{subtotal}</span>
            </div>
          </div>

          <div className="rounded-xl border border-brand-border bg-brand-surface/60 px-4 py-3 text-[12px] text-brand-text-dim">
            Payment will be collected at the counter. Order will appear in the kitchen queue immediately.
          </div>

          <button
            onClick={placeOrder}
            disabled={submitting || cart.length === 0}
            className="w-full py-4 rounded-xl bg-emerald-500 text-white font-bold text-[15px] hover:bg-emerald-600 transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                <Zap size={18} />
                Place Order · &#8377;{subtotal}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
