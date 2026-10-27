import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Script } from "node:vm";
import * as homepageGtm from "../src/lib/homepage-gtm.mjs";

const BOOTSTRAP_ID = "asher-homepage-gtm-bootstrap";
// No noscript request: without JavaScript, affirmative choice cannot be read.
const NEXT_VERSION = "16.3.7";

function exactlyOne(source, pattern, description) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${description}.`);
  return matches[0];
}

function attributes(tag) {
  const entries = [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu)]
    .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]);
  if (new Set(entries.map(([name]) => name)).size !== entries.length) {
    throw new Error("Duplicate markup attributes are not supported.");
  }
  return Object.fromEntries(entries);
}

export function injectHomepageGtmBootstrap(html, bootstrap) {
  if (typeof html !== "string" || !/^\s*<!doctype html>/iu.test(html)) {
    throw new TypeError("Expected a complete exported HTML document.");
  }
  if (typeof bootstrap !== "string" || !bootstrap.trim() || /\0|<\/?script\b|<!--|-->/iu.test(bootstrap)) {
    throw new TypeError("Expected safe inline JavaScript bootstrap source.");
  }
  // Validate syntax without running browser code or making any network request.
  new Script(bootstrap);
  if (/<form\b/iu.test(html)) throw new Error("The homepage export must not contain a form.");

  const headOpen = exactlyOne(html, /<head\b[^>]*>/giu, "head opening tag");
  const headClose = exactlyOne(html, /<\/head\s*>/giu, "head closing tag");
  const bodyOpen = exactlyOne(html, /<body\b[^>]*>/giu, "body opening tag");
  const bodyClose = exactlyOne(html, /<\/body\s*>/giu, "body closing tag");
  if (!(headOpen.index < headClose.index && headClose.index < bodyOpen.index && bodyOpen.index < bodyClose.index)) {
    throw new Error("Unexpected exported document structure.");
  }
  const start = headOpen.index + headOpen[0].length;
  const head = html.slice(start, headClose.index);
  const title = exactlyOne(head, /<title\b[^>]*>([\s\S]*?)<\/title\s*>/giu, "homepage title");
  if (title[1].trim() !== "Asher Healthcare") throw new Error("Unexpected homepage title.");

  const metaTags = [...head.matchAll(/<meta\b[^>]*>/giu)];
  const charsetTags = metaTags.filter((match) => "charset" in attributes(match[0]));
  if (charsetTags.length !== 1 || attributes(charsetTags[0][0]).charset.toLowerCase() !== "utf-8") {
    throw new Error("Expected exactly one UTF-8 charset meta tag.");
  }
  const referrerTags = metaTags.filter((match) => attributes(match[0]).name?.toLowerCase() === "referrer");
  const allReferrerTags = [...html.matchAll(/<meta\b[^>]*>/giu)]
    .filter((match) => attributes(match[0]).name?.toLowerCase() === "referrer");
  if (referrerTags.length !== 1 || allReferrerTags.length !== 1 || attributes(referrerTags[0][0]).content?.toLowerCase() !== "no-referrer") {
    throw new Error("Expected exactly one no-referrer meta tag.");
  }

  const scriptTags = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)];
  const existing = scriptTags.filter((match) => attributes(match[0].slice(0, match[0].indexOf(">") + 1)).id === BOOTSTRAP_ID);
  if (existing.length > 1) throw new Error("Duplicate homepage GTM bootstrap.");
  const noscriptTags = [...html.matchAll(/<noscript\b[^>]*>([\s\S]*?)<\/noscript\s*>/giu)];
  const existingNoscript = noscriptTags.filter((match) => /googletagmanager\.com\/ns\.html|asher-homepage-gtm-noscript/iu.test(match[0]));
  if (existingNoscript.length) throw new Error("A Google fallback would bypass affirmative consent.");
  let stripped = existing.length ? html.replace(existing[0][0], "") : html;
  if (/googletagmanager\.com\/|\basher-homepage-gtm-(?:bootstrap|noscript)\b/iu.test(stripped)) {
    throw new Error("Unexpected existing Tag Manager markup.");
  }
  const prefix = charsetTags[0][0] + referrerTags[0][0];
  const script = `<script id="${BOOTSTRAP_ID}">${bootstrap}</script>`;
  if (existing.length) {
    if (!head.startsWith(prefix + script)) throw new Error("Existing homepage bootstrap differs or is misplaced.");
    return html;
  }
  const remainingHead = head.replace(charsetTags[0][0], "").replace(referrerTags[0][0], "");
  const updated = html.slice(0, start) + prefix + script + remainingHead + html.slice(headClose.index);
  return updated;
}

const adapter = {
  name: "asher-homepage-gtm-head",
  async onBuildComplete({ config, nextVersion, projectDir, outputs }) {
    if (config?.output !== "export" || nextVersion !== NEXT_VERSION) {
      throw new Error("The homepage adapter requires the reviewed Next.js 16.3.7 static export.");
    }
    if (typeof projectDir !== "string" || !Array.isArray(outputs?.staticFiles)) {
      throw new Error("Missing static export output metadata.");
    }
    const target = resolve(projectDir, "out", "index.html");
    // Next's recursiveReadDir keeps the leading native separator in export IDs.
    const matches = outputs.staticFiles.filter((file) => typeof file?.id === "string" && /^[/\\]?index\.html$/u.test(file.id));
    if (matches.length !== 1 || typeof matches[0].filePath !== "string" || resolve(matches[0].filePath) !== target) {
      throw new Error("Expected only the reviewed out/index.html homepage target.");
    }
    if (typeof homepageGtm.createHomepageGtmBootstrap !== "function") {
      throw new Error("The reviewed homepage bootstrap generator is missing.");
    }
    const html = await readFile(target, "utf8");
    const updated = injectHomepageGtmBootstrap(html, homepageGtm.createHomepageGtmBootstrap());
    if (updated !== html) await writeFile(target, updated, "utf8");
  },
};

export default adapter;
