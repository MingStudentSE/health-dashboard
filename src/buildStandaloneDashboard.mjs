import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(projectRoot, "web");
const dataFile = path.join(webDir, "data", "health-dashboard.json");
const htmlTemplate = path.join(webDir, "index.html");
const cssFile = path.join(webDir, "styles.css");
const appFile = path.join(webDir, "app.js");
const outputFile = path.join(webDir, "health-dashboard-standalone.html");

async function main() {
  const [payloadRaw, html, css, appJs] = await Promise.all([
    fs.readFile(dataFile, "utf8"),
    fs.readFile(htmlTemplate, "utf8"),
    fs.readFile(cssFile, "utf8"),
    fs.readFile(appFile, "utf8"),
  ]);

  const withoutCss = html.replace(
    /<link rel="stylesheet" href="\.\/styles\.css" \/>/,
    `<style>\n${css}\n</style>`,
  );

  const withoutModuleScript = withoutCss.replace(
    /<script type="module" src="\.\/app\.js"><\/script>/,
    [
      `<script>`,
      `window.__HEALTH_DASHBOARD_DATA__ = ${payloadRaw.trim()};`,
      `</script>`,
      `<script>`,
      appJs,
      `</script>`,
    ].join("\n"),
  );

  await fs.writeFile(outputFile, withoutModuleScript);
  console.log(`Wrote ${outputFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
