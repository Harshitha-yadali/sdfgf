import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Flame } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
import { staggerContainer, staggerChild } from '../lib/animations';
import { fetchCustomizationAvailability, itemHasAssignedCustomizations, type CustomizationAvailability } from '../lib/customizations';
import { installHomeSnapState, readHomeSnapshot, writeHomeSnapshot } from '../lib/homeSnapshot';
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
  const browseCategoryScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollBrowseCategoriesLeft, setCanScrollBrowseCategoriesLeft] = useState(false);
  const [canScrollBrowseCategoriesRight, setCanScrollBrowseCategoriesRight] = useState(false);
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

    if (!supportsCustomizations) {
      return;
    }

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
    if (!supportsCustomizations) {
      return;
    }
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
    () => Object.fromEntries(categories.map((category) => [category.id, category.slug])),
    [categories],
  );
  const menuItemsById = useMemo(
    () => Object.fromEntries(allItems.map((item) => [item.id, { id: item.id, category_id: item.category_id }])),
    [allItems],
  );

  const updateHorizontalScrollState = useCallback((
    el: HTMLDivElement | null,
    setLeft: (value: boolean) => void,
    setRight: (value: boolean) => void,
  ) => {
    if (!el) return;
    setLeft(el.scrollLeft > 4);
    setRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  const scrollHorizontal = useCallback((
    ref: { current: HTMLDivElement | null },
    direction: 'left' | 'right',
  ) => {
    const el = ref.current;
    if (!el) return;
    const amount = Math.max(140, el.clientWidth * 0.72);
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const el = browseCategoryScrollRef.current;
    if (!el) return;

    const sync = () => updateHorizontalScrollState(el, setCanScrollBrowseCategoriesLeft, setCanScrollBrowseCategoriesRight);
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [categories, updateHorizontalScrollState]);

  if (bootstrapping && categories.length === 0 && allItems.length === 0 && offers.length === 0) {
    return <HomeLoadingShell />;
  }

  return (
    <div className="bg-brand-bg min-h-screen pb-20">
      {offers.length > 0 && (
        <section className="px-4 pt-4 pb-2">
          <OfferCarousel
            offers={offers}
            categorySlugById={categorySlugById}
            menuItemsById={menuItemsById}
          />
        </section>
      )}

      {categories.length > 0 && (
        <ScrollReveal>
          <section className="px-4 pt-3 pb-1">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="section-label">Browse More</p>
                <h2 className="mt-1 text-[18px] font-bold text-white">More categories</h2>
              </div>
            </div>
            <div className="relative">
              <motion.div
                ref={browseCategoryScrollRef}
                className="flex gap-3 overflow-x-auto scrollbar-hide pb-1 pr-10"
                variants={staggerContainer}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.3 }}
              >
                {categories.map((cat) => (
                  <motion.div key={cat.id} variants={staggerChild}>
                    <Link
                      to={`/menu?category=${cat.slug}`}
                      className="group flex w-[88px] flex-shrink-0 flex-col items-center gap-2"
                    >
                      <div className="glow-border h-[72px] w-[72px] overflow-hidden rounded-full border border-white/10 bg-white/[0.03] p-1 transition-all group-hover:-translate-y-1 group-hover:border-brand-gold/40">
                        <img
                          src={normalizeImageUrl(cat.image_url)}
                          alt={`${cat.name} waffle category`}
                          loading="lazy"
                          decoding="async"
                          width={72}
                          height={72}
                          onError={setImageFallback}
                          className="h-full w-full rounded-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                      </div>
                      <span
                        className="min-h-[2rem] overflow-hidden break-words text-center text-[12px] font-bold leading-tight text-brand-text-muted transition-colors group-hover:text-brand-gold"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {cat.name}
                      </span>
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
              {canScrollBrowseCategoriesLeft && (
                <ScrollArrowButton
                  direction="left"
                  onClick={() => scrollHorizontal(browseCategoryScrollRef, 'left')}
                  className="top-[38%]"
                />
              )}
              {canScrollBrowseCategoriesRight && (
                <ScrollArrowButton
                  direction="right"
                  onClick={() => scrollHorizontal(browseCategoryScrollRef, 'right')}
                  className="top-[38%]"
                />
              )}
            </div>
          </section>
        </ScrollReveal>
      )}

      {bestSellers.length > 0 && (
        <ScrollReveal>
          <HorizontalRail
            icon={<Flame size={18} className="text-orange-400" strokeWidth={2.5} />}
            title={popularityContext.title}
            subtitle="Most-ordered picks customers usually start with."
            items={bestSellers}
            onImageClick={handleImageClick}
            onAdd={handleAdd}
            linkTo="/menu"
          />
        </ScrollReveal>
      )}

      {itemsByCategory.map((group, idx) => (
        <ScrollReveal key={group.category.id} delay={idx * 0.05}>
          <HorizontalRail
            title={group.category.name}
            items={group.items}
            onImageClick={handleImageClick}
            onAdd={handleAdd}
            linkTo={`/menu?category=${group.category.slug}`}
          />
        </ScrollReveal>
      ))}

      <ScrollReveal>
        <section className="px-4 pt-5 pb-2">
          <div className="gloss-shell rounded-[28px] px-5 py-5 sm:px-6">
            <p className="section-label">Common Questions</p>
            <h2 className="mt-2 text-[22px] font-black text-white">Local waffle search answers</h2>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {seoFaqs.map((item) => (
                <article
                  key={item.question}
                  className="rounded-[22px] border border-white/10 bg-black/10 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                >
                  <h3 className="text-[15px] font-bold text-white">{item.question}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-brand-text-muted">{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </ScrollReveal>

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

function HomeLoadingShell() {
  return (
    <div className="bg-brand-bg min-h-screen pb-20">
      <section className="px-4 pt-4 pb-2">
        <div className="gloss-shell h-[220px] animate-pulse rounded-[28px] sm:h-[260px]" />
      </section>

      <section className="px-4 pt-3 pb-1">
        <div className="mb-4">
          <div className="h-3 w-28 rounded-full bg-white/10" />
          <div className="mt-2 h-6 w-44 rounded-full bg-white/10" />
        </div>
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex w-[88px] flex-shrink-0 flex-col items-center gap-2">
              <div className="h-[72px] w-[72px] rounded-full border border-white/10 bg-white/[0.04]" />
              <div className="h-3 w-16 rounded-full bg-white/10" />
            </div>
          ))}
        </div>
      </section>

      <section className="pt-4 pb-1">
        <div className="mb-3 px-4">
          <div className="h-5 w-36 rounded-full bg-white/10" />
          <div className="mt-2 h-3 w-56 rounded-full bg-white/10" />
        </div>
        <div className="flex gap-3 overflow-hidden px-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="card w-[44vw] min-w-[176px] flex-shrink-0 overflow-hidden sm:w-48 lg:w-52">
              <div className="aspect-[5/6] bg-white/[0.04]" />
              <div className="space-y-3 p-3.5">
                <div className="h-4 w-3/4 rounded-full bg-white/10" />
                <div className="h-3 w-1/2 rounded-full bg-white/10" />
                <div className="h-4 w-20 rounded-full bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ScrollArrowButton({
  direction,
  onClick,
  className = '',
}: {
  direction: 'left' | 'right';
  onClick: () => void;
  className?: string;
}) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      aria-label={direction === 'left' ? 'Scroll left' : 'Scroll right'}
      onClick={onClick}
      className={`absolute ${direction === 'left' ? 'left-0' : 'right-0'} top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-brand-surface/88 text-white shadow-elevated backdrop-blur-xl transition-all hover:scale-105 hover:bg-brand-surface-light sm:h-9 sm:w-9 ${className}`}
    >
      <Icon size={16} strokeWidth={2.7} />
    </button>
  );
}

function HorizontalRail({
  icon,
  title,
  subtitle,
  items,
  onImageClick,
  onAdd,
  linkTo,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  items: MenuItem[];
  onImageClick: (item: MenuItem) => void;
  onAdd: (item: MenuItem) => void;
  linkTo: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  function updateArrows() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }

  useEffect(() => {
    updateArrows();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateArrows, { passive: true });
    return () => el.removeEventListener('scroll', updateArrows);
  }, [items]);

  function scroll(dir: 'left' | 'right') {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.7;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  }

  return (
    <section className="pt-4 pb-1">
      <div className="mb-3 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h2 className="text-[18px] font-bold text-white">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-[12px] font-medium text-brand-text-dim">{subtitle}</p>
            )}
          </div>
        </div>
        <Link to={linkTo} className="gloss-chip text-brand-gold transition-all hover:gap-1.5">
          See All <ChevronRight size={15} strokeWidth={2.5} />
        </Link>
      </div>
      <div className="relative group/rail">
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scrollbar-hide px-4 snap-x snap-mandatory"
        >
          {items.map((item) => (
            <div key={item.id} className="w-[44vw] min-w-[176px] sm:w-48 lg:w-52 flex-shrink-0 snap-start">
              <ProductCard item={item} onImageClick={onImageClick} onAdd={onAdd} />
            </div>
          ))}
        </div>
        {canScrollLeft && (
          <ScrollArrowButton
            direction="left"
            onClick={() => scroll('left')}
            className="left-2 lg:opacity-0 lg:group-hover/rail:opacity-100"
          />
        )}
        {canScrollRight && (
          <ScrollArrowButton
            direction="right"
            onClick={() => scroll('right')}
            className="right-2 lg:opacity-0 lg:group-hover/rail:opacity-100"
          />
        )}
      </div>
    </section>
  );
}
