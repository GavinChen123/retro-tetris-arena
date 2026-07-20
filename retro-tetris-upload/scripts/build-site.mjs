import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const publicDir = resolve(root, "public");

const [html, css, js, hosting] = await Promise.all([
  readFile(resolve(publicDir, "index.html"), "utf8"),
  readFile(resolve(publicDir, "styles.css"), "utf8"),
  readFile(resolve(publicDir, "app.js"), "utf8"),
  readFile(resolve(root, ".openai", "hosting.json"), "utf8")
]);

const routes = {
  "/": { body: html, type: "text/html; charset=utf-8" },
  "/index.html": { body: html, type: "text/html; charset=utf-8" },
  "/styles.css": { body: css, type: "text/css; charset=utf-8" },
  "/app.js": { body: js, type: "application/javascript; charset=utf-8" }
};

const worker = `const routes = ${JSON.stringify(routes)};\n\nexport default {\n  async fetch(request) {\n    const url = new URL(request.url);\n    const asset = routes[url.pathname] || routes[\"/\"];\n    return new Response(asset.body, {\n      headers: {\n        \"content-type\": asset.type,\n        \"cache-control\": asset.type.startsWith(\"text/html\") ? \"no-cache\" : \"public, max-age=31536000, immutable\"\n      }\n    });\n  }\n};\n`;

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "server"), { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });
await writeFile(resolve(dist, "server", "index.js"), worker, "utf8");
await writeFile(resolve(dist, ".openai", "hosting.json"), hosting, "utf8");

console.log(`Built ${dist}`);
