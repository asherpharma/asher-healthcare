import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commandCenterSource = await readFile(
  new URL("../src/components/admin/StaffCommandCenter.tsx", import.meta.url),
  "utf8",
);
const portalLoginSource = await readFile(
  new URL("../src/app/portal/login/page.tsx", import.meta.url),
  "utf8",
);
const healthPanelSource = await readFile(
  new URL("../src/components/admin/SystemHealthPanel.tsx", import.meta.url),
  "utf8",
);
const adminShellSource = await readFile(
  new URL("../src/components/admin/AdminShell.tsx", import.meta.url),
  "utf8",
);
const portalDashboardSource = await readFile(
  new URL("../src/components/portal/PatientPortalDashboard.tsx", import.meta.url),
  "utf8",
);
const globalsSource = await readFile(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("staff command centre traps focus, makes its background inert and restores focus", () => {
  assert.match(commandCenterSource, /dialogRef\.current\.querySelectorAll<HTMLElement>/u);
  assert.match(commandCenterSource, /event\.key !== "Tab"/u);
  assert.match(commandCenterSource, /event\.key === "Escape"/u);
  assert.match(commandCenterSource, /background\.inert = true/u);
  assert.match(commandCenterSource, /background\.setAttribute\("aria-hidden", "true"\)/u);
  assert.match(commandCenterSource, /returnFocusTarget\?\.isConnected/u);
  assert.match(commandCenterSource, /aria-modal="true"/u);
});

test("family portal offers a non-enumerating Firebase password reset", () => {
  assert.match(portalLoginSource, /sendPasswordResetEmail\(auth, approvedEmail/u);
  assert.match(portalLoginSource, /asherhealthcare\.in\/portal\/login\?passwordReset=1/u);
  assert.match(portalLoginSource, /If an approved family portal account matches this email/u);
  assert.match(portalLoginSource, /catch \{[\s\S]*?cannot reveal portal accounts/u);
  assert.doesNotMatch(portalLoginSource, /Forgot password\? Call reception/u);
});

test("operations panel presents the active manual billing ledger", () => {
  assert.match(healthPanelSource, /payments: "Manual billing"/u);
  assert.match(healthPanelSource, /Manual collection · ledger operational/u);
  assert.doesNotMatch(healthPanelSource, /TEST mode · payments are not live/u);
  assert.doesNotMatch(healthPanelSource, /Payment gateway"/u);
});

test("small authenticated app surfaces use the compact web logo", () => {
  for (const source of [adminShellSource, portalLoginSource, portalDashboardSource]) {
    assert.match(source, /\/images\/asher-logo-compact-v2\.webp/u);
    assert.doesNotMatch(source, /<Image src="\/images\/logo\.png"/u);
  }
});

test("tablet layouts retain responsive grids while phone forms remain single-column", () => {
  const tabletStart = globalsSource.indexOf("@media (max-width: 1279px)");
  const standaloneStart = globalsSource.indexOf(
    "@media (display-mode: standalone) and (hover: none) and (pointer: coarse)",
    tabletStart,
  );
  const phoneStart = globalsSource.indexOf("@media (max-width: 639px)", standaloneStart);
  const narrowPhoneStart = globalsSource.indexOf("@media (max-width: 359px)", phoneStart);

  assert.ok(tabletStart >= 0 && standaloneStart > tabletStart);
  assert.ok(phoneStart > standaloneStart && narrowPhoneStart > phoneStart);

  const tabletRules = globalsSource.slice(tabletStart, standaloneStart);
  const phoneRules = globalsSource.slice(phoneStart, narrowPhoneStart);
  assert.doesNotMatch(tabletRules, /form\[class\*="grid"\]/u);
  assert.doesNotMatch(tabletRules, /article\[class\*="sm:grid-cols"\]/u);
  assert.match(
    phoneRules,
    /form\[class\*="grid"\][\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important/u,
  );
  assert.match(
    phoneRules,
    /article\[class\*="sm:grid-cols"\][\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important/u,
  );
});
