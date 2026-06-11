import { useState, useRef, useEffect, useCallback } from 'react';
import { MapPin, Search, Loader2, Navigation, X } from 'lucide-react';

interface LocationResult {
  display_name: string;
  lat?: string;
  lon?: string;
  address: {
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    country?: string;
    house_number?: string;
    county?: string;
  };
}

interface LocationPickerProps {
  address: string;
  pincode: string;
  onAddressChange: (address: string) => void;
  onPincodeChange: (pincode: string) => void;
  onLatChange?: (lat: number | null) => void;
  onLngChange?: (lng: number | null) => void;
}

export default function LocationPicker({
  address,
  pincode,
  onAddressChange,
  onPincodeChange,
  onLatChange,
  onLngChange,
}: LocationPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [geoError, setGeoError] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchAddress = useCallback(async (q: string) => {
    if (q.trim().length < 3) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=in&limit=5&q=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      setResults(data);
      setShowResults(true);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
    setGeoError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchAddress(value), 400);
  }

  function formatAddress(result: LocationResult): { fullAddress: string; postcode: string } {
    const a = result.address;
    const parts: string[] = [];
    if (a.house_number) parts.push(a.house_number);
    if (a.road) parts.push(a.road);
    if (a.neighbourhood) parts.push(a.neighbourhood);
    if (a.suburb) parts.push(a.suburb);
    const locality = a.city || a.town || a.village || '';
    if (locality) parts.push(locality);
    if (a.county && a.county !== locality) parts.push(a.county);
    if (a.state) parts.push(a.state);
    return { fullAddress: parts.join(', '), postcode: a.postcode?.replace(/\s/g, '') || '' };
  }

  function selectResult(result: LocationResult) {
    const { fullAddress, postcode: pc } = formatAddress(result);
    onAddressChange(fullAddress);
    if (pc && pc.length === 6) onPincodeChange(pc);
    const lat = result.lat ? parseFloat(result.lat) : null;
    const lng = result.lon ? parseFloat(result.lon) : null;
    onLatChange?.(Number.isFinite(lat) ? lat : null);
    onLngChange?.(Number.isFinite(lng) ? lng : null);
    setQuery('');
    setResults([]);
    setShowResults(false);
  }

  async function detectLocation() {
    setGeoError('');
    if (!navigator.geolocation) { setGeoError('Geolocation is not supported by your browser'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${latitude}&lon=${longitude}`
          );
          const data: LocationResult = await res.json();
          const { fullAddress, postcode: pc } = formatAddress(data);
          onAddressChange(fullAddress);
          if (pc && pc.length === 6) onPincodeChange(pc);
          onLatChange?.(latitude);
          onLngChange?.(longitude);
        } catch { setGeoError('Could not determine your address'); }
        finally { setLocating(false); }
      },
      () => { setGeoError('Location access denied. Please allow location or search manually.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={detectLocation}
        disabled={locating}
        className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-brand-gold/[0.06] border border-brand-gold/20 rounded-xl text-brand-gold font-semibold text-[14px] hover:bg-brand-gold/10 transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
      >
        {locating ? <Loader2 size={16} strokeWidth={2.2} className="animate-spin" /> : <Navigation size={16} strokeWidth={2.2} />}
        {locating ? 'Detecting location...' : 'Use My Current Location'}
      </button>

      {geoError && <p className="text-[12px] font-semibold text-red-400">{geoError}</p>}

      <div ref={wrapperRef} className="relative">
        <Search size={16} strokeWidth={2.2} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-text-dim pointer-events-none" />
        <input
          type="text"
          placeholder="Search for your area, street, landmark..."
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          className="input-field pl-10 pr-9"
        />
        {searching && <Loader2 size={16} strokeWidth={2.2} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-text-dim animate-spin" />}
        {query && !searching && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResults([]); setShowResults(false); }}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-text-dim hover:text-white transition-colors"
          >
            <X size={16} strokeWidth={2.2} />
          </button>
        )}

        {showResults && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-brand-surface border border-brand-border rounded-xl shadow-elevated z-30 max-h-60 overflow-y-auto animate-slide-down">
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectResult(r)}
                className="w-full text-left px-4 py-3 hover:bg-brand-surface-light/70 transition-colors border-b border-brand-border last:border-0 flex items-start gap-3"
              >
                <MapPin size={15} strokeWidth={2.2} className="text-brand-gold flex-shrink-0 mt-0.5" />
                <span className="text-[14px] text-brand-text-muted leading-snug line-clamp-2">{r.display_name}</span>
              </button>
            ))}
          </div>
        )}

        {showResults && query.length >= 3 && !searching && results.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-brand-surface border border-brand-border rounded-xl shadow-elevated z-30 px-4 py-3">
            <p className="text-[14px] text-brand-text-dim text-center">No results found</p>
          </div>
        )}
      </div>

      {address && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          <div className="flex items-start gap-2.5">
            <MapPin size={14} strokeWidth={2.2} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            <p className="text-[14px] text-emerald-400 flex-1 leading-snug">{address}</p>
          </div>
        </div>
      )}

      <textarea
        placeholder="Full address (apt, floor, landmark) *"
        value={address}
        onChange={(e) => { onAddressChange(e.target.value); onLatChange?.(null); onLngChange?.(null); }}
        className="input-field resize-none"
        rows={2}
      />

      <input
        type="text"
        placeholder="Pincode *"
        value={pincode}
        onChange={(e) => onPincodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="input-field"
      />
    </div>
  );
}
