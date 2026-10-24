/* =====================================================================
   config.js  -  the ONLY file you need to edit to make CodeFlix yours
   ---------------------------------------------------------------------
   Everything here is safe to be public (Firebase web keys are not
   secrets - your Firestore security rules protect the data).
   ===================================================================== */
window.CODEFLIX_CONFIG = {

  // Shown in the header, hero and footer.
  collegeName: "RGUKT",

  // The "Feedback" button opens an email to this address.
  adminEmail: "KALYAN@yourcollege.in",

  // Google Analytics 4 "Measurement ID" (looks like G-ABC123XYZ).
  // Leave as-is to switch analytics off.
  analyticsId: "G-XXXXXXXXXX",

  // Firebase web-app settings. Copy them from:
  // Firebase console -> Project settings -> Your apps -> Web app -> Config.
  // While apiKey starts with "PASTE", login is switched off and CodeFlix
  // quietly saves to the browser (localStorage) instead.
  firebase: {
    apiKey: "PASTE_YOUR_API_KEY",
    authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
    projectId: "PASTE_YOUR_PROJECT_ID",
    appId: "PASTE_YOUR_APP_ID"
  }
};
