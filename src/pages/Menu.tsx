import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X, Clock, Sparkles, Flame, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { expireStalePendingOrders } from '../lib/inventorySchema';
import { supabase } from '../lib/supabase';
import { sortCategoriesForMenu } from '../lib/categoryOrdering';
import { buildBreadcrumbSchema, buildSchemaGraph, buildSeoUrl, seoDefaultKeywords, seoSiteName } from '../lib/seo';
import type { Category, MenuItem, Offer } from '../types';
import ProductCard from '../components/ProductCard';
import CustomizationModal from '../components/CustomizationModal';
import OfferCarousel from '../components/OfferCarousel';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { useCart } from '../contexts/CartContext';
import { useToast } from '../components/Toast';
import { playAddToCartSound } from '../lib/sounds';
import { staggerContainer, staggerChild } from '../lib/animations';
import { fetchCustomizationAvailability, itemHasAssignedCustomizations, type CustomizationAvailability } from '../lib/customizations';
import { fetchMenuPopularity, type MenuPopularityContext } from '../lib/menuPopularity';

function setNamedMeta(name: string, content: string) {
  upsertHeadTag(`meta[name="${name}"]`, 'meta', { name, content });
}

function setPropertyMeta(property: string, content: string) {
  upsertHeadTag(`meta[property="${property}"]`, 'meta', { property, content });
}

function setJsonLd(scriptId: string, schema?: Record<string, unknown>) {
  const existing = document.head.querySelector<HTMLScriptElement>(`#${scriptId}`);

  if (!schema) {
    existing?.remove();
    return;
  }

  const script = existing || document.createElement('script');
  script.id = scriptId;
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(schema);

  if (!existing) {
    document.head.appendChild(script);
  }
}

function upsertHeadTag(
  selector: string,
  tagName: 'meta' | 'link',
  attributes: Record<string, string>,
) {
  const existing = document.head.querySelector<HTMLElement>(selector);
  const element = existing || document.createElement(tagName);

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }

  if (!existing) {
    document.head.appendChild(element);
  }
}

type SuggestedCategoryContext = {
  title: string;
  subtitle: string;
  categories: Category[];
};

export default function MenuPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [popularityContext, setPopularityContext] = useState<MenuPopularityContext>({
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
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [activeCategory, setActiveCategory] = useState(searchParams.get('category') || 'all');
  const [sortBy, setSortBy] = useState<'popular' | 'price_low' | 'price_high'>('popular');
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [pendingAddOnItem, setPendingAddOnItem] = useState<{ cartItemId: string; menuItem: MenuItem; quantity: number } | null>(null);
  const [customizationAvailability, setCustomizationAvailability] = useState<CustomizationAvailability | null>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const { addItem, removeItem } = useCart();
  const { showToast } = useToast();
  const categoryParam = searchParams.get('category') || 'all';
  const searchParam = searchParams.get('search') || '';
  const itemParam = searchParams.get('item');

  const loadData = useCallback(async () => {
    try {
      await expireStalePendingOrders();
    } catch (error) {
      console.error('Failed to expire stale pending orders', error);
    }

    const [catRes, itemRes, offerRes, availability] = await Promise.all([
      supabase.from('categories').select('*').order('display_order'),
      supabase.from('menu_items').select('*').eq('is_available', true).order('display_order'),
      supabase.from('offers').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(4),
      fetchCustomizationAvailability(),
    ]);
    const categoryData = catRes.data || [];
    const itemData = itemRes.data || [];
    const visibleCategoryData = categoryData.filter((category) => (
      itemData.some((item) => item.category_id === category.id)
    ));

    if (catRes.data) setCategories(sortCategoriesForMenu(visibleCategoryData));
    if (itemRes.data) setItems(itemData);
    if (offerRes.error) showToast(offerRes.error.message || 'Failed to load offers', 'error');
    setOffers(offerRes.data || []);
    setCustomizationAvailability(availability);
    setPopularityContext(await fetchMenuPopularity(itemData, visibleCategoryData));
    setLoading(false);
  }, [showToast]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    setActiveCategory(categoryParam);
  }, [categoryParam]);

  useEffect(() => {
    setSearch(searchParam);
  }, [searchParam]);

  useEffect(() => {
    if (!itemParam || items.length === 0 || categories.length === 0) {
      return;
    }

    const targetItem = items.find((item) => item.id === itemParam);
    if (!targetItem) {
      return;
    }

    const targetCategory = categories.find((category) => category.id === targetItem.category_id);
    if (targetCategory && activeCategory !== targetCategory.slug) {
      setActiveCategory(targetCategory.slug);
    }

    setSelectedItem((current) => (current?.id === targetItem.id ? current : targetItem));
  }, [activeCategory, categories, itemParam, items]);

  const suggestedCategoryContext = useMemo(
    () => ({
      title: popularityContext.title,
      subtitle: popularityContext.subtitle,
      categories: popularityContext.rankedCategories.slice(0, 6),
    } satisfies SuggestedCategoryContext),
    [popularityContext],
  );
  const suggestedCategoryPriority = useMemo(
    () => new Map(suggestedCategoryContext.categories.map((category, index) => [
      category.id,
      suggestedCategoryContext.categories.length - index,
    ])),
    [suggestedCategoryContext.categories],
  );
  const rankedItemPriority = useMemo(
    () => new Map(popularityContext.rankedItems.map((item, index) => [
      item.id,
      popularityContext.rankedItems.length - index,
    ])),
    [popularityContext.rankedItems],
  );

  const filteredItems = useMemo(() => {
    let result = items.filter((item) => item.is_available !== false);
    if (activeCategory !== 'all') {
      const cat = categories.find((c) => c.slug === activeCategory);
      if (cat) result = result.filter((i) => i.category_id === cat.id);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
    }
    switch (sortBy) {
      case 'price_low': result.sort((a, b) => a.price - b.price); break;
      case 'price_high': result.sort((a, b) => b.price - a.price); break;
      default:
        result.sort((a, b) => {
          const itemScoreDelta = (popularityContext.itemScores[b.id] || 0) - (popularityContext.itemScores[a.id] || 0);
          if (itemScoreDelta !== 0) return itemScoreDelta;

          const fallbackItemDelta = (popularityContext.fallbackItemScores[b.id] || 0) - (popularityContext.fallbackItemScores[a.id] || 0);
          if (fallbackItemDelta !== 0) return fallbackItemDelta;

          const rankedItemDelta = (rankedItemPriority.get(b.id) || 0) - (rankedItemPriority.get(a.id) || 0);
          if (rankedItemDelta !== 0) return rankedItemDelta;

          if (activeCategory === 'all' && !search.trim()) {
            const categoryBoost = (suggestedCategoryPriority.get(b.category_id) || 0) - (suggestedCategoryPriority.get(a.category_id) || 0);
            if (categoryBoost !== 0) return categoryBoost;
          }

          const ratingDelta = b.rating - a.rating;
          if (ratingDelta !== 0) return ratingDelta;

          return a.display_order - b.display_order;
        });
    }
    return result;
  }, [items, categories, activeCategory, popularityContext.fallbackItemScores, popularityContext.itemScores, rankedItemPriority, search, sortBy, suggestedCategoryPriority]);
  const currentCategory = useMemo(
    () => (activeCategory === 'all' ? null : categories.find((category) => category.slug === activeCategory) || null),
    [activeCategory, categories],
  );
  const bestSellerItems = useMemo(
    () => popularityContext.rankedItems.filter((item) => item.is_available !== false).slice(0, 12),
    [popularityContext.rankedItems],
  );

  function handleCategoryChange(slug: string) {
    setActiveCategory(slug);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('item');
    if (slug === 'all') {
      nextParams.delete('category');
    } else {
      nextParams.set('category', slug);
    }
    setSearchParams(nextParams);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    const nextParams = new URLSearchParams(searchParams);
    if (value.trim()) {
      nextParams.set('search', value);
    } else {
      nextParams.delete('search');
    }
    setSearchParams(nextParams, { replace: true });
  }

  const closeSelectedItem = useCallback(() => {
    setSelectedItem(null);
    if (!itemParam) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('item');
    setSearchParams(nextParams, { replace: true });
  }, [itemParam, searchParams, setSearchParams]);

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
    playAddToCartSound();
    showToast(`${item.name} added to cart!`);

    if (!supportsCustomizations) {
      return;
    }

    setPendingAddOnItem({ cartItemId, menuItem: item, quantity: 1 });
  }, [addItem, customizationAvailability, showToast]);

  const handleBaseConfirm = useCallback((item: MenuItem, qty: number) => {
    if (!item.is_available) {
      showToast(`${item.name} is currently out of stock`, 'error');
      return;
    }

    const supportsCustomizations = itemHasAssignedCustomizations(item, customizationAvailability);
    const cartItemId = addItem(item, qty, []);
    playAddToCartSound();
    showToast(`${item.name} added to cart!`);
    setSelectedItem(null);
    if (itemParam) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('item');
      setSearchParams(nextParams, { replace: true });
    }
    if (!supportsCustomizations) {
      return;
    }
    setPendingAddOnItem({ cartItemId, menuItem: item, quantity: qty });
  }, [addItem, customizationAvailability, itemParam, searchParams, setSearchParams, showToast]);
  const categorySlugById = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category.slug])),
    [categories],
  );
  const menuItemsById = useMemo(
    () => Object.fromEntries(items.map((item) => [item.id, { id: item.id, category_id: item.category_id }])),
    [items],
  );
  const resolveOfferAction = useCallback((href: string) => {
    if (href === '/menu') {
      return {
        kind: 'button' as const,
        onClick: () => filterBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      };
    }

    return {
      kind: 'link' as const,
      to: href,
    };
  }, []);

  useEffect(() => {
    if (loading || categories.length === 0) {
      return;
    }

    const highlightedItems = filteredItems.slice(0, 24);
    const menuDescription = currentCategory
      ? `Browse ${currentCategory.name} at ${seoSiteName}, including ${highlightedItems.slice(0, 4).map((item) => item.name).join(', ')}.`
      : `Browse the complete menu at ${seoSiteName} with Belgian waffles, thick shakes, dessert combos, fries, momos, burgers, and more.`;
    const keywordSet = new Set([
      ...seoDefaultKeywords,
      ...(currentCategory ? [currentCategory.name.toLowerCase(), `${currentCategory.name.toLowerCase()} menu`] : ['full dessert menu', 'waffle shop menu']),
      ...highlightedItems.slice(0, 8).map((item) => item.name.toLowerCase()),
    ]);

    setNamedMeta('keywords', Array.from(keywordSet).join(', '));
    setNamedMeta('description', menuDescription);
    setPropertyMeta('og:description', menuDescription);
    setNamedMeta('twitter:description', menuDescription);

    const breadcrumbItems = [
      { name: 'Home', path: '/' },
      { name: 'Menu', path: '/menu' },
      ...(currentCategory ? [{ name: currentCategory.name, path: `/menu?category=${currentCategory.slug}` }] : []),
    ];

    const schema = buildSchemaGraph([
      {
        '@type': search.trim() ? 'SearchResultsPage' : 'CollectionPage',
        '@id': buildSeoUrl(`/menu${currentCategory ? `?category=${currentCategory.slug}` : ''}${search.trim() ? `${currentCategory ? '&' : '?'}search=${encodeURIComponent(search.trim())}` : ''}#webpage`),
        url: buildSeoUrl(`/menu${currentCategory ? `?category=${currentCategory.slug}` : ''}${search.trim() ? `${currentCategory ? '&' : '?'}search=${encodeURIComponent(search.trim())}` : ''}`),
        name: currentCategory ? `${currentCategory.name} Menu | ${seoSiteName}` : `${seoSiteName} Menu`,
        description: menuDescription,
        about: {
          '@type': 'Menu',
          name: currentCategory ? `${currentCategory.name} Menu Section` : `${seoSiteName} Menu`,
        },
        mainEntity: {
          '@type': 'ItemList',
          itemListOrder: 'https://schema.org/ItemListOrderAscending',
          numberOfItems: highlightedItems.length,
          itemListElement: highlightedItems.map((item, index) => {
            const itemCategory = categories.find((category) => category.id === item.category_id);
            const itemUrl = `/menu?${new URLSearchParams({
              ...(itemCategory ? { category: itemCategory.slug } : {}),
              item: item.id,
            }).toString()}`;

            return {
              '@type': 'ListItem',
              position: index + 1,
              url: buildSeoUrl(itemUrl),
              item: {
                '@type': 'MenuItem',
                name: item.name,
                description: item.description,
                image: buildSeoUrl(item.image_url),
                offers: {
                  '@type': 'Offer',
                  priceCurrency: 'INR',
                  price: item.price.toFixed(2),
                  availability: item.is_available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
                  url: buildSeoUrl(itemUrl),
                },
              },
            };
          }),
        },
      },
      {
        '@type': 'Menu',
        '@id': buildSeoUrl('/menu#live-menu'),
        name: `${seoSiteName} Menu`,
        hasMenuSection: categories.map((category) => ({
          '@type': 'MenuSection',
          name: category.name,
          url: buildSeoUrl(`/menu?category=${category.slug}`),
        })),
      },
      buildBreadcrumbSchema(breadcrumbItems),
    ]);

    setJsonLd('menu-search-schema', schema);

    return () => {
      setJsonLd('menu-search-schema');
    };
  }, [categories, currentCategory, filteredItems, loading, search]);

  return (
    <div className="min-h-screen bg-brand-bg">
      {offers.length > 0 ? (
        <>
          <h1 className="sr-only">Waffle Menu</h1>
          <section className="px-4 pt-4 pb-2">
            <OfferCarousel
              offers={offers}
              categorySlugById={categorySlugById}
              menuItemsById={menuItemsById}
              resolveAction={resolveOfferAction}
            />
          </section>
        </>
      ) : (
        <section className="section-padding pt-6 pb-2">
          <div className="max-w-3xl">
            <span className="section-label">Menu</span>
            <h1 className="mt-3 text-3xl font-black leading-tight text-white sm:text-4xl">
              Waffle Menu
            </h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-brand-text-muted sm:text-base">
              Browse handcrafted waffles, dessert combos, and shakes. Use search and sorting to find your picks faster.
            </p>
          </div>
        </section>
      )}

      <motion.div
        className="px-4 py-2"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <div className="flex items-center gap-3 text-[12px] font-semibold text-brand-text-dim">
          {[
            { icon: Clock, text: '10-min prep' },
            { icon: Sparkles, text: 'Fresh & Handcrafted' },
          ].map((item, i) => (
            <motion.div key={item.text} variants={staggerChild} className="flex items-center gap-1.5 whitespace-nowrap">
              {i > 0 && <span className="mr-1 text-brand-gold-muted">|</span>}
              <item.icon size={13} className="flex-shrink-0 text-brand-gold-muted" strokeWidth={2.2} />
              <span>{item.text}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {activeCategory === 'all' && !search.trim() && bestSellerItems.length > 0 && (
        <MenuBestSellerRail
          title={popularityContext.title}
          subtitle={popularityContext.subtitle}
          items={bestSellerItems}
          onImageClick={handleImageClick}
          onAdd={handleAdd}
          onSeeAll={() => filterBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      )}

      <div ref={filterBarRef} className="sticky top-[60px] z-30 border-b border-brand-border bg-brand-bg/95 backdrop-blur-xl lg:top-[68px]">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-gold" strokeWidth={2.5} />
              <input
                type="text"
                placeholder="Search waffles, shakes, and toppings..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="input-field pl-11 text-[15px] font-medium"
                aria-label="Search menu items"
              />
              {search && (
                <button onClick={() => handleSearchChange('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-text-dim hover:text-white transition-colors">
                  <X size={18} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-hide relative">
            <CategoryPill
              label="All"
              slug="all"
              active={activeCategory === 'all'}
              onClick={() => handleCategoryChange('all')}
            />
            {categories.map((cat) => (
              <CategoryPill
                key={cat.id}
                label={cat.name}
                slug={cat.slug}
                active={activeCategory === cat.slug}
                onClick={() => handleCategoryChange(cat.slug)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[13px] font-semibold text-brand-text-dim">
            {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
          </div>
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal size={14} className="text-brand-text-dim" strokeWidth={2.5} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="text-[13px] bg-transparent font-bold text-brand-text-muted focus:outline-none cursor-pointer"
            >
              <option value="popular">Popular</option>
              <option value="price_low">Price: Low</option>
              <option value="price_high">Price: High</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 items-start">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <CardSkeleton key={i} />)}
          </div>
        ) : filteredItems.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16"
          >
            <div className="w-16 h-16 bg-brand-surface rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Search size={24} className="text-brand-text-dim" strokeWidth={2.5} />
            </div>
            <h3 className="text-[17px] font-bold text-white mb-1.5">No waffles found</h3>
            <p className="text-brand-text-dim text-[14px] font-medium">Try adjusting your filters or search terms</p>
          </motion.div>
        ) : (
          <motion.div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 items-start"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            key={`${activeCategory}-${sortBy}`}
          >
            {filteredItems.map((item) => (
              <motion.div key={item.id} variants={staggerChild} className="self-start">
                <ProductCard item={item} onImageClick={handleImageClick} onAdd={handleAdd} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {selectedItem && (
          <CustomizationModal
            item={selectedItem}
            onClose={closeSelectedItem}
            onConfirm={(item, qty) => handleBaseConfirm(item, qty)}
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
              showToast(`${item.name} add-ons updated!`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CategoryPill({ label, active, onClick }: { label: string; slug: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative whitespace-nowrap px-4 py-2.5 rounded-lg text-[13px] font-bold transition-colors ${
        active
          ? 'text-brand-bg'
          : 'bg-brand-surface text-brand-text-muted border border-brand-border hover:border-brand-border'
      }`}
    >
      {active && (
        <motion.div
          layoutId="activeCategoryPill"
          className="absolute inset-0 bg-brand-gold rounded-lg"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <span className="relative z-10">{label}</span>
    </button>
  );
}

function MenuBestSellerRail({
  title,
  subtitle,
  items,
  onImageClick,
  onAdd,
  onSeeAll,
}: {
  title: string;
  subtitle?: string;
  items: MenuItem[];
  onImageClick: (item: MenuItem) => void;
  onAdd: (item: MenuItem) => void;
  onSeeAll: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateArrows = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setCanScrollLeft(element.scrollLeft > 4);
    setCanScrollRight(element.scrollLeft < element.scrollWidth - element.clientWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
    const element = scrollRef.current;
    if (!element) return;
    element.addEventListener('scroll', updateArrows, { passive: true });
    return () => element.removeEventListener('scroll', updateArrows);
  }, [items, updateArrows]);

  function scroll(direction: 'left' | 'right') {
    const element = scrollRef.current;
    if (!element) return;
    const amount = element.clientWidth * 0.7;
    element.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  }

  return (
    <section className="pt-4 pb-2">
      <div className="px-4 flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Flame size={18} className="text-orange-400" strokeWidth={2.5} />
            <h2 className="text-[18px] font-bold text-white">{title}</h2>
          </div>
          {subtitle && (
            <p className="mt-0.5 text-[12px] font-medium text-brand-text-dim">{subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-brand-gold text-[13px] font-bold flex items-center gap-0.5 hover:gap-1.5 transition-all"
        >
          See All <ChevronRight size={15} strokeWidth={2.5} />
        </button>
      </div>
      <div className="relative group/rail">
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scrollbar-hide px-4 snap-x snap-mandatory"
        >
          {items.map((item) => (
            <div key={item.id} className="flex-shrink-0 snap-start" style={{ width: 'clamp(108px, 32vw, 156px)' }}>
              <ProductCard item={item} onImageClick={onImageClick} onAdd={onAdd} />
            </div>
          ))}
        </div>
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scroll('left')}
            className="hidden lg:flex absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-brand-surface border border-brand-border rounded-full items-center justify-center text-white hover:bg-brand-surface-light opacity-0 group-hover/rail:opacity-100 transition-all shadow-elevated z-10"
          >
            <ChevronLeft size={18} strokeWidth={2.5} />
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scroll('right')}
            className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 bg-brand-surface border border-brand-border rounded-full items-center justify-center text-white hover:bg-brand-surface-light opacity-0 group-hover/rail:opacity-100 transition-all shadow-elevated z-10"
          >
            <ChevronRight size={18} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </section>
  );
}
