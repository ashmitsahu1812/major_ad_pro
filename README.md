# Smart College Attendance

React, Tailwind, and Express attendance app with Google faculty sign-in, student check-in, CSV roster tools, geofencing, attendance history, and an audit log. With Firebase enabled, Firestore stores the roster and attendance records. Without Firebase configuration, the app uses SQLite in `data/attendance.sqlite` for local development.

## Run locally

Requirements: Node.js 24.12+.

```sh
npm install
npm run dev
```

Open the faculty app at `http://localhost:5173`. Local mode prints a one-time administrator setup token on its first run. In Firebase mode, only the Google account listed in `FIREBASE_ADMIN_EMAILS` can be the first administrator.

## Create the Firebase project

Firebase is not connected until you create a project and provide its app settings:

1. Open the [Firebase Console](https://console.firebase.google.com/) and choose **Add project**. Give it a name such as `Smart College Attendance`.
2. From the project overview, choose the **Web** (`</>`) app icon, register the app, and copy the web config values. See [Firebase's web setup guide](https://firebase.google.com/docs/web/setup).
3. Open **Authentication → Get started → Sign-in method**, enable **Google**, choose a support email, and save. See [Google sign-in setup](https://firebase.google.com/docs/auth/web/google-signin).
4. Open **Firestore Database → Create database**. Choose **Production mode** and a region near the college. Production mode blocks direct browser reads/writes while the server uses Firebase Admin. See the [Firestore quickstart](https://firebase.google.com/docs/firestore/quickstart).
5. Add `localhost` and the eventual hosted app domain under **Authentication → Settings → Authorized domains**.
6. `.env` is already filled with the Web config you sent. Add your Google account email to `FIREBASE_ADMIN_EMAILS`, set `FIREBASE_ENABLED=true`, and keep `.env` private; Git ignores it.
7. For local server credentials, create a service-account key in **Project settings → Service accounts** and save the JSON file outside this repository. Set `GOOGLE_APPLICATION_CREDENTIALS` in `.env` to its full path. Do not upload or send that file. Firebase recommends Application Default Credentials for trusted server environments; on Google Cloud, attach a service identity instead of using a downloaded key. See [Admin SDK setup](https://firebase.google.com/docs/admin/setup).
8. Deploy the included server-only Firestore rules with `firebase deploy --only firestore:rules --project smart-college-attendance-1462f` after installing and signing in to the Firebase CLI.

Restart `npm run dev` after updating `.env`. The server verifies Google ID tokens and allows only the admin email or staff entries approved by an admin. On first Firebase startup, it copies the current SQLite roster and attendance records to Firestore once. New records are stored in Firestore. Existing SQLite data stays in `data/` as a local backup.

Build and run the production server locally with:

```sh
npm run build
npm start
```

Then open `http://localhost:4173`.

## Faculty and student flow

1. The first admin signs in, imports or adds the roster, and creates individual faculty accounts with **Add faculty**.
2. Faculty opens **Take attendance → QR / Digital pass**, sets the classroom location, selects a 25–100 m radius, and starts a session.
3. Students scan the QR from their phone, enter their roster roll number, and allow location access. The server checks the short-lived QR session, radius, and duplicate attendance before saving.
4. Faculty can record manual attendance, review per-date records, and export the roster as CSV.

Existing `data/attendance.json` files are imported into SQLite once when the new database is empty. Keep `data/` on persistent storage and back it up. SQLite is intended for a single app instance; do not run multiple app replicas against a local SQLite file.

## Deploy on Vercel

The repository is configured for Vercel: it builds the React app into `public/`, serves the API with an Express Function, and rewrites `/student-check-in` to the app entry point. Import the GitHub repository into Vercel and use the default build command (`npm run build`). Set the Node.js version to 22 or newer.

Add these variables in **Vercel → Project → Settings → Environment Variables** for Production and Preview:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_ENABLED=true`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_ADMIN_EMAILS`
- `FIREBASE_SERVICE_ACCOUNT_JSON` — paste the service-account JSON as a server-only secret; never add it to Git or a `VITE_` variable.
- `APP_TIME_ZONE=Asia/Kolkata`

After the first deployment, add the assigned `*.vercel.app` hostname to **Firebase Authentication → Settings → Authorized domains** and redeploy. The server credential is stored in Vercel's environment settings, roster and attendance data stay in Firestore, and Vercel's filesystem is temporary.

## Deploy elsewhere

Deploy the Node service with a persistent writable disk mounted at the app's `data/` directory. Build the frontend with `npm run build`; the Node server serves the built app and API from the same origin. Configure `PORT`, `DATA_DIR` if needed, and `APP_TIME_ZONE` for the institution's local calendar. Use HTTPS; student browsers require a secure context for geolocation. Set `ADMIN_SETUP_TOKEN` before the first production start and deliver it to the administrator through a secure channel. Do not commit the database, setup token, student data, or credentials.

The included `Dockerfile` builds a container. Mount a persistent volume at `/app/data`, set a unique `ADMIN_SETUP_TOKEN`, and expose port `4173` behind an HTTPS proxy. The `/api/health` endpoint is available for health checks.

## Before official college use

- The student page currently identifies a student by roll number alone. Add an institution-approved student login or individual credential before relying on check-ins as identity-verified attendance.
- Browser GPS can be spoofed or inaccurate. The radius is a practical classroom check, not proof of physical presence; decide whether stronger device or network controls are required.
- Agree on attendance rules, time zone, correction/appeal process, retention period, backups, and who may access student records. These are institution-specific.
- This app creates and authenticates faculty accounts locally. Connect the college's identity provider, email/password recovery, and account deactivation process before a broad deployment.

The app is a deployable single-instance baseline, not a substitute for the institution's security, privacy, and attendance policy review.
