import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserSessionPersistence,
  getAuth,
  initializeAuth,
  setPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean);
export const firebaseApp = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
export const firestore = firebaseApp ? getFirestore(firebaseApp) : null;
export const storage = firebaseApp ? getStorage(firebaseApp) : null;

// Patient sessions deliberately use a separately named Firebase app and
// session-only persistence. Signing into the family portal must never replace
// a staff session that happens to be open in another tab on the same device.
const patientFirebaseApp = isFirebaseConfigured
  ? getApps().find((app) => app.name === "asher-patient-portal")
    ?? initializeApp(firebaseConfig, "asher-patient-portal")
  : null;
export const patientFirebaseAuth = patientFirebaseApp
  ? (() => {
      try {
        return initializeAuth(patientFirebaseApp, {
          persistence: browserSessionPersistence,
        });
      } catch {
        return getAuth(patientFirebaseApp);
      }
    })()
  : null;

// Clinic devices are often shared. Keep staff credentials only for the current
// browser session so closing the browser or installed app cannot silently
// restore access to patient, clinical, or billing records later.
if (firebaseAuth && typeof window !== "undefined") {
  void setPersistence(firebaseAuth, browserSessionPersistence);
}

if (patientFirebaseAuth && typeof window !== "undefined") {
  void setPersistence(patientFirebaseAuth, browserSessionPersistence);
}
