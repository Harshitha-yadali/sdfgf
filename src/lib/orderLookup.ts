import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import type { Order, OrderItem } from '../types';
import { customerSupabase } from './supabase';

interface OrderLookupResponse {
  success: boolean;
  order?: Order;
  items?: OrderItem[];
  error?: string;
}

interface FunctionAuthToken {
  accessToken: string;
  isGuest: boolean;
}

const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const MISSING_ORDER_LOOKUP_FUNCTION_MESSAGE =
  'Guest order tracking is not enabled on this Supabase project yet. Deploy the order lookup Edge Function first.';

function normalizeGuestCustomerEmail(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

async function refreshCustomerSession(errorMessage = 'Please sign in again to view your order.') {
  const { data: refreshedData, error: refreshError } = await customerSupabase.auth.refreshSession();
  if (refreshError || !refreshedData.session) {
    throw new Error(errorMessage);
  }

  return refreshedData.session;
}

async function getFunctionAuthToken(options?: { forceRefresh?: boolean; errorMessage?: string }): Promise<FunctionAuthToken> {
  const forceRefresh = options?.forceRefresh ?? false;
  const errorMessage = options?.errorMessage ?? 'Please sign in again to view your order.';

  if (forceRefresh) {
    const session = await refreshCustomerSession(errorMessage);
    return { accessToken: session.access_token, isGuest: false };
  }

  const { data: sessionData } = await customerSupabase.auth.getSession();
  if (!sessionData.session) {
    return { accessToken: supabaseAnonKey, isGuest: true };
  }

  const expiresAtMs = sessionData.session.expires_at ? sessionData.session.expires_at * 1000 : 0;
  if (!expiresAtMs || expiresAtMs - Date.now() < 60_000) {
    const session = await refreshCustomerSession(errorMessage);
    return { accessToken: session.access_token, isGuest: false };
  }

  return { accessToken: sessionData.session.access_token, isGuest: false };
}

async function toOrderLookupFunctionError(error: unknown, fallbackMessage: string) {
  if (error instanceof FunctionsHttpError) {
    const response = error.context;

    if (response instanceof Response) {
      if (response.status === 401) {
        return new Error('Authentication failed. Please try again or sign in again.');
      }

      if (response.status === 404) {
        return new Error(MISSING_ORDER_LOOKUP_FUNCTION_MESSAGE);
      }

      try {
        const payload = await response.clone().json() as { error?: string; message?: string };
        if (typeof payload.error === 'string' && payload.error.trim()) {
          return new Error(payload.error);
        }
        if (typeof payload.message === 'string' && payload.message.trim()) {
          return new Error(payload.message);
        }
      } catch {
        try {
          const text = await response.clone().text();
          if (text.trim()) {
            return new Error(text.trim());
          }
        } catch {
          // fall through
        }
      }
    }

    return new Error(fallbackMessage);
  }

  if (error instanceof FunctionsFetchError) {
    return new Error('Could not reach the order tracking service. Please check your network and try again.');
  }

  if (error instanceof FunctionsRelayError) {
    return new Error('Supabase could not route the order tracking request. Please try again.');
  }

  return error instanceof Error ? error : new Error(fallbackMessage);
}

export async function fetchAccessibleOrderDetails(appOrderId: string, customerEmail?: string) {
  let authToken = await getFunctionAuthToken();
  const requestBody = {
    appOrderId,
    customerEmail: normalizeGuestCustomerEmail(customerEmail),
  };
  const invoke = () => customerSupabase.functions.invoke<OrderLookupResponse>(
    'get-order-details',
    {
      body: requestBody,
      headers: {
        Authorization: `Bearer ${authToken.accessToken}`,
      },
    },
  );

  const { data, error } = await invoke();

  if (error instanceof FunctionsHttpError && error.context instanceof Response && error.context.status === 401 && !authToken.isGuest) {
    authToken = await getFunctionAuthToken({ forceRefresh: true });
    const retry = await invoke();
    if (retry.error) {
      throw await toOrderLookupFunctionError(retry.error, 'Failed to load order details');
    }
    if (!retry.data?.success || !retry.data.order) {
      throw new Error(retry.data?.error || 'Order not found');
    }
    return {
      order: retry.data.order,
      items: retry.data.items || [],
    };
  }

  if (error) {
    throw await toOrderLookupFunctionError(error, 'Failed to load order details');
  }

  if (!data?.success || !data.order) {
    throw new Error(data?.error || 'Order not found');
  }

  return {
    order: data.order,
    items: data.items || [],
  };
}
