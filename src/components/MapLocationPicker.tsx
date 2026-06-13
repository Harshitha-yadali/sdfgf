import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, MapPin, Navigation, Search, Loader2, X, Home } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

const DEFAULT_LAT = 16.4724;
const DEFAULT_LNG = 80.6516;
const DEFAULT_ZOOM = 18;

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  namedetails?: Record<string, string>;
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
    house_name?: string;
    building?: string;
    amenity?: string;
    shop?: string;
    county?: string;
    quarter?: string;
  };
}

interface SearchSuggestion {
  label: string;
  sublabel: string;
  lat: number;
  lng: number;
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
  const detailInputRef = useRef<HTMLInputElement>(null);
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
  const [detailError, setDetailError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [locating, setLocating] = useState(false);
  const [centerLat, setCenterLat] = useState(initialLat ?? DEFAULT_LAT);
  const [centerLng, setCenterLng] = useState(initialLng ?? DEFAULT_LNG);

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setResolving(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&namedetails=1&zoom=18&lat=${lat}&lon=${lng}`
      );
      const data: NominatimResult = await res.json();
      const a = data.address;

      // Prefer specific place name (building/amenity/shop) then road-level
      const placeName = a.amenity || a.shop || a.building || a.house_name || '';
      const area = placeName || a.neighbourhood || a.quarter || a.suburb || a.town || a.city || a.county || '';
      setAreaName(area);

      // Build address string with most specific parts first
      const parts: string[] = [];
      if (a.house_number) parts.push(a.house_number);
      if (a.road) parts.push(a.road);
      if (a.neighbourhood) parts.push(a.neighbourhood);
      if (a.quarter && a.quarter !== a.neighbourhood) parts.push(a.quarter);
      if (a.suburb && a.suburb !== a.neighbourhood && a.suburb !== a.quarter) parts.push(a.suburb);
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
    if (mapRef.current) mapRef.current.flyTo([lat, lng], 18, { duration: 0.8 });
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
    if (q.trim().length < 2) { setSearchResults([]); setNoResults(false); return; }
    setSearching(true);
    setNoResults(false);

    const seen = new Set<string>();
    const results: SearchSuggestion[] = [];

    function addSuggestion(s: SearchSuggestion) {
      const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
      if (!seen.has(key) && s.label.trim()) { seen.add(key); results.push(s); }
    }

    const delta = 0.15;
    const south = centerLat - delta;
    const north = centerLat + delta;
    const west = centerLng - delta;
    const east = centerLng + delta;

    try {
      // Run Photon + Nominatim in parallel for maximum coverage
      const [photonRes, nomRes] = await Promise.allSettled([
        fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10&lang=en&lat=${centerLat}&lon=${centerLng}`)
          .then(r => r.json()),
        fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&namedetails=1&limit=8&viewbox=${west},${south},${east},${north}&bounded=0&q=${encodeURIComponent(q)}`)
          .then(r => r.json()),
      ]);

      // Photon results
      if (photonRes.status === 'fulfilled') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const f of (photonRes.value?.features || []) as any[]) {
          const p = f.properties;
          const name = p.name || p.street || p.city || '';
          const parts: string[] = [];
          if (p.street && p.street !== name) parts.push(p.street);
          if (p.district) parts.push(p.district);
          if (p.city) parts.push(p.city);
          if (p.state) parts.push(p.state);
          addSuggestion({ label: name, sublabel: parts.join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
        }
      }

      // Nominatim results
      if (nomRes.status === 'fulfilled') {
        for (const r of (nomRes.value || []) as NominatimResult[]) {
          const a = r.address;
          const name = r.namedetails?.name || a.amenity || a.shop || a.building || a.road || r.display_name.split(',')[0];
          const parts: string[] = [];
          if (a.road && a.road !== name) parts.push(a.road);
          if (a.neighbourhood) parts.push(a.neighbourhood);
          const city = a.city || a.town || a.village || '';
          if (city) parts.push(city);
          addSuggestion({ label: name, sublabel: parts.join(', '), lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
        }
      }

      // Overpass API as final fallback — searches OSM named entities in viewport directly
      if (results.length === 0) {
        const safeQ = q.replace(/[\\"\[\]{}()|?+*^$]/g, '').trim();
        if (safeQ.length >= 2) {
          const ovQuery = `[out:json][timeout:8];(node["name"~"${safeQ}",i](${south},${west},${north},${east});way["name"~"${safeQ}",i](${south},${west},${north},${east}););out center 8;`;
          try {
            const ovRes = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(ovQuery)}`);
            const ovData = await ovRes.json();
            for (const el of (ovData.elements || [])) {
              const lat = el.lat ?? el.center?.lat;
              const lng = el.lon ?? el.center?.lon;
              if (!lat || !lng || !el.tags?.name) continue;
              addSuggestion({
                label: el.tags.name,
                sublabel: el.tags['addr:street'] || el.tags['addr:suburb'] || el.tags.amenity || '',
                lat, lng,
              });
            }
          } catch { /* ignore overpass errors */ }
        }
      }

      setSearchResults(results.slice(0, 8));
      setShowResults(results.length > 0);
      setNoResults(results.length === 0);
    } catch {
      setSearchResults([]);
      setNoResults(true);
    } finally {
      setSearching(false);
    }
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    if (!value.trim()) { setSearchResults([]); setShowResults(false); setNoResults(false); }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => void doSearch(value), 300);
  }

  function selectSearchResult(r: SearchSuggestion) {
    flyTo(r.lat, r.lng);
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
    setNoResults(false);
  }

  function handleConfirm() {
    if (!detail.trim()) {
      setDetailError(true);
      detailInputRef.current?.focus();
      return;
    }
    const finalPincode = detectedPincode || manualPincode.replace(/\D/g, '').slice(0, 6);
    const baseAddress = fullAddress || areaName || '';
    const finalAddress = `${detail.trim()}, ${baseAddress}`;
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
                onClick={() => { setSearchQuery(''); setSearchResults([]); setShowResults(false); setNoResults(false); }}
                className="absolute right-7 top-1/2 -translate-y-1/2 text-brand-text-dim hover:text-white transition-colors"
              >
                <X size={15} strokeWidth={2.2} />
              </button>
            )}

          {(showResults && searchResults.length > 0) || noResults ? (
            <div className="absolute left-4 right-4 top-full mt-0.5 bg-brand-surface border border-brand-border rounded-xl shadow-elevated z-10 max-h-64 overflow-y-auto">
              {noResults ? (
                <div className="px-4 py-4 text-center">
                  <p className="text-[13px] text-brand-text-dim font-semibold">No results found</p>
                  <p className="text-[11px] text-brand-text-dim/60 mt-1 leading-snug">This place may not be in the map database yet. <br/>Drag the map pin to your exact location instead.</p>
                </div>
              ) : (
                searchResults.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectSearchResult(r)}
                    className="w-full text-left px-4 py-3 hover:bg-brand-surface-light transition-colors border-b border-brand-border last:border-0 flex items-start gap-3"
                  >
                    <MapPin size={14} strokeWidth={2.2} className="text-brand-gold flex-shrink-0 mt-1" />
                    <div className="min-w-0">
                      <p className="text-[13px] text-white font-semibold leading-snug truncate">{r.label}</p>
                      {r.sublabel && (
                        <p className="text-[11px] text-brand-text-dim leading-snug truncate mt-0.5">{r.sublabel}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative min-h-0">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Fixed center pin */}
        <div
          className="absolute pointer-events-none flex flex-col items-center"
          style={{
            zIndex: 9999,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: '50%',
              background: '#D8B24E',
              border: '3px solid #ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 6px 28px rgba(216,178,78,0.65), 0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            <MapPin size={22} color="#0f1117" strokeWidth={2.8} />
          </div>
          <div style={{ width: 3, height: 14, background: '#D8B24E', borderRadius: '0 0 3px 3px' }} />
          <div style={{ width: 10, height: 4, borderRadius: '50%', background: 'rgba(0,0,0,0.25)', marginTop: 1 }} />
        </div>

        {/* Drag hint */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none" style={{ zIndex: 9999 }}>
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
        {/* Detected area */}
        <div className="flex items-start gap-3 min-h-[44px]">
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

        {/* House / flat input — required */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[12px] font-bold text-white">
            <Home size={12} strokeWidth={2.5} className="text-brand-gold" />
            House / Flat no. &amp; Building name
            <span className="text-red-400 text-[13px] leading-none">*</span>
          </label>
          <input
            ref={detailInputRef}
            type="text"
            placeholder="e.g. Flat 4B, Sri Sai Residency"
            value={detail}
            onChange={(e) => { setDetail(e.target.value); if (e.target.value.trim()) setDetailError(false); }}
            className={`input-field text-[14px] transition-colors ${detailError ? 'border-red-500/60 focus:border-red-500' : ''}`}
          />
          {detailError ? (
            <p className="text-[12px] text-red-400 font-semibold">
              Enter your house / flat number to continue
            </p>
          ) : (
            <p className="text-[11px] text-brand-text-dim leading-snug">
              The map shows the area — your exact house number helps the delivery partner find you
            </p>
          )}
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
