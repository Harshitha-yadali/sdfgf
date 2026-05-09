import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Pencil, Trash2, Save, X, Search } from 'lucide-react';
import { useToast } from '../../components/Toast';
import CustomizationAssignmentsManager from '../../components/admin/CustomizationAssignmentsManager';
import { detectDietarySchemaSupport, detectInventorySchemaSupport } from '../../lib/inventorySchema';
import { getMenuItemDietaryBadges } from '../../lib/menuItemDietary';
import { supabase } from '../../lib/supabase';
import type { Category, MenuItem } from '../../types';

interface ItemForm {
  id?: string;
  name: string;
  description: string;
  price: string;
  category_id: string;
  image_url: string;
  prep_time: string;
  is_veg: boolean;
  is_non_veg: boolean;
  is_eggless: boolean;
  manual_availability: boolean;
  track_inventory: boolean;
  available_quantity: string;
}

interface CategoryForm {
  id?: string;
  name: string;
  slug: string;
  image_url: string;
}

const emptyItem: ItemForm = {
  name: '',
  description: '',
  price: '',
  category_id: '',
  image_url: '',
  prep_time: '10',
  is_veg: false,
  is_non_veg: false,
  is_eggless: false,
  manual_availability: true,
  track_inventory: false,
  available_quantity: '0',
};

const emptyCategoryForm: CategoryForm = {
  name: '',
  slug: '',
  image_url: '',
};

function isForeignKeyConstraintError(error: { code?: string; message?: string } | null) {
  return error?.code === '23503';
}

function normalizeImageUrl(url: string) {
  const trimmedUrl = url.trim();
  const malformedExtensionSuffixMatch = trimmedUrl.match(/^(https?:\/\/\S+\.(?:png|jpe?g|webp|gif|svg))(?:\d+)$/i);
  const normalizedUrl = malformedExtensionSuffixMatch?.[1] || trimmedUrl;
  return normalizedUrl.replace(/^http:\/\//i, 'https://');
}

function normalizeItemName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

function getManualAvailability(item: MenuItem) {
  return item.manual_availability ?? item.is_available;
}

function shouldShowInStockTracking(item: MenuItem) {
  return getManualAvailability(item);
}

function getTrackInventory(item: MenuItem) {
  return item.track_inventory === true;
}

function getAvailableQuantity(item: MenuItem) {
  const quantity = Number(item.available_quantity ?? 0);
  return Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
}

function computeEffectiveAvailability(manualAvailability: boolean, trackInventory: boolean, availableQuantity: number) {
  return manualAvailability && (!trackInventory || availableQuantity > 0);
}

function getAvailabilityUpdatePayload(item: MenuItem, nextManualAvailability: boolean, inventorySchemaReady: boolean) {
  if (!inventorySchemaReady) {
    return {
      is_available: nextManualAvailability,
    };
  }

  const availableQuantity = getAvailableQuantity(item);
  const trackInventory = getTrackInventory(item);

  return {
    manual_availability: nextManualAvailability,
    is_available: computeEffectiveAvailability(nextManualAvailability, trackInventory, availableQuantity),
  };
}

function formatInventorySummary(item: MenuItem) {
  if (!getTrackInventory(item)) {
    return 'Inventory not tracked';
  }

  const quantity = getAvailableQuantity(item);
  return `${quantity} left`;
}

function formatVisibilityReason(item: MenuItem) {
  if (!getManualAvailability(item)) {
    return 'Hidden manually';
  }

  if (getTrackInventory(item) && getAvailableQuantity(item) <= 0) {
    return 'Auto-hidden at zero stock';
  }

  return 'Visible to customers';
}

function getStockStatus(item: MenuItem) {
  if (!getTrackInventory(item)) {
    return {
      label: 'Not Tracked',
      className: 'border-brand-border bg-brand-surface-light/60 text-brand-text-muted',
    };
  }

  const quantity = getAvailableQuantity(item);
  if (quantity <= 0) {
    return {
      label: 'Out of Stock',
      className: 'border-red-500/20 bg-red-500/10 text-red-300',
    };
  }

  if (quantity <= 5) {
    return {
      label: 'Low Stock',
      className: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
    };
  }

  return {
    label: 'In Stock',
    className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  };
}

function getEditingVisibilityResult(editing: ItemForm) {
  if (!editing.manual_availability) {
    return {
      title: 'Customers will not see this item',
      detail: 'Untick hide to allow this item back on the menu.',
    };
  }

  if (
    editing.track_inventory &&
    Math.max(0, Number.parseInt(editing.available_quantity || '0', 10) || 0) <= 0
  ) {
    return {
      title: 'Customers will not see this item until stock is added',
      detail: 'When quantity reaches 0, the item hides automatically.',
    };
  }

  return {
    title: 'Customers can order this item',
    detail: editing.track_inventory
      ? 'Stock tracking will hide it automatically at 0.'
      : 'Manual visibility controls whether it appears on the menu.',
  };
}

async function repairMalformedMenuItemImageUrls(items: MenuItem[]) {
  const corrections = items
    .map((item) => ({
      id: item.id,
      currentImageUrl: item.image_url || '',
      normalizedImageUrl: normalizeImageUrl(item.image_url || ''),
    }))
    .filter((item) => item.currentImageUrl && item.currentImageUrl !== item.normalizedImageUrl);

  if (corrections.length === 0) {
    return { repairedCount: 0, error: null as string | null };
  }

  const results = await Promise.all(
    corrections.map((item) => (
      supabase
        .from('menu_items')
        .update({ image_url: item.normalizedImageUrl })
        .eq('id', item.id)
    )),
  );

  const firstError = results.find((result) => result.error)?.error;
  return {
    repairedCount: firstError ? 0 : corrections.length,
    error: firstError?.message || null,
  };
}

function toItemForm(item: MenuItem): ItemForm {
  return {
    id: item.id,
    name: normalizeItemName(item.name),
    description: item.description,
    price: String(item.price),
    category_id: item.category_id,
    image_url: normalizeImageUrl(item.image_url),
    prep_time: String(item.prep_time),
    is_veg: item.is_veg,
    is_non_veg: item.is_non_veg === true,
    is_eggless: item.is_eggless,
    manual_availability: getManualAvailability(item),
    track_inventory: getTrackInventory(item),
    available_quantity: String(getAvailableQuantity(item)),
  };
}

export default function AdminMenu() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [inventorySchemaReady, setInventorySchemaReady] = useState(true);
  const [dietarySchemaReady, setDietarySchemaReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ItemForm | null>(null);
  const [catForm, setCatForm] = useState<CategoryForm>(emptyCategoryForm);
  const [showCatForm, setShowCatForm] = useState(false);
  const [stockDrafts, setStockDrafts] = useState<Record<string, string>>({});
  const [updatingStockId, setUpdatingStockId] = useState<string | null>(null);
  const [updatingCategoryId, setUpdatingCategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('');
  const categoryFormRef = useRef<HTMLDivElement | null>(null);
  const itemFormRef = useRef<HTMLDivElement | null>(null);
  const schemaNoticeShownRef = useRef(false);
  const { showToast } = useToast();

  const loadData = useCallback(async () => {
    let schemaReady = true;
    let dietaryReady = true;
    try {
      schemaReady = await detectInventorySchemaSupport();
    } catch (error) {
      console.error('Failed to detect inventory schema support', error);
    }

    try {
      dietaryReady = await detectDietarySchemaSupport();
    } catch (error) {
      console.error('Failed to detect dietary schema support', error);
    }

    setInventorySchemaReady(schemaReady);
    setDietarySchemaReady(dietaryReady);

    if (!schemaReady && !schemaNoticeShownRef.current) {
      showToast('Inventory columns are not in Supabase yet. Apply the latest migration to enable stock counts.', 'error');
      schemaNoticeShownRef.current = true;
    }

    if (!dietaryReady) {
      showToast('Non-veg label needs the latest Supabase migration before it can be saved.', 'error');
    }

    const [catRes, itemRes] = await Promise.all([
      supabase.from('categories').select('*').order('display_order'),
      supabase.from('menu_items').select('*').order('display_order'),
    ]);

    if (catRes.data) setCategories(catRes.data);

    if (itemRes.data) {
      const normalizedItems = itemRes.data.map((item) => ({
        ...item,
        image_url: normalizeImageUrl(item.image_url || ''),
      }));
      setItems(normalizedItems);

      const repairResult = await repairMalformedMenuItemImageUrls(itemRes.data);
      if (repairResult.error) {
        showToast(repairResult.error, 'error');
      } else if (repairResult.repairedCount > 0) {
        showToast(`Fixed ${repairResult.repairedCount} broken image URL${repairResult.repairedCount > 1 ? 's' : ''}`);
      }
    }

    if (catRes.error) {
      showToast(catRes.error.message || 'Failed to load categories', 'error');
    }

    if (itemRes.error) {
      showToast(itemRes.error.message || 'Failed to load menu items', 'error');
    }

    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!showCatForm) return;
    categoryFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showCatForm]);

  useEffect(() => {
    if (!editing) return;
    itemFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [editing]);

  const sortedItems = [...items].sort((a, b) => {
    if (a.is_available !== b.is_available) {
      return Number(b.is_available) - Number(a.is_available);
    }

    if (getTrackInventory(a) !== getTrackInventory(b)) {
      return Number(getTrackInventory(b)) - Number(getTrackInventory(a));
    }

    return a.display_order - b.display_order;
  });

  const stockTrackingItems = sortedItems.filter(shouldShowInStockTracking);
  const hiddenFromStockTrackingItems = sortedItems.filter((item) => !shouldShowInStockTracking(item));
  const trackedItems = stockTrackingItems.filter(getTrackInventory);
  const untrackedItems = stockTrackingItems.filter((item) => !getTrackInventory(item));
  const lowStockItems = trackedItems.filter((item) => {
    const quantity = getAvailableQuantity(item);
    return quantity > 0 && quantity <= 5;
  });
  const outOfStockItems = trackedItems.filter((item) => getAvailableQuantity(item) <= 0);
  const totalTrackedQuantity = trackedItems.reduce((sum, item) => sum + getAvailableQuantity(item), 0);
  const editingVisibilityResult = editing ? getEditingVisibilityResult(editing) : null;

  const filteredItems = sortedItems.filter((item) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q || item.name.toLowerCase().includes(q);
    const matchesCategory = !selectedCategoryFilter || item.category_id === selectedCategoryFilter;
    return matchesSearch && matchesCategory;
  });

  const categoryItemCountById = Object.fromEntries(
    categories.map((category) => [
      category.id,
      items.filter((item) => item.category_id === category.id).length,
    ]),
  );

  const categoryAvailableItemCountById = Object.fromEntries(
    categories.map((category) => [
      category.id,
      items.filter((item) => item.category_id === category.id && item.is_available).length,
    ]),
  );

  function startNewProduct() {
    if (categories.length === 0) {
      showToast('Add a category before creating a menu item', 'error');
      return;
    }

    setEditing({ ...emptyItem, category_id: categories[0]?.id || '' });
  }

  function getStockDraftValue(item: MenuItem) {
    return stockDrafts[item.id] ?? String(getAvailableQuantity(item));
  }

  function setStockDraftValue(itemId: string, value: string) {
    setStockDrafts((current) => ({
      ...current,
      [itemId]: value,
    }));
  }

  async function updateStockQuantity(item: MenuItem, nextQuantity: number, enableTracking = getTrackInventory(item)) {
    if (!inventorySchemaReady) {
      showToast('Run the latest Supabase migration before tracking stock quantities.', 'error');
      return;
    }

    if (updatingStockId === item.id) return;

    const availableQuantity = Math.max(0, Math.floor(nextQuantity));
    const manualAvailability = getManualAvailability(item);
    const trackInventory = enableTracking || getTrackInventory(item);
    const nextAvailability = computeEffectiveAvailability(manualAvailability, trackInventory, availableQuantity);

    setUpdatingStockId(item.id);

    const { error } = await supabase
      .from('menu_items')
      .update({
        manual_availability: manualAvailability,
        track_inventory: trackInventory,
        available_quantity: availableQuantity,
        is_available: nextAvailability,
      })
      .eq('id', item.id);

    if (error) {
      showToast(error.message || `Failed to update stock for ${item.name}`, 'error');
      setUpdatingStockId(null);
      return;
    }

    setStockDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    showToast(`${item.name} stock updated`);
    await loadData();
    setUpdatingStockId(null);
  }

  async function saveStockDraft(item: MenuItem) {
    const stockValue = Number.parseInt(getStockDraftValue(item) || '0', 10);
    await updateStockQuantity(item, Number.isFinite(stockValue) ? stockValue : 0, true);
  }

  async function adjustStockQuantity(item: MenuItem, delta: number) {
    await updateStockQuantity(item, getAvailableQuantity(item) + delta, true);
  }

  async function saveItem() {
    if (!editing) return;

    if (!editing.name.trim()) {
      showToast('Item name is required', 'error');
      return;
    }

    if (!editing.category_id) {
      showToast('Select a category before saving the item', 'error');
      return;
    }

    const availableQuantity = Math.max(0, Number.parseInt(editing.available_quantity || '0', 10) || 0);
    if (editing.track_inventory && availableQuantity < 0) {
      showToast('Available quantity cannot be negative', 'error');
      return;
    }

    const nextAvailability = computeEffectiveAvailability(editing.manual_availability, editing.track_inventory, availableQuantity);
    const basePayload = {
      name: normalizeItemName(editing.name),
      description: editing.description,
      price: parseFloat(editing.price) || 0,
      category_id: editing.category_id,
      image_url: normalizeImageUrl(editing.image_url),
      prep_time: parseInt(editing.prep_time, 10) || 10,
      is_veg: editing.is_veg,
      is_eggless: editing.is_eggless,
      ...(dietarySchemaReady ? { is_non_veg: editing.is_non_veg } : {}),
      is_available: inventorySchemaReady ? nextAvailability : editing.manual_availability,
      display_order: editing.id
        ? undefined
        : items.reduce((maxOrder, item) => Math.max(maxOrder, item.display_order), -1) + 1,
    };
    const payload = inventorySchemaReady
      ? {
          ...basePayload,
          manual_availability: editing.manual_availability,
          track_inventory: editing.track_inventory,
          available_quantity: availableQuantity,
        }
      : basePayload;

    const actionLabel = editing.id ? 'update' : 'add';
    const { error } = editing.id
      ? await supabase.from('menu_items').update(payload).eq('id', editing.id)
      : await supabase.from('menu_items').insert(payload);

    if (error) {
      showToast(error.message || `Failed to ${actionLabel} item`, 'error');
      return;
    }

    if (!inventorySchemaReady) {
      showToast('Item saved, but stock quantity needs the latest Supabase migration before it can be tracked.');
    }

    showToast(editing.id ? 'Item updated' : 'Item added');
    setEditing(null);
    await loadData();
  }

  async function deleteItem(id: string) {
    const currentItem = items.find((item) => item.id === id);
    const { error } = await supabase.from('menu_items').delete().eq('id', id);

    if (isForeignKeyConstraintError(error)) {
      const archivePayload = inventorySchemaReady
        ? {
            manual_availability: false,
            is_available: false,
          }
        : {
            is_available: false,
          };
      const { error: archiveError } = await supabase
        .from('menu_items')
        .update(archivePayload)
        .eq('id', id);

      if (archiveError) {
        showToast(archiveError.message || 'Failed to archive item', 'error');
        return;
      }

      showToast(
        currentItem?.is_available === false
          ? 'This item is already removed from the menu'
          : 'This item exists in past orders, so it was removed from the menu',
      );
      await loadData();
      return;
    }

    if (error) {
      showToast(error.message || 'Failed to delete item', 'error');
      return;
    }

    showToast('Item deleted');
    await loadData();
  }

  async function toggleItemAvailability(item: MenuItem, nextManualAvailability: boolean) {
    const availableQuantity = getAvailableQuantity(item);
    const trackInventory = getTrackInventory(item);
    const updatePayload = getAvailabilityUpdatePayload(item, nextManualAvailability, inventorySchemaReady);

    const { error } = await supabase
      .from('menu_items')
      .update(updatePayload)
      .eq('id', item.id);

    if (error) {
      showToast(error.message || `Failed to update ${item.name}`, 'error');
      return;
    }

    if (!nextManualAvailability) {
      showToast(`${item.name} hidden from customers`);
    } else if (trackInventory && availableQuantity <= 0) {
      showToast(`${item.name} will become visible after stock is added`);
    } else {
      showToast(`${item.name} is now visible to customers`);
    }

    await loadData();
  }

  async function toggleCategoryAvailability(category: Category, nextManualAvailability: boolean) {
    const categoryItems = items.filter((item) => item.category_id === category.id);
    const categoryItemCount = categoryItems.length;

    if (categoryItemCount === 0) {
      showToast('This category has no items yet', 'error');
      return;
    }

    if (updatingCategoryId === category.id) return;

    setUpdatingCategoryId(category.id);

    try {
      const results = await Promise.allSettled(
        categoryItems.map((item) => (
          supabase
            .from('menu_items')
            .update(getAvailabilityUpdatePayload(item, nextManualAvailability, inventorySchemaReady))
            .eq('id', item.id)
        )),
      );

      const failedResult = results.find((result) => (
        result.status === 'rejected' || Boolean(result.value.error)
      ));

      if (failedResult) {
        const errorMessage = failedResult.status === 'rejected'
          ? (failedResult.reason instanceof Error ? failedResult.reason.message : `Failed to update ${category.name}`)
          : (failedResult.value.error?.message || `Failed to update ${category.name}`);

        showToast(errorMessage, 'error');
        await loadData();
        return;
      }

      showToast(
        nextManualAvailability
          ? `${category.name} items will show when stock is available`
          : `${category.name} hidden from customers`,
      );
      await loadData();
    } finally {
      setUpdatingCategoryId(null);
    }
  }

  async function saveCategory() {
    if (!catForm.name.trim()) {
      showToast('Category name is required', 'error');
      return;
    }

    const slug = catForm.slug || catForm.name.toLowerCase().replace(/\s+/g, '-');
    const payload = {
      name: catForm.name.trim(),
      slug,
      image_url: normalizeImageUrl(catForm.image_url),
    };

    const { error } = catForm.id
      ? await supabase.from('categories').update(payload).eq('id', catForm.id)
      : await supabase.from('categories').insert({
        ...payload,
        display_order: categories.length,
      });

    if (error) {
      showToast(error.message || `Failed to ${catForm.id ? 'update' : 'add'} category`, 'error');
      return;
    }

    setCatForm(emptyCategoryForm);
    setShowCatForm(false);
    showToast(catForm.id ? 'Category updated' : 'Category added');
    await loadData();
  }

  function startCategoryEdit(category: Category) {
    setCatForm({
      id: category.id,
      name: category.name,
      slug: category.slug,
      image_url: category.image_url,
    });
    setShowCatForm(true);
  }

  async function deleteCategory(id: string) {
    const { count, error: linkedItemsError } = await supabase
      .from('menu_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', id);

    if (linkedItemsError) {
      showToast(linkedItemsError.message || 'Failed to check category items', 'error');
      return;
    }

    if ((count || 0) > 0) {
      showToast('This category still has menu items. Move or archive those items first.', 'error');
      return;
    }

    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) {
      showToast(error.message || 'Failed to delete category', 'error');
      return;
    }

    showToast('Category deleted');
    await loadData();
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-brand-surface rounded w-32 mb-4" />
        <div className="h-40 bg-brand-surface rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Product Management</h1>
          <p className="mt-1 text-sm text-brand-text-muted">Add products, track stock, and control customer visibility.</p>
        </div>
        <button
          onClick={startNewProduct}
          className="btn-primary inline-flex items-center justify-center gap-1 px-4 py-2 text-sm"
        >
          <Plus size={16} /> Add Product
        </button>
      </div>

      <div className="mb-8 rounded-xl border border-brand-border bg-brand-surface p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Stock Tracking</h2>
            <p className="mt-1 text-sm text-brand-text-muted">
              Track menu item quantities here. Products hidden manually are kept out of this stock list.
            </p>
          </div>
          {!inventorySchemaReady && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
              Run the inventory migration to enable stock controls.
            </div>
          )}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Menu Products', value: stockTrackingItems.length, className: 'border-sky-500/20 bg-sky-500/10 text-sky-300' },
            { label: 'Tracked', value: trackedItems.length, className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
            { label: 'Low Stock', value: lowStockItems.length, className: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
            { label: 'Out', value: outOfStockItems.length, className: 'border-red-500/20 bg-red-500/10 text-red-300' },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-lg border px-3 py-3 ${stat.className}`}>
              <p className="text-2xl font-black tabular-nums">{stat.value}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-75">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="mb-4 rounded-lg border border-brand-border bg-brand-bg/40 px-3 py-2 text-sm text-brand-text-muted">
          Total tracked stock: <span className="font-bold text-white">{totalTrackedQuantity}</span> item{totalTrackedQuantity === 1 ? '' : 's'}
          {hiddenFromStockTrackingItems.length > 0 && (
            <span className="ml-2 text-xs text-brand-text-dim">
              {hiddenFromStockTrackingItems.length} hidden product{hiddenFromStockTrackingItems.length === 1 ? '' : 's'} excluded
            </span>
          )}
        </div>

        {trackedItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-brand-border bg-brand-bg/30 px-4 py-6 text-center">
            <p className="text-sm font-semibold text-white">No products are tracking stock yet.</p>
            <p className="mt-1 text-xs text-brand-text-dim">Add a product or edit an existing one, then enable stock quantity tracking.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {trackedItems.map((item) => {
              const stockStatus = getStockStatus(item);
              const stockDraft = getStockDraftValue(item);
              const isUpdatingStock = updatingStockId === item.id;

              return (
                <div key={item.id} className="rounded-lg border border-brand-border bg-brand-bg/40 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-bold text-white">{item.name}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${stockStatus.className}`}>
                          {stockStatus.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-brand-text-dim">
                        ₹{item.price} &bull; {getAvailableQuantity(item)} available
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void adjustStockQuantity(item, -1)}
                        disabled={isUpdatingStock || !inventorySchemaReady || getAvailableQuantity(item) <= 0}
                        className="h-9 w-9 rounded-lg border border-brand-border text-sm font-black text-brand-text-muted transition-colors hover:border-brand-gold/40 hover:text-brand-gold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={stockDraft}
                        onChange={(event) => setStockDraftValue(item.id, event.target.value)}
                        disabled={!inventorySchemaReady}
                        className="h-9 w-24 rounded-lg border border-brand-border bg-brand-surface px-3 text-center text-sm font-bold text-white outline-none transition-colors focus:border-brand-gold disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <button
                        onClick={() => void adjustStockQuantity(item, 1)}
                        disabled={isUpdatingStock || !inventorySchemaReady}
                        className="h-9 w-9 rounded-lg border border-brand-border text-sm font-black text-brand-text-muted transition-colors hover:border-brand-gold/40 hover:text-brand-gold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        +
                      </button>
                      <button
                        onClick={() => void saveStockDraft(item)}
                        disabled={isUpdatingStock || !inventorySchemaReady}
                        className="rounded-lg bg-brand-gold px-3 py-2 text-xs font-bold text-brand-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isUpdatingStock ? 'Saving...' : 'Save Stock'}
                      </button>
                      <button
                        onClick={() => setEditing(toItemForm(item))}
                        className="rounded-lg border border-brand-border px-3 py-2 text-xs font-bold text-brand-text-muted transition-colors hover:border-brand-gold/40 hover:text-brand-gold"
                      >
                        Edit Product
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {untrackedItems.length > 0 && inventorySchemaReady && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-bold text-white">Not Tracking Stock</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {untrackedItems.slice(0, 6).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-brand-border bg-brand-bg/30 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{item.name}</p>
                    <p className="text-xs text-brand-text-dim">Manual visibility only</p>
                  </div>
                  <button
                    onClick={() => void updateStockQuantity(item, getAvailableQuantity(item), true)}
                    disabled={updatingStockId === item.id}
                    className="shrink-0 rounded-lg border border-brand-gold/30 px-3 py-1.5 text-xs font-bold text-brand-gold transition-colors hover:bg-brand-gold hover:text-brand-bg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Track
                  </button>
                </div>
              ))}
            </div>
            {untrackedItems.length > 6 && (
              <p className="mt-2 text-xs text-brand-text-dim">
                {untrackedItems.length - 6} more product{untrackedItems.length - 6 === 1 ? '' : 's'} can be enabled from Edit Product.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Categories</h2>
          <button
            onClick={() => {
              setCatForm(emptyCategoryForm);
              setShowCatForm(true);
            }}
            className="flex items-center gap-1 text-sm text-brand-gold font-semibold"
          >
            <Plus size={16} /> Add Category
          </button>
        </div>

        {showCatForm && (
          <div ref={categoryFormRef} className="bg-brand-surface rounded-xl border border-brand-border p-4 mb-4 space-y-3">
            <h3 className="text-sm font-bold text-white">{catForm.id ? 'Edit Category' : 'Add Category'}</h3>
            <input placeholder="Category Name" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} className="input-field" />
            <input placeholder="Image URL" value={catForm.image_url} onChange={(e) => setCatForm({ ...catForm, image_url: e.target.value })} className="input-field" />
            <div className="flex gap-2">
              <button onClick={saveCategory} className="btn-primary text-sm px-4 py-2 flex items-center gap-1"><Save size={14} />{catForm.id ? 'Update' : 'Save'}</button>
              <button
                onClick={() => {
                  setCatForm(emptyCategoryForm);
                  setShowCatForm(false);
                }}
                className="btn-outline text-sm px-4 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {categories.map((cat) => {
            const totalItems = categoryItemCountById[cat.id] || 0;
            const availableItems = categoryAvailableItemCountById[cat.id] || 0;
            const hasItems = totalItems > 0;
            const isUpdatingCategory = updatingCategoryId === cat.id;
            const shouldMarkVisible = hasItems && availableItems === 0;

            return (
              <div key={cat.id} className="rounded-xl border border-brand-border bg-brand-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{cat.name}</p>
                    <p className="mt-1 text-xs text-brand-text-muted">
                      {hasItems
                        ? `${availableItems}/${totalItems} item${totalItems === 1 ? '' : 's'} visible`
                        : 'No items in this category'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startCategoryEdit(cat)} className="rounded-lg p-2 text-brand-text-dim transition-colors hover:bg-brand-surface-light/70 hover:text-white"><Pencil size={14} /></button>
                    <button onClick={() => deleteCategory(cat.id)} className="rounded-lg p-2 text-brand-text-dim transition-colors hover:bg-red-500/10 hover:text-red-400"><Trash2 size={14} /></button>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                      hasItems && availableItems > 0
                        ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                        : 'border border-red-500/20 bg-red-500/10 text-red-300'
                    }`}
                  >
                    {hasItems && availableItems > 0 ? 'Visible To Customers' : 'Hidden From Customers'}
                  </span>
                  <button
                    onClick={() => void toggleCategoryAvailability(cat, shouldMarkVisible)}
                    disabled={!hasItems || isUpdatingCategory}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors ${
                      !hasItems || isUpdatingCategory
                        ? 'cursor-not-allowed bg-brand-surface-light/40 text-brand-text-dim'
                        : shouldMarkVisible
                          ? 'text-emerald-300 hover:bg-emerald-500/10'
                          : 'text-red-300 hover:bg-red-500/10'
                    }`}
                  >
                    {isUpdatingCategory ? 'Updating...' : shouldMarkVisible ? 'Show All' : 'Hide All'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Menu Items</h2>
          <button
            onClick={startNewProduct}
            className="flex items-center gap-1 text-sm text-brand-gold font-semibold"
          >
            <Plus size={16} /> Add Product
          </button>
        </div>

        {editing && (
          <div ref={itemFormRef} className="bg-brand-surface rounded-xl border border-brand-border p-4 mb-4 space-y-3">
            {!inventorySchemaReady && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Stock quantity tracking is not enabled on this Supabase project yet.
                Run the latest migration, then refresh this page.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input placeholder="Item Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="input-field" />
              <select value={editing.category_id} onChange={(e) => setEditing({ ...editing, category_id: e.target.value })} className="input-field">
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input placeholder="Price" type="number" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} className="input-field" />
              <input placeholder="Prep Time (min)" type="number" value={editing.prep_time} onChange={(e) => setEditing({ ...editing, prep_time: e.target.value })} className="input-field" />
            </div>

            <input placeholder="Image URL" value={editing.image_url} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} className="input-field" />
            <textarea placeholder="Description" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="input-field resize-none" rows={2} />

            <div className="rounded-xl border border-brand-border bg-brand-surface-light/40 p-4 space-y-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-brand-text-dim">Dietary Tags</p>
                <p className="mt-1 text-sm text-brand-text-muted">
                  Choose which label should appear on the product card.
                </p>
              </div>
              {!dietarySchemaReady && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Non-Veg label needs the latest Supabase migration before it can be saved.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEditing((current) => {
                    if (!current) return current;

                    const nextIsVeg = !current.is_veg;

                    return {
                      ...current,
                      is_veg: nextIsVeg,
                      is_non_veg: false,
                      is_eggless: nextIsVeg ? current.is_eggless : false,
                    };
                  })}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                    editing.is_veg
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-brand-border text-brand-text-muted hover:border-emerald-500/30 hover:text-emerald-300'
                  }`}
                >
                  Veg
                </button>
                <button
                  type="button"
                  onClick={() => setEditing((current) => {
                    if (!current) return current;

                    const nextIsNonVeg = !current.is_non_veg;

                    return {
                      ...current,
                      is_non_veg: nextIsNonVeg,
                      is_veg: nextIsNonVeg ? false : current.is_veg,
                      is_eggless: nextIsNonVeg ? false : current.is_eggless,
                    };
                  })}
                  disabled={!dietarySchemaReady}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                    editing.is_non_veg
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-brand-border text-brand-text-muted hover:border-red-500/30 hover:text-red-300'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  Non-Veg
                </button>
                <button
                  type="button"
                  onClick={() => setEditing((current) => (
                    current
                      ? {
                          ...current,
                          is_eggless: !current.is_eggless,
                        }
                      : current
                  ))}
                  disabled={!editing.is_veg || editing.is_non_veg}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                    editing.is_eggless
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-brand-border text-brand-text-muted hover:border-amber-500/30 hover:text-amber-300'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  Eggless
                </button>
              </div>
              <p className="text-xs text-brand-text-dim">
                Eggless is available only when the item is marked veg.
              </p>
            </div>

            <label className="flex items-center gap-3 rounded-xl border border-brand-border bg-brand-surface-light/40 px-4 py-3 text-sm text-white">
              <input
                type="checkbox"
                checked={!editing.manual_availability}
                onChange={(e) => setEditing({ ...editing, manual_availability: !e.target.checked })}
                className="h-4 w-4 accent-brand-gold"
              />
              <span>Hide item from customers</span>
            </label>

            <div className="rounded-xl border border-brand-border bg-brand-surface-light/40 p-4 space-y-3">
              <label className="flex items-center gap-3 text-sm text-white">
                <input
                  type="checkbox"
                  checked={editing.track_inventory}
                  onChange={(e) => setEditing({
                    ...editing,
                    track_inventory: e.target.checked,
                    available_quantity: e.target.checked ? editing.available_quantity : editing.available_quantity || '0',
                  })}
                  disabled={!inventorySchemaReady}
                  className="h-4 w-4 accent-brand-gold"
                />
                <span>Track stock quantity for this item</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase tracking-[0.18em] text-brand-text-dim mb-2">
                    Available Quantity
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editing.available_quantity}
                    onChange={(e) => setEditing({ ...editing, available_quantity: e.target.value })}
                    disabled={!editing.track_inventory}
                    className="input-field disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div className="rounded-xl border border-brand-border bg-brand-bg/60 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-brand-text-dim">Result</p>
                  <p className="mt-2 text-sm font-semibold text-white">{editingVisibilityResult?.title}</p>
                  <p className="mt-1 text-xs text-brand-text-muted">
                    {editingVisibilityResult?.detail}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-sm text-brand-text-muted">
              Stock counts are only for admin use. Hidden items do not appear on the customer menu.
            </p>
            <p className="text-sm text-brand-text-muted">
              Add-ons are assigned from the Add-On Management section below.
            </p>

            <div className="flex gap-2">
              <button onClick={saveItem} className="btn-primary text-sm px-4 py-2 flex items-center gap-1"><Save size={14} />{editing.id ? 'Update' : 'Add'}</button>
              <button onClick={() => setEditing(null)} className="btn-outline text-sm px-4 py-2 flex items-center gap-1"><X size={14} />Cancel</button>
            </div>
          </div>
        )}

        {/* Search + category filter */}
        <div className="mb-3 space-y-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-dim pointer-events-none" />
            <input
              type="text"
              placeholder="Search items…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field pl-9 pr-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-text-dim hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategoryFilter('')}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  !selectedCategoryFilter
                    ? 'border-brand-gold bg-brand-gold/10 text-brand-gold'
                    : 'border-brand-border text-brand-text-muted hover:border-brand-gold/40 hover:text-white'
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryFilter(selectedCategoryFilter === cat.id ? '' : cat.id)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    selectedCategoryFilter === cat.id
                      ? 'border-brand-gold bg-brand-gold/10 text-brand-gold'
                      : 'border-brand-border text-brand-text-muted hover:border-brand-gold/40 hover:text-white'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          {(searchQuery || selectedCategoryFilter) && (
            <p className="text-xs text-brand-text-dim">
              {filteredItems.length} of {sortedItems.length} item{sortedItems.length === 1 ? '' : 's'}
            </p>
          )}
        </div>

        {sortedItems.length === 0 ? (
          <div className="bg-brand-surface rounded-xl border border-brand-border p-10 text-center text-brand-text-muted">
            No menu items to show
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-brand-border bg-brand-bg/30 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-white">No items match your search</p>
            <button
              onClick={() => { setSearchQuery(''); setSelectedCategoryFilter(''); }}
              className="mt-2 text-xs text-brand-gold hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredItems.map((item) => {
              const manualAvailability = getManualAvailability(item);
              const trackInventory = getTrackInventory(item);
              const availableQuantity = getAvailableQuantity(item);
              const categoryName = categories.find((c) => c.id === item.category_id)?.name;
              const dietaryBadges = getMenuItemDietaryBadges(item);

              return (
                <div key={item.id} className="bg-brand-surface rounded-xl border border-brand-border p-3 space-y-2">
                  {/* Row 1: image + name + badges */}
                  <div className="flex items-center gap-3">
                    <img
                      src={item.image_url || '/image.png'}
                      alt={item.name}
                      loading="lazy"
                      width={44}
                      height={44}
                      onError={(event) => {
                        if (event.currentTarget.src.endsWith('/image.png')) return;
                        event.currentTarget.src = '/image.png';
                      }}
                      className="w-11 h-11 rounded-lg object-cover flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-bold text-sm text-white">{item.name}</h3>
                        {dietaryBadges.map((badge) => (
                          <span key={badge.key} className={`${badge.className} px-2 py-0.5 text-[10px]`}>
                            {badge.label}
                          </span>
                        ))}
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            item.is_available
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                              : 'border-red-500/20 bg-red-500/10 text-red-300'
                          }`}
                        >
                          {item.is_available ? 'Visible' : 'Hidden'}
                        </span>
                        {trackInventory && (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              availableQuantity > 5
                                ? 'border-sky-500/20 bg-sky-500/10 text-sky-300'
                                : availableQuantity > 0
                                  ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                                  : 'border-red-500/20 bg-red-500/10 text-red-300'
                            }`}
                          >
                            {formatInventorySummary(item)}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-brand-text-dim">
                        {formatVisibilityReason(item)}
                      </p>
                    </div>
                  </div>

                  {/* Row 2: price/meta + actions */}
                  <div className="flex items-center justify-between gap-2 pl-14">
                    <p className="text-xs text-brand-text-muted">
                      ₹{item.price}
                      {item.prep_time ? ` · ${item.prep_time} min` : ''}
                      {categoryName ? ` · ${categoryName}` : ''}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => void toggleItemAvailability(item, !manualAvailability)}
                        className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                          manualAvailability
                            ? 'text-red-300 hover:bg-red-500/10'
                            : 'text-emerald-300 hover:bg-emerald-500/10'
                        }`}
                      >
                        {manualAvailability ? 'Hide' : 'Show'}
                      </button>
                      <button
                        onClick={() => setEditing(toItemForm(item))}
                        className="rounded-lg p-2 text-brand-text-dim transition-colors hover:bg-brand-surface-light/70 hover:text-white"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="rounded-lg p-2 text-brand-text-dim transition-colors hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CustomizationAssignmentsManager />
    </div>
  );
}
