require("dotenv").config();
const crypto = require("crypto");

const cloud = process.env.CLOUDINARY_CLOUD_NAME;
const key = process.env.CLOUDINARY_API_KEY;
const secret = process.env.CLOUDINARY_API_SECRET;

console.log("node:", process.version);
console.log("cloud:", JSON.stringify(cloud));
console.log("key length:", key?.length, "| secret length:", secret?.length);

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const upload = async (label, file) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHash("sha1")
    .update(`timestamp=${timestamp}${secret}`)
    .digest("hex");

  const form = new FormData();
  form.append("file", file);
  form.append("api_key", key);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/image/upload`,
    { method: "POST", body: form }
  );
  console.log(`\n[${label}] STATUS:`, res.status);
  console.log(`[${label}] BODY:`, (await res.text()).slice(0, 300));
};

(async () => {
  try {
    await upload("DATA URI", tinyPng);
    await upload("REMOTE URL", "https://res.cloudinary.com/demo/image/upload/sample.jpg");
  } catch (e) {
    console.log("ERROR:", e);
  }
})();