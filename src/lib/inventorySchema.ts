import { supabase } from './supabase';

const INVENTORY_COLUMN_NAMES = ['available_quantity', 'manual_availability', 'track_inventory'];
const DIETARY_COLUMN_NAMES = ['is_non_veg'];
const EXPIRE_ORDERS_FUNCTION_NAME = 'expire_stale_pending_orders';
const EXPIRE_ORDERS_UNAVAILABLE_STORAGE_KEY = 'supreme-waffle-expire-orders-rpc-unavailable';

type SupabaseLikeError = {
  code?: string | null;
  message?: string | null;
};

export function isMissingInventorySchemaError(error: SupabaseLikeError | null | undefined) {
  const message = error?.message?.toLowerCase() || '';
  return INVENTORY_COLUMN_NAMES.some((columnName) => message.includes(columnName));
}

export function isMissingDietarySchemaError(error: SupabaseLikeError | null | undefined) {
  const message = error?.message?.toLowerCase() || '';
  return DIETARY_COLUMN_NAMES.some((columnName) => message.includes(columnName));
}

export function isMissingExpireOrdersFunctionError(error: SupabaseLikeError | null | undefined) {
  const message = error?.message?.toLowerCase() || '';
  return error?.code === 'PGRST202' || message.includes(EXPIRE_ORDERS_FUNCTION_NAME);
}

export async function detectInventorySchemaSupport() {
  const { error } = await supabase
    .from('menu_items')
    .select('id, manual_availability, track_inventory, available_quantity')
    .limit(1);

  if (error) {
    if (isMissingInventorySchemaError(error)) {
      return false;
    }

    throw error;
  }

  return true;
}

export async function detectDietarySchemaSupport() {
  const { error } = await supabase
    .from('menu_items')
    .select('id, is_non_veg')
    .limit(1);

  if (error) {
    if (isMissingDietarySchemaError(error)) {
      return false;
    }

    throw error;
  }

  return true;
}

export async function expireStalePendingOrders() {
  if (
    typeof window !== 'undefined' &&
    window.sessionStorage.getItem(EXPIRE_ORDERS_UNAVAILABLE_STORAGE_KEY) === '1'
  ) {
    return false;
  }

  const { error } = await supabase.rpc(EXPIRE_ORDERS_FUNCTION_NAME);

  if (error) {
    if (isMissingExpireOrdersFunctionError(error)) {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(EXPIRE_ORDERS_UNAVAILABLE_STORAGE_KEY, '1');
      }
      return false;
    }

    throw error;
  }

  return true;
}
