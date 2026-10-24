/* =====================================================================
   cloud.js  -  Google login + saving to Firestore (Firebase)
   ---------------------------------------------------------------------
   This is the ONLY file that talks to Firebase. app.js just calls:

       CodeFlixCloud.enabled          true if Firebase is configured
       CodeFlixCloud.onAuth(fn)       fn(user | null) runs when login changes
       CodeFlixCloud.signIn()         opens the Google sign-in popup
       CodeFlixCloud.signOut()
       CodeFlixCloud.list()           -> array of saved items (newest first)
       CodeFlixCloud.save(item)       -> the saved item (gets an id)
       CodeFlixCloud.remove(id)

   Data lives at:  users/{uid}/visualizations/{id}
   If Firebase is not configured (or fails to load) everything here
   becomes a harmless no-op and app.js uses localStorage instead.
   ===================================================================== */
const cfg = (window.CODEFLIX_CONFIG && window.CODEFLIX_CONFIG.firebase) || {};
const configured = !!cfg.apiKey && !/^PASTE/.test(cfg.apiKey);

const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
let fb = null;                 // will hold the Firebase functions once loaded
let currentUser = null;
const listeners = [];

/* Load Firebase only when it is configured, so a missing config never breaks the page. */
async function init() {
  if (!configured) return;
  try {
    const [app, auth, store] = await Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-auth.js"),
      import(SDK + "firebase-firestore.js")
    ]);
    const firebaseApp = app.initializeApp(cfg);
    fb = { auth, store, a: auth.getAuth(firebaseApp), db: store.getFirestore(firebaseApp) };
    auth.onAuthStateChanged(fb.a, (user) => {
      currentUser = user ? { uid: user.uid, name: user.displayName || "Student", email: user.email, photo: user.photoURL } : null;
      listeners.forEach((fn) => fn(currentUser));
    });
  } catch (err) {
    console.warn("CodeFlix: could not load Firebase - using local saving only.", err);
    api.enabled = false;
    listeners.forEach((fn) => fn(null));
  }
}

const ready = init();
const col = () => fb.store.collection(fb.db, "users", currentUser.uid, "visualizations");

const api = {
  enabled: configured,
  ready,
  onAuth(fn) { listeners.push(fn); if (currentUser) fn(currentUser); },

  async signIn() {
    await ready;
    if (!fb) throw new Error("Login is not set up yet.");
    const provider = new fb.auth.GoogleAuthProvider();
    try {
      await fb.auth.signInWithPopup(fb.a, provider);
    } catch (err) {
      // Some phone browsers block popups - fall back to a full-page redirect.
      if (err.code === "auth/popup-blocked") return fb.auth.signInWithRedirect(fb.a, provider);
      if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
      throw err;
    }
  },
  async signOut() { await ready; if (fb) await fb.auth.signOut(fb.a); },

  async list() {
    await ready;
    const q = fb.store.query(col(), fb.store.orderBy("updatedAt", "desc"));
    const snap = await fb.store.getDocs(q);
    return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  },

  async save(item) {
    await ready;
    const data = { title: item.title, code: item.code, lang: item.lang || "python", steps: item.steps || null, stepCount: item.stepCount || 0, updatedAt: Date.now() };
    if (item.id) {
      await fb.store.setDoc(fb.store.doc(col(), item.id), data);
      return Object.assign({ id: item.id }, data);
    }
    data.createdAt = data.updatedAt;
    const ref = await fb.store.addDoc(col(), data);
    return Object.assign({ id: ref.id }, data);
  },

  // Profile lives at users/{uid}/profile/main
  async getProfile() {
    await ready;
    const snap = await fb.store.getDoc(fb.store.doc(fb.db, "users", currentUser.uid, "profile", "main"));
    return snap.exists() ? snap.data() : null;
  },
  async saveProfile(p) {
    await ready;
    const data = { displayName: p.displayName, college: p.college, department: p.department, year: p.year, rollNo: p.rollNo, updatedAt: Date.now() };
    await fb.store.setDoc(fb.store.doc(fb.db, "users", currentUser.uid, "profile", "main"), data);
    return data;
  },

  async remove(id) {
    await ready;
    await fb.store.deleteDoc(fb.store.doc(col(), id));
  }
};

window.CodeFlixCloud = api;
