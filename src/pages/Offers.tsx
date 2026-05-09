import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Sparkles, Tag } from 'lucide-react';
import { motion } from 'motion/react';
import OfferCarousel from '../components/OfferCarousel';
import { useToast } from '../components/Toast';
import { getOfferBadgeLabel, getOfferCtaHref, getOfferCtaText, getOfferDisplayDescription, getOfferRewardLabel } from '../lib/offers';
import { supabase } from '../lib/supabase';
import type { Category, MenuItem, Offer } from '../types';

function normalizeImageUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/^http:\/\//i, 'https://') : null;
}

export default function OffersPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<Array<Pick<MenuItem, 'id' | 'category_id'>>>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const loadData = useCallback(async () => {
    const [offerRes, categoryRes, menuItemsRes] = await Promise.all([
      supabase.from('offers').select('*').eq('is_active', true).order('created_at', { ascending: false }),
      supabase.from('categories').select('*').order('display_order'),
      supabase.from('menu_items').select('id, category_id').eq('is_available', true),
    ]);

    if (offerRes.error) {
      showToast(offerRes.error.message || 'Failed to load offers', 'error');
    } else {
      setOffers(offerRes.data || []);
    }

    if (categoryRes.error) {
      showToast(categoryRes.error.message || 'Failed to load offer categories', 'error');
    } else {
      setCategories(categoryRes.data || []);
    }

    if (menuItemsRes.error) {
      showToast(menuItemsRes.error.message || 'Failed to load offer items', 'error');
    } else {
      setMenuItems((menuItemsRes.data || []) as Array<Pick<MenuItem, 'id' | 'category_id'>>);
    }

    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const categorySlugById = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category.slug])),
    [categories],
  );
  const menuItemsById = useMemo(
    () => Object.fromEntries(menuItems.map((item) => [item.id, item])),
    [menuItems],
  );

  return (
    <div className="min-h-screen bg-brand-bg pb-20">
      <section className="section-padding pt-8 pb-4">
        <span className="section-label">Offers</span>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-black leading-tight text-white sm:text-4xl lg:text-5xl">
              Deals customers can swipe through and claim fast
            </h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-brand-text-muted sm:text-base">
              Active promotions rotate automatically here, and customers can still move the carousel themselves with arrows, dots, or swipe.
            </p>
          </div>
          <Link
            to="/menu"
            className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-brand-gold/30 bg-brand-gold/10 px-4 py-2.5 text-[14px] font-bold text-brand-gold transition-all hover:border-brand-gold/50 hover:bg-brand-gold/15"
          >
            Browse Menu <ChevronRight size={16} strokeWidth={2.5} />
          </Link>
        </div>
      </section>

      <section className="px-4 pb-5">
        {loading ? (
          <div className="h-[240px] animate-pulse rounded-[24px] border border-brand-border bg-brand-surface sm:h-[268px] lg:h-[308px]" />
        ) : offers.length > 0 ? (
          <OfferCarousel
            offers={offers}
            categorySlugById={categorySlugById}
            menuItemsById={menuItemsById}
          />
        ) : (
          <div className="rounded-[24px] border border-brand-border bg-brand-surface p-8 text-center text-brand-text-dim">
            No active offers right now.
          </div>
        )}
      </section>

      {offers.length > 0 && (
        <section className="section-padding py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Tag, label: `${offers.length} live offer${offers.length === 1 ? '' : 's'}` },
              { icon: Sparkles, label: 'Auto moving carousel' },
              { icon: ChevronRight, label: 'Manual arrows and dots' },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-brand-border bg-brand-surface/85 px-4 py-3 text-[13px] font-semibold text-brand-text-muted">
                <div className="flex items-center gap-2">
                  <item.icon size={15} className="text-brand-gold" strokeWidth={2.4} />
                  <span>{item.label}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {offers.length > 0 && (
        <section className="section-padding py-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="section-label">Live Deals</span>
              <h2 className="mt-2 text-2xl font-black text-white">All active offers</h2>
            </div>
            <Link
              to="/menu"
              className="inline-flex items-center gap-1 text-[14px] font-bold text-brand-gold transition-all hover:gap-2"
            >
              Order from menu <ChevronRight size={16} strokeWidth={2.5} />
            </Link>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {offers.map((offer, index) => {
              const reward = getOfferRewardLabel(offer);
              const description = getOfferDisplayDescription(offer);
              const ctaHref = getOfferCtaHref(offer, { categorySlugById, menuItemsById });
              const backgroundImage = normalizeImageUrl(offer.background_image_url);

              return (
                <motion.article
                  key={offer.id}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.16) }}
                  className="group relative overflow-hidden rounded-[28px] border border-brand-border bg-brand-surface"
                >
                  {backgroundImage && (
                    <>
                      <img
                        src={backgroundImage}
                        alt={offer.title}
                        loading="lazy"
                        width={1200}
                        height={600}
                        className="absolute inset-0 h-full w-full object-cover opacity-20 transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(8,11,7,0.96)_0%,rgba(8,11,7,0.84)_44%,rgba(8,11,7,0.7)_100%)]" />
                    </>
                  )}
                  {!backgroundImage && (
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(216,178,78,0.14),_transparent_32%),linear-gradient(135deg,rgba(23,31,18,1)_0%,rgba(17,24,13,1)_100%)]" />
                  )}

                  <div className="relative p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <span className="inline-flex rounded-full border border-brand-gold/20 bg-brand-gold/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-gold">
                        {getOfferBadgeLabel(offer)}
                      </span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-text-dim">
                        Offer {index + 1}
                      </span>
                    </div>

                    <h3 className="mt-4 text-2xl font-black leading-tight text-white">
                      {offer.title}
                    </h3>

                    {description && (
                      <p className="mt-3 max-w-xl whitespace-pre-line text-[14px] leading-relaxed text-brand-text-muted">
                        {description}
                      </p>
                    )}

                    {reward && (
                      <div className="mt-4 inline-flex rounded-2xl border border-brand-gold/20 bg-brand-gold/10 px-4 py-2 text-[18px] font-black text-brand-gold">
                        {reward}
                      </div>
                    )}

                    <div className="mt-5 flex flex-wrap gap-3">
                      <Link
                        to={ctaHref}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-gold px-4 py-2.5 text-[14px] font-bold text-brand-bg transition-all hover:-translate-y-0.5 hover:brightness-110"
                      >
                        {getOfferCtaText(offer)}
                      </Link>
                      <Link
                        to="/menu"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-brand-border bg-brand-surface/80 px-4 py-2.5 text-[14px] font-bold text-white transition-all hover:border-brand-gold/40 hover:text-brand-gold"
                      >
                        View Menu
                      </Link>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
