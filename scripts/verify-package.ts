/**
 * Checks a built MIRA FIVE JavaScript SDK the way an app meets it, before it can be released.
 *
 *   bun verify-package.ts <package dir> [--script-budget <gzip bytes>]
 *
 * 1. Every `exports` target exists, with its declarations.
 * 2. Every bare import in the shipped JavaScript and declarations is a declared dependency or peer.
 * 3. A fresh app installs the packed tarball from npm's point of view (`npm pack`, `npm install`),
 *    and type-checks an import of every entry under `bundler` and `nodenext` resolution.
 * 4. Entries load in plain Node (except those that need a framework to run).
 * 5. `dist/mira.js` stays within its gzip budget, when one is given.
 */
import { builtinModules } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

interface Manifest {
  name: string;
  version: string;
  exports: Record<string, string | Record<string, string>>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  mira?: { external?: string[]; nodeLoad?: boolean };
}

const dir = resolve(Bun.argv[2] ?? ".");
const budgetIndex = Bun.argv.indexOf("--script-budget");
const budget = budgetIndex > 0 ? Number(Bun.argv[budgetIndex + 1]) : 0;
const manifest = (await Bun.file(`${dir}/package.json`).json()) as Manifest;

const fail = (message: string): never => {
  console.error(`✗ ${manifest.name}: ${message}`);
  process.exit(1);
};

async function sh(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${command.join(" ")}\n${out}${err}`);
  return out.trim();
}

// 1. Exports.
const targets: [string, string][] = [];
for (const [key, value] of Object.entries(manifest.exports)) {
  for (const target of typeof value === "string" ? [value] : Object.values(value)) {
    targets.push([key, target]);
    const found = target.includes("*")
      ? (await Array.fromAsync(new Bun.Glob(target.replace(/^\.\//, "")).scan({ cwd: dir }))).length > 0
      : await Bun.file(`${dir}/${target}`).exists();
    if (!found) fail(`export "${key}" points to missing ${target}`);
  }
  if (typeof value !== "string" && value.default?.endsWith(".js") && !value.types) {
    fail(`export "${key}" has no types`);
  }
}
console.log(`✓ ${targets.length} export targets exist`);

// 2. Imports.
const allowed = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
  ...(manifest.mira?.external ?? []),
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const transpiler = new Bun.Transpiler({ loader: "js" });
for await (const file of new Bun.Glob("**/*.{js,d.ts}").scan({ cwd: `${dir}/dist` })) {
  // Comments hold usage examples, which import the package itself.
  const source = (await Bun.file(`${dir}/dist/${file}`).text())
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^#!.*\n/, "");
  const specifiers = file.endsWith(".d.ts")
    ? [...source.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]!)
    : transpiler.scanImports(source).map((entry) => entry.path);
  for (const specifier of specifiers) {
    if (specifier.startsWith(".")) {
      if (file.endsWith(".d.ts") && !/\.(js|json)$/.test(specifier)) {
        fail(`dist/${file} imports ${specifier} without an extension; nodenext cannot resolve it`);
      }
      continue;
    }
    const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
    if (!allowed.has(name) && !allowed.has(specifier)) {
      fail(`dist/${file} imports ${specifier}, which is neither a dependency nor a peer`);
    }
  }
}
console.log("✓ every import is a declared dependency or peer");

// 3. A fresh app.
const app = await mkdtemp(`${tmpdir()}/mirafive-consumer-`);
const tarball = (await sh(["npm", "pack", "--silent", "--pack-destination", app], dir)).split("\n").at(-1)!;
await writeFile(`${app}/package.json`, JSON.stringify({ name: "consumer", private: true, type: "module" }));
// An app that uses a peer from TypeScript also has its separate types (`react` → `@types/react`).
const typings: string[] = [];
for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
  if (peer.startsWith("@")) continue;
  try {
    await sh(["npm", "view", `@types/${peer}`, "version"], app);
    typings.push(`@types/${peer}`);
  } catch {
    // The peer ships its own types.
  }
}
try {
  await sh(["npm", "install", "--no-audit", "--no-fund", "--loglevel=error", `./${tarball}`, "typescript@7", "@types/node", ...typings], app);
} catch (error) {
  fail(`the packed package does not install:\n${String(error)}`);
}

const entries = Object.entries(manifest.exports)
  .filter(([key, value]) => key !== "./package.json" && typeof value !== "string" && value.types)
  .map(([key]) => `${manifest.name}${key.slice(1)}`);
await writeFile(
  `${app}/index.ts`,
  `${entries.map((entry, index) => `import * as m${index} from "${entry}";`).join("\n")}\nexport const all = [${entries.map((_, index) => `m${index}`).join(", ")}];\n`,
);
for (const resolution of ["bundler", "nodenext"] as const) {
  await writeFile(
    `${app}/tsconfig.json`,
    JSON.stringify({
      compilerOptions: {
        target: "es2024",
        module: resolution === "bundler" ? "preserve" : "nodenext",
        moduleResolution: resolution,
        lib: ["es2024", "esnext.disposable", "dom", "dom.iterable"],
        types: ["node"],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        verbatimModuleSyntax: true,
      },
      files: ["index.ts"],
    }),
  );
  try {
    await sh([`${app}/node_modules/.bin/tsc`, "-p", "tsconfig.json"], app);
  } catch (error) {
    // Only problems in this package's own files count; a peer's own declarations are its business.
    const own = String(error)
      .split("\n")
      .filter((line) => line.includes(`node_modules/${manifest.name}/`) || line.startsWith("index.ts"));
    if (own.length) fail(`does not type-check for an app (moduleResolution: ${resolution}):\n${own.join("\n")}`);
  }
}
console.log(`✓ an app installs it and type-checks ${entries.length} entr${entries.length === 1 ? "y" : "ies"} (bundler, nodenext)`);

// 4. Node.
if (manifest.mira?.nodeLoad !== false) {
  for (const entry of entries) {
    try {
      await sh(["node", "--input-type=module", "-e", `await import(${JSON.stringify(entry)})`], app);
    } catch (error) {
      fail(`${entry} does not load in Node:\n${String(error)}`);
    }
  }
  console.log("✓ loads in Node");
}

// 5. Script budget.
if (budget > 0) {
  const gzip = Bun.gzipSync(await Bun.file(`${dir}/dist/mira.js`).bytes(), { level: 9 }).length;
  if (gzip > budget) fail(`dist/mira.js is ${gzip} bytes gzip, over its budget of ${budget}`);
  console.log(`✓ dist/mira.js ${gzip} bytes gzip (budget ${budget})`);
}
