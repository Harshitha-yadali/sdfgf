import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ChevronRight, Flame, Tag, Star, ArrowRight } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import OfferCarousel from '../components/OfferCarousel';
import { expireStalePendingOrders } from '../lib/inventorySchema';
import { supabase } from '../lib/supabase';
import { sortCategoriesForMenu } from '../lib/categoryOrdering';
import { fetchMenuPopularity, type MenuPopularityContext } from '../lib/menuPopularity';
import { normalizeImageUrl, setImageFallback } from '../lib/images';
import { useCart } from '../contexts/CartContext';
import { useToast } from '../components/Toast';
import ProductCard from '../components/ProductCard';
import CustomizationModal from '../components/CustomizationModal';
import ScrollReveal from '../components/ScrollReveal';
import { fetchCustomizationAvailability, itemHasAssignedCustomizations, type CustomizationAvailability } from '../lib/customizations';
import { installHomeSnapState, readHomeSnapshot, writeHomeSnapshot } from '../lib/homeSnapshot';
import { getOfferCtaHref } from '../lib/offers';
import type { Category, MenuItem, Offer } from '../types';

const seoFaqs = [
  {
    question: 'Where is The Supreme Waffle in Vijayawada?',
    answer: 'You can find The Supreme Waffle on Police Station Road, Kanuru, Vijayawada.',
  },
  {
    question: 'What can I order besides waffles?',
    answer: 'The menu also includes thick shakes, milkshakes, fries, momos, burgers, and dessert combos.',
  },
  {
    question: 'Can I order online for takeaway or dine-in pickup?',
    answer: 'Yes. The website supports online ordering for dine-in and takeaway pickup.',
  },
];

export default function Home() {
  const initialSnapshot = useMemo(() => readHomeSnapshot(), []);
  const [categories, setCategories] = useState<Category[]>(() => initialSnapshot?.categories || []);
  const [bestSellers, setBestSellers] = useState<MenuItem[]>(() => initialSnapshot?.bestSellers || []);
  const [allItems, setAllItems] = useState<MenuItem[]>(() => initialSnapshot?.allItems || []);
  const [popularityContext, setPopularityContext] = useState<MenuPopularityContext>(() => initialSnapshot?.popularityContext || {
    slotKey: 'all_day',
    title: 'Best Sellers',
    subtitle: 'Sorted from recent orders so the most-picked items rise to the top.',
    itemScores: {},
    fallbackItemScores: {},
    categoryScores: {},
    fallbackCategoryScores: {},
    rankedItems: [],
    rankedCategories: [],
    hasLiveData: false,
  });
  const [offers, setOffers] = useState<Offer[]>(() => initialSnapshot?.offers || []);
  const [bootstrapping, setBootstrapping] = useState(() => !initialSnapshot);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [pendingAddOnItem, setPendingAddOnItem] = useState<{ cartItemId: string; menuItem: MenuItem; quantity: number } | null>(null);
  const [customizationAvailability, setCustomizationAvailability] = useState<CustomizationAvailability | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const { addItem, removeItem } = useCart();
  const { showToast } = useToast();

  const loadData = useCallback(async () => {
    try {
      try {
        await expireStalePendingOrders();
      } catch (error) {
        console.error('Failed to expire stale pending orders', error);
      }

      const [catRes, allRes, offerRes] = await Promise.all([
        supabase.from('categories').select('*').order('display_order'),
        supabase.from('menu_items').select('*').eq('is_available', true).order('display_order'),
        supabase.from('offers').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(4),
      ]);

      if (catRes.error) throw catRes.error;
      if (allRes.error) throw allRes.error;

      const categoryData = catRes.data || [];
      const itemData = allRes.data || [];
      const visibleCategoryData = categoryData.filter((category) => (
        itemData.some((item) => item.category_id === category.id)
      ));
      const sortedCategories = sortCategoriesForMenu(visibleCategoryData);
      const activeOffers = offerRes.data || [];

      setCategories(sortedCategories);
      setAllItems(itemData);
      if (offerRes.error) showToast(offerRes.error.message || 'Failed to load offers', 'error');
      setOffers(activeOffers);

      const [availability, popularity] = await Promise.all([
        fetchCustomizationAvailability().catch((error) => {
          console.error('Failed to load customization availability', error);
          return null;
        }),
        fetchMenuPopularity(itemData, sortedCategories),
      ]);

      const nextBestSellers = popularity.rankedItems
        .filter((item) => item.is_available !== false)
        .slice(0, 12);

      setCustomizationAvailability(availability);
      setPopularityContext(popularity);
      setBestSellers(nextBestSellers);

      const snapshot = {
        categories: sortedCategories,
        bestSellers: nextBestSellers,
        allItems: itemData,
        offers: activeOffers,
        popularityContext: popularity,
      };

      installHomeSnapState(snapshot);
      writeHomeSnapshot(snapshot);
    } catch (error) {
      console.error('Failed to load homepage data', error);
      showToast('Failed to load homepage data', 'error');
    } finally {
      setBootstrapping(false);
    }
  }, [showToast]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    if (!initialSnapshot) return;
    installHomeSnapState(initialSnapshot);
  }, [initialSnapshot]);

  const handleImageClick = useCallback((item: MenuItem) => {
    setSelectedItem(item);
  }, []);

  const handleAdd = useCallback((item: MenuItem) => {
    if (!item.is_available) {
      showToast(`${item.name} is currently out of stock`, 'error');
      return;
    }
    const supportsCustomizations = itemHasAssignedCustomizations(item, customizationAvailability);
    const cartItemId = addItem(item, 1, []);
    showToast(`${item.name} added to cart`);
    if (!supportsCustomizations) return;
    setPendingAddOnItem({ cartItemId, menuItem: item, quantity: 1 });
  }, [addItem, customizationAvailability, showToast]);

  const handleConfirmAdd = useCallback((item: MenuItem, qty: number) => {
    if (!item.is_available) {
      showToast(`${item.name} is currently out of stock`, 'error');
      return;
    }
    const supportsCustomizations = itemHasAssignedCustomizations(item, customizationAvailability);
    const cartItemId = addItem(item, qty, []);
    showToast(`${item.name} added to cart`);
    setSelectedItem(null);
    if (!supportsCustomizations) return;
    setPendingAddOnItem({ cartItemId, menuItem: item, quantity: qty });
  }, [addItem, customizationAvailability, showToast]);

  const itemsByCategory = useMemo(() => {
    const sortedCategories = [...categories].sort((left, right) => {
      const categoryScoreDelta = (popularityContext.categoryScores[right.id] || 0) - (popularityContext.categoryScores[left.id] || 0);
      if (categoryScoreDelta !== 0) return categoryScoreDelta;
      const fallbackCategoryDelta = (popularityContext.fallbackCategoryScores[right.id] || 0) - (popularityContext.fallbackCategoryScores[left.id] || 0);
      if (fallbackCategoryDelta !== 0) return fallbackCategoryDelta;
      return left.display_order - right.display_order;
    });
    return sortedCategories.map((category) => ({
      category,
      items: [...allItems.filter((item) => item.category_id === category.id && item.is_available !== false)].sort((left, right) => {
        const itemScoreDelta = (popularityContext.itemScores[right.id] || 0) - (popularityContext.itemScores[left.id] || 0);
        if (itemScoreDelta !== 0) return itemScoreDelta;
        const fallbackItemDelta = (popularityContext.fallbackItemScores[right.id] || 0) - (popularityContext.fallbackItemScores[left.id] || 0);
        if (fallbackItemDelta !== 0) return fallbackItemDelta;
        const ratingDelta = right.rating - left.rating;
        if (ratingDelta !== 0) return ratingDelta;
        return left.display_order - right.display_order;
      }),
    })).filter((group) => group.items.length > 0);
  }, [allItems, categories, popularityContext.categoryScores, popularityContext.fallbackCategoryScores, popularityContext.fallbackItemScores, popularityContext.itemScores]);

  const categorySlugById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.slug])),
    [categories],
  );
  const menuItemsById = useMemo(
    () => Object.fromEntries(allItems.map((item) => [item.id, { id: item.id, category_id: item.category_id }])),
    [allItems],
  );

  const promoBannerOffer = useMemo(
    () => offers.find((o) => o.background_image_url) || offers[1] || null,
    [offers],
  );

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    navigate(searchQuery.trim() ? `/menu?q=${encodeURIComponent(searchQuery.trim())}` : '/menu');
  }

  if (bootstrapping && categories.length === 0 && allItems.length === 0 && offers.length === 0) {
    return <HomeLoadingShell />;
  }

  return (
    <div className="bg-brand-bg min-h-screen pb-24">

      {/* ── Sticky Search Bar ── */}
      <div className="sticky top-0 z-30 bg-brand-bg/96 backdrop-blur-md border-b border-brand-border/50 px-4 py-2.5">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-text-dim pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search waffles, shakes, snacks..."
              className="w-full rounded-2xl border border-brand-border bg-brand-surface pl-10 pr-4 py-2.5 text-[14px] text-white placeholder-brand-text-dim outline-none focus:border-brand-gold/50 transition-colors"
            />
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-2xl bg-brand-gold px-4 py-2.5 text-[13px] font-bold text-brand-bg hover:brightness-110 transition-all active:scale-95"
          >
            Search
          </button>
        </form>
      </div>

      {/* ── Offer Carousel ── */}
      {offers.length > 0 && (
        <section className="px-4 pt-3 pb-1">
          <OfferCarousel
            offers={offers}
            categorySlugById={categorySlugById}
            menuItemsById={menuItemsById}
            heightClassName="h-[200px] sm:h-[240px] lg:h-[280px]"
          />
        </section>
      )}

      {/* ── Category Strip ── */}
      {categories.length > 0 && (
        <ScrollReveal>
          <section className="pt-4 pb-1">
            <div className="flex items-center justify-between px-4 mb-3">
              <h2 className="text-[15px] font-black text-white uppercase tracking-wide">Shop by Category</h2>
              <Link to="/menu" className="flex items-center gap-0.5 text-[12px] font-bold text-brand-gold hover:text-brand-gold-soft transition-colors">
                All <ChevronRight size={14} />
              </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
              {categories.map((cat) => (
                <Link
                  key={cat.id}
                  to={`/menu?category=${cat.slug}`}
                  className="flex-shrink-0 flex flex-col items-center gap-1.5"
                  style={{ width: '64px' }}
                >
                  <div className="w-[58px] h-[58px] rounded-2xl overflow-hidden border border-brand-border bg-brand-surface hover:border-brand-gold/40 transition-all shrink-0">
                    <img
                      src={normalizeImageUrl(cat.image_url)}
                      alt={cat.name}
                      loading="lazy"
                      decoding="async"
                      width={58}
                      height={58}
                      onError={setImageFallback}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <span
                    className="text-[10px] font-semibold text-brand-text-muted text-center leading-tight w-full overflow-hidden"
                    style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                  >
                    {cat.name}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </ScrollReveal>
      )}

      {/* ── Best Sellers Rail ── */}
      {bestSellers.length > 0 && (
        <ScrollReveal>
          <ProductRail
            icon={<Flame size={15} className="text-orange-400" strokeWidth={2.5} />}
            badge="HOT"
            badgeColor="bg-orange-500"
            title={popularityContext.title.toUpperCase()}
            subtitle="Most-ordered picks"
            items={bestSellers}
            onImageClick={handleImageClick}
            onAdd={handleAdd}
            linkTo="/menu"
          />
        </ScrollReveal>
      )}

      {/* ── Mid-page Promo Banner ── */}
      {promoBannerOffer && (
        <ScrollReveal>
          <section className="px-4 pt-4 pb-1">
            <PromoBannerCard
              offer={promoBannerOffer}
              categorySlugById={categorySlugById}
              menuItemsById={menuItemsById}
            />
          </section>
        </ScrollReveal>
      )}

      {/* ── Category Rails ── */}
      {itemsByCategory.map((group, idx) => (
        <ScrollReveal key={group.category.id} delay={idx * 0.04}>
          <ProductRail
            title={group.category.name.toUpperCase()}
            items={group.items}
            onImageClick={handleImageClick}
            onAdd={handleAdd}
            linkTo={`/menu?category=${group.category.slug}`}
          />
        </ScrollReveal>
      ))}

      {/* ── Browse All CTA ── */}
      <ScrollReveal>
        <section className="px-4 pt-5 pb-2">
          <Link
            to="/menu"
            className="flex items-center justify-center gap-2 w-full rounded-2xl border border-brand-border bg-brand-surface px-4 py-4 text-[14px] font-bold text-brand-text-muted hover:border-brand-gold/40 hover:text-brand-gold transition-all"
          >
            <Star size={15} className="text-brand-gold" />
            View Full Menu
            <ArrowRight size={15} />
          </Link>
        </section>
      </ScrollReveal>

      {/* ── FAQ ── */}
      <ScrollReveal>
        <section className="px-4 pt-5 pb-2">
          <div className="rounded-[24px] border border-brand-border bg-brand-surface px-5 py-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-gold mb-1">Quick Answers</p>
            <h2 className="text-[17px] font-black text-white mb-4">Common Questions</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {seoFaqs.map((item) => (
                <article key={item.question} className="rounded-[16px] border border-brand-border/60 bg-brand-bg/40 px-4 py-3">
                  <h3 className="text-[13px] font-bold text-white">{item.question}</h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-brand-text-dim">{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Modals ── */}
      <AnimatePresence>
        {selectedItem && (
          <CustomizationModal
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onConfirm={(item, qty) => handleConfirmAdd(item, qty)}
            showCustomizations={false}
          />
        )}
        {pendingAddOnItem && (
          <CustomizationModal
            item={pendingAddOnItem.menuItem}
            initialQuantity={pendingAddOnItem.quantity}
            onClose={() => setPendingAddOnItem(null)}
            onConfirm={(item, qty, customizations) => {
              removeItem(pendingAddOnItem.cartItemId);
              addItem(item, qty, customizations);
              setPendingAddOnItem(null);
              showToast(`${item.name} add-ons updated`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Promo Banner ─────────────────────────────────────────────────────────────

function PromoBannerCard({
  offer,
  categorySlugById,
  menuItemsById,
}: {
  offer: Offer;
  categorySlugById: Record<string, string>;
  menuItemsById: Record<string, { id: string; category_id: string }>;
}) {
  const href = getOfferCtaHref(offer, { categorySlugById, menuItemsById });

  return (
    <Link to={href}>
      <div className="relative overflow-hidden rounded-[20px] border border-brand-gold/20 bg-brand-surface h-[116px] sm:h-[136px] hover:border-brand-gold/40 transition-colors">
        {offer.background_image_url && (
          <>
            <img
              src={offer.background_image_url}
              alt={offer.title}
              className="absolute inset-0 h-full w-full object-cover opacity-35"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-brand-bg/95 via-brand-bg/75 to-transparent" />
          </>
        )}
        {!offer.background_image_url && (
          <div className="absolute inset-0 bg-gradient-to-r from-brand-gold/15 via-brand-gold/8 to-transparent" />
        )}
        <div className="relative h-full flex items-center px-5 gap-4">
          <div className="flex-1 min-w-0">
            <span className="inline-flex items-center gap-1 rounded-md bg-brand-gold px-2 py-0.5 text-[9px] font-black text-brand-bg uppercase tracking-wide mb-1.5">
              <Tag size={8} />
              {offer.display_badge || 'DEAL'}
            </span>
            <h3 className="text-[17px] font-black text-white leading-tight truncate">{offer.title}</h3>
            {offer.description && (
              <p className="text-[11px] text-brand-text-dim mt-0.5 truncate">{offer.description}</p>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-1 rounded-xl bg-brand-gold px-3.5 py-2 text-[12px] font-black text-brand-bg shadow-lg shadow-brand-gold/20">
            Order Now <ArrowRight size={12} />
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Product Rail ─────────────────────────────────────────────────────────────

function ProductRail({
  icon,
  badge,
  badgeColor,
  title,
  subtitle,
  items,
  onImageClick,
  onAdd,
  linkTo,
}: {
  icon?: React.ReactNode;
  badge?: string;
  badgeColor?: string;
  title: string;
  subtitle?: string;
  items: MenuItem[];
  onImageClick: (item: MenuItem) => void;
  onAdd: (item: MenuItem) => void;
  linkTo: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <section className="pt-5 pb-1">
      <div className="flex items-center justify-between px-4 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {badge && (
                <span className={`${badgeColor || 'bg-brand-gold'} text-white text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider`}>
                  {badge}
                </span>
              )}
              <h2 className="text-[15px] font-black text-white tracking-tight">{title}</h2>
            </div>
            {subtitle && <p className="text-[11px] text-brand-text-dim">{subtitle}</p>}
          </div>
        </div>
        <Link
          to={linkTo}
          className="shrink-0 flex items-center gap-0.5 text-[12px] font-bold text-brand-gold hover:text-brand-gold-soft transition-colors ml-2"
        >
          See all <ChevronRight size={13} strokeWidth={2.5} />
        </Link>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-2.5 overflow-x-auto scrollbar-hide px-4 snap-x snap-mandatory"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="flex-shrink-0 snap-start"
            style={{ width: 'clamp(108px, 32vw, 156px)' }}
          >
            <ProductCard item={item} onImageClick={onImageClick} onAdd={onAdd} />
          </div>
        ))}
      </div>

      <div className="px-4 mt-3">
        <Link
          to={linkTo}
          className="flex items-center justify-center gap-1.5 w-full rounded-xl border border-brand-border px-4 py-2.5 text-[13px] font-bold text-brand-text-dim hover:border-brand-gold/40 hover:text-brand-gold transition-all"
        >
          View more products <ChevronRight size={14} />
        </Link>
      </div>
    </section>
  );
}

// ─── Loading Shell ────────────────────────────────────────────────────────────

function HomeLoadingShell() {
  return (
    <div className="bg-brand-bg min-h-screen pb-24">
      <div className="px-4 py-2.5 border-b border-brand-border/50">
        <div className="h-10 rounded-2xl bg-brand-surface animate-pulse" />
      </div>
      <section className="px-4 pt-3 pb-1">
        <div className="h-[200px] animate-pulse rounded-[20px] bg-brand-surface" />
      </section>
      <section className="pt-4 pb-1 px-4">
        <div className="h-4 w-36 rounded-full bg-brand-surface mb-3 animate-pulse" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 flex flex-col items-center gap-1.5" style={{ width: '64px' }}>
              <div className="w-[58px] h-[58px] rounded-2xl bg-brand-surface animate-pulse" />
              <div className="h-2.5 w-10 rounded-full bg-brand-surface animate-pulse" />
            </div>
          ))}
        </div>
      </section>
      <section className="pt-5 pb-1">
        <div className="px-4 mb-3 flex items-center justify-between">
          <div className="h-4 w-28 rounded-full bg-brand-surface animate-pulse" />
          <div className="h-3.5 w-12 rounded-full bg-brand-surface animate-pulse" />
        </div>
        <div className="flex gap-2.5 overflow-hidden px-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 rounded-2xl overflow-hidden bg-brand-surface animate-pulse"
              style={{ width: 'clamp(108px, 32vw, 156px)' }}
            >
              <div className="aspect-square bg-brand-surface-light" />
              <div className="p-2.5 space-y-1.5">
                <div className="h-3 w-full rounded-full bg-brand-surface-light" />
                <div className="h-4 w-1/2 rounded-full bg-brand-surface-light" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
