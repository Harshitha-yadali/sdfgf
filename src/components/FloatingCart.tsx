import { Link, useLocation } from 'react-router-dom';
import { ShoppingBag, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCart } from '../contexts/CartContext';

export default function FloatingCart() {
  const { itemCount, subtotal } = useCart();
  const location = useLocation();

  const hidden = location.pathname === '/cart'
    || location.pathname.startsWith('/admin')
    || location.pathname.startsWith('/chef')
    || location.pathname.startsWith('/order-success')
    || itemCount === 0;

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          className="customer-floating-cart lg:hidden"
        >
          <Link to="/cart">
            <motion.div
              className="bg-brand-gold rounded-2xl px-5 py-3.5 flex items-center justify-between shadow-glow-gold"
              whileHover={{ filter: 'brightness(1.1)' }}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <ShoppingBag size={20} strokeWidth={2.5} className="text-brand-bg" />
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={itemCount}
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                      className="absolute -top-2 -right-2.5 w-5 h-5 bg-brand-bg text-brand-gold text-[11px] font-extrabold rounded-full flex items-center justify-center"
                    >
                      {itemCount}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <div className="text-brand-bg">
                  <span className="text-[14px] font-extrabold">
                    View Cart ({itemCount} {itemCount === 1 ? 'item' : 'items'})
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 text-brand-bg">
                <span className="text-[14px] font-extrabold tabular-nums">
                  {'\u20B9'}{subtotal.toFixed(0)}
                </span>
                <ChevronRight size={16} strokeWidth={2.5} />
              </div>
            </motion.div>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
