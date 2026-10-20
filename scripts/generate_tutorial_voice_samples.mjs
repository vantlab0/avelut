#!/usr/bin/env node
/**
 * scripts/generate_tutorial_voice_samples.mjs
 *
 * Pre-generates high quality audio samples for all tutorial voices using Alibaba Qwen3-TTS-Flash,
 * uploads them to Supabase Storage ('materials' bucket under 'voice_samples/'),
 * and saves local copies in 'public/assets/voices/'.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const ALIBABA_API_KEY =
  process.env.ALIBABA_API_KEY ||
  process.env.VITE_ALIBABA_API_KEY ||
  '';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

if (!ALIBABA_API_KEY) {
  throw new Error('Set ALIBABA_API_KEY before running this script.');
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Set SUPABASE_SERVICE_ROLE_KEY before running this script.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const VOICES = [
  {
    id: 'Cherry',
    dashScopeVoice: 'Cherry',
    sampleText: "Hello! I'm Cherry, your live tutor. Let's break down this topic together step by step on the whiteboard.",
  },
  {
    id: 'Serena',
    dashScopeVoice: 'Serena',
    sampleText: "Hi there! I'm Serena. Take your time as we explore each concept warmly and thoroughly.",
  },
  {
    id: 'Ethan',
    dashScopeVoice: 'Ethan',
    sampleText: "Hey! I'm Ethan. Let's dig right into the core principles and solve these problems together.",
  },
  {
    id: 'Chelsie',
    dashScopeVoice: 'Chelsie',
    sampleText: "Welcome! I'm Chelsie. We are going to make this lesson exciting and easy to grasp!",
  },
  {
    id: 'Ryan',
    dashScopeVoice: 'Ryan',
    sampleText: "Awesome to have you here! I'm Ryan, and we're going to power through this lesson with high energy!",
  },
  {
    id: 'Mia',
    dashScopeVoice: 'Mia',
    sampleText: "Hello. I'm Mia. Let's take a calm, structured journey through today's topic together.",
  },
  {
    id: 'Katerina',
    dashScopeVoice: 'Vivian', // Official DashScope voice with commanding academic rhythm
    sampleText: "Greetings. I'm Katerina. Today we break down the core foundations and mechanisms of our lesson step by step.",
  },
  {
    id: 'Vivian',
    dashScopeVoice: 'Vivian',
    sampleText: "Greetings. I'm Vivian. Today we analyze the foundational mechanisms and theoretical frameworks of our subject.",
  },
];

const localOutputDir = path.join(rootDir, 'public', 'assets', 'voices');
if (!fs.existsSync(localOutputDir)) {
  fs.mkdirSync(localOutputDir, { recursive: true });
}

async function synthesizeAndUpload(voiceConfig) {
  console.log(`\n🎙️ Synthesizing voice [${voiceConfig.id}] (DashScope: ${voiceConfig.dashScopeVoice})...`);

  const ttsEndpoint = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  const ttsRes = await fetch(ttsEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ALIBABA_API_KEY}`,
      'Content-Type': 'application/json',
      'X-DashScope-WorkSpace': 'ws-o3v6mh0i8y9tqdfx',
    },
    body: JSON.stringify({
      model: 'qwen3-tts-flash',
      input: {
        text: voiceConfig.sampleText,
        voice: voiceConfig.dashScopeVoice,
        language_type: 'English',
      },
    }),
  });

  if (!ttsRes.ok) {
    const errorText = await ttsRes.text();
    throw new Error(`Alibaba TTS HTTP ${ttsRes.status}: ${errorText}`);
  }

  const result = await ttsRes.json();
  const audioUrl = result?.output?.audio?.url || result?.output?.audio;
  if (!audioUrl) {
    throw new Error(`No audio URL in output: ${JSON.stringify(result)}`);
  }

  console.log(`  Downloading synthesized audio from: ${audioUrl.slice(0, 70)}...`);
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(`Failed to fetch audio stream: ${audioRes.statusText}`);
  }

  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  const filename = `${voiceConfig.id.toLowerCase()}.wav`;

  // 1. Save locally to public/assets/voices/
  const localFilePath = path.join(localOutputDir, filename);
  fs.writeFileSync(localFilePath, audioBuffer);
  console.log(`  Saved locally to: public/assets/voices/${filename} (${(audioBuffer.length / 1024).toFixed(1)} KB)`);

  // 2. Upload to Supabase Storage in 'materials' bucket
  const storagePath = `voice_samples/${filename}`;
  console.log(`  Uploading to Supabase: materials/${storagePath}...`);
  const { error: uploadError } = await supabase.storage.from('materials').upload(storagePath, audioBuffer, {
    contentType: 'audio/wav',
    upsert: true,
  });

  if (uploadError) {
    throw new Error(`Supabase upload error: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage.from('materials').getPublicUrl(storagePath);
  console.log(`  Uploaded to Supabase CDN: ${publicUrlData.publicUrl}`);

  return {
    id: voiceConfig.id,
    localUrl: `/assets/voices/${filename}`,
    supabaseUrl: publicUrlData.publicUrl,
  };
}

async function main() {
  console.log('================================================================');
  console.log('🚀 PRE-GENERATING TUTORIAL VOICE SAMPLES & UPLOADING TO SUPABASE');
  console.log('================================================================');

  const generatedUrls = {};

  for (const voice of VOICES) {
    try {
      const res = await synthesizeAndUpload(voice);
      generatedUrls[res.id] = {
        supabaseUrl: res.supabaseUrl,
        localUrl: res.localUrl,
      };
    } catch (err) {
      console.error(`❌ Error for ${voice.id}:`, err.message);
    }
  }

  console.log('\n================================================================');
  console.log('✅ ALL SAMPLES GENERATED SUCCESSFULLY!');
  console.log('================================================================');
  console.log(JSON.stringify(generatedUrls, null, 2));

  // Write a manifest JSON file for the frontend to consume
  const manifestPath = path.join(rootDir, 'public', 'assets', 'voices', 'voice_samples_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(generatedUrls, null, 2), 'utf8');
  console.log(`\nSaved manifest to: ${manifestPath}`);
}

main();
