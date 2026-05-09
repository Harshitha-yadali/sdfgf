/// <reference types="vite/client" />

interface HomePageState {
  categories: unknown[];
  bestSellers: unknown[];
  allItems: unknown[];
  offers: unknown[];
  popularityContext: Record<string, unknown>;
}

interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayFailureResponse {
  error?: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: {
      order_id?: string;
      payment_id?: string;
    };
  };
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  image?: string;
  description?: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  theme?: {
    color?: string;
  };
  modal?: {
    ondismiss?: () => void;
    confirm_close?: boolean;
  };
  retry?: {
    enabled?: boolean;
    max_count?: number;
  };
  callback_url?: string;
  redirect?: boolean;
  handler?: (response: RazorpaySuccessResponse) => void;
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', callback: (response: RazorpayFailureResponse) => void): void;
}

interface Window {
  Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  __HOME_PAGE_STATE__?: HomePageState;
  snapSaveState?: () => Record<string, unknown>;
}
