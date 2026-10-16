import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export type VercelRequest = IncomingMessage & {
  body: any;
  query: { [key: string]: string | string[] };
  cookies: { [key: string]: string };
  method?: string;
};

export type VercelResponse = ServerResponse & {
  send: (body: any) => VercelResponse;
  json: (jsonBody: any) => VercelResponse;
  status: (statusCode: number) => VercelResponse;
};

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5d3Brc2FwenR6Ym50aGxnZmhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMjc5MzYsImV4cCI6MjEwMzYwMzkzNn0.uLZ-LBLWBmcgZYHnSDkbMV-BJA26I9x-pGDTZZxzyPI';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

/**
 * Paystack Webhook Handler for Vercel
 * Endpoint: POST /api/paystack-webhook
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!PAYSTACK_SECRET_KEY) {
    console.error('PAYSTACK_SECRET_KEY is not configured in environment variables.');
    return res.status(500).json({ error: 'Gateway Configuration Error' });
  }

  let rawBuffer: Buffer;
  try {
    rawBuffer = await getRawBody(req);
  } catch (err) {
    console.error('Error reading request stream:', err);
    return res.status(400).json({ error: 'Error reading request body' });
  }

  try {
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(rawBuffer).digest('hex');
    const signatureHeader = Array.isArray(req.headers['x-paystack-signature'])
      ? req.headers['x-paystack-signature'][0]
      : req.headers['x-paystack-signature'];

    if (!signatureHeader || hash !== signatureHeader) {
      console.warn('Invalid Paystack signature on webhook request');
      return res.status(401).json({ error: 'Unauthorized signature' });
    }
  } catch (sigErr) {
    console.error('Error verifying webhook signature:', sigErr);
    return res.status(400).json({ error: 'Bad signature verification request' });
  }

  let event: any;
  try {
    event = JSON.parse(rawBuffer.toString('utf-8'));
  } catch (jsonErr) {
    console.error('Error parsing JSON event payload:', jsonErr);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  if (event?.event === 'charge.success') {
    const data = event.data || {};
    const reference = data.reference;
    const metadata = data.metadata || {};
    const customFields = Array.isArray(metadata.custom_fields) ? metadata.custom_fields : [];

    const uidField = customFields.find((f: any) => f?.variable_name === 'user_id');
    const typeField = customFields.find((f: any) => f?.variable_name === 'purchase_type');
    const planField = customFields.find((f: any) => f?.variable_name === 'plan_key');
    const packageField = customFields.find((f: any) => f?.variable_name === 'package_id');

    const uid = uidField?.value || metadata.user_id || metadata.userId;
    const purchaseType = typeField?.value || metadata.purchase_type || metadata.purchaseType;
    const planKey = planField?.value || metadata.plan_key || metadata.planKey;
    const packageId = packageField?.value || metadata.package_id || metadata.packageId;
    const verifiedAmountKobo = Number(data.amount);
    const verifiedAmountNgn = Number.isFinite(verifiedAmountKobo) ? Math.round(verifiedAmountKobo) / 100 : 0;

    let resolvedUid = uid;
    const isDvaPayment = data.channel === 'dedicated_bank' || Boolean(data.dedicated_account?.account_number);

    // If metadata did not supply user_id, resolve user from dedicated account number or customer info
    if (!resolvedUid && isDvaPayment) {
      const acctNum = data.dedicated_account?.account_number;
      if (acctNum) {
        const { data: dvaMapping } = await supabaseAdmin
          .from('app_kv')
          .select('value, value_json')
          .eq('key', `dva_account/${acctNum}`)
          .maybeSingle();

        if (dvaMapping) {
          const raw = dvaMapping.value || dvaMapping.value_json;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (parsed?.user_id) {
            resolvedUid = parsed.user_id;
          }
        }
      }

      if (!resolvedUid && data.customer?.customer_code) {
        const { data: profileWithCode } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('paystack_customer_code', data.customer.customer_code)
          .maybeSingle();
        if (profileWithCode?.id) {
          resolvedUid = profileWithCode.id;
        }
      }

      if (!resolvedUid && data.customer?.email) {
        const { data: profileWithEmail } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('email', data.customer.email.toLowerCase().trim())
          .maybeSingle();
        if (profileWithEmail?.id) {
          resolvedUid = profileWithEmail.id;
        }
      }
    }

    if (!resolvedUid) {
      console.error('Paystack webhook charge.success missing user identification (no metadata.user_id and no DVA mapping)');
      return res.status(200).send('OK');
    }

    // Idempotency: verify this transaction reference hasn't been credited already
    if (reference) {
      const { data: alreadyProcessed } = await supabaseAdmin
        .from('app_kv')
        .select('key')
        .eq('key', `processed_paystack_ref/${reference}`)
        .maybeSingle();

      if (alreadyProcessed) {
        console.log(`[Paystack Webhook] Reference ${reference} already processed. Skipping duplicate.`);
        return res.status(200).send('OK');
      }
    }

    try {
      if (purchaseType === 'subscription') {
        const canonicalPlan = (planKey || 'pro').toLowerCase();
        const effectivePlan = canonicalPlan === 'pro' ? 'monthly' : canonicalPlan;

        await supabaseAdmin.from('profiles').update({
          is_paid_subscriber: true,
          subscription_status: effectivePlan,
          updated_at: new Date().toISOString(),
        }).eq('id', resolvedUid);

        await supabaseAdmin.from('subscriptions').upsert({
          user_id: resolvedUid,
          plan_type: effectivePlan,
          status: 'active',
          paystack_reference: reference,
          starts_at: new Date().toISOString(),
        });
      } else {
        let creditsToAdd = Math.round(verifiedAmountNgn);
        if (packageId === 'live_tutorial_15') creditsToAdd = 299;
        else if (packageId === 'live_tutorial_30') creditsToAdd = 599;
        else if (packageId === 'live_tutorial_60') creditsToAdd = 1099;

        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('ai_credits, ai_credits_balance')
          .eq('id', resolvedUid)
          .maybeSingle();

        const currentCredits = profile?.ai_credits_balance ?? profile?.ai_credits ?? 0;
        const newBalance = currentCredits + creditsToAdd;

        await supabaseAdmin.from('profiles').update({
          ai_credits: newBalance,
          ai_credits_balance: newBalance,
          updated_at: new Date().toISOString(),
        }).eq('id', resolvedUid);

        // Record payment in app_kv
        if (reference) {
          await supabaseAdmin.from('app_kv').upsert({
            key: `processed_paystack_ref/${reference}`,
            value: {
              user_id: resolvedUid,
              reference,
              amount: verifiedAmountNgn,
              credits_added: creditsToAdd,
              channel: data.channel || (isDvaPayment ? 'dedicated_bank' : 'standard'),
              processed_at: Date.now(),
            },
            updated_at: new Date().toISOString(),
          }, { onConflict: 'key' });
        }

        // Send instant Push Notification to user
        try {
          const apiBase = process.env.VITE_APP_URL || 'https://www.avelut.xyz';
          await fetch(`${apiBase}/api/notifications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send',
              targetUserId: resolvedUid,
              title: '⚡ Top-up Received!',
              message: `₦${verifiedAmountNgn.toLocaleString()} received via bank transfer! ${creditsToAdd.toLocaleString()} AI credits added to your wallet.`,
              data: { route: 'billing' },
            }),
          });
        } catch (notifErr) {
          console.warn('[Paystack Webhook] Push notification warning:', notifErr);
        }
      }

      console.log('Successfully processed Paystack webhook for user:', resolvedUid, 'ref:', reference, 'channel:', data.channel);
    } catch (dbErr) {
      console.error('Error updating Supabase from Vercel Webhook:', dbErr);
      return res.status(500).json({ error: 'Database update failed' });
    }
  }

  return res.status(200).send('OK');
}
