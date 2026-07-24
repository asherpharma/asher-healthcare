# Firebase activation checklist

The public website works without Firebase. Complete every item below before using staff or patient features.

1. Create a clinic-owned Firebase project.
2. Add a Web app and copy its six public configuration values into the deployment environment variables listed in .env.example.
3. Enable Email/Password in Authentication.
4. Create Firestore in production mode and choose the nearest supported region.
5. Create the first staff user in Authentication.
6. In Firestore, create staff/{USER_UID} with: active=true, role="admin", displayName, and email.
7. Deploy firestore.rules and storage.rules from this repository.
8. Test with dummy data only: public users can create appointment requests but cannot read them; approved staff can read and update them; signed-out users cannot access patients.
9. Only after the security tests pass, begin entering real clinic data.

Never commit .env.local, passwords, private keys, or service-account JSON files.
