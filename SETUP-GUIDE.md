# CodeFlix - Setup Guide

CodeFlix is plain HTML + CSS + JavaScript. There is nothing to install or build.
Only **login and cloud saving** need an outside service (Firebase). Everything else runs in the student's browser.

**Time needed:** about 30 minutes. **Cost:** free (Firebase Spark plan, Netlify free plan).

---

## 0. What is in the folder

| File | What it does | Do you edit it? |
|---|---|---|
| `index.html` | The three pages: Home, Try it, My Visualizations | Rarely |
| `style.css` | Colours, cards, animations, phone layout | Yes - colours are at the top |
| `app.js` | Buttons, editor, playback, saving, feedback | If you want new features |
| `tracer.js` | The Python "brain" that records every step | Only to add Python features |
| `ctracer.js` | The C "brain" (same idea, for C programs) | Only to add C features |
| `examples-c.js` | The 15 C gallery snippets | Yes - add your own |
| `examples.js` | The 15 gallery snippets | Yes - add your own |
| `cloud.js` | Google login, saving and profile in Firestore (only file that talks to Firebase) | No |
| `config.js` | **Your college name, admin email, Firebase keys, Analytics ID** | **Yes - first** |
| `firestore.rules` | Security rules to paste into Firebase | Paste once |
| `netlify.toml` | Hosting settings | No |
| `assets/college-logo.svg` | Placeholder logo | Replace |
| `assets/demo.gif` | Hero demo animation | Replace (optional) |
| `test-examples.js` | `node test-examples.js` checks all examples still run | Optional |

To try it on your own computer, open a terminal in the folder and run `python3 -m http.server 8000`, then visit http://localhost:8000.
(Opening `index.html` by double-clicking will not work for login, because browsers block modules on `file://`.)

---

## 1. Personalise it (`config.js`)

```js
collegeName: "Your College Name",
adminEmail:  "admin@yourcollege.in",     // the Feedback button emails this address
analyticsId: "G-XXXXXXXXXX",             // step 3 below
firebase: { ... }                        // step 2 below
```

* **College logo:** replace `assets/college-logo.svg` with your logo (keep the same file name, or change the `src` in `index.html`). A square image about 72x72 px looks best. PNG/SVG both work.
* **Demo GIF:** replace `assets/demo.gif`. The included one is a short real recording of the app. A *one-minute* GIF will be 20 MB or more and slow on phones - record 10-15 seconds, or use a small MP4 instead (change the `<img>` in `index.html` to `<video src="assets/demo.mp4" autoplay muted loop playsinline>`). Free recorders: ScreenToGif (Windows), Kap (Mac), or `ezgif.com` to shrink a recording.

---

## 2. Firebase (Google login + saving)

### 2.1 Create the project
1. Go to https://console.firebase.google.com and sign in with a Google account (use a college/admin account so the project is not tied to one student).
2. **Create a project** -> name it `codeflix` -> you can switch Google Analytics *off* here (we use a separate Analytics snippet) -> **Create**.

### 2.2 Turn on Google sign-in
1. Left menu **Build -> Authentication -> Get started**.
2. **Sign-in method** tab -> **Google** -> toggle **Enable**.
3. Pick a **Project support email** (the admin address) -> **Save**.

### 2.3 Create the database
1. Left menu **Build -> Firestore Database -> Create database**.
2. Choose a location near you (e.g. `asia-south1` Mumbai). Pick **Start in production mode** -> **Create**.
3. Open the **Rules** tab, delete everything, paste the contents of `firestore.rules`, press **Publish**.
   These rules mean every student can only see and change their own saved items and their own profile.
   (If you pasted an older version of the rules, paste this one again - it now also covers the Profile page.)

### 2.4 Get your keys
1. Click the gear icon -> **Project settings** -> scroll to **Your apps** -> click the web icon `</>`.
2. Nickname `codeflix-web`. Leave "Firebase Hosting" unticked. **Register app**.
3. Copy the four values (`apiKey`, `authDomain`, `projectId`, `appId`) into the `firebase` block of `config.js`.
   These keys are *not secret* - the security rules protect the data.

### 2.5 Allow your website address (do this AFTER hosting, step 4)
Authentication -> **Settings** -> **Authorized domains** -> **Add domain** for each address students will use:
* `your-site-name.netlify.app`
* `codeflix.yourcollege.in`

(`localhost` is already allowed for testing.) If you skip this, login fails with *"auth/unauthorized-domain"*.

---

## 3. Google Analytics

1. Go to https://analytics.google.com -> **Admin -> Create -> Property** (Google Analytics 4).
2. **Data streams -> Add stream -> Web** -> enter your website address -> **Create stream**.
3. Copy the **Measurement ID** (looks like `G-AB12CD34EF`) into `analyticsId` in `config.js`.

The snippet is already in `index.html`; it stays switched off until you change that ID. CodeFlix also sends three simple events: `run_code`, `load_example`, `save_visualization` (see them under Reports -> Engagement -> Events after ~24 hours). Because Analytics counts visitors, add a short privacy line to your college page if your policy requires it.

---

## 4. Hosting on Netlify

### Option A - drag and drop (easiest)
1. Make sure `config.js` is filled in.
2. Go to https://app.netlify.com -> your site -> **Deploys** tab -> drag the whole `codeflix` **folder** onto the box that says *"Drag and drop your site output folder here"*.
   (Your existing site `tranquil-tulumba-10010d.netlify.app` will be replaced by CodeFlix. Prefer to keep the old one? Use **Add new site -> Deploy manually** instead.)
3. Rename the site: **Site configuration -> Change site name** -> e.g. `codeflix-yourcollege` -> address becomes `codeflix-yourcollege.netlify.app`.

### Option B - GitHub (updates go live automatically)
1. Put the folder in a new GitHub repository.
2. Netlify -> **Add new site -> Import an existing project** -> pick the repo.
3. Build command: *(leave empty)*. Publish directory: `.` -> **Deploy**.
   From now on, every `git push` updates the website.

### Custom domain: `codeflix.yourcollege.in`
1. Netlify -> **Domain management -> Add a domain** -> type `codeflix.yourcollege.in` -> confirm.
2. Ask your **college IT / whoever manages `yourcollege.in` DNS** to add this record:

   | Type | Name / Host | Value |
   |---|---|---|
   | `CNAME` | `codeflix` | `your-site-name.netlify.app` |

3. Wait 5-60 minutes (sometimes up to a day). Netlify then shows the domain as verified.
4. **Domain management -> HTTPS -> Verify DNS -> Provision certificate.** (Free, automatic.)
5. Go back to **step 2.5** and add the custom domain in Firebase.

## 4b. Hosting on Vercel (alternative)

1. https://vercel.com -> **Add New -> Project** -> import the GitHub repo.
2. Framework preset: **Other**. Leave build command and output directory empty -> **Deploy**.
3. **Project -> Settings -> Domains** -> add `codeflix.yourcollege.in`.
4. DNS record to add: `CNAME` | `codeflix` | `cname.vercel-dns.com`.
5. Add the Vercel and custom domains in Firebase (step 2.5).

---

## 5. Test checklist (5 minutes)

- [ ] Home page loads; hero shows the demo GIF and your logo.
- [ ] Click an example card -> it opens "Try it" and starts playing.
- [ ] Click the **C** tab in the gallery, open "Factorial (recursion)" -> the call stack grows; switch the drop-down back to Python.
- [ ] Type `x = = 3` and press Run -> a friendly error appears in the blue/red bar (no crash).
- [ ] Paste 31+ lines -> the counter turns red and Run explains the 30-line limit.
- [ ] Write `while True:` loop -> stops at 600 steps with a note.
- [ ] Not signed in: **Save** -> toast says "saved on this device" -> **My Visualizations** lists it.
- [ ] **Sign in with Google** -> works -> Save -> item appears in My Visualizations; open it from a different phone/laptop after signing in there.
- [ ] Click your name in the header -> **My Profile** opens; fill name, department, year, roll number -> Save -> reload and the values are still there.
- [ ] Type `print(` in the editor -> `)` is added automatically and the code is coloured.
- [ ] If items were saved before signing in, a banner offers **Move to my account**.
- [ ] **Feedback** -> opens the email app addressed to your admin.
- [ ] Phone: menu button works, no sideways scrolling.

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| "Google login is not switched on yet" | `config.js` still has `PASTE_...` values. |
| `auth/unauthorized-domain` | Add the exact website address in Firebase -> Authentication -> Settings -> Authorized domains. |
| Login popup closes at once / blank | Phone browser blocked popups - CodeFlix retries with a full-page redirect. Also make sure no `Cross-Origin-Opener-Policy` header is set. |
| "Missing or insufficient permissions" in My Visualizations | Rules not published (step 2.3), or you are signed out. |
| Changes to my files do not show | Hard refresh (Ctrl+Shift+R). Netlify caches JS/CSS for 5 minutes. |
| Gallery empty / page blank | Open the browser console (F12). A typo in `examples.js` or `config.js` usually shows the line number. |
| Analytics shows nothing | Needs a real `G-...` ID, up to 24 h delay; ad blockers hide visits from your own test. |

## 7. Easy things to change

* **Colours:** top of `style.css` (`--brand`, `--accent`, ...).
* **Add an example:** copy one block in `examples.js`, change `id`, `title`, `code`. Run `node test-examples.js` to be sure it works in CodeFlix.
* **Change the limits:** `LIMITS` at the top of `tracer.js` (`maxLines`, `maxSteps`). Note: Firestore documents must stay under 1 MB - 600 steps compresses to far less, so the default is safe.
* **Support more Python:** `tracer.js` has three labelled stages (tokenizer -> parser -> executor). Unsupported words give a polite message from the `UNSUPPORTED` list.

## 8. C language support

Use the **Python / C** drop-down in "Try it" (or the Python/C tabs in the Examples gallery).
C v1 understands: `#include`, `#define NAME value`, `int long short char float double`, 1-D arrays, char arrays as strings, `if / else if / else`, `for`, `while`, `do-while`, `break / continue`, functions with `return` (arrays are passed by reference), `printf` (with %d %f %c %s %x and widths like %.2f), `puts`, `putchar`, `abs`, `fabs`, `sqrt`, `pow`, `floor`, `ceil`, `strlen`, casts and `sizeof`.
Not in C v1: pointers (`*`, `&`), `scanf`/keyboard input, structs, `switch`, 2-D arrays, `malloc`, files.
Students see a plain-English message when they use one of these. Run `node test-examples.js` to re-check every Python and C example.

## 9. What v1 deliberately does not do

Python: dictionaries, classes, imports, f-strings, list comprehensions, `input()`, try/except, default arguments, keyword arguments (e.g. `print(sep=...)`). C: see section 8. The tracers tell students this in plain English when they use them. No sharing/collaboration; no server of your own.
