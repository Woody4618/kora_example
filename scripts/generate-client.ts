import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import {
  readFileSync, cpSync, rmSync, readdirSync,
  statSync, writeFileSync, existsSync,
} from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const idlPath = resolve(projectRoot, "src/idl/let_me_buy.json");
const idl = JSON.parse(readFileSync(idlPath, "utf-8"));

const rootNode = rootNodeFromAnchor(idl);
const codama = createFromRoot(rootNode);

await codama.accept(renderVisitor("js-client", {syncPackageJson: true, deleteFolderBeforeRendering: false }));

const outputDir = resolve(projectRoot, "js-client");

function addJsExtensions(dir: string) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      addJsExtensions(full);
    } else if (full.endsWith(".ts")) {
      const fileDir = dirname(full);
       let content = readFileSync(full, "utf-8");
    //   content = content.replace(
    //     /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
    //     (_match, prefix, importPath, suffix) => {
    //       if (importPath.endsWith(".js")) return _match;
    //       const absTarget = resolve(fileDir, importPath);
    //       if (existsSync(absTarget) && statSync(absTarget).isDirectory()) {
    //         return `${prefix}${importPath}/index.js${suffix}`;
    //       }
    //       return `${prefix}${importPath}.js${suffix}`;
    //     }
    //   );
      writeFileSync(full, content);
    }
  }
}

addJsExtensions(outputDir);

console.log("Generated client code in src/generated/");
