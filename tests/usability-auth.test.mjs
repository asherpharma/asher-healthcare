import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staff = await readFile("src/app/admin/login/page.tsx", "utf8");
const family = await readFile("src/app/portal/login/page.tsx", "utf8");
const css = await readFile("src/app/globals.css", "utf8");

test("both login screens put the form before optional help and preserve password-manager support", () => {
  for (const source of [staff, family]) {
    assert.match(source, /className="auth-page"/);
    assert.match(source, /className="auth-form"/);
    assert.ok(source.indexOf('className="auth-form"') < source.indexOf('className="auth-help"'));
    assert.match(source, /autoComplete="username"/);
    assert.match(source, /autoComplete="current-password"/);
    assert.match(source, /aria-label=\{showPassword \? "Hide password" : "Show password"\}/);
    assert.match(source, /!resetOpen/);
    assert.match(source, /handleCodeInApp: false/);
    assert.match(source, /If an approved .*account matches this email/);
    assert.doesNotMatch(source, /signInWithPhoneNumber|sendSignInLinkToEmail|type="tel"/);
    assert.doesNotMatch(source, /bg-\[#A8864A\].*text-white/);
  }
});

test("family access still requires the server claim and uses the separate session", () => {
  assert.match(family, /patientFirebaseAuth/);
  assert.match(family, /body: JSON.stringify\(\{ action: "claim" \}\)/);
  assert.match(family, /cache: "no-store"/);
  assert.match(family, /onAuthStateChanged/);
  assert.match(family, /response.status === 403/);
  assert.match(family, /A matching name, phone number or email never links a medical record automatically/);
});

function luminance(hex) {
  const values = hex.match(/[a-f0-9]{2}/gi).map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

test("primary colours have readable white-text contrast and controls remain touch sized", () => {
  for (const token of ["navy", "teal", "rose"]) {
    const hex = css.match(new RegExp(`--${token}: (#[a-f0-9]{6});`, "i"))?.[1];
    assert.ok(hex);
    assert.ok(1.05 / (luminance(hex) + 0.05) >= 4.5, `${token} should pass 4.5:1`);
  }
  assert.match(css, /\.auth-input \{[^}]*min-height: 48px;[^}]*font-size: 1rem;/);
  assert.match(css, /\.auth-primary \{[^}]*min-height: 48px;/);
  assert.match(css, /\.booking-slot-input:focus-visible \+ \.booking-slot-time/);
  assert.match(css, /\.appointment-form-panel \{ order: 1; \}/);
});
