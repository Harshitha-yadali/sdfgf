import { useState } from 'react';
import { Phone, MessageCircle, Mail, MapPin, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/Toast';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const { showToast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim() || !email.trim() || !message.trim()) {
      showToast('Please fill in all fields', 'error');
      return;
    }

    setSending(true);
    const { error } = await supabase.from('contact_messages').insert({
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
    });

    if (error) {
      showToast('Failed to send message', 'error');
    } else {
      showToast('Message sent successfully!');
      setName('');
      setEmail('');
      setMessage('');
    }

    setSending(false);
  }

  return (
    <div className="bg-brand-bg min-h-screen animate-fade-in">
      <section className="section-padding py-16 lg:py-24">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <span className="section-label">Contact</span>
            <h1 className="section-title">Visit Or Reach Out</h1>
            <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-brand-text-muted">
              Find The Supreme Waffle on Police Station Road, Kanuru, Vijayawada. Call, message, or send us a note for orders and store queries.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12">
            <div className="bg-brand-surface rounded-xl border border-brand-border p-6">
              <h2 className="mb-6 text-xl font-bold text-white">Store Details</h2>
              <div className="space-y-5">
                <a href="tel:+919876543210" className="flex items-center gap-4 text-left transition-colors hover:text-white">
                  <div className="w-11 h-11 bg-brand-gold/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Phone size={18} strokeWidth={2.2} className="text-brand-gold" />
                  </div>
                  <div>
                    <p className="font-semibold text-[14px] text-white">Phone</p>
                    <p className="text-brand-text-muted text-[14px]">+91 98765 43210</p>
                  </div>
                </a>

                <a href="mailto:thesupremewafflee@gmail.com" className="flex items-center gap-4 text-left transition-colors hover:text-white">
                  <div className="w-11 h-11 bg-brand-gold/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Mail size={18} strokeWidth={2.2} className="text-brand-gold" />
                  </div>
                  <div>
                    <p className="font-semibold text-[14px] text-white">Email</p>
                    <p className="text-brand-text-muted text-[14px]">thesupremewafflee@gmail.com</p>
                  </div>
                </a>

                <a
                  href="https://maps.google.com/?q=Police%20Station%20Road%2C%20Kanuru%2C%20Vijayawada"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-4 text-left transition-colors hover:text-white"
                >
                  <div className="w-11 h-11 bg-brand-gold/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <MapPin size={18} strokeWidth={2.2} className="text-brand-gold" />
                  </div>
                  <div>
                    <p className="font-semibold text-[14px] text-white">Address</p>
                    <p className="text-brand-text-muted text-[14px]">Police Station Road, Kanuru, Vijayawada, Andhra Pradesh 520007</p>
                  </div>
                </a>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="https://wa.me/919876543210?text=Hi%2C%20I%27d%20like%20to%20order%20from%20The%20Supreme%20Waffle"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-white transition-colors hover:bg-emerald-600"
                >
                  <MessageCircle size={18} strokeWidth={2.2} />
                  Chat On WhatsApp
                </a>
                <a
                  href="tel:+919876543210"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-border px-5 py-3 font-semibold text-brand-text-muted transition-colors hover:border-brand-gold/30 hover:text-white"
                >
                  <Phone size={18} strokeWidth={2.2} />
                  Call Store
                </a>
              </div>
            </div>

            <div className="bg-brand-surface rounded-xl border border-brand-border p-6">
              <h2 className="mb-6 text-xl font-bold text-white">Send Us A Message</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  type="text"
                  placeholder="Your Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field"
                />
                <input
                  type="email"
                  placeholder="Your Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                />
                <textarea
                  placeholder="Your Message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="input-field resize-none"
                  rows={6}
                />
                <button type="submit" disabled={sending} className="btn-primary w-full flex items-center justify-center gap-2">
                  <Send size={16} strokeWidth={2.2} />
                  {sending ? 'Sending...' : 'Send Message'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
