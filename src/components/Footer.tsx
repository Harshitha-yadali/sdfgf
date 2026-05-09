import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin, Clock3, BadgeCheck, MessageCircle, Instagram } from 'lucide-react';
import {
  storeAddressFull,
  storeEmail,
  storeFssaiLicense,
  storeHoursText,
  storeInstagramHref,
  storePhoneDisplay,
  storePhoneHref,
  storeWhatsAppHref,
} from '../lib/storeInfo';

export default function Footer() {
  return (
    <footer className="relative">
      <div className="section-padding py-10 lg:py-14">
        <div className="gloss-shell rounded-[28px] px-6 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3 lg:gap-12">
            <div>
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-2 backdrop-blur-xl">
                  <img src="/image.png" alt="The Supreme Waffle" loading="lazy" width={40} height={40} className="h-10 w-auto object-contain" />
                </div>
              </div>
              <p className="max-w-sm text-[14px] leading-relaxed text-brand-text-dim">
                Crafting the finest waffles with premium ingredients. Every bite is a moment of pure joy.
              </p>
              <div className="mt-5 space-y-2 text-[13px] text-brand-text-dim">
                <p className="flex items-center gap-2">
                  <BadgeCheck size={14} strokeWidth={2.2} className="text-brand-gold-muted" />
                  <span>FSSAI Lic. No. {storeFssaiLicense}</span>
                </p>
                <p className="flex items-center gap-2">
                  <Clock3 size={14} strokeWidth={2.2} className="text-brand-gold-muted" />
                  <span>{storeHoursText}</span>
                </p>
              </div>
            </div>

            <div>
              <h4 className="mb-4 text-[12px] font-bold uppercase tracking-[0.15em] text-brand-text-dim">Quick Links</h4>
              <ul className="space-y-2.5">
                {[
                  { to: '/menu', label: 'Our Menu' },
                  { to: '/offers', label: 'Offers' },
                  { to: '/track', label: 'Track Order' },
                  { to: '/about', label: 'About Us' },
                  { to: '/contact', label: 'Contact' },
                ].map((link) => (
                  <li key={link.label}>
                    <Link to={link.to} className="text-[14px] font-medium text-brand-text-muted transition-colors duration-200 hover:text-brand-gold">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="mb-4 text-[12px] font-bold uppercase tracking-[0.15em] text-brand-text-dim">Visit And Contact</h4>
              <ul className="space-y-3">
                <li>
                  <a href={storePhoneHref} className="flex items-center gap-3 text-[14px] text-brand-text-muted transition-colors hover:text-white">
                    <Phone size={14} strokeWidth={2.2} className="flex-shrink-0 text-brand-gold-muted" />
                    <span>{storePhoneDisplay}</span>
                  </a>
                </li>
                <li className="flex items-center gap-3 text-[14px] text-brand-text-muted">
                  <Mail size={14} strokeWidth={2.2} className="flex-shrink-0 text-brand-gold-muted" />
                  <span>{storeEmail}</span>
                </li>
                <li className="flex items-start gap-3 text-[14px] text-brand-text-muted">
                  <MapPin size={14} strokeWidth={2.2} className="mt-0.5 flex-shrink-0 text-brand-gold-muted" />
                  <span>{storeAddressFull}</span>
                </li>
              </ul>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <a
                  href={storeWhatsAppHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-[13px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/15"
                >
                  <MessageCircle size={14} strokeWidth={2.2} />
                  <span>WhatsApp</span>
                </a>
                <a
                  href={storeInstagramHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[13px] font-semibold text-brand-text-muted transition-colors hover:text-white"
                >
                  <Instagram size={14} strokeWidth={2.2} />
                  <span>Instagram</span>
                </a>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-5 sm:flex-row">
            <p className="text-[12px] font-semibold text-brand-text-dim">
              &copy; {new Date().getFullYear()} The Supreme Waffle. All rights reserved.
            </p>
            <div className="flex items-center gap-5 text-[12px] font-semibold text-brand-text-dim">
              <Link to="/privacy" className="transition-colors hover:text-brand-text-muted">
                Privacy Policy
              </Link>
              <Link to="/terms" className="transition-colors hover:text-brand-text-muted">
                Terms of Service
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
