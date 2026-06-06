import { Link, useLocation } from 'react-router-dom';
import { Home, UtensilsCrossed, Package, User, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';

const tabs = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/menu', icon: UtensilsCrossed, label: 'Menu' },
  { to: '/offers', icon: Tag, label: 'Offers' },
  { to: '/my-orders', icon: Package, label: 'Orders' },
  { to: '/auth', icon: User, label: 'Profile' },
];

export default function BottomNav() {
  const location = useLocation();
  const { user } = useAuth();

  const isAdmin = location.pathname.startsWith('/admin');
  const isChef = location.pathname.startsWith('/chef');
  if (isAdmin || isChef) return null;

  function getProfileTo() {
    return user ? '/profile' : '/auth';
  }

  function isActive(to: string) {
    if (to === '/') return location.pathname === '/';
    if (to === '/auth') return location.pathname === '/auth' || location.pathname === '/profile';
    return location.pathname.startsWith(to);
  }

  return (
    <nav className="customer-bottom-nav">
      <div className="flex items-center justify-around h-[62px] max-w-lg mx-auto px-2">
        {tabs.map((tab) => {
          const to = tab.to === '/auth' ? getProfileTo() : tab.to;
          const active = isActive(tab.to);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.label}
              to={to}
              className="flex flex-1 flex-col items-center justify-center py-1"
            >
              <div className="relative flex flex-col items-center gap-[5px] px-3 py-1.5 rounded-xl">
                {/* Active pill */}
                <AnimatePresence>
                  {active && (
                    <motion.div
                      layoutId="navPill"
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background: 'rgba(216,178,78,0.12)',
                        border: '1px solid rgba(216,178,78,0.22)',
                        boxShadow: '0 0 12px rgba(216,178,78,0.08)',
                      }}
                      initial={{ opacity: 0, scale: 0.88 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.88 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                </AnimatePresence>

                <motion.div
                  className="relative z-10"
                  whileTap={{ scale: 0.80 }}
                  transition={{ duration: 0.1 }}
                >
                  <Icon
                    size={21}
                    strokeWidth={active ? 2.5 : 1.8}
                    className={`transition-colors duration-200 ${
                      active ? 'text-brand-gold' : 'text-brand-text-dim'
                    }`}
                  />
                </motion.div>

                <span
                  className={`relative z-10 text-[10px] leading-none transition-colors duration-200 ${
                    active ? 'font-bold text-brand-gold' : 'font-medium text-brand-text-dim'
                  }`}
                >
                  {tab.label === 'Profile' && user ? 'Profile' : tab.label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
