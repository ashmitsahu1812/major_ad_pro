# Smart College Attendance

React, Tailwind, and Express attendance app with Google faculty sign-in, student check-in, CSV roster tools, geofencing, attendance history, and an audit log. Local development uses SQLite in `data/attendance.sqlite`. Production can use managed PostgreSQL by setting `DATABASE_URL`; Firebase Authentication remains the faculty sign-in provider.

## Run locally

Requirements: Node.js 24.12+.

```sh
npm install
npm run dev
```

Open the faculty app at `http://localhost:5173`. Local mode prints a one-time administrator setup token on its first run. In Firebase mode, only the Google account listed in `FIREBASE_ADMIN_EMAILS` can be the first administrator.

## Create the Firebase project

Firebase is not connected until you create a project and provide its app settings:

1. Register a Firebase Web app and enable **Authentication → Google**. See [Firebase web setup](https://firebase.google.com/docs/web/setup) and [Google sign-in setup](https://firebase.google.com/docs/auth/web/google-signin).
2. Add `localhost` and the hosted app domain to **Authentication → Settings → Authorized domains**.
3. Set the `VITE_FIREBASE_*` values, `FIREBASE_PROJECT_ID`, `FIREBASE_ADMIN_EMAILS`, and `FIREBASE_ENABLED=true`. Keep `.env` private.
4. Keep the Firebase Admin service-account JSON in a server-only environment variable. It verifies Google ID tokens; do not commit or expose it in a `VITE_` variable. See [Admin SDK setup](https://firebase.google.com/docs/admin/setup).

Restart `npm run dev` after updating `.env`. The server verifies Google ID tokens and allows only the admin email or staff entries approved by an admin. If `DATABASE_URL` is unset, local SQLite is used. In PostgreSQL mode, students, attendance, geofence, sessions, check-ins, staff, and audit records are stored in PostgreSQL.

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

## Deploy with Vercel and Render PostgreSQL

Create a PostgreSQL database in Render, then copy its **External Database URL**. In Vercel, set `DATABASE_URL` to that URL as a server-only secret for Production and Preview. Use the external URL because Vercel is outside Render's private network. Set `PG_POOL_MAX=5` and `PG_SSL=true`, and keep `FIREBASE_ENABLED=true` so Firebase continues to handle Google faculty sign-in. The repository builds the React app into `public/`; Express handles the API, and `/student-check-in` rewrites to the app entry point. Use build command `npm run build` and Node.js 24.

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
- `DATABASE_URL` — Render's external PostgreSQL URL. Keep it private and server-only.
- `PG_POOL_MAX=5`
- `PG_SSL=true`
- `APP_TIME_ZONE=Asia/Kolkata`

After deployment, add the assigned `*.vercel.app` hostname to **Firebase Authentication → Settings → Authorized domains**. Migrate existing Firestore data once by setting `DATABASE_URL`, Firebase credentials, and `FIREBASE_ENABLED=true` in a private local `.env`, then running `npm run migrate:firestore-to-postgres`. The migration refuses to merge into a non-empty PostgreSQL roster and records a completion marker. Firestore read quota must be available for the migration to finish. Once verified, the app uses PostgreSQL for all attendance data; Firebase remains only for authentication.

## Deploy elsewhere

Deploy the Node service with a persistent writable disk mounted at the app's `data/` directory. Build the frontend with `npm run build`; the Node server serves the built app and API from the same origin. Configure `PORT`, `DATA_DIR` if needed, and `APP_TIME_ZONE` for the institution's local calendar. Use HTTPS; student browsers require a secure context for geolocation. Set `ADMIN_SETUP_TOKEN` before the first production start and deliver it to the administrator through a secure channel. Do not commit the database, setup token, student data, or credentials.

The included `Dockerfile` builds a container. Mount a persistent volume at `/app/data`, set a unique `ADMIN_SETUP_TOKEN`, and expose port `4173` behind an HTTPS proxy. The `/api/health` endpoint is available for health checks.

## Before official college use

- The student page currently identifies a student by roll number alone. Add an institution-approved student login or individual credential before relying on check-ins as identity-verified attendance.
- Browser GPS can be spoofed or inaccurate. The radius is a practical classroom check, not proof of physical presence; decide whether stronger device or network controls are required.
- Agree on attendance rules, time zone, correction/appeal process, retention period, backups, and who may access student records. These are institution-specific.
- This app creates and authenticates faculty accounts locally. Connect the college's identity provider, email/password recovery, and account deactivation process before a broad deployment.

The app is a deployable single-instance baseline, not a substitute for the institution's security, privacy, and attendance policy review.
