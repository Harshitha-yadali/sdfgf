import { useEffect, useState } from 'react';
import { Clock, Plus, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { MenuItem } from '../types';
import { useCart } from '../contexts/CartContext';
import { FALLBACK_IMAGE_SRC, normalizeImageUrl } from '../lib/images';
import { getMenuItemDietaryBadges } from '../lib/menuItemDietary';

interface ProductCardProps {
  item: MenuItem;
  onImageClick: (item: MenuItem) => void;
  onAdd: (item: MenuItem) => void;
}

export default function ProductCard({ item, onImageClick, onAdd }: ProductCardProps) {
  const { items, updateQuantity, removeItem } = useCart();
  const [imageSrc, setImageSrc] = useState(normalizeImageUrl(item.image_url));
  const dietaryBadges = getMenuItemDietaryBadges(item);

  const cartItems = items.filter((ci) => ci.menu_item.id === item.id);
  const totalQty = cartItems.reduce((sum, ci) => sum + ci.quantity, 0);

  useEffect(() => {
    setImageSrc(normalizeImageUrl(item.image_url));
  }, [item.image_url]);

  if (item.is_available === false) {
    return null;
  }

  function handleIncrement() {
    if (totalQty === 0) {
      onAdd(item);
    } else {
      const last = cartItems[cartItems.length - 1];
      updateQuantity(last.id, last.quantity + 1);
    }
  }

  function handleDecrement() {
    if (totalQty <= 0) return;
    const last = cartItems[cartItems.length - 1];
    if (last.quantity <= 1) {
      removeItem(last.id);
    } else {
      updateQuantity(last.id, last.quantity - 1);
    }
  }

  function openImagePreview() {
    onImageClick(item);
  }

  return (
    <motion.div
      className="card group"
      whileHover={{ y: -8, boxShadow: '0 20px 42px rgba(8,12,7,0.42), 0 0 0 1px rgba(255,255,255,0.06), 0 0 36px rgba(216,178,78,0.1)' }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <motion.button
        type="button"
        onClick={openImagePreview}
        whileTap={{ scale: 0.985 }}
        className="relative block aspect-[5/6] w-full overflow-hidden bg-brand-surface-light text-left"
        aria-label={`Open ${item.name}`}
      >
        <img
          src={imageSrc}
          alt={item.name}
          loading="lazy"
          decoding="async"
          width={400}
          height={480}
          onError={() => {
            if (imageSrc !== FALLBACK_IMAGE_SRC) {
              setImageSrc(FALLBACK_IMAGE_SRC);
            }
          }}
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(8,12,7,0.08)_55%,rgba(8,12,7,0.32)_100%)]" />
        <div className="absolute inset-y-0 left-[-38%] w-[55%] rotate-12 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)] opacity-0 blur-xl transition-all duration-700 group-hover:left-[105%] group-hover:opacity-100" />
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-brand-overlay to-transparent" />
        <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/85 backdrop-blur-xl">
          Fresh pick
        </div>
      </motion.button>

      <div className="p-3.5">
        <motion.h3
          className="min-h-[2.3rem] overflow-hidden break-words text-[15px] font-bold leading-[1.15] text-white"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {item.name}
        </motion.h3>

        {dietaryBadges.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {dietaryBadges.map((badge) => (
              <span key={badge.key} className={`${badge.className} px-2 py-0.5 text-[11px]`}>
                {badge.label}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[12px] font-semibold text-brand-text-dim shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <Clock size={12} className="text-brand-gold" strokeWidth={2.2} />
          <span>{item.prep_time} min prep</span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[17px] font-extrabold text-brand-gold tracking-tight">
            {'\u20B9'}{item.price}
          </span>

          <AnimatePresence mode="wait" initial={false}>
            {totalQty > 0 ? (
              <motion.div
                key="stepper"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-0 overflow-hidden rounded-full border border-brand-gold/60 bg-brand-gold/10 shadow-[0_14px_28px_rgba(216,178,78,0.1),inset_0_1px_0_rgba(255,255,255,0.08)]"
              >
                <motion.button
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDecrement();
                  }}
                  whileTap={{ scale: 0.85 }}
                  className="flex h-9 w-9 items-center justify-center text-brand-gold transition-colors hover:bg-brand-gold/10"
                >
                  <Minus size={16} strokeWidth={2.5} />
                </motion.button>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={totalQty}
                    initial={{ y: -10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 10, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="w-8 text-center text-[14px] font-extrabold text-brand-gold"
                  >
                    {totalQty}
                  </motion.span>
                </AnimatePresence>
                <motion.button
                  onClick={(event) => {
                    event.stopPropagation();
                    handleIncrement();
                  }}
                  whileTap={{ scale: 0.85 }}
                  className="flex h-9 w-9 items-center justify-center text-brand-gold transition-colors hover:bg-brand-gold/10"
                >
                  <Plus size={16} strokeWidth={2.5} />
                </motion.button>
              </motion.div>
            ) : (
              <motion.button
                key="add"
                onClick={(event) => {
                  event.stopPropagation();
                  onAdd(item);
                }}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-full border border-brand-gold/55 bg-brand-gold/10 px-4 py-2 text-[12px] font-black tracking-[0.12em] text-brand-gold shadow-[0_14px_30px_rgba(216,178,78,0.1),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:-translate-y-0.5 hover:bg-brand-gold hover:text-brand-bg"
              >
                ADD
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
