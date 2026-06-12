import { useState } from 'react';
import { MapPin, Pencil, Map } from 'lucide-react';
import MapLocationPicker, { type MapConfirmData } from './MapLocationPicker';

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
  const [mapOpen, setMapOpen] = useState(false);
  const [savedLat, setSavedLat] = useState<number | null>(null);
  const [savedLng, setSavedLng] = useState<number | null>(null);

  function handleConfirm(data: MapConfirmData) {
    onAddressChange(data.address);
    if (data.pincode.length === 6) onPincodeChange(data.pincode);
    onLatChange?.(data.lat);
    onLngChange?.(data.lng);
    setSavedLat(data.lat);
    setSavedLng(data.lng);
    setMapOpen(false);
  }

  return (
    <>
      {address ? (
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="w-full flex items-start gap-3 rounded-xl border border-emerald-500/25 px-4 py-3 text-left transition-colors hover:border-emerald-500/40 group"
          style={{ background: 'rgba(16,185,129,0.07)' }}
        >
          <div
            className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
            style={{ background: 'rgba(16,185,129,0.15)' }}
          >
            <MapPin size={15} className="text-emerald-400" strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-emerald-400 leading-snug line-clamp-2">
              {address}
            </p>
            {pincode && (
              <p className="text-[11px] text-emerald-300/60 mt-0.5">{pincode}</p>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5 flex-shrink-0">
            <Pencil size={12} className="text-emerald-400/50 group-hover:text-emerald-400 transition-colors" strokeWidth={2.2} />
            <span className="text-[11px] font-semibold text-emerald-400/50 group-hover:text-emerald-400 transition-colors">
              Edit
            </span>
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 border-dashed border-brand-gold/30 text-left transition-all hover:border-brand-gold/50 hover:bg-brand-gold/5 active:scale-[0.98]"
        >
          <div
            className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center"
            style={{ background: 'rgba(216,178,78,0.12)' }}
          >
            <Map size={16} className="text-brand-gold" strokeWidth={2.2} />
          </div>
          <div>
            <p className="text-[14px] font-bold text-brand-gold">Set delivery location</p>
            <p className="text-[11px] text-brand-text-dim mt-0.5">
              Pin your exact address on the map
            </p>
          </div>
        </button>
      )}

      {mapOpen && (
        <MapLocationPicker
          initialLat={savedLat}
          initialLng={savedLng}
          onConfirm={handleConfirm}
          onClose={() => setMapOpen(false)}
        />
      )}
    </>
  );
}
