import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const results: Record<string, string> = {};

    const accounts = [
      {
        email: "9999900000@supremewaffle.app",
        password: "admin123",
        role: "admin",
        fullName: "Admin",
        phone: "9999900000",
      },
      {
        email: "9999900001@supremewaffle.app",
        password: "chef123",
        role: "chef",
        fullName: "Chef",
        phone: "9999900001",
      },
      {
        email: "delivery@gmail.com",
        password: "delivery123",
        role: "delivery",
        fullName: "Delivery",
        phone: "9999900002",
      },
    ];

    for (const account of accounts) {
      const { data: existing } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("phone", account.phone)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("profiles")
          .update({ role: account.role })
          .eq("id", existing.id);
        results[account.role] = `Updated existing user to ${account.role} role`;
        continue;
      }

      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email: account.email,
          password: account.password,
          email_confirm: true,
          user_metadata: {
            full_name: account.fullName,
            phone: account.phone,
          },
        });

      if (authError) {
        results[account.role] = `Error: ${authError.message}`;
        continue;
      }

      if (authData.user) {
        await supabase
          .from("profiles")
          .update({
            role: account.role,
            full_name: account.fullName,
            phone: account.phone,
          })
          .eq("id", authData.user.id);
        results[account.role] = `Created successfully`;
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
