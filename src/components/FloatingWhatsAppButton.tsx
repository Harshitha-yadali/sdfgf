import { MessageCircle } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useCart } from '../contexts/CartContext';
import { storeWhatsAppHref } from '../lib/storeInfo';

export default function FloatingWhatsAppButton() {
  const location = useLocation();
  const { itemCount } = useCart();

  const hidden = location.pathname === '/cart'
    || location.pathname.startsWith('/admin')
    || location.pathname.startsWith('/chef')
    || location.pathname.startsWith('/order-success');

  if (hidden) return null;

  return (
    <a
      href={storeWhatsAppHref}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat on WhatsApp"
      className={`customer-whatsapp-button ${itemCount > 0 ? 'customer-whatsapp-button--lifted' : ''}`}
    >
      <MessageCircle size={26} strokeWidth={2.4} />
    </a>
  );
}
