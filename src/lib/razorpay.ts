import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { customerSupabase } from './supabase';
import type { OrderType, PickupOption, SelectedCustomization } from '../types';

export interface RazorpayCartItemInput {
  menu_item_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  customizations: SelectedCustomization[];
}

interface CreateRazorpayOrderPayload {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  orderType: OrderType;
  pickupOption: PickupOption;
  address: string;
  pincode: string;
  deliveryFee: number;
  deliveryLat?: number;
  deliveryLng?: number;
  subtotal: number;
  discount: number;
  total: number;
  reviewRewardCouponId?: string;
  reviewRewardDiscountAmount?: number;
  items: RazorpayCartItemInput[];
}

interface CreateRazorpayOrderResponse {
  success: boolean;
  keyId: string;
  razorpayOrderId: string;
  appOrderId: string;
  amount: number;
  currency: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  error?: string;
}

interface CreateExistingRazorpayOrderResponse {
  success: boolean;
  keyId: string;
  razorpayOrderId: string;
  appOrderId: string;
  amount: number;
  currency: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  error?: string;
}

interface VerifyRazorpayPaymentPayload {
  appOrderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  customerEmail?: string;
}

interface VerifyRazorpayPaymentResponse {
  success: boolean;
  appOrderId?: string;
  paymentState?: 'paid' | 'pending' | 'failed';
  orderStatus?: string;
  paymentMethod?: 'upi' | 'card';
  receiptEmailSent?: boolean;
  manualReview?: boolean;
  error?: string;
}

interface CancelRazorpayPaymentResponse {
  success: boolean;
  appOrderId?: string;
  paymentState?: 'paid' | 'pending' | 'failed';
  orderStatus?: string;
  paymentMethod?: 'upi' | 'card';
  receiptEmailSent?: boolean;
  manualReview?: boolean;
  error?: string;
}

interface ReconcileRazorpayPaymentResponse {
  success: boolean;
  appOrderId?: string;
  paymentState?: 'paid' | 'pending' | 'failed';
  orderStatus?: string;
  paymentMethod?: 'upi' | 'card';
  receiptEmailSent?: boolean;
  manualReview?: boolean;
  error?: string;
}

let razorpayScriptPromise: Promise<void> | null = null;

const MISSING_RAZORPAY_FUNCTIONS_MESSAGE =
  'Online payment is not enabled on this Supabase project yet. Deploy the Razorpay Edge Functions first.';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const GUEST_EDGE_CHECKOUT_ENABLED = import.meta.env.VITE_GUEST_EDGE_CHECKOUT_ENABLED !== 'false';
export const RAZORPAY_BRAND_IMAGE =
  typeof window === 'undefined' || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname)
    ? undefined
    : new URL('/razorpay-logo-badge.svg', window.location.origin).toString();

function getSupabaseFunctionsBaseUrl() {
  return new URL('/functions/v1/', import.meta.env.VITE_SUPABASE_URL as string);
}

function normalizeGuestCustomerEmail(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function toAbsoluteReturnUrl(returnPathOrUrl: string) {
  if (/^https?:\/\//i.test(returnPathOrUrl)) {
    return returnPathOrUrl;
  }

  if (typeof window === 'undefined') {
    throw new Error('Window is not available');
  }

  return new URL(returnPathOrUrl, window.location.origin).toString();
}

export function buildRazorpayCallbackUrl(appOrderId: string, returnPathOrUrl = `/order-success/${appOrderId}`) {
  const callbackUrl = new URL('razorpay-callback', getSupabaseFunctionsBaseUrl());
  callbackUrl.searchParams.set('app_order_id', appOrderId);
  callbackUrl.searchParams.set('return_url', toAbsoluteReturnUrl(returnPathOrUrl));
  return callbackUrl.toString();
}

async function refreshCustomerSession(errorMessage = 'Please sign in again to continue.') {
  const { data: refreshedData, error: refreshError } = await customerSupabase.auth.refreshSession();
  if (refreshError || !refreshedData.session) {
    throw new Error(errorMessage);
  }

  return refreshedData.session;
}

interface FunctionAuthToken {
  accessToken: string;
  isGuest: boolean;
}

async function getFunctionAuthToken(options?: { forceRefresh?: boolean; errorMessage?: string }): Promise<FunctionAuthToken> {
  const forceRefresh = options?.forceRefresh ?? false;
  const errorMessage = options?.errorMessage ?? 'Please sign in again to continue.';

  if (forceRefresh) {
    const session = await refreshCustomerSession(errorMessage);
    return { accessToken: session.access_token, isGuest: false };
  }

  const { data: sessionData } = await customerSupabase.auth.getSession();
  if (!sessionData.session) {
    return { accessToken: supabaseAnonKey, isGuest: true };
  } else {
    const expiresAtMs = sessionData.session.expires_at ? sessionData.session.expires_at * 1000 : 0;
    if (!expiresAtMs || expiresAtMs - Date.now() < 60_000) {
      const session = await refreshCustomerSession(errorMessage);
      return { accessToken: session.access_token, isGuest: false };
    }
  }

  return { accessToken: sessionData.session.access_token, isGuest: false };
}

async function toRazorpayFunctionError(error: unknown, fallbackMessage: string) {
  if (error instanceof FunctionsHttpError) {
    const response = error.context;

    if (response instanceof Response) {
      if (response.status === 401) {
        return new Error('Authentication failed. Please try again or sign in again.');
      }

      if (response.status === 404) {
        return new Error(MISSING_RAZORPAY_FUNCTIONS_MESSAGE);
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
    return new Error('Could not reach the online payment service. Please check your network and try again.');
  }

  if (error instanceof FunctionsRelayError) {
    return new Error('Supabase could not route the online payment request. Please try again.');
  }

  return error instanceof Error ? error : new Error(fallbackMessage);
}

export function loadRazorpayScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is not available'));
  }

  if (window.Razorpay) {
    return Promise.resolve();
  }

  if (razorpayScriptPromise) {
    return razorpayScriptPromise;
  }

  razorpayScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpayCheckout = 'true';
    script.onload = () => resolve();
    script.onerror = () => {
      razorpayScriptPromise = null;
      script.remove();
      reject(new Error('Failed to load Razorpay checkout'));
    };
    document.body.appendChild(script);
  });

  return razorpayScriptPromise;
}

export async function createRazorpayOrder(payload: CreateRazorpayOrderPayload) {
  let authToken = await getFunctionAuthToken();

  if (authToken.isGuest && !GUEST_EDGE_CHECKOUT_ENABLED) {
    throw new Error('Guest online payment needs the store backend update before an Order ID can be created.');
  }

  const { data, error } = await customerSupabase.functions.invoke<CreateRazorpayOrderResponse>(
    'create-razorpay-order',
    {
      body: payload,
      headers: {
        Authorization: `Bearer ${authToken.accessToken}`,
      },
    },
  );

  if (error instanceof FunctionsHttpError && error.context instanceof Response && error.context.status === 401 && !authToken.isGuest) {
    authToken = await getFunctionAuthToken({ forceRefresh: true });
    const retry = await customerSupabase.functions.invoke<CreateRazorpayOrderResponse>(
      'create-razorpay-order',
      {
        body: payload,
        headers: {
          Authorization: `Bearer ${authToken.accessToken}`,
        },
      },
    );
    if (retry.error) {
      throw await toRazorpayFunctionError(retry.error, 'Failed to create Razorpay order');
    }
    if (!retry.data?.success) {
      throw new Error(retry.data?.error || 'Failed to create Razorpay order');
    }
    return retry.data;
  }

  if (error instanceof FunctionsHttpError && error.context instanceof Response && error.context.status === 401 && authToken.isGuest) {
    try {
      const payload = await error.context.clone().json() as { error?: string; message?: string };
      const msg = (typeof payload.error === 'string' && payload.error.trim()) || (typeof payload.message === 'string' && payload.message.trim());
      if (msg) throw new Error(msg);
    } catch (parseErr) {
      if (parseErr instanceof Error && parseErr !== error) throw parseErr;
    }
    throw new Error('Guest online payment needs the store backend update before an Order ID can be created.');
  }

  if (error) {
    throw await toRazorpayFunctionError(error, 'Failed to create Razorpay order');
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to create Razorpay order');
  }

  return data;
}

export async function createExistingRazorpayOrder(appOrderId: string, customerEmail?: string) {
  let authToken = await getFunctionAuthToken();
  const requestBody = {
    appOrderId,
    customerEmail: normalizeGuestCustomerEmail(customerEmail),
  };
  const invoke = () => customerSupabase.functions.invoke<CreateExistingRazorpayOrderResponse>(
    'create-existing-razorpay-order',
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
      throw await toRazorpayFunctionError(retry.error, 'Failed to start online payment');
    }
    if (!retry.data?.success) {
      throw new Error(retry.data?.error || 'Failed to start online payment');
    }
    return retry.data;
  }

  if (error) {
    throw await toRazorpayFunctionError(error, 'Failed to start online payment');
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to start online payment');
  }

  return data;
}

export async function verifyRazorpayPayment(payload: VerifyRazorpayPaymentPayload) {
  let authToken = await getFunctionAuthToken();
  const requestBody = {
    ...payload,
    customerEmail: normalizeGuestCustomerEmail(payload.customerEmail),
  };
  const { data, error } = await customerSupabase.functions.invoke<VerifyRazorpayPaymentResponse>(
    'verify-razorpay-payment',
    {
      body: requestBody,
      headers: {
        Authorization: `Bearer ${authToken.accessToken}`,
      },
    },
  );

  if (error instanceof FunctionsHttpError && error.context instanceof Response && error.context.status === 401 && !authToken.isGuest) {
    authToken = await getFunctionAuthToken({ forceRefresh: true });
    const retry = await customerSupabase.functions.invoke<VerifyRazorpayPaymentResponse>(
      'verify-razorpay-payment',
      {
        body: requestBody,
        headers: {
          Authorization: `Bearer ${authToken.accessToken}`,
        },
      },
    );
    if (retry.error) {
      throw await toRazorpayFunctionError(retry.error, 'Failed to verify Razorpay payment');
    }
    if (!retry.data?.success) {
      throw new Error(retry.data?.error || 'Failed to verify Razorpay payment');
    }
    return retry.data;
  }

  if (error) {
    throw await toRazorpayFunctionError(error, 'Failed to verify Razorpay payment');
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to verify Razorpay payment');
  }

  return data;
}

export async function cancelRazorpayPayment(appOrderId: string, customerEmail?: string) {
  let authToken = await getFunctionAuthToken();
  const requestBody = {
    appOrderId,
    customerEmail: normalizeGuestCustomerEmail(customerEmail),
  };
  const { data, error } = await customerSupabase.functions.invoke<CancelRazorpayPaymentResponse>(
    'cancel-razorpay-payment',
    {
      body: requestBody,
      headers: {
        Authorization: `Bearer ${authToken.accessToken}`,
      },
    },
  );

  if (error instanceof FunctionsHttpError && error.context instanceof Response && error.context.status === 401 && !authToken.isGuest) {
    authToken = await getFunctionAuthToken({ forceRefresh: true });
    const retry = await customerSupabase.functions.invoke<CancelRazorpayPaymentResponse>(
      'cancel-razorpay-payment',
      {
        body: requestBody,
        headers: {
          Authorization: `Bearer ${authToken.accessToken}`,
        },
      },
    );
    if (retry.error) {
      throw await toRazorpayFunctionError(retry.error, 'Failed to cancel Razorpay payment');
    }
    if (!retry.data?.success) {
      throw new Error(retry.data?.error || 'Failed to cancel Razorpay payment');
    }
    return retry.data;
  }

  if (error) {
    throw await toRazorpayFunctionError(error, 'Failed to cancel Razorpay payment');
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to cancel Razorpay payment');
  }

  return data;
}

export async function reconcileRazorpayPayment(appOrderId: string, customerEmail?: string) {
  let authToken = await getFunctionAuthToken();
  const requestBody = {
    appOrderId,
    customerEmail: normalizeGuestCustomerEmail(customerEmail),
  };
  const { data, error } = await customerSupabase.functions.invoke<ReconcileRazorpayPaymentResponse>(
    'reconcile-razorpay-payment',
    {
      body: requestBody,
      headers: {
        Authorization: `Bearer ${authToken.accessToken}`,
      },
    },
  );

  if (error instanceof FunctionsHttpError && error.context instanceof Response && error.context.status === 401 && !authToken.isGuest) {
    authToken = await getFunctionAuthToken({ forceRefresh: true });
    const retry = await customerSupabase.functions.invoke<ReconcileRazorpayPaymentResponse>(
      'reconcile-razorpay-payment',
      {
        body: requestBody,
        headers: {
          Authorization: `Bearer ${authToken.accessToken}`,
        },
      },
    );
    if (retry.error) {
      throw await toRazorpayFunctionError(retry.error, 'Failed to reconcile Razorpay payment');
    }
    if (!retry.data?.success) {
      throw new Error(retry.data?.error || 'Failed to reconcile Razorpay payment');
    }
    return retry.data;
  }

  if (error) {
    throw await toRazorpayFunctionError(error, 'Failed to reconcile Razorpay payment');
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to reconcile Razorpay payment');
  }

  return data;
}
