import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseHTML } from "linkedom";
import ts from "typescript";
import type { Manifest } from "./manifest.js";
import { projectPaths } from "../store/store.js";
import type { SafetyIssue } from "../types.js";

const require = createRequire(import.meta.url);

export type HyperframesSceneAdmissionContext = {
  projectId?: string;
  projectRoot: string;
  sceneId: string;
  width: number;
  height: number;
  durationSeconds?: number;
  imageRef?: string;
  writeNormalized?: boolean;
};

export type HyperframesSceneAdmissionResult =
  | { admitted: true; sceneId: string; compositionId: string; htmlPath: string }
  | { admitted: false; violations: SafetyIssue[] };

export type HyperframesProjectAdmissionResult =
  | { ok: true; sceneIds: string[]; files: string[] }
  | { ok: false; violations: SafetyIssue[] };

const GSAP_VENDOR_BASENAME = "gsap.min.js";
const KNOWN_GSAP_CDN_RE =
  /^https:\/\/(?:(?:cdn\.jsdelivr\.net\/npm\/gsap@[^/]+\/dist\/gsap\.min\.js)|(?:unpkg\.com\/gsap@[^/]+\/dist\/gsap\.min\.js)|(?:cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/[^/]+\/gsap\.min\.js))(?:[?#].*)?$/i;
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const CSS_URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const PATH_ATTRS = new Set(["src", "href", "poster"]);
const RAW_MEDIA_TAGS = new Set(["video", "audio", "iframe", "object", "embed", "source", "track"]);

const BANNED_IDENTIFIERS = new Set([
  "Date",
  "fetch",
  "XMLHttpRequest",
  "eval",
  "Function",
  "require",
  "process",
  "Promise",
  "localStorage",
  "requestAnimationFrame",
  "setTimeout",
  "setInterval",
]);

const BANNED_MEMBERS = new Set([
  "Math.random",
  "Date.now",
  "window.location",
  "document.cookie",
]);

export function hyperframesSceneFileName(sceneId: string): string {
  const safe = sceneId.replace(/[^a-zA-Z0-9-]/g, "-").replace(/^[_-]+/, "");
  return `${safe || "scene"}.html`;
}

export function hyperframesScenePath(projectId: string, sceneId: string): string {
  return join(projectPaths(projectId).hyperframesScenesDir, hyperframesSceneFileName(sceneId));
}

export async function writeHyperframesScene(projectId: string, sceneId: string, html: string): Promise<string> {
  const path = hyperframesScenePath(projectId, sceneId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, normalizeHyperframesSceneHtml(html), "utf8");
  return path;
}

export async function listHyperframesSceneFiles(projectId: string): Promise<string[]> {
  const dir = projectPaths(projectId).hyperframesScenesDir;
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files
    .filter((f) => /\.html$/i.test(f))
    .sort()
    .map((f) => join(dir, f));
}

export async function ensureHyperframesVendor(projectId: string): Promise<string> {
  const paths = projectPaths(projectId);
  await mkdir(paths.hyperframesVendorDir, { recursive: true });
  const dest = join(paths.hyperframesVendorDir, GSAP_VENDOR_BASENAME);
  if (!existsSync(dest)) {
    const src = require.resolve("gsap/dist/gsap.min.js");
    await copyFile(src, dest);
  }
  return dest;
}

export function normalizeHyperframesSceneHtml(html: string): string {
  return html.replace(
    /<script\b([^>]*?)\bsrc=(["'])(https:\/\/(?:(?:cdn\.jsdelivr\.net\/npm\/gsap@[^/]+\/dist\/gsap\.min\.js)|(?:unpkg\.com\/gsap@[^/]+\/dist\/gsap\.min\.js)|(?:cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/[^/]+\/gsap\.min\.js))(?:[?#].*)?)\2([^>]*)><\/script>/gi,
    (_full, before: string, quote: string, _url: string, after: string) =>
      `<script${before}src=${quote}../vendor/${GSAP_VENDOR_BASENAME}${quote}${after}></script>`,
  );
}

export function admitHyperframesScene(
  htmlPath: string,
  context: HyperframesSceneAdmissionContext,
): HyperframesSceneAdmissionResult {
  let text: string;
  try {
    text = readFileSync(htmlPath, "utf8");
  } catch (error) {
    return {
      admitted: false,
      violations: [
        {
          check: "N4",
          severity: "error",
          path: htmlPath,
          message: `Cannot read HyperFrames scene: ${errorMessage(error)}`,
        },
      ],
    };
  }

  const normalized = normalizeHyperframesSceneHtml(text);
  if (normalized !== text && context.writeNormalized !== false) {
    writeFileSync(htmlPath, normalized, "utf8");
    text = normalized;
  } else {
    text = normalized;
  }

  const violations: SafetyIssue[] = [];
  const add = (check: "N4" | "N5" | "N9" | "N11", message: string, path = htmlPath): void => {
    violations.push({ check, severity: "error", sceneId: context.sceneId, path, message });
  };

  const { document } = parseHTML(text);
  const roots = [...document.querySelectorAll("[data-composition-id]")];
  if (roots.length !== 1) {
    add("N11", `HyperFrames scene must contain exactly one [data-composition-id] root; found ${roots.length}.`);
  }
  const root = roots[0] as Element | undefined;
  const compositionId = root?.getAttribute("data-composition-id")?.trim() ?? "";
  if (root) {
    requireAttr(root, "data-width", String(context.width), add);
    requireAttr(root, "data-height", String(context.height), add);
    const duration = root.getAttribute("data-duration");
    if (!duration || !Number.isFinite(Number(duration)) || Number(duration) <= 0) {
      add("N11", "HyperFrames root must declare a positive numeric data-duration.");
    }
  }

  for (const el of [...document.querySelectorAll("*")]) {
    const tag = el.tagName.toLowerCase();
    if (RAW_MEDIA_TAGS.has(tag)) add("N5", `Raw <${tag}> is not allowed in AI-authored HyperFrames scenes.`);
    if (tag === "link") add("N9", "External or local <link> resources/fonts are not allowed; inline CSS only.");
    for (const attr of [...el.getAttributeNames()]) {
      const lower = attr.toLowerCase();
      if (!PATH_ATTRS.has(lower)) continue;
      const value = el.getAttribute(attr)?.trim() ?? "";
      if (!value) continue;
      if (tag === "script" && lower === "src") continue;
      if (tag === "img" && lower === "src") continue;
      if (isUnsafeUrl(value)) add("N9", `Forbidden URL/path in ${tag}[${attr}]: "${value}".`);
    }
    const style = el.getAttribute("style");
    if (style) inspectCssUrls(style, add);
  }

  for (const style of [...document.querySelectorAll("style")]) {
    inspectCssUrls(style.textContent ?? "", add);
  }

  const images = [...document.querySelectorAll("img")];
  if (images.length > 1) add("N9", `HyperFrames scene may use at most one <img>; found ${images.length}.`);
  for (const img of images) {
    const src = img.getAttribute("src")?.trim() ?? "";
    if (!context.imageRef) {
      add("N9", "Scene HTML uses <img> but manifest scene has no approved image.ref.");
      continue;
    }
    if (!pathMatchesProjectRef(src, context.projectRoot, context.imageRef)) {
      add("N9", `Scene <img> src must resolve to approved image.ref "${context.imageRef}"; received "${src}".`);
    }
  }

  for (const script of [...document.querySelectorAll("script")]) {
    const src = script.getAttribute("src")?.trim();
    if (src) {
      if (!isAllowedGsapVendor(src, context.projectRoot, htmlPath)) {
        add("N5", `Only the local HyperFrames GSAP vendor script is allowed; received "${src}".`);
      }
      continue;
    }
    inspectInlineScript(script.textContent ?? "", basename(htmlPath), compositionId || context.sceneId, add);
  }

  if (compositionId) {
    const timelinePattern = new RegExp(
      `window\\.__timelines\\s*\\[\\s*["']${escapeRegExp(compositionId)}["']\\s*\\]\\s*=`,
    );
    if (!timelinePattern.test(text)) {
      add("N11", `HyperFrames scene must register window.__timelines["${compositionId}"].`);
    }
  }
  if (!/gsap\.timeline\s*\(\s*\{[\s\S]*?\bpaused\s*:\s*true[\s\S]*?\}/.test(text)) {
    add("N11", "HyperFrames scene must create a paused GSAP timeline: gsap.timeline({ paused: true }).");
  }
  if (/\brepeat\s*:\s*-\s*1\b/.test(text)) {
    add("N5", "Infinite GSAP repeat (-1) is forbidden; use a finite repeat count.");
  }

  return violations.length > 0 || !compositionId
    ? { admitted: false, violations }
    : { admitted: true, sceneId: context.sceneId, compositionId, htmlPath };
}

export async function admitProjectHyperframes(projectId: string, manifest: Manifest): Promise<HyperframesProjectAdmissionResult> {
  await ensureHyperframesVendor(projectId);
  const paths = projectPaths(projectId);
  const violations: SafetyIssue[] = [];
  const files: string[] = [];
  const seen = new Set<string>();
  const width = manifest.format === "youtube" ? 1920 : 1080;
  const height = manifest.format === "youtube" ? 1080 : 1920;

  for (const scene of manifest.scenes) {
    if (seen.has(scene.id)) {
      violations.push({
        check: "N1",
        severity: "error",
        sceneId: scene.id,
        message: `Duplicate HyperFrames scene id "${scene.id}".`,
      });
      continue;
    }
    seen.add(scene.id);
    const file = hyperframesScenePath(projectId, scene.id);
    if (!existsSync(file)) {
      violations.push({
        check: "N4",
        severity: "error",
        sceneId: scene.id,
        path: file,
        message: `Missing HyperFrames scene HTML for ${scene.id}.`,
      });
      continue;
    }
    const result = admitHyperframesScene(file, {
      projectId,
      projectRoot: paths.root,
      sceneId: scene.id,
      width,
      height,
      durationSeconds: scene.durationInSeconds,
      imageRef: scene.image?.ref,
    });
    if (result.admitted) files.push(file);
    else violations.push(...result.violations);
  }

  return violations.length > 0
    ? { ok: false, violations }
    : { ok: true, sceneIds: manifest.scenes.map((s) => s.id), files };
}

function requireAttr(
  el: Element,
  attr: string,
  expected: string,
  add: (check: "N4" | "N5" | "N9" | "N11", message: string, path?: string) => void,
): void {
  const actual = el.getAttribute(attr)?.trim();
  if (actual !== expected) add("N11", `HyperFrames root ${attr} must be "${expected}"; received "${actual ?? "(missing)"}".`);
}

function inspectCssUrls(
  css: string,
  add: (check: "N4" | "N5" | "N9" | "N11", message: string, path?: string) => void,
): void {
  let match: RegExpExecArray | null;
  CSS_URL_RE.lastIndex = 0;
  while ((match = CSS_URL_RE.exec(css)) !== null) {
    const target = (match[2] ?? "").trim();
    if (/^#[A-Za-z_][\w:.-]*$/.test(target)) continue;
    add("N9", `CSS url(...) is forbidden in AI-authored HyperFrames scenes: "${target}".`);
  }
}

function inspectInlineScript(
  script: string,
  file: string,
  compositionId: string,
  add: (check: "N4" | "N5" | "N9" | "N11", message: string, path?: string) => void,
): void {
  const src = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics = (src as ts.SourceFile & { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  for (const diagnostic of diagnostics) {
    const line = src.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    add("N11", `Inline HyperFrames script has invalid JS syntax: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`, `${file}:${line}`);
  }

  const at = (node: ts.Node): string => `${file}:${src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1}`;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add("N5", "Dynamic import() is forbidden in HyperFrames scene scripts.", at(node));
    }
    if (isAsyncFunction(node)) {
      add("N5", "Async timeline construction is forbidden; build GSAP timelines synchronously at module load.", at(node));
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const dotted = `${node.expression.text}.${node.name.text}`;
      if (BANNED_MEMBERS.has(dotted)) add("N5", `Forbidden API "${dotted}" in HyperFrames scene script.`, at(node));
    }
    if (ts.isIdentifier(node) && BANNED_IDENTIFIERS.has(node.text) && !isSafeIdentifierPosition(node)) {
      add("N5", `Forbidden API "${node.text}" in HyperFrames scene script.`, at(node));
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(src) === "repeat") {
      const value = node.initializer.getText(src).replace(/\s+/g, "");
      if (value === "-1") add("N5", "Infinite GSAP repeat (-1) is forbidden.", at(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(src);

  const escaped = escapeRegExp(compositionId);
  if (compositionId && !new RegExp(`window\\.__timelines\\s*\\[\\s*["']${escaped}["']\\s*\\]`).test(script)) {
    add("N11", `Inline script must register window.__timelines["${compositionId}"].`, file);
  }
}

function isAsyncFunction(node: ts.Node): boolean {
  if (
    !(
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    )
  ) {
    return false;
  }
  return (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
}

function isSafeIdentifierPosition(node: ts.Identifier): boolean {
  const p = node.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === node) ||
    (ts.isPropertyAssignment(p) && p.name === node) ||
    (ts.isBindingElement(p) && p.name === node) ||
    ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)) &&
      (p as { name?: ts.Node }).name === node)
  );
}

function isUnsafeUrl(value: string): boolean {
  return /^\/\//.test(value) || HAS_SCHEME_RE.test(value) || /^[/\\]|^[A-Za-z]:/.test(value);
}

function isAllowedGsapVendor(src: string, projectRoot: string, htmlPath: string): boolean {
  if (KNOWN_GSAP_CDN_RE.test(src)) return false;
  if (isUnsafeUrl(src)) return false;
  const abs = resolve(dirname(htmlPath), src);
  const rel = relative(resolve(projectRoot), abs).split(/[\\/]/).join("/");
  return rel === `hyperframes/vendor/${GSAP_VENDOR_BASENAME}`;
}

function pathMatchesProjectRef(src: string, projectRoot: string, ref: string): boolean {
  if (!src || isUnsafeUrl(src) || isAbsolute(src)) return false;
  const abs = resolve(projectRoot, src);
  const wanted = resolve(projectRoot, ref);
  return abs === wanted && isPathInside(abs, projectRoot);
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readHyperframesSceneSources(files: readonly string[]): Promise<string[]> {
  return Promise.all(
    files.map(async (file) => {
      try {
        return await readFile(file, "utf8");
      } catch {
        return file;
      }
    }),
  );
}

