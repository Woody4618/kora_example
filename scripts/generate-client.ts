import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import {
  readFileSync, writeFileSync, readdirSync, statSync, existsSync,
} from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const idlPath = resolve(projectRoot, "src/idl/let_me_buy.json");
const idl = JSON.parse(readFileSync(idlPath, "utf-8"));

const rootNode = rootNodeFromAnchor(idl);
const codama = createFromRoot(rootNode);

const outputBase = "clients/js";
await codama.accept(
  renderVisitor(outputBase, { syncPackageJson: true, deleteFolderBeforeRendering: false })
);

// Add .js extensions to relative imports (required for nodenext moduleResolution)
function addJsExtensions(dir: string) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      addJsExtensions(full);
    } else if (full.endsWith(".ts")) {
      const fileDir = dirname(full);
      let content = readFileSync(full, "utf-8");
      content = content.replace(
        /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
        (_match, prefix, importPath, suffix) => {
          if (importPath.endsWith(".js")) return _match;
          const absTarget = resolve(fileDir, importPath);
          if (existsSync(absTarget) && statSync(absTarget).isDirectory()) {
            return `${prefix}${importPath}/index.js${suffix}`;
          }
          return `${prefix}${importPath}.js${suffix}`;
        }
      );
      writeFileSync(full, content);
    }
  }
}
addJsExtensions(join(outputBase, "src/generated"));

const pkgPath = join(outputBase, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
pkg.type = "module";
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`Generated client in ${outputBase}/src/generated/`);
