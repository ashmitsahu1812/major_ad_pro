# Smart College Attendance

React + Tailwind + Lucide faculty dashboard with a student phone check-in flow. Express provides the shared API and stores the demo roster, class location, active QR session, and check-ins in `data/attendance.json`.

## Run locally

Requirements: Node.js 20.19+.

```sh
npm install
npm run dev
```

Vite serves the faculty dashboard at `http://localhost:5173` and proxies API requests to Express on port 4173. The API creates its sample roster automatically on first run.

## Student check-in flow

1. Faculty opens **Take attendance → QR / Digital pass**, sets the class location from the classroom, selects a 25–100 m radius, and starts the attendance session.
2. Students scan the actual QR with their phone camera. It opens `/student-check-in` with a short-lived session token.
3. Each student enters their roster roll number and taps **Verify location & check in**. The server checks the pass, roll number, duplicate status, and distance from the configured classroom before recording attendance.
4. The faculty dashboard refreshes shared attendance and check-in records automatically.

The roster can be maintained manually or imported/exported as CSV in **Students**. CSV imports require `name`, `roll`, and `department`; optional columns are `attendance_percent`, `today`, and `notified`.

## Deploy

Build the frontend with `npm run build`, then deploy the Node service with `npm start` on a host that supports persistent storage. Set `PORT` if required by the host. Keep the `data/` directory on a persistent disk so roster and check-in records survive restarts. Use HTTPS for student check-in so phone browsers can request location. If the app is served behind a separate public URL, set `VITE_APP_URL` at build time to the public origin used by the QR link.

## Prototype limits

The initial roster is sample data. This prototype has no faculty login, and browser location can be spoofed, so it is not ready for official attendance or sensitive student records. A production college deployment should add faculty authentication, a managed database, and stronger device/location verification. Check-ins are validated and stored centrally by the Express API; browser local storage is not used as the shared source of truth.
