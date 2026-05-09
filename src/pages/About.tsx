import { useState } from 'react';
import { Shield, Leaf, Award, Phone, MessageCircle, Mail, MapPin, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../components/Toast';

export default function AboutPage() {
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
    const { error } = await supabase.from('contact_messages').insert({ name: name.trim(), email: email.trim(), message: message.trim() });
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
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://images.pexels.com/photos/2103124/pexels-photo-2103124.jpeg?auto=compress&cs=tinysrgb&w=1920&h=600&fit=crop"
            alt="Fresh gourmet waffles from The Supreme Waffle"
            loading="eager"
            fetchPriority="high"
            width={1920}
            height={600}
            className="w-full h-full object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-brand-bg via-brand-bg/95 to-brand-bg/70" />
        </div>
        <div className="relative section-padding py-24 lg:py-32">
          <div className="max-w-2xl">
            <span className="section-label">Our Story</span>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white mt-3 mb-6 leading-tight">
              Crafted with Passion,{' '}
              <span className="text-brand-gold">Served with Love</span>
            </h1>
            <p className="text-brand-text-muted text-lg leading-relaxed max-w-xl">
              Born from a love of crispy, golden waffles and a dream to make premium quality accessible to everyone. Every waffle at The Supreme Waffle is handcrafted using the finest ingredients, baked to golden perfection.
            </p>
          </div>
        </div>
      </section>

      <section className="section-padding py-16 lg:py-24">
        <div className="text-center mb-12">
          <span className="section-label">Why Choose Us</span>
          <h2 className="section-title">What Sets Us Apart</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 lg:gap-8">
          {[
            { icon: Shield, title: 'Hygiene First', desc: 'FSSAI certified kitchen. Daily sanitization protocols. Sealed packaging for every order.' },
            { icon: Leaf, title: 'Fresh Ingredients', desc: 'We source premium ingredients daily. No preservatives, no artificial flavors. Pure goodness.' },
            { icon: Award, title: 'Quality Promise', desc: 'If your waffle is not perfect, we will make it right. That is the Supreme Waffle guarantee.' },
          ].map((item) => (
            <div
              key={item.title}
              className="bg-brand-surface rounded-xl p-6 border border-brand-border hover:border-brand-gold/20 transition-all duration-300 text-center"
            >
              <div className="w-14 h-14 bg-brand-gold/10 rounded-xl flex items-center justify-center mx-auto mb-5">
                <item.icon size={28} strokeWidth={2.2} className="text-brand-gold" />
              </div>
              <h3 className="font-bold text-lg text-white mb-2">{item.title}</h3>
              <p className="text-brand-text-muted text-[14px] leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="section-padding">
          <div className="text-center mb-12">
            <span className="section-label">Get in Touch</span>
            <h2 className="section-title">Contact Us</h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
            <div className="bg-brand-surface rounded-xl p-6 border border-brand-border">
              <h3 className="font-bold text-xl text-white mb-6">Reach Out Directly</h3>
              <div className="space-y-5 mb-8">
                {[
                  { icon: Phone, label: 'Phone', value: '+91 98765 43210' },
                  { icon: Mail, label: 'Email', value: 'thesupremewafflee@gmail.com' },
                  { icon: MapPin, label: 'Address', value: 'Police Station Road, Kanuru, Vijayawada' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-4">
                    <div className="w-11 h-11 bg-brand-gold/10 rounded-xl flex items-center justify-center flex-shrink-0">
                      <item.icon size={18} strokeWidth={2.2} className="text-brand-gold" />
                    </div>
                    <div>
                      <p className="font-semibold text-[14px] text-white">{item.label}</p>
                      <p className="text-brand-text-muted text-[14px]">{item.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              <a
                href="https://wa.me/919876543210?text=Hi, I have a question about The Supreme Waffle"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-emerald-500 text-white font-semibold px-6 py-3 rounded-xl hover:bg-emerald-600 transition-colors duration-200"
              >
                <MessageCircle size={18} strokeWidth={2.2} />
                Chat on WhatsApp
              </a>
            </div>

            <div className="bg-brand-surface rounded-xl p-6 border border-brand-border">
              <h3 className="font-bold text-xl text-white mb-6">Send Us a Message</h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                <input type="text" placeholder="Your Name" value={name} onChange={(e) => setName(e.target.value)} className="input-field" />
                <input type="email" placeholder="Your Email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" />
                <textarea placeholder="Your Message" value={message} onChange={(e) => setMessage(e.target.value)} className="input-field resize-none" rows={5} />
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
