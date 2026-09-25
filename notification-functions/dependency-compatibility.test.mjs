import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const loadCommonJs = createRequire(import.meta.url);
const gaxiosPath = loadCommonJs.resolve("gaxios");
const requireFromGaxios = createRequire(gaxiosPath);
const uuid = requireFromGaxios("uuid");
const { Gaxios } = loadCommonJs("gaxios");

test("override is limited to gaxios 6.7.1 and resolves the patched CommonJS uuid", () => {
  const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.overrides, { "gaxios@6.7.1": { uuid: "11.1.1" } });
  assert.equal(loadCommonJs("gaxios/package.json").version, "6.7.1");
  assert.equal(requireFromGaxios("uuid/package.json").version, "11.1.1");
  assert.match(requireFromGaxios.resolve("uuid").replaceAll("\\", "/"), /\/dist\/cjs\/index\.js$/u);
});

test("gaxios's no-argument v4 usage retains valid unique UUID output", () => {
  const values = Array.from({ length: 100 }, () => uuid.v4());
  assert.equal(new Set(values).size, values.length);
  for (const value of values) {
    assert.equal(typeof value, "string");
    assert.equal(uuid.validate(value), true);
    assert.equal(uuid.version(value), 4);
  }
});

test("patched v3/v5/v6 APIs reject undersized output buffers without partial writes", () => {
  const calls = [
    (buffer) => uuid.v3("notification-compatibility", uuid.v3.DNS, buffer, 4),
    (buffer) => uuid.v5("notification-compatibility", uuid.v5.DNS, buffer, 4),
    (buffer) => uuid.v6({}, buffer, 4),
  ];
  for (const invoke of calls) {
    const buffer = Buffer.alloc(8, 0xa5);
    assert.throws(() => invoke(buffer), RangeError);
    assert.deepEqual(buffer, Buffer.alloc(8, 0xa5));
  }
});

test("gaxios multipart adapter uses the patched boundary generator without network access", async () => {
  const client = new Gaxios();
  let intercepted = 0;
  const boundaries = [];
  for (let index = 0; index < 2; index += 1) {
    const response = await client.request({
      url: "https://notification-compatibility.invalid/upload",
      method: "POST",
      multipart: [
        { headers: { "Content-Type": "application/json" }, content: JSON.stringify({ synthetic: true }) },
        { headers: { "Content-Type": "text/plain" }, content: "notification-compatibility-fixture" },
      ],
      retry: false,
      fetchImplementation: async () => { throw new Error("Unexpected network adapter use."); },
      // A supplied adapter bypasses gaxios's fetch adapter entirely. All bodies
      // are synthetic and remain in memory: no sockets, credentials or providers.
      adapter: async (options) => {
        intercepted += 1;
        const contentType = options.headers["Content-Type"];
        const boundary = /^multipart\/related; boundary=(.+)$/u.exec(contentType)?.[1];
        assert.ok(boundary);
        assert.equal(uuid.validate(boundary), true);
        assert.equal(uuid.version(boundary), 4);
        boundaries.push(boundary);
        let body = "";
        for await (const chunk of options.body) body += chunk.toString();
        assert.ok(body.includes(`--${boundary}`));
        assert.ok(body.includes("notification-compatibility-fixture"));
        assert.ok(body.includes('"synthetic":true'));
        assert.ok(body.includes(`--${boundary}--`));
        return { config: options, status: 200, statusText: "OK", headers: {}, data: { accepted: true } };
      },
    });
    assert.deepEqual(response.data, { accepted: true });
  }
  assert.equal(intercepted, 2);
  assert.equal(new Set(boundaries).size, 2);
});
