# SSC'26 school friends

## Files
- `index.html` — login and first-time registration UI
- `chat.html` — responsive Messenger-style class group
- `style.css` — glassmorphism, responsive layout, animations
- `app.js` — Firebase Auth, Firestore listeners, messages, reactions, pin/delete
- `firebase-config.js` — Firebase web app config placeholders
- `firestore.rules` — starter Firestore security rules
- `functions/` — callable Cloud Function to validate registration numbers privately

## Firebase setup
1. Create a project at https://console.firebase.google.com/.
2. Add a **Web app**. Copy its config into `firebase-config.js`.
3. In **Authentication → Sign-in method**, enable **Email/Password**.
4. Create a **Cloud Firestore** database.
5. Add the collection `allowedRegistrations`. For each student, create a document whose **document ID** is the normalized registration number (uppercase, no spaces). Example document `2600123`:
   ```json
   { "active": true, "claimed": false, "displayName": "Student Name" }
   ```
   Only add genuine class registration numbers. The collection is intentionally unreadable from the browser.
6. Deploy the Firestore rules:
   ```bash
   firebase init firestore
   firebase deploy --only firestore:rules
   ```
7. Deploy the registration-check Cloud Function:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init functions
   ```
   If `firebase init functions` creates files, merge the supplied `functions/index.js` and `functions/package.json` into that folder. From the `functions` folder run `npm install`, then from the project root run:
   ```bash
   firebase deploy --only functions:checkRegistration
   ```
   Cloud Functions deployment may require the Blaze billing plan. App Check is recommended before public launch.
8. Enable Firebase Authentication and Firestore in the same project, then serve the files using a local web server (ES modules do not work reliably from `file://`):
   ```bash
   python -m http.server 8000
   ```
   Open `http://localhost:8000`. You can also use Firebase Hosting:
   ```bash
   firebase init hosting
   firebase deploy --only hosting
   ```
9. Test with one registration number from the allow-list. The first registration creates a Firebase Auth account; later sign-ins use the same registration number and password.

## Important security notes
- Never store plain-text passwords in Firestore. Firebase Authentication stores password credentials securely.
- Do not publish Firestore test mode rules. Use the supplied rules as a starting point and test them with the Firebase Emulator Suite before production.
- The included callable function checks whether a registration number is approved. For a high-assurance public deployment, extend it into a transaction-backed registration-claim flow so concurrent signup attempts cannot race, and add Firebase App Check / abuse controls.
- The UI shows classmates' registration numbers. If you prefer privacy, remove that field from the sidebar.
- `isAdmin` is an optional trusted field on a user document. Do not let users set it themselves. Set it only using the Admin SDK / Firebase Console, and consider custom claims for production.
- Pin permissions in the starter rules are intentionally simple; for a larger class, move moderation and pinning to trusted backend functions and tighten reaction validation.
