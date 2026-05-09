import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  getBearerToken,
  shouldResolveUserFromAuthToken,
} from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface LookupBody {
  appOrderId?: string;
  customerEmail?: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const { appOrderId, customerEmail } = await req.json() as LookupBody;
    const normalizedOrderId = appOrderId?.trim() || "";
    const normalizedCustomerEmail = customerEmail?.trim().toLowerCase() || "";

    if (!normalizedOrderId) {
      return jsonResponse({ success: false, error: "appOrderId is required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authToken = getBearerToken(authHeader);
    const shouldResolveUser = shouldResolveUserFromAuthToken(authToken, anonKey);

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let user: { id: string } | null = null;
    if (shouldResolveUser) {
      const userClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${authToken}` } },
      });
      const {
        data: { user: requestUser },
        error: authError,
      } = await userClient.auth.getUser();

      if (authError || !requestUser) {
        return jsonResponse({ success: false, error: "Unauthorized request" }, 401);
      }

      user = { id: requestUser.id };
    }

    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("*")
      .eq("order_id", normalizedOrderId)
      .maybeSingle();

    if (orderError || !order) {
      return jsonResponse({ success: false, error: "Order not found" }, 404);
    }

    const orderCustomerEmail = order.customer_email?.trim().toLowerCase() || "";

    if (order.user_id) {
      if (order.user_id !== user?.id) {
        return jsonResponse({ success: false, error: "Order not found" }, 404);
      }
    } else if (!normalizedCustomerEmail || !orderCustomerEmail || orderCustomerEmail !== normalizedCustomerEmail) {
      return jsonResponse({ success: false, error: "Order not found" }, 404);
    }

    const { data: items, error: itemsError } = await adminClient
      .from("order_items")
      .select("id, order_id, menu_item_id, item_name, quantity, unit_price, customizations, created_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true });

    if (itemsError) {
      throw itemsError;
    }

    return jsonResponse({
      success: true,
      order,
      items: items || [],
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
