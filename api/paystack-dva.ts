import { createClient } from '@supabase/supabase-js';

export const maxDuration = 45;

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

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

interface DvaAccountResult {
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_slug?: string;
  customer_code: string;
  currency: string;
}

/**
 * GET /api/paystack-dva?userId=...
 * Retrieve existing dedicated virtual account for user
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 1. Check app_kv user_dva/<userId>
    const { data: kvData } = await supabaseAdmin
      .from('app_kv')
      .select('value, value_json')
      .eq('key', `user_dva/${userId}`)
      .maybeSingle();

    if (kvData) {
      const raw = kvData.value || kvData.value_json;
      const account = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (account?.account_number) {
        return new Response(JSON.stringify({ success: true, account }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // 2. Check profiles table
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('dva_account_number, dva_bank_name, dva_account_name, paystack_customer_code')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.dva_account_number) {
      const account: DvaAccountResult = {
        account_number: profile.dva_account_number,
        bank_name: profile.dva_bank_name || 'Wema Bank',
        account_name: profile.dva_account_name || 'Avelut Account',
        customer_code: profile.paystack_customer_code || '',
        currency: 'NGN',
      };
      return new Response(JSON.stringify({ success: true, account }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response(JSON.stringify({ success: false, message: 'No dedicated virtual account found for user.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

/**
 * POST /api/paystack-dva
 * Generate or assign a dedicated virtual account to a customer
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, email, firstName, lastName, phone, preferredBank } = body;

    if (!userId || !email) {
      return new Response(JSON.stringify({ error: 'userId and email are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: 'PAYSTACK_SECRET_KEY is not configured on the server.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // 1. Check if user already has an active DVA
    const { data: existingKv } = await supabaseAdmin
      .from('app_kv')
      .select('value, value_json')
      .eq('key', `user_dva/${userId}`)
      .maybeSingle();

    if (existingKv) {
      const raw = existingKv.value || existingKv.value_json;
      const account = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (account?.account_number) {
        return new Response(JSON.stringify({ success: true, account, alreadyExisted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanFirst = (firstName || 'Student').trim();
    const cleanLast = (lastName || 'Avelut').trim();
    const cleanPhone = (phone || '').trim();

    // 2. Create or Fetch Paystack Customer
    let customerCode: string | null = null;

    try {
      const custRes = await fetch('https://api.paystack.co/customer', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: cleanEmail,
          first_name: cleanFirst,
          last_name: cleanLast,
          phone: cleanPhone || undefined,
          metadata: {
            user_id: userId,
            platform: 'avelut',
          },
        }),
      });

      const custData = await custRes.json();
      if (custData.status && custData.data?.customer_code) {
        customerCode = custData.data.customer_code;
      } else if (custData.message?.toLowerCase().includes('already exists') || custRes.status === 400) {
        // Fetch existing customer by email
        const getCustRes = await fetch(`https://api.paystack.co/customer/${encodeURIComponent(cleanEmail)}`, {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          },
        });
        const getCustData = await getCustRes.json();
        if (getCustData.status && getCustData.data?.customer_code) {
          customerCode = getCustData.data.customer_code;
        }
      }
    } catch (custErr) {
      console.warn('[Paystack DVA] Error ensuring customer:', custErr);
    }

    if (!customerCode) {
      return new Response(
        JSON.stringify({ error: 'Could not create or locate Paystack customer for this user.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // 3. Create Dedicated Virtual Account on Paystack
    const banksToTry = preferredBank ? [preferredBank, 'wema-bank', 'titan-paystack'] : ['wema-bank', 'titan-paystack'];
    let assignedAccount: any = null;
    let lastError: string = 'Could not generate virtual account';

    for (const bankSlug of banksToTry) {
      try {
        const dvaRes = await fetch('https://api.paystack.co/dedicated_account', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            customer: customerCode,
            preferred_bank: bankSlug,
          }),
        });

        const dvaData = await dvaRes.json();

        if (dvaData.status && (dvaData.data?.account_number || dvaData.data?.dedicated_account?.account_number)) {
          assignedAccount = dvaData.data?.dedicated_account || dvaData.data;
          break;
        } else {
          lastError = dvaData.message || JSON.stringify(dvaData);
          console.warn(`[Paystack DVA] Attempt with bank ${bankSlug} failed:`, lastError);
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }

    if (!assignedAccount || !assignedAccount.account_number) {
      return new Response(
        JSON.stringify({
          error: lastError || 'Paystack Dedicated Virtual Account creation failed. Please verify that Dedicated Accounts are activated in your Paystack Dashboard settings.',
          customerCode,
        }),
        { status: 422, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const bankName = assignedAccount.bank?.name || (assignedAccount.bank?.slug === 'titan-paystack' ? 'Titan Bank' : 'Wema Bank');
    const finalAccount: DvaAccountResult = {
      account_number: assignedAccount.account_number,
      account_name: assignedAccount.account_name || `${cleanFirst} ${cleanLast}`,
      bank_name: bankName,
      bank_slug: assignedAccount.bank?.slug,
      customer_code: customerCode,
      currency: assignedAccount.currency || 'NGN',
    };

    // 4. Persist in Supabase app_kv
    await supabaseAdmin.from('app_kv').upsert([
      {
        key: `user_dva/${userId}`,
        value: finalAccount,
        updated_at: new Date().toISOString(),
      },
      {
        key: `dva_account/${finalAccount.account_number}`,
        value: {
          user_id: userId,
          customer_code: customerCode,
          account_number: finalAccount.account_number,
          email: cleanEmail,
          created_at: Date.now(),
        },
        updated_at: new Date().toISOString(),
      },
    ], { onConflict: 'key' });

    // 5. Try updating profiles table columns if present
    try {
      await supabaseAdmin.from('profiles').update({
        dva_account_number: finalAccount.account_number,
        dva_bank_name: finalAccount.bank_name,
        dva_account_name: finalAccount.account_name,
        paystack_customer_code: customerCode,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);
    } catch {
      // Ignore if columns not yet added to profiles table
    }

    return new Response(JSON.stringify({ success: true, account: finalAccount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err: any) {
    console.error('[Paystack DVA] Unexpected exception:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
