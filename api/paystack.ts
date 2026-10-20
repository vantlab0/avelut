import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    },
  });
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const queryAction = url.searchParams.get('action');
    const body = await req.json().catch(() => ({}));
    const action = queryAction || body.action || (body.reference ? 'verify' : 'initialize');

    if (action === 'verify' || body.reference) {
      return await handleVerify(body);
    } else {
      return await handleInitialize(body, req);
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Payment processing error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

async function handleInitialize(body: any, req: Request) {
  const { amount, planKey, packageId, type, userId, email: userEmail } = body;

  let resolvedAmountNgn: number | null = null;

  if (packageId) {
    if (packageId === 'live_tutorial_15' || packageId === 'live_tutorial_pass') resolvedAmountNgn = 70;
    else if (packageId === 'live_tutorial_30' || packageId === 'live_tutorial_30_pass') resolvedAmountNgn = 130;
    else if (packageId === 'live_tutorial_60' || packageId === 'live_tutorial_60_pass') resolvedAmountNgn = 270;
  }

  if (!resolvedAmountNgn && planKey) {
    const key = (planKey || '').toLowerCase();
    if (key === 'pro' || key === 'monthly' || key === 'premium') resolvedAmountNgn = 3999;
    else if (key === 'weekly' || key === 'basic') resolvedAmountNgn = 1499;
    else if (key === 'semester') resolvedAmountNgn = 11999;
  }

  const finalAmountNgn = resolvedAmountNgn ?? Number(amount);

  if (!finalAmountNgn || finalAmountNgn < 50) {
    return new Response(
      JSON.stringify({ error: 'Invalid amount or package ID. Minimum is ₦50.' }),
      { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!PAYSTACK_SECRET_KEY) {
    return new Response(
      JSON.stringify({ error: 'PAYSTACK_SECRET_KEY is not configured on the server' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const host = req.headers.get('host') || 'www.avelut.xyz';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const callback_url = `${protocol}://${host}/payment-success`;

  const email = userEmail || `${userId || 'student'}@avelut.com`;
  const payload = {
    email,
    amount: Math.round(finalAmountNgn * 100),
    callback_url,
    metadata: {
      custom_fields: [
        { display_name: 'User ID', variable_name: 'user_id', value: userId },
        { display_name: 'Purchase Type', variable_name: 'purchase_type', value: type },
        { display_name: 'Plan Key', variable_name: 'plan_key', value: planKey || 'none' },
        { display_name: 'Package ID', variable_name: 'package_id', value: packageId || 'none' },
      ],
    },
  };

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json();

  if (!json.status) {
    return new Response(
      JSON.stringify({ error: json.message || 'Failed to initialize payment with provider' }),
      { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }

  return new Response(
    JSON.stringify({
      authorization_url: json.data.authorization_url,
      reference: json.data.reference,
      access_code: json.data.access_code,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
  );
}

async function handleVerify(body: any) {
  const { reference, userId } = body;

  if (!reference) {
    return new Response(
      JSON.stringify({ error: 'Transaction reference is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!PAYSTACK_SECRET_KEY) {
    return new Response(
      JSON.stringify({ error: 'PAYSTACK_SECRET_KEY is not configured on the server' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
  });

  const json = await response.json();

  if (!json.status || json.data.status !== 'success') {
    return new Response(
      JSON.stringify({ error: json.data?.gateway_response || 'Payment verification failed' }),
      { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const data = json.data;
  const metadata = data.metadata || {};
  const customFields = metadata.custom_fields || [];
  
  const uidField = customFields.find((f: any) => f.variable_name === 'user_id');
  const typeField = customFields.find((f: any) => f.variable_name === 'purchase_type');
  const planField = customFields.find((f: any) => f.variable_name === 'plan_key');
  const packageField = customFields.find((f: any) => f.variable_name === 'package_id');

  const targetUserId = userId || uidField?.value;
  const purchaseType = typeField?.value || 'refill';
  const planKey = planField?.value;
  const packageId = packageField?.value;
  const amountNgn = data.amount / 100;

  if (targetUserId) {
    if (purchaseType === 'subscription') {
      const canonicalPlan = (planKey || 'pro').toLowerCase();
      const effectivePlan = canonicalPlan === 'pro' ? 'monthly' : canonicalPlan;

      await supabaseAdmin.from('profiles').update({
        is_paid_subscriber: true,
        subscription_status: effectivePlan,
        updated_at: new Date().toISOString(),
      }).eq('id', targetUserId);

      await supabaseAdmin.from('subscriptions').upsert({
        user_id: targetUserId,
        plan_type: effectivePlan,
        status: 'active',
        paystack_reference: reference,
        starts_at: new Date().toISOString(),
      });
    } else {
      let creditsToAdd = Math.round(amountNgn);
      if (packageId === 'live_tutorial_15') creditsToAdd = 70;
      else if (packageId === 'live_tutorial_30') creditsToAdd = 130;
      else if (packageId === 'live_tutorial_60') creditsToAdd = 270;

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('ai_credits')
        .eq('id', targetUserId)
        .maybeSingle();

      const currentCredits = profile?.ai_credits || 0;
      await supabaseAdmin.from('profiles').update({
        ai_credits: currentCredits + creditsToAdd,
        updated_at: new Date().toISOString(),
      }).eq('id', targetUserId);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Payment verified and applied successfully',
      data: {
        reference,
        amount: amountNgn,
        status: data.status,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
  );
}
