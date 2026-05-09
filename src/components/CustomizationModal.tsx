import { useState, useEffect, useCallback } from 'react';
import { X, Minus, Plus, Check } from 'lucide-react';
import { motion } from 'motion/react';
import type { MenuItem, SelectedCustomization } from '../types';
import { modalOverlay, modalSheet, springSnappy } from '../lib/animations';
import { fetchCustomizationGroupsForItem, type CustomizationGroupWithOptions } from '../lib/customizations';

interface Props {
  item: MenuItem;
  onClose: () => void;
  onConfirm: (item: MenuItem, quantity: number, customizations: SelectedCustomization[]) => void;
  showCustomizations?: boolean;
  initialQuantity?: number;
  initialCustomizations?: SelectedCustomization[];
}

const EMPTY_CUSTOMIZATIONS: SelectedCustomization[] = [];
function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeFlavorText(value: string) {
  return normalizeLabel(value)
    .replace(/[()/_-]+/g, ' ')
    .replace(/\bvanila\b/g, 'vanilla')
    .replace(/\bchoco\b/g, 'chocolate')
    .replace(/\bredvelvet\b/g, 'red velvet')
    .replace(/\s+/g, ' ')
    .trim();
}

function getConeItemFlavorKey(itemName: string) {
  const normalizedItemName = normalizeFlavorText(itemName);
  const flavorMatchers = [
    { key: 'red velvet', terms: ['red velvet'] },
    { key: 'chocolate', terms: ['chocolate'] },
    { key: 'vanilla', terms: ['vanilla'] },
    { key: 'black currant', terms: ['black currant'] },
    { key: 'black forest', terms: ['black forest'] },
    { key: 'caramel', terms: ['caramel'] },
    { key: 'american dry fruit', terms: ['american dry fruit', 'dry fruit'] },
  ];

  return flavorMatchers.find(({ terms }) => terms.some((term) => normalizedItemName.includes(term)))?.key || null;
}

function findDefaultConeBaseOption(options: CustomizationGroupWithOptions['options']) {
  const normalizedOptions = options.map((option) => ({
    option,
    normalizedName: normalizeFlavorText(option.name),
  }));

  return normalizedOptions.find(({ normalizedName }) => (
    normalizedName.includes('vanilla') || normalizedName.includes('regular')
  ))?.option ?? null;
}

function getPreviewImageFromSelections(
  item: MenuItem,
  groups: CustomizationGroupWithOptions[],
  selected: Record<string, string[]>,
) {
  const previewImages: string[] = [];
  const normalizedItemName = normalizeLabel(item.name);
  const isConeWaffle = normalizedItemName.includes('cone waffle');
  const itemFlavorKey = isConeWaffle ? getConeItemFlavorKey(item.name) : null;

  for (const group of groups) {
    for (const optionId of selected[group.id] || []) {
      const option = group.options.find((entry) => entry.id === optionId);
      if (!option) {
        continue;
      }

      const previewImageUrl = option.preview_image_url?.trim();
      if (previewImageUrl) {
        if (isConeWaffle && normalizeLabel(group.name) === 'base' && option.preview_image_source !== 'item') {
          const canUseSharedConePreview = !itemFlavorKey || itemFlavorKey === 'vanilla';
          if (!canUseSharedConePreview) {
            continue;
          }
        }

        previewImages.push(previewImageUrl);
      }
    }
  }

  if (previewImages.length > 0) {
    return previewImages[previewImages.length - 1];
  }

  return null;
}

function getDefaultOptionIdsForItem(
  item: MenuItem,
  groups: CustomizationGroupWithOptions[],
  initialCustomizations: SelectedCustomization[],
) {
  const initialSelections: Record<string, string[]> = {};
  const normalizedItemName = normalizeLabel(item.name);
  const isConeWaffle = normalizedItemName.includes('cone waffle');

  groups.forEach((group) => {
    const matchedOptionIds = initialCustomizations
      .filter((customization) => normalizeLabel(customization.group_name) === normalizeLabel(group.name))
      .map((customization) => (
        group.options.find((option) => normalizeLabel(option.name) === normalizeLabel(customization.option_name))?.id
      ))
      .filter((optionId): optionId is string => Boolean(optionId));

    if (matchedOptionIds.length > 0) {
      initialSelections[group.id] = group.selection_type === 'single'
        ? [matchedOptionIds[0]]
        : [...new Set(matchedOptionIds)];
      return;
    }

    if (!isConeWaffle || normalizeLabel(group.name) !== 'base') {
      return;
    }

    const vanillaBaseOption = findDefaultConeBaseOption(group.options);

    if (vanillaBaseOption) {
      initialSelections[group.id] = [vanillaBaseOption.id];
    }
  });

  return initialSelections;
}

export default function CustomizationModal({
  item,
  onClose,
  onConfirm,
  showCustomizations = true,
  initialQuantity = 1,
  initialCustomizations,
}: Props) {
  const [groups, setGroups] = useState<CustomizationGroupWithOptions[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [imageSrc, setImageSrc] = useState(item.image_url || '/image.png');
  const initialCustomizationsList = initialCustomizations ?? EMPTY_CUSTOMIZATIONS;

  const loadCustomizations = useCallback(async () => {
    setLoading(true);
    setSelected({});
    setQuantity(initialQuantity);

    if (!showCustomizations) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const grouped = await fetchCustomizationGroupsForItem(item);
    setGroups(grouped);
    setSelected(getDefaultOptionIdsForItem(item, grouped, initialCustomizationsList));
    setLoading(false);
  }, [initialCustomizationsList, initialQuantity, item, showCustomizations]);

  useEffect(() => {
    void loadCustomizations();
  }, [loadCustomizations]);

  useEffect(() => {
    if (item.is_available === false) {
      onClose();
    }
  }, [item.is_available, onClose]);

  const selectedPreviewImage = getPreviewImageFromSelections(item, groups, selected);

  useEffect(() => {
    setImageSrc(selectedPreviewImage || item.image_url || '/image.png');
  }, [item.image_url, selectedPreviewImage]);

  function toggleOption(groupId: string, optionId: string, selectionType: string) {
    setSelected((prev) => {
      const current = prev[groupId] || [];
      if (selectionType === 'single') {
        return { ...prev, [groupId]: current.includes(optionId) ? [] : [optionId] };
      }
      return {
        ...prev,
        [groupId]: current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId],
      };
    });
  }

  function getSelectedCustomizations(): SelectedCustomization[] {
    const result: SelectedCustomization[] = [];
    for (const group of groups) {
      const selectedIds = selected[group.id] || [];
      for (const optionId of selectedIds) {
        const option = group.options.find((o) => o.id === optionId);
        if (option) {
          result.push({ group_name: group.name, option_name: option.name, price: option.price });
        }
      }
    }
    return result;
  }

  const selectedCustomizations = getSelectedCustomizations();
  const customizationsTotal = selectedCustomizations.reduce((sum, c) => sum + c.price, 0);
  const totalPrice = (item.price + customizationsTotal) * quantity;
  const baseGroup = groups.find((group) => normalizeLabel(group.name) === 'base');
  const selectedBaseId = baseGroup ? (selected[baseGroup.id] || [])[0] : null;
  const selectedBaseName = baseGroup?.options.find((option) => option.id === selectedBaseId)?.name || null;

  if (item.is_available === false) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <motion.div
        variants={modalOverlay}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="absolute inset-0 bg-brand-overlay backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        variants={modalSheet}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="relative bg-brand-surface w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl max-h-[82vh] sm:max-h-[90vh] flex flex-col shadow-elevated border border-brand-border mb-16 sm:mb-0"
        transition={springSnappy}
      >
        <div className="relative border-b border-brand-border bg-gradient-to-b from-brand-surface-light/35 via-brand-surface/95 to-brand-surface px-5 pt-5 pb-4">
          <motion.button
            onClick={onClose}
            whileTap={{ scale: 0.85 }}
            className="absolute right-4 top-4 z-10 p-2 rounded-xl border border-brand-border/70 bg-brand-surface/90 text-brand-text-dim hover:text-white hover:bg-brand-surface-light/80 transition-colors"
          >
            <X size={22} className="text-brand-text-dim" strokeWidth={2.5} />
          </motion.button>

          <div className="grid grid-cols-[116px_minmax(0,1fr)] gap-4 pr-12 sm:grid-cols-[152px_minmax(0,1fr)] sm:items-center">
            <div className="overflow-hidden rounded-[24px] border border-brand-border/60 bg-[radial-gradient(circle_at_top,_rgba(216,178,78,0.2),_transparent_55%),linear-gradient(180deg,rgba(31,38,22,0.95),rgba(17,23,14,0.98))] shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
              <img
                src={imageSrc}
                alt={item.name}
                loading="eager"
                decoding="async"
                width={304}
                height={304}
                onError={() => {
                  const fallbackImage = item.image_url || '/image.png';
                  if (imageSrc !== fallbackImage) {
                    setImageSrc(fallbackImage);
                    return;
                  }
                  if (imageSrc !== '/image.png') {
                    setImageSrc('/image.png');
                  }
                }}
                className="block h-[158px] w-full object-contain p-2 sm:h-[188px]"
              />
            </div>

            <div className="min-w-0">
              <span className="inline-flex items-center rounded-full border border-brand-gold/25 bg-brand-gold/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-gold">
                Customize
              </span>
              <motion.h3 className="mt-3 font-extrabold text-[22px] leading-tight tracking-tight text-white sm:text-[26px]">
                {item.name}
              </motion.h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-brand-border bg-brand-surface-light/70 px-3 py-1 text-[12px] font-semibold text-brand-text-muted">
                  Base {'\u20B9'}{item.price}
                </span>
                {selectedBaseName && (
                  <span className="rounded-full border border-brand-gold/25 bg-brand-gold/10 px-3 py-1 text-[12px] font-semibold text-brand-gold">
                    Base: {selectedBaseName}
                  </span>
                )}
                {selectedCustomizations.length > 0 && (
                  <span className="rounded-full border border-brand-border bg-brand-surface-light/70 px-3 py-1 text-[12px] font-semibold text-brand-text-muted">
                    {selectedCustomizations.length} selected
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!showCustomizations ? null : loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-4 bg-brand-surface-light rounded w-24 mb-3" />
                  <div className="space-y-2">
                    <div className="h-12 bg-brand-surface-light/70 rounded-xl" />
                    <div className="h-12 bg-brand-surface-light/70 rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="text-brand-text-dim text-sm text-center py-4">No customization options available</p>
          ) : (
            groups.map((group) => (
              <div key={group.id} className="rounded-2xl border border-brand-border/80 bg-brand-surface-light/20 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-bold text-[15px] text-white">{group.name}</h4>
                    <span className="rounded-full border border-brand-border/80 bg-brand-surface-light/65 px-2.5 py-0.5 text-[11px] font-semibold text-brand-text-dim">
                      {group.selection_type === 'single' ? 'Choose one' : 'Choose multiple'}
                    </span>
                    {group.is_required && (
                      <span className="rounded-full border border-brand-gold/25 bg-brand-gold/10 px-2.5 py-0.5 text-[11px] font-bold text-brand-gold">
                        Required
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  {group.options.map((option) => {
                    const isSelected = (selected[group.id] || []).includes(option.id);
                    return (
                      <motion.button
                        key={option.id}
                        onClick={() => toggleOption(group.id, option.id, group.selection_type)}
                        whileTap={{ scale: 0.97 }}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all duration-200 ${
                          isSelected
                            ? 'border-brand-gold bg-brand-gold/[0.12] shadow-[0_10px_24px_rgba(216,178,78,0.08)]'
                            : 'border-brand-border bg-brand-surface/60 hover:border-brand-border-strong hover:bg-brand-surface-light/70'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <motion.div
                            animate={isSelected ? { scale: 1, backgroundColor: '#D8B24E', borderColor: '#D8B24E' } : { scale: 1, backgroundColor: 'transparent', borderColor: '#869078' }}
                            transition={{ duration: 0.2 }}
                            className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                          >
                            {isSelected && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                              >
                                <Check size={12} className="text-brand-bg" />
                              </motion.div>
                            )}
                          </motion.div>
                          <div className="min-w-0">
                            <span className="block text-[14px] font-semibold text-white">{option.name}</span>
                            {isSelected && group.selection_type === 'single' && (
                              <span className="block text-[11px] font-medium text-brand-gold/90">Current choice</span>
                            )}
                          </div>
                        </div>
                        {option.price > 0 && (
                          <span className="text-[14px] font-bold text-brand-text-muted">+{'\u20B9'}{option.price}</span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex-shrink-0 border-t border-brand-border bg-brand-surface/95 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-4 backdrop-blur-sm space-y-3">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-brand-border bg-brand-surface-light/55 px-2 py-2">
              <motion.button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                whileTap={{ scale: 0.85 }}
                className="w-9 h-9 rounded-xl border border-brand-border/80 flex items-center justify-center text-white hover:border-brand-gold/30 transition-colors"
              >
                <Minus size={16} />
              </motion.button>
              <span className="min-w-[1.75rem] text-center text-[18px] font-extrabold tabular-nums text-white">{quantity}</span>
              <motion.button
                onClick={() => setQuantity(quantity + 1)}
                whileTap={{ scale: 0.85 }}
                className="w-9 h-9 rounded-xl bg-brand-gold text-brand-bg flex items-center justify-center hover:brightness-110 transition-all"
              >
                <Plus size={16} />
              </motion.button>
            </div>

            <div className="min-w-0 text-right">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-text-dim">Total</p>
              <p className="text-[24px] font-black tracking-tight text-brand-gold">{'\u20B9'}{totalPrice.toFixed(0)}</p>
              <p className="text-[12px] text-brand-text-dim">
                {customizationsTotal > 0
                  ? `Base ₹${item.price} + Add-ons ₹${customizationsTotal}${quantity > 1 ? ` x ${quantity}` : ''}`
                  : quantity > 1
                    ? `₹${item.price} each x ${quantity}`
                    : 'Includes base price'}
              </p>
            </div>
          </div>

          <motion.button
            onClick={() => {
              onConfirm(item, quantity, getSelectedCustomizations());
            }}
            whileTap={{ scale: 0.97 }}
            className="btn-primary w-full text-center flex items-center justify-center gap-2"
          >
            <span>Add to Cart</span>
            <span className="font-extrabold">{'\u20B9'}{totalPrice.toFixed(0)}</span>
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
