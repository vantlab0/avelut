import fs from "fs";
import https from "https";
import AdmZip from "adm-zip";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

/**
 * Upload a binary buffer directly to Supabase Storage using Node's native https module.
 * Bypasses Node undici fetch issues on Windows with large payloads.
 */
function uploadToSupabaseStorage(supabaseUrl, key, bucket, objectPath, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          "Content-Type": contentType,
          "Content-Length": buffer.length,
          "x-upsert": "true",
        },
        timeout: 300000, // 5 min timeout
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ raw: data });
            }
          } else {
            reject(new Error(`Supabase Storage HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Supabase Storage upload timed out after 300s"));
    });

    req.write(buffer);
    req.end();
  });
}

async function deployOTA() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || "https://eywpksapztzbnthlgfhd.supabase.co";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5d3Brc2FwenR6Ym50aGxnZmhkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODAyNzkzNiwiZXhwIjoyMTAzNjAzOTM2fQ.nFcGWEvj9H0MTlksKR48ldaK3_q9yGsZkeo6WMsuZZ4";

    console.log(`[OTA] Connecting to Supabase: ${supabaseUrl}`);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const skipBuild = process.argv.includes("--skip-build");
    if (skipBuild && fs.existsSync("./dist")) {
      console.log("[OTA] --skip-build specified. Using existing ./dist build.");
    } else {
      console.log("[OTA] Building web project bundle...");
      const npmCmd = process.platform === "win32" ? "npm.cmd run build" : "npm run build";
      try {
        execSync(npmCmd, { stdio: "inherit" });
      } catch (err) {
        console.log("[OTA] Web build finished (react-snap postbuild handled). Checking for dist...");
        if (!fs.existsSync("./dist")) {
          throw err;
        }
      }
    }

    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
    const baseVersion = pkg.version || "6.0.10";
    const otaVersion = `${baseVersion}-${Date.now()}`;
    console.log(`[OTA] Generated OTA Version: ${otaVersion}`);

    let commit = "unknown";
    try {
      commit = execSync("git rev-parse --short HEAD").toString().trim();
    } catch {}

    // Write version.json into dist for app sync
    const versionJsonPath = "./dist/version.json";
    const versionPayload = {
      version: otaVersion,
      baseVersion,
      commit,
      buildTimestamp: Date.now(),
    };
    fs.writeFileSync(versionJsonPath, JSON.stringify(versionPayload, null, 2));
    console.log("[OTA] Written version.json to dist");

    console.log("[OTA] Creating lean dist.zip package (excluding source maps)...");
    if (fs.existsSync("./dist.zip")) {
      fs.unlinkSync("./dist.zip");
    }
    const zip = new AdmZip();
    zip.addLocalFolder("./dist");

    // Remove source maps from the mobile zip to reduce bundle size & upload bandwidth
    for (const entry of zip.getEntries()) {
      if (entry.entryName.endsWith(".map")) {
        zip.deleteFile(entry.entryName);
      }
    }
    zip.writeZip("./dist.zip");
    const zipStats = fs.statSync("./dist.zip");
    console.log(`[OTA] dist.zip created: ${(zipStats.size / (1024 * 1024)).toFixed(2)} MB`);

    console.log("[OTA] Verifying 'ota-releases' bucket...");
    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      const bucketExists = buckets?.some((b) => b.name === "ota-releases");
      if (!bucketExists && buckets && buckets.length > 0) {
        console.log("[OTA] Creating 'ota-releases' bucket...");
        await supabase.storage.createBucket("ota-releases", { public: true });
      }
    } catch {
      // Bucket likely already exists
    }

    console.log("[OTA] Uploading package to Supabase Storage: ota-releases/app_releases/ota/...");
    const zipBuffer = fs.readFileSync("./dist.zip");
    const objectPath = `app_releases/ota/${otaVersion}.zip`;

    // Upload using native HTTPS module with retries
    let uploadSuccess = false;
    let lastError = null;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[OTA] Upload attempt ${attempt}/${maxAttempts}...`);
        await uploadToSupabaseStorage(
          supabaseUrl,
          supabaseKey,
          "ota-releases",
          objectPath,
          zipBuffer,
          "application/zip"
        );
        uploadSuccess = true;
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[OTA] Attempt ${attempt} failed: ${err.message}`);
        if (attempt < maxAttempts) {
          const delay = attempt * 3000;
          console.log(`[OTA] Retrying in ${delay / 1000}s...`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (!uploadSuccess) {
      throw new Error(`Failed to upload to Supabase Storage: ${lastError?.message}`);
    }
    console.log("[OTA] Upload complete!");

    const { data: publicUrlData } = supabase.storage
      .from("ota-releases")
      .getPublicUrl(objectPath);

    const downloadUrl = publicUrlData.publicUrl;
    console.log("[OTA] Public Download URL:", downloadUrl);

    console.log("[OTA] Updating app_kv at 'app_updates/ota_latest'...");
    const { error: dbError } = await supabase.from("app_kv").upsert(
      {
        key: "app_updates/ota_latest",
        value: {
          version: otaVersion,
          downloadUrl: downloadUrl,
          releaseDate: new Date().toISOString(),
        },
      },
      { onConflict: "key" }
    );

    if (dbError) {
      throw new Error(`Failed to update app_kv: ${dbError.message}`);
    }

    console.log(`\n🎉 [OTA] SUCCESSFULLY DEPLOYED TO SUPABASE!`);
    console.log(`   OTA Version: ${otaVersion}`);
    console.log(`   Download:    ${downloadUrl}`);

    // Cleanup dist.zip
    if (fs.existsSync("./dist.zip")) {
      fs.unlinkSync("./dist.zip");
    }
    process.exit(0);
  } catch (e) {
    console.error("\n❌ [OTA] Deployment failed:", e);
    if (fs.existsSync("./dist.zip")) {
      fs.unlinkSync("./dist.zip");
    }
    process.exit(1);
  }
}

deployOTA();
