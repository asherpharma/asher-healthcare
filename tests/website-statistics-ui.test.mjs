import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("src/app/admin/website-statistics/page.tsx");

test("statistics report stays inside the staff shell and administrator-only child boundary", () => {
  const layout = read("src/app/admin/layout.tsx");
  const shell = read("src/components/admin/AdminShell.tsx");
  assert.match(layout, /<AdminShell>\{children\}<\/AdminShell>/);
  assert.match(shell, /<StaffGuard>/);
  assert.match(page, /import \{ useStaff \} from "@\/components\/admin\/StaffGuard"/);
  const access = page.slice(page.indexOf("export default function WebsiteStatisticsPage"));
  assert.match(access, /if \(profile\.role !== "admin"\)/);
  assert.ok(access.indexOf("Administrator access required") < access.indexOf("return <WebsiteStatisticsReport"));
  assert.doesNotMatch(access, /fetch\(/);
});

test("daily totals use an authenticated uncached same-origin request with bounded periods", () => {
  assert.match(page, /await user\.getIdToken\(\)/);
  assert.match(page, /fetch\(`\/api\/admin\/homepage-counts\?days=\$\{days\}`/);
  assert.match(page, /Authorization: `Bearer \$\{token\}`/);
  assert.match(page, /cache: "no-store"/);
  assert.match(page, /credentials: "omit"/);
  assert.match(page, /referrerPolicy: "no-referrer"/);
  assert.match(page, /report\.timezone === "Asia\/Kolkata"/);
  assert.match(page, /useState<7 \| 30>\(7\)/);
  assert.match(page, /event\.target\.value === "30" \? 30 : 7/);
  assert.match(page, /if \(!response\.ok\)/);
  assert.match(page, /if \(!isReport\(result, days\)\)/);
  assert.match(page, /Number\.isSafeInteger/);
  assert.match(page, /report\.rows\.length <= days/);
});

test("report requests are cancelled on navigation and do not persist reports in the browser", () => {
  assert.match(page, /new AbortController\(\)/);
  assert.match(page, /controller\.signal\.throwIfAborted\(\)/);
  assert.match(page, /signal: controller\.signal/);
  assert.match(page, /request\?\.abort\(\)/);
  assert.match(page, /activeRequest\.current === controller/);
  assert.doesNotMatch(page, /localStorage|sessionStorage|document\.cookie|console\./);
  assert.doesNotMatch(page, /getDocs|onSnapshot|firestore|firebase\/firestore/);
});

test("labels do not imply unique people, completed calls, appointments or Google Ads attribution", () => {
  assert.match(page, /Homepage views are not unique visitors/);
  assert.match(page, /do not confirm completed calls, booked appointments or clinic visits/);
  assert.match(page, /cannot identify visitors or show which Google ad led to an enquiry/);
  assert.match(page, /patient details or individual activity history/);
  assert.match(page, /earlier activity is not backfilled/);
  assert.match(page, /India Standard Time \(IST\)/);
});

test("daily table and loading/error states have accessible labels", () => {
  assert.match(page, /<caption className="sr-only">/);
  assert.match(page, /scope="col"/);
  assert.match(page, /scope="row"/);
  assert.match(page, /role="status"/);
  assert.match(page, /role="alert"/);
  assert.match(page, /aria-busy=\{loading\}/);
  assert.match(page, /<label className="text-sm font-semibold">\s*Period/);
  assert.match(page, /overflow-x-auto/);
});
