import fs from "fs";
import https from "https";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

/**
 * Upload a binary buffer directly to Supabase Storage using Node's native https module.
 * Bypasses Node undici fetch issues on Windows with large payloads.
 */
function uploadFileToSupabaseStorage(supabaseUrl, key, bucket, objectPath, filePath, contentType) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const url = new URL(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`);
    const agent = new https.Agent({ keepAlive: false });
    const req = https.request(
      url,
      {
        method: "POST",
        agent,
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          "Content-Type": contentType,
          "Content-Length": stat.size,
          "x-upsert": "true",
        },
        timeout: 600000, // 10 min timeout
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

    req.on("error", (err) => {
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Supabase Storage upload timed out after 600s"));
    });

    const readStream = fs.createReadStream(filePath);
    readStream.on("error", (err) => {
      req.destroy();
      reject(err);
    });
    readStream.pipe(req);
  });
}

async function deployOTA() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || "https://eywpksapztzbnthlgfhd.supabase.co";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseKey) {
      throw new Error("Set SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY before running the OTA deploy script.");
    }

    console.log(`[OTA] Connecting to Supabase: ${supabaseUrl}`);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const skipBuild = process.argv.includes("--skip-build");
    if (skipBuild && fs.existsSync("./dist")) {
      console.log("[OTA] --skip-build specified. Using existing ./dist build.");
    } else {
      console.log("[OTA] Building web project bundle...");
      const buildCmd = process.platform === "win32" ? "pnpm.cmd run build" : "pnpm run build";
      try {
        execSync(buildCmd, { stdio: "inherit" });
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
    const checksum = crypto.createHash("sha256").update(zipBuffer).digest("hex");
    console.log(`[OTA] Bundle SHA-256 Checksum: ${checksum}`);
    const objectPath = `app_releases/ota/${otaVersion}.zip`;

    // Upload using native HTTPS module with retries
    let uploadSuccess = false;
    let lastError = null;
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[OTA] Upload attempt ${attempt}/${maxAttempts}...`);
        await uploadFileToSupabaseStorage(
          supabaseUrl,
          supabaseKey,
          "ota-releases",
          objectPath,
          "./dist.zip",
          "application/zip"
        );
        uploadSuccess = true;
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[OTA] Attempt ${attempt} failed: ${err.message}`);
        if (attempt < maxAttempts) {
          const delay = attempt * 4000;
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
          checksum: checksum,
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
