import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/components/home/AppointmentCTA.tsx", import.meta.url), "utf8");
// Exercise the real submit handler without mounting Firebase or making requests.
const handlerSource = source.slice(
  source.indexOf("  async function submitBooking("),
  source.indexOf("\n  const selectedDayEnabled"),
).replace(": FormEvent<HTMLFormElement>", "").trim();

function harness({ response, scheduleLoading = false, availabilityLoading = false, availabilityError = false, selectedTime = "19:15" } = {}) {
  const state = { result: null, submitting: false, time: selectedTime, resets: 0, requests: [], availability: { key: "obg_2026-10-01", slots: new Set(["19:00"]), error: false } };
  const fields = { name: "Test Patient", phone: "0000000000", reason: "Private test reason", consent: "on", website: "" };
  const submissionPending = { current: false };
  const context = vm.createContext({
    Error, Date, Set,
    FormData: class { get(name) { return fields[name]; } },
    submissionPending, scheduleLoading, availabilityLoading, availabilityError,
    selectedTime, doctorId: "obg", date: "2026-10-01", availabilityKey: "obg_2026-10-01",
    DOCTORS: [{ id: "obg", label: "Dr. Shaik Reshma — Obstetrics & Gynaecology" }],
    formStartedAt: { current: Date.now() - 2000 },
    setResult: (result) => { state.result = result; },
    setSubmitting: (value) => { state.submitting = value; },
    setTime: (value) => { state.time = value; },
    setCarePrefillMessage: () => {},
    setAvailability: (update) => { state.availability = update(state.availability); },
    fetch: (url, options) => {
      state.requests.push({ url, options });
      return response ? response() : Promise.resolve({ ok: true, json: async () => ({ appointmentId: "test-reservation" }) });
    },
    window: { open: () => { throw new Error("A reservation must not open another app"); } },
  });
  const submit = vm.runInContext(`(${handlerSource})`, context);
  const event = { preventDefault() {}, currentTarget: { reset() { state.resets += 1; } } };
  return { state, submissionPending, submit: () => submit(event) };
}

test("availability choices precede personal details in numbered native fieldsets", () => {
  const doctor = source.indexOf('name="doctor"');
  const date = source.indexOf('name="date"');
  const time = source.indexOf('name="time"');
  const name = source.indexOf('name="name"');
  const phone = source.indexOf('name="phone"');
  assert.ok(doctor > 0 && doctor < date && date < time && time < name && name < phone);
  assert.equal((source.match(/<fieldset className="patient-booking-step" disabled=\{submitting\}>/gu) || []).length, 2);
  assert.match(source, /<legend><span aria-hidden="true">1<\/span> Choose your appointment<\/legend>/u);
  assert.match(source, /<legend><span aria-hidden="true">2<\/span> Patient details<\/legend>/u);
  assert.match(source, /aria-describedby="booking-schedule"/u);
  assert.match(source, /name="name"[^>]*autoComplete="name"[^>]*required/u);
  assert.match(source, /name="phone"[^>]*autoComplete="tel"[^>]*required/u);
  assert.match(source, /name="consent"[^>]*required/u);
});

test("successful bookings preserve the API payload and show a durable reservation without navigation", async () => {
  const app = harness();
  await app.submit();
  assert.equal(app.state.requests.length, 1);
  const request = app.state.requests[0];
  assert.equal(request.url, "/api/appointments/book");
  assert.equal(request.options.method, "POST");
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.source, "website");
  assert.equal(payload.privacyAccepted, true);
  assert.equal(payload.website, "");
  assert.ok(payload.formElapsedMs >= 2000);
  assert.equal(payload.patientName, "Test Patient");
  assert.equal(payload.phone, "0000000000");
  assert.equal(payload.reason, "Private test reason");
  assert.equal(payload.doctorId, "obg");
  assert.equal(app.state.result.tone, "success");
  assert.equal(app.state.result.doctor, "Dr. Shaik Reshma — Obstetrics & Gynaecology");
  assert.equal(app.state.result.date, payload.preferredDate);
  assert.equal(app.state.result.time, payload.preferredTime);
  assert.match(app.state.result.message, /awaiting clinic confirmation/u);
  assert.equal(app.state.time, "");
  assert.equal(app.state.resets, 1);
  assert.equal(app.state.availability.slots.has("19:00"), true);
  assert.equal(app.state.availability.slots.has("19:15"), true);
  assert.equal(app.submissionPending.current, false);
  assert.equal(app.state.submitting, false);
  assert.doesNotMatch(source, /window\.open|window\.location\.(?:href|assign|replace)|encodeURIComponent|wa\.me\/[^"\s]+\?text/u);
  assert.match(source, /href="https:\/\/wa\.me\/919019263709"/u);
  assert.match(source, /WhatsApp for help \(optional\)/u);
  assert.match(source, /current\?\.tone === "error" \? null : current/u);
});

test("an in-flight reservation cannot be submitted twice before React rerenders", async () => {
  let finish;
  const app = harness({ response: () => new Promise((resolve) => { finish = resolve; }) });
  const first = app.submit();
  await app.submit();
  assert.equal(app.state.requests.length, 1);
  assert.equal(app.submissionPending.current, true);
  assert.equal(app.state.submitting, true);
  finish({ ok: true, json: async () => ({}) });
  await first;
  assert.equal(app.submissionPending.current, false);
  assert.equal(app.state.submitting, false);
  assert.match(source, /disabled=\{submitting \|\| scheduleLoading \|\| availabilityLoading \|\| availabilityError \|\| !selectedTime\}/u);
});

test("unavailable, unverified, or unselected slots never submit", async () => {
  for (const options of [{ scheduleLoading: true }, { availabilityLoading: true }, { availabilityError: true }, { selectedTime: "" }]) {
    const app = harness(options);
    await app.submit();
    assert.equal(app.state.requests.length, 0);
    assert.equal(app.state.result.tone, "error");
    assert.equal(app.state.resets, 0);
    assert.equal(app.submissionPending.current, false);
  }
});

test("server and network failures preserve patient inputs and release the submission lock", async () => {
  for (const response of [
    async () => ({ ok: false, json: async () => ({ error: "This appointment time is already booked." }) }),
    async () => { throw new Error("Connection unavailable"); },
  ]) {
    const app = harness({ response });
    await app.submit();
    assert.equal(app.state.result.tone, "error");
    assert.equal(app.state.resets, 0);
    assert.equal(app.state.time, "19:15");
    assert.equal(app.state.availability.slots.has("19:15"), false);
    assert.equal(app.submissionPending.current, false);
    assert.equal(app.state.submitting, false);
  }
});

test("booking feedback is announced and focused with an explicit confirmation boundary", () => {
  const effect = source.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[result\]\);/u)?.[1];
  assert.ok(effect, "the result feedback effect should exist");
  for (const result of [null, { tone: "success" }, { tone: "error" }]) {
    const calls = [];
    vm.runInNewContext(`(function () { ${effect} })()`, {
      result,
      resultRef: { current: {
        focus: (options) => { calls.push(["focus", { ...options }]); },
        scrollIntoView: (options) => { calls.push(["scroll", { ...options }]); },
      } },
    });
    assert.deepEqual(calls, result ? [
      ["focus", { preventScroll: true }],
      ["scroll", { behavior: "instant", block: "start" }],
    ] : []);
  }
  assert.match(source, /ref=\{resultRef\}/u);
  assert.match(source, /"booking-feedback booking-confirmation"/u);
  assert.match(source, /"booking-feedback rounded-xl/u);
  assert.match(source, /role=\{result\?\.tone === "error" \? "alert" : "status"\}/u);
  assert.match(source, /aria-live=\{result\?\.tone === "error" \? "assertive" : "polite"\}/u);
  assert.match(source, /tabIndex=\{result \? -1 : undefined\}/u);
  assert.match(source, /aria-atomic="true"/u);
  assert.match(source, /<dt>Specialist<\/dt><dd>\{result\.doctor\}/u);
  assert.match(source, /dateTime=\{result\.date\}/u);
  assert.match(source, /formatAppointmentTime\(result\.time\)/u);
  assert.match(source, /A reservation is not a confirmed appointment/u);
  assert.match(source, /href="\/privacy"/u);
  assert.doesNotMatch(source, /Quick confirmation on WhatsApp|Book in under a minute|Please choose Monday to Saturday/u);
});

test("care prefill, live occupancy, clinic clock, and hydration safeguards remain intact", () => {
  assert.match(source, /window\.addEventListener\(CARE_SELECTION_EVENT, onCareSelection\)/u);
  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\("care"\)/u);
  assert.match(source, /collection\(firestore, "appointmentSlots"\)/u);
  assert.match(source, /where\("doctorId", "==", doctorId\)/u);
  assert.match(source, /where\("date", "==", date\)/u);
  assert.match(source, /availabilityError \? \[\] : allSlots\.filter\(\(slot\) => !occupiedSlots\.has\(slot\)\)/u);
  assert.match(source, /availableSlots\.includes\(time\) \? time : ""/u);
  assert.match(source, /timeZone: "Asia\/Kolkata"/u);
  assert.match(source, /date !== clinicClock\.date \|\| slot > clinicClock\.time/u);
  assert.match(source, /const \[date, setDate\] = useState\(""\)/u);
  assert.match(source, /const \[clinicClock, setClinicClock\] = useState\(\{ date: "", time: "" \}\)/u);
  assert.match(source, /nextEnabledDate\(schedule, clinicClock\.date\)/u);
  assert.match(source, /name="website" type="text" tabIndex=\{-1\} autoComplete="off"/u);
});

test("native specialist links prefill from private fragments while preserving legacy query links", () => {
  const selectionSource = source.slice(
    source.indexOf("    const careFromUrl ="),
    source.indexOf("    const onCareSelection ="),
  );
  for (const [hash, search, expected] of [
    ["#appointment-pediatrics", "", "pediatrics"],
    ["#appointment-obg", "", "obg"],
    ["#appointment", "?care=obg", "obg"],
    ["", "?care=pediatrics", "pediatrics"],
    ["#appointment-obg", "?care=pediatrics", "obg"],
    ["#appointment-unknown", "", undefined],
    ["#appointment-obg-extra", "", undefined],
    ["#appointment", "?care=unknown", undefined],
  ]) {
    let selected;
    vm.runInNewContext(selectionSource, {
      URLSearchParams,
      window: { location: { hash, search } },
      selectCare: (doctorId) => { selected = doctorId; },
    });
    assert.equal(selected, expected, `${hash}${search}`);
  }
  assert.match(source, /id="appointment-pediatrics" className="patient-anchor" aria-hidden="true"/u);
  assert.match(source, /id="appointment-obg" className="patient-anchor" aria-hidden="true"/u);
  assert.doesNotMatch(source, /history\.(?:replaceState|pushState)|searchParams\.set/u);
});
