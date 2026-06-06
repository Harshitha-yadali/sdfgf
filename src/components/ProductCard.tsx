import { useEffect, useState } from 'react';
import { Plus, Minus } from 'lucide-react';
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

  if (item.is_available === false) return null;

  function handleIncrement(e: React.MouseEvent) {
    e.stopPropagation();
    if (totalQty === 0) {
      onAdd(item);
    } else {
      const last = cartItems[cartItems.length - 1];
      updateQuantity(last.id, last.quantity + 1);
    }
  }

  function handleDecrement(e: React.MouseEvent) {
    e.stopPropagation();
    if (totalQty <= 0) return;
    const last = cartItems[cartItems.length - 1];
    if (last.quantity <= 1) {
      removeItem(last.id);
    } else {
      updateQuantity(last.id, last.quantity - 1);
    }
  }

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border border-brand-border bg-brand-surface transition-all duration-200 hover:border-brand-border-strong cursor-pointer"
      onClick={() => onImageClick(item)}
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-brand-surface-light">
        <img
          src={imageSrc}
          alt={item.name}
          loading="lazy"
          decoding="async"
          width={300}
          height={300}
          onError={() => {
            if (imageSrc !== FALLBACK_IMAGE_SRC) setImageSrc(FALLBACK_IMAGE_SRC);
          }}
          className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
        />

        {/* Dietary badges */}
        {dietaryBadges.length > 0 && (
          <div className="absolute left-1.5 top-1.5 flex flex-col gap-1">
            {dietaryBadges.map((badge) => (
              <span
                key={badge.key}
                className={`${badge.className} px-1.5 py-0.5 text-[9px] shadow backdrop-blur-sm`}
              >
                {badge.label}
              </span>
            ))}
          </div>
        )}

        {/* Cart stepper / add button overlaid bottom-right */}
        <div
          className="absolute bottom-1.5 right-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <AnimatePresence mode="wait" initial={false}>
            {totalQty > 0 ? (
              <motion.div
                key="stepper"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center overflow-hidden rounded-lg border border-brand-gold/70 bg-brand-surface/95 shadow-lg backdrop-blur-sm"
              >
                <motion.button
                  onClick={handleDecrement}
                  whileTap={{ scale: 0.85 }}
                  className="flex h-7 w-7 items-center justify-center text-brand-gold hover:bg-brand-gold/10 transition-colors"
                >
                  <Minus size={13} strokeWidth={2.5} />
                </motion.button>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={totalQty}
                    initial={{ y: -8, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 8, opacity: 0 }}
                    transition={{ duration: 0.13 }}
                    className="w-6 text-center text-[13px] font-extrabold text-brand-gold tabular-nums"
                  >
                    {totalQty}
                  </motion.span>
                </AnimatePresence>
                <motion.button
                  onClick={handleIncrement}
                  whileTap={{ scale: 0.85 }}
                  className="flex h-7 w-7 items-center justify-center text-brand-gold hover:bg-brand-gold/10 transition-colors"
                >
                  <Plus size={13} strokeWidth={2.5} />
                </motion.button>
              </motion.div>
            ) : (
              <motion.button
                key="add"
                onClick={handleIncrement}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileTap={{ scale: 0.85 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-gold/60 bg-brand-surface/90 text-brand-gold shadow-lg backdrop-blur-sm hover:bg-brand-gold hover:text-brand-bg transition-all"
                aria-label={`Add ${item.name} to cart`}
              >
                <Plus size={16} strokeWidth={2.5} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Info */}
      <div className="px-2.5 py-2">
        <p
          className="text-[13px] font-semibold text-white leading-snug overflow-hidden"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {item.name}
        </p>
        <p className="mt-1 text-[14px] font-extrabold text-brand-gold tracking-tight">
          &#8377;{item.price}
        </p>
      </div>
    </div>
  );
}
