# Firebase activation checklist

The public website works without Firebase. Complete every item below before using staff or patient features.

1. Create a clinic-owned Firebase project.
2. Add a Web app and copy its six public configuration values into the deployment environment variables listed in .env.example.
3. Enable Email/Password in Authentication.
4. Create Firestore in production mode and choose the nearest supported region.
5. Create the first staff user in Authentication.
6. In Firestore, create staff/{USER_UID} with: active=true, role="admin", displayName, and email.
7. Create the default Storage bucket in `asia-south1` and confirm `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` matches the bucket shown in Firebase Storage.
8. Deploy `firestore.rules`, `firestore.indexes.json`, and `storage.rules` from this repository.
9. If Storage reports that cross-service database calls are not configured, use its official **Fix issue → Attach permissions** flow so Storage Rules can verify Firestore staff and patient records.
10. Test with dummy data only: public users cannot read clinic records; approved staff can access only the workflows allowed by their role; signed-out users cannot access patients or reports.
11. Configure a monthly Google Cloud billing budget. A budget sends alerts and is not a hard spending cap.
12. Only after the security tests pass, begin entering real clinic data.

Never commit .env.local, passwords, private keys, or service-account JSON files.
