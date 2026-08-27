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
