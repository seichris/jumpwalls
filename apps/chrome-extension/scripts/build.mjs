import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const distDir = path.join(projectDir, "dist");

const staticFiles = ["manifest.json", "popup.html", "options.html", "styles.css"];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const file of staticFiles) {
  await cp(path.join(projectDir, file), path.join(distDir, file));
}
await cp(path.join(projectDir, "assets"), path.join(distDir, "assets"), { recursive: true });

await build({
  entryPoints: [
    path.join(projectDir, "src/background.ts"),
    path.join(projectDir, "src/content.ts"),
    path.join(projectDir, "src/inpage.ts"),
    path.join(projectDir, "src/popup.ts"),
    path.join(projectDir, "src/options.ts")
  ],
  outdir: distDir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: false,
  minify: false,
  logLevel: "info"
});
