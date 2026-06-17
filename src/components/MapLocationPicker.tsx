import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, MapPin, Navigation, Search, Loader2, X, Home, Layers, Plus, Minus } from 'lucide-react';
import { supabase } from '../lib/supabase';

const DEFAULT_LAT = 16.4724;
const DEFAULT_LNG = 80.6516;
const DEFAULT_ZOOM = 17;
const TILE_PREF_KEY = 'mapTilePreference';
const GMAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || '';

type TileMode = 'street' | 'satellite';

interface SearchSuggestion {
  label: string;
  sublabel: string;
  placeId: string;
}

export interface MapConfirmData {
  address: string;
  pincode: string;
  lat: number;
  lng: number;
}

// Singleton script-load promise so we never inject the tag twice
let gmapsLoadPromise: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).google?.maps?.Map) return Promise.resolve();
  if (gmapsLoadPromise) return gmapsLoadPromise;
  gmapsLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=places`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
  return gmapsLoadPromise;
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
  const [tileMode, setTileMode] = useState<TileMode>(() => {
    if (typeof window === 'undefined') return 'street';
    const saved = window.localStorage.getItem(TILE_PREF_KEY);
    return saved === 'satellite' ? 'satellite' : 'street';
  });

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setResolving(true);
    try {
      const { data, error } = await supabase.functions.invoke('reverse-geocode', {
        body: { lat, lng },
      });
      if (error) throw error;

      const area: string = data?.area || '';
      const fAddr: string = data?.fullAddress || '';
      const pincode: string = (data?.pincode || '').toString().replace(/\s/g, '');

      setAreaName(area);
      setFullAddress(fAddr);
      setDetectedPincode(pincode.length === 6 ? pincode : '');
    } catch {
      setAreaName('');
      setFullAddress('');
      setDetectedPincode('');
    } finally {
      setResolving(false);
    }
  }, []);

  // Kick off reverse geocode immediately on mount — independent of whether Google Maps loads
  useEffect(() => {
    void reverseGeocode(initialLat ?? DEFAULT_LAT, initialLng ?? DEFAULT_LNG);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapContainerRef.current || typeof window === 'undefined') return;
    let mounted = true;

    const initMap = async () => {
      try {
        await loadGoogleMaps();
      } catch {
        return; // Map failed to load; reverse geocode already running above
      }
      if (!mounted || !mapContainerRef.current) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const google = (window as any).google;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapInstance: any = new google.maps.Map(mapContainerRef.current, {
        center: { lat: initialLat ?? DEFAULT_LAT, lng: initialLng ?? DEFAULT_LNG },
        zoom: DEFAULT_ZOOM,
        mapTypeId: tileMode === 'satellite' ? 'satellite' : 'roadmap',
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
      });

      mapRef.current = mapInstance;

      mapInstance.addListener('idle', () => {
        if (!mounted) return;
        const center = mapInstance.getCenter();
        const lat: number = center.lat();
        const lng: number = center.lng();
        setCenterLat(lat);
        setCenterLng(lng);
        if (resolveDebounceRef.current) clearTimeout(resolveDebounceRef.current);
        resolveDebounceRef.current = setTimeout(() => {
          if (mounted) void reverseGeocode(lat, lng);
        }, 700);
      });
    };

    void initMap();

    return () => {
      mounted = false;
      if (resolveDebounceRef.current) clearTimeout(resolveDebounceRef.current);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      // Google Maps instances don't have a .remove() — just drop the ref
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

  // Swap map type when mode toggles
  useEffect(() => {
    if (!mapRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google;
    if (!google?.maps) return;
    mapRef.current.setMapTypeId(tileMode === 'satellite' ? 'satellite' : 'roadmap');
    if (typeof window !== 'undefined') window.localStorage.setItem(TILE_PREF_KEY, tileMode);
  }, [tileMode]);

  function flyTo(lat: number, lng: number) {
    if (!mapRef.current) return;
    mapRef.current.panTo({ lat, lng });
    mapRef.current.setZoom(18);
  }

  function detectLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setCenterLat(lat);
        setCenterLng(lng);
        flyTo(lat, lng);
        // If the map isn't loaded, the idle event won't fire — geocode directly
        if (!mapRef.current) void reverseGeocode(lat, lng);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function doSearch(q: string) {
    if (q.trim().length < 2) { setSearchResults([]); setNoResults(false); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google;
    if (!google?.maps?.places) return;
    setSearching(true);
    setNoResults(false);

    try {
      await new Promise<void>((resolve) => {
        const svc = new google.maps.places.AutocompleteService();
        svc.getPlacePredictions(
          {
            input: q,
            location: new google.maps.LatLng(centerLat, centerLng),
            radius: 30000,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (predictions: any[] | null, status: string) => {
            if (status === 'OK' && predictions && predictions.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const results: SearchSuggestion[] = predictions.slice(0, 8).map((p: any) => ({
                label: p.structured_formatting?.main_text || p.description.split(',')[0],
                sublabel: p.structured_formatting?.secondary_text || '',
                placeId: p.place_id,
              }));
              setSearchResults(results);
              setShowResults(true);
              setNoResults(false);
            } else {
              setSearchResults([]);
              setShowResults(false);
              setNoResults(true);
            }
            resolve();
          },
        );
      });
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
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
    setNoResults(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google;
    if (!google?.maps) return;

    const geocoder = new google.maps.Geocoder();
    geocoder.geocode(
      { placeId: r.placeId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (results: any[], status: string) => {
        if (status === 'OK' && results[0]) {
          const loc = results[0].geometry.location;
          flyTo(loc.lat(), loc.lng());
        }
      },
    );
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
                  <p className="text-[11px] text-brand-text-dim/60 mt-1 leading-snug">
                    Try a different spelling or use<br />
                    <span className="text-brand-gold font-bold">Satellite</span> view to spot your building from above.
                  </p>
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
            {tileMode === 'satellite' ? 'Drag to your rooftop' : 'Drag map to move pin'}
          </div>
        </div>

        {/* Map / Satellite toggle */}
        <button
          type="button"
          onClick={() => setTileMode((m) => (m === 'street' ? 'satellite' : 'street'))}
          className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold text-white shadow-elevated hover:scale-105 active:scale-95 transition-transform"
          style={{ zIndex: 9999, background: 'rgba(15,17,23,0.85)', backdropFilter: 'blur(8px)', border: '1px solid rgba(216,178,78,0.35)' }}
        >
          <Layers size={14} strokeWidth={2.2} className="text-brand-gold" />
          <span>{tileMode === 'street' ? 'Satellite' : 'Map'}</span>
        </button>

        {/* Custom zoom buttons */}
        <div
          className="absolute bottom-4 right-3 flex flex-col gap-1"
          style={{ zIndex: 9999 }}
        >
          <button
            type="button"
            onClick={() => mapRef.current && mapRef.current.setZoom(mapRef.current.getZoom() + 1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-white hover:scale-105 active:scale-95 transition-transform"
            style={{ background: 'rgba(15,17,23,0.85)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            <Plus size={16} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current && mapRef.current.setZoom(mapRef.current.getZoom() - 1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-white hover:scale-105 active:scale-95 transition-transform"
            style={{ background: 'rgba(15,17,23,0.85)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            <Minus size={16} strokeWidth={2.5} />
          </button>
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
                  {detail.trim() || areaName || 'Move map to set location'}
                </p>
                {detail.trim() && areaName && (
                  <p className="text-[11px] text-brand-gold/90 leading-snug mt-0.5 font-semibold">
                    near {areaName}
                  </p>
                )}
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
    document.body,
  );
}
