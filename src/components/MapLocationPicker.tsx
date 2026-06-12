import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, MapPin, Navigation, Search, Loader2, X } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

const DEFAULT_LAT = 16.4724;
const DEFAULT_LNG = 80.6516;
const DEFAULT_ZOOM = 15;

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address: {
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    house_number?: string;
    county?: string;
  };
}

export interface MapConfirmData {
  address: string;
  pincode: string;
  lat: number;
  lng: number;
}

interface Props {
  initialLat: number | null;
  initialLng: number | null;
  onConfirm: (data: MapConfirmData) => void;
  onClose: () => void;
}

export default function MapLocationPicker({ initialLat, initialLng, onConfirm, onClose }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const resolveDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [resolving, setResolving] = useState(true);
  const [areaName, setAreaName] = useState('');
  const [fullAddress, setFullAddress] = useState('');
  const [detectedPincode, setDetectedPincode] = useState('');
  const [manualPincode, setManualPincode] = useState('');
  const [detail, setDetail] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [locating, setLocating] = useState(false);
  const [centerLat, setCenterLat] = useState(initialLat ?? DEFAULT_LAT);
  const [centerLng, setCenterLng] = useState(initialLng ?? DEFAULT_LNG);

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setResolving(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lng}`
      );
      const data: NominatimResult = await res.json();
      const a = data.address;
      const area = a.neighbourhood || a.suburb || a.town || a.city || a.county || '';
      setAreaName(area);
      const parts: string[] = [];
      if (a.house_number) parts.push(a.house_number);
      if (a.road) parts.push(a.road);
      if (a.neighbourhood) parts.push(a.neighbourhood);
      if (a.suburb && a.suburb !== a.neighbourhood) parts.push(a.suburb);
      const city = a.city || a.town || a.village || '';
      if (city) parts.push(city);
      if (a.state) parts.push(a.state);
      setFullAddress(parts.join(', '));
      const pc = (a.postcode || '').replace(/\s/g, '');
      setDetectedPincode(pc.length === 6 ? pc : '');
    } catch {
      setAreaName('');
      setFullAddress('');
      setDetectedPincode('');
    } finally {
      setResolving(false);
    }
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || typeof window === 'undefined') return;
    let mounted = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mapInstance: any = null;

    const initMap = async () => {
      const L = (await import('leaflet')).default;
      if (!mounted || !mapContainerRef.current) return;

      mapInstance = L.map(mapContainerRef.current, {
        center: [initialLat ?? DEFAULT_LAT, initialLng ?? DEFAULT_LNG],
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
      });

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      }).addTo(mapInstance);

      L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);

      mapInstance.on('moveend', () => {
        if (!mounted) return;
        const center = mapInstance.getCenter();
        setCenterLat(center.lat);
        setCenterLng(center.lng);
        if (resolveDebounceRef.current) clearTimeout(resolveDebounceRef.current);
        resolveDebounceRef.current = setTimeout(() => {
          if (mounted) void reverseGeocode(center.lat, center.lng);
        }, 700);
      });

      mapRef.current = mapInstance;
      void reverseGeocode(initialLat ?? DEFAULT_LAT, initialLng ?? DEFAULT_LNG);
    };

    void initMap();

    return () => {
      mounted = false;
      if (resolveDebounceRef.current) clearTimeout(resolveDebounceRef.current);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (mapInstance) mapInstance.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function flyTo(lat: number, lng: number) {
    if (mapRef.current) mapRef.current.flyTo([lat, lng], 16, { duration: 0.8 });
  }

  function detectLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { flyTo(pos.coords.latitude, pos.coords.longitude); setLocating(false); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function doSearch(q: string) {
    if (q.trim().length < 3) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=in&limit=5&q=${encodeURIComponent(q)}`
      );
      const data: NominatimResult[] = await res.json();
      setSearchResults(data);
      setShowResults(true);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    if (!value.trim()) { setSearchResults([]); setShowResults(false); }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => void doSearch(value), 400);
  }

  function selectSearchResult(r: NominatimResult) {
    flyTo(parseFloat(r.lat), parseFloat(r.lon));
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
  }

  function handleConfirm() {
    const finalPincode = detectedPincode || manualPincode.replace(/\D/g, '').slice(0, 6);
    const baseAddress = fullAddress || areaName || '';
    const finalAddress = detail.trim() ? `${detail.trim()}, ${baseAddress}` : baseAddress;
    onConfirm({ address: finalAddress, pincode: finalPincode, lat: centerLat, lng: centerLng });
  }

  const needsPincodeInput = !resolving && !detectedPincode;
  const confirmDisabled = resolving || (!areaName && !fullAddress);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: '#0f1117' }}>
      {/* Header */}
      <div className="flex-shrink-0 bg-brand-surface border-b border-brand-border">
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <button
            onClick={onClose}
            className="p-2 -ml-2 rounded-xl hover:bg-brand-surface-light transition-colors text-white"
          >
            <ArrowLeft size={20} strokeWidth={2.2} />
          </button>
          <h2 className="text-[15px] font-bold text-white flex-1">Select delivery location</h2>
          <button
            onClick={detectLocation}
            disabled={locating}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-gold/10 border border-brand-gold/20 rounded-lg text-brand-gold text-[12px] font-bold hover:bg-brand-gold/15 transition-all disabled:opacity-50"
          >
            {locating
              ? <Loader2 size={13} className="animate-spin" />
              : <Navigation size={13} strokeWidth={2.2} />}
            <span>My location</span>
          </button>
        </div>

        {/* Search bar */}
        <div ref={searchWrapperRef} className="relative px-4 pb-3">
          <Search size={15} strokeWidth={2.2} className="absolute left-7 top-1/2 -translate-y-1/2 text-brand-text-dim pointer-events-none" />
          <input
            type="text"
            placeholder="Search area, street, landmark..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowResults(true)}
            className="input-field pl-9 pr-9 text-[14px] w-full"
          />
          {searching
            ? <Loader2 size={15} strokeWidth={2} className="absolute right-7 top-1/2 -translate-y-1/2 text-brand-text-dim animate-spin pointer-events-none" />
            : searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setSearchResults([]); setShowResults(false); }}
                className="absolute right-7 top-1/2 -translate-y-1/2 text-brand-text-dim hover:text-white transition-colors"
              >
                <X size={15} strokeWidth={2.2} />
              </button>
            )}

          {showResults && searchResults.length > 0 && (
            <div className="absolute left-4 right-4 top-full mt-0.5 bg-brand-surface border border-brand-border rounded-xl shadow-elevated z-10 max-h-56 overflow-y-auto">
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectSearchResult(r)}
                  className="w-full text-left px-4 py-3 hover:bg-brand-surface-light transition-colors border-b border-brand-border last:border-0 flex items-start gap-3"
                >
                  <MapPin size={14} strokeWidth={2.2} className="text-brand-gold flex-shrink-0 mt-0.5" />
                  <span className="text-[13px] text-brand-text-muted leading-snug line-clamp-2">{r.display_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative min-h-0">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Fixed center pin (map moves under this) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[10]">
          <div className="flex flex-col items-center" style={{ marginTop: '-44px' }}>
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center border-[3px] border-white"
              style={{ background: '#D8B24E', boxShadow: '0 4px 24px rgba(216,178,78,0.55)' }}
            >
              <MapPin size={20} className="text-[#0f1117]" strokeWidth={2.8} />
            </div>
            {/* Pin needle */}
            <div
              className="w-[3px] h-[10px] rounded-b-full"
              style={{ background: 'rgba(216,178,78,0.7)' }}
            />
            {/* Shadow dot */}
            <div
              className="w-[6px] h-[3px] rounded-full mt-0.5"
              style={{ background: 'rgba(0,0,0,0.3)' }}
            />
          </div>
        </div>

        {/* Drag hint */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[10] pointer-events-none">
          <div
            className="rounded-full px-3.5 py-1.5 text-[11px] font-semibold text-white/90"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          >
            Drag map to move pin
          </div>
        </div>
      </div>

      {/* Bottom sheet */}
      <div className="flex-shrink-0 bg-brand-surface border-t border-brand-border px-4 pt-4 pb-6 space-y-3">
        {/* Address preview */}
        <div className="flex items-start gap-3 min-h-[52px]">
          <div
            className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
            style={{ background: 'rgba(216,178,78,0.12)' }}
          >
            <MapPin size={16} className="text-brand-gold" strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            {resolving ? (
              <div className="flex items-center gap-2 text-brand-text-dim text-[13px]">
                <Loader2 size={13} className="animate-spin" />
                <span>Locating address...</span>
              </div>
            ) : (
              <>
                <p className="text-[15px] font-bold text-white leading-tight">
                  {areaName || 'Move map to set location'}
                </p>
                {fullAddress && (
                  <p className="text-[12px] text-brand-text-muted leading-snug mt-0.5 line-clamp-2">
                    {fullAddress}
                  </p>
                )}
                {detectedPincode && (
                  <span className="inline-block mt-1 text-[11px] font-semibold text-brand-text-dim bg-brand-surface-light px-2 py-0.5 rounded-md">
                    {detectedPincode}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pincode fallback */}
        {needsPincodeInput && (
          <input
            type="text"
            inputMode="numeric"
            placeholder="Enter 6-digit pincode *"
            value={manualPincode}
            onChange={(e) => setManualPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="input-field text-[14px]"
          />
        )}

        {/* Flat / landmark */}
        <input
          type="text"
          placeholder="Flat no., floor, landmark (optional)"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="input-field text-[14px]"
        />

        {/* Confirm */}
        <button
          onClick={handleConfirm}
          disabled={confirmDisabled}
          className="btn-primary w-full rounded-xl py-3.5 text-[15px] font-black disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Confirm Location
        </button>
      </div>
    </div>,
    document.body
  );
}
