import { Link, useLocation } from 'react-router-dom';
import { Home, UtensilsCrossed, Package, User, Tag } from 'lucide-react';
import { motion } from 'motion/react';
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
      <div className="flex items-center justify-around h-[64px] max-w-lg mx-auto px-1">
        {tabs.map((tab) => {
          const to = tab.to === '/auth' ? getProfileTo() : tab.to;
          const active = isActive(tab.to);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.label}
              to={to}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-2 transition-all ${
                active
                  ? 'text-brand-gold'
                  : 'text-brand-text-dim hover:text-brand-text-muted'
              }`}
            >
              <motion.div
                className="relative"
                whileTap={{ scale: 0.82 }}
                transition={{ duration: 0.1 }}
              >
                {active ? (
                  <motion.div
                    layoutId="bottomNavActive"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  >
                    <Icon size={22} strokeWidth={2.5} />
                  </motion.div>
                ) : (
                  <Icon size={22} strokeWidth={1.8} />
                )}
                {active && (
                  <motion.div
                    layoutId="bottomNavDot"
                    className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand-gold shadow-[0_0_8px_rgba(216,178,78,0.7)]"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
              </motion.div>
              <span className={`text-[10px] leading-none ${active ? 'font-bold' : 'font-medium'}`}>
                {tab.label === 'Profile' && user ? 'Profile' : tab.label}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
