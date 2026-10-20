// 1) Replace these values with your Firebase project's web-app config.
// Firebase web config is not a password; security comes from Auth + Firestore Rules.
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// The registration allow-list is stored in Firestore collection `allowedRegistrations`.
// Document ID = normalized registration number, e.g. "2600123".
// Fields: { active: true, claimed: false, displayName: "Student Name" }
