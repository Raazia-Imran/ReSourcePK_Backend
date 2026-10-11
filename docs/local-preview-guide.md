# Clone, run and verify ReSource PK

Updated: 11 October 2026. Use `main` in both repositories after consolidation. Do not apply the old onboarding/catalog patches again: their code is included.

## 1. Install and open the tools

Install Git, Node.js 24 LTS and VS Code. Open **Git Bash** on Windows. Check `git --version`, `node --version` and `npm --version`. Commands below are for Git Bash; keep two terminals open while running the app.

## 2. Clone both repositories

Use a new folder so existing local edits are preserved:

```bash
mkdir -p ~/Projects/ReSourcePK-preview
cd ~/Projects/ReSourcePK-preview
git clone --branch main https://github.com/Raazia-Imran/ReSourcePK_Backend.git
git clone --branch main https://github.com/Raazia-Imran/ReSourcePK_Frontend.git
```

If the repositories are already cloned, first check `git status` in each one. With a clean working tree, run `git switch main` and `git pull --ff-only origin main`. Do not discard local edits to update.

## 3. Configure the backend

```bash
cd ~/Projects/ReSourcePK-preview/ReSourcePK_Backend
cp .env.example .env
code .env
```

Fill the placeholders in this file before starting:

| Setting              | What you enter                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Supabase PostgreSQL transaction-pooler connection string, with your database password substituted and URL-encoded |
| `JWT_ACCESS_SECRET`  | A newly generated random secret of at least 32 characters                                                         |
| `APP_URL`            | `http://localhost:3000`                                                                                           |
| `CORS_ORIGINS`       | `http://localhost:3000`                                                                                           |
| `PORT`               | `5000`                                                                                                            |
| `GMAIL_USER`         | The Gmail account that sends verification/reset/invitation messages                                               |
| `GMAIL_APP_PASSWORD` | Its Google app password, entered without spaces; never the normal Gmail login password                            |

Generate a JWT secret locally using:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Copy the result into `.env`. This backend uses its own authentication; a Supabase anon key is not a substitute for `DATABASE_URL`.

### Where the passwords come from

- **Database password:** the password for your Supabase project. Retrieve it from your own saved credentials, or reset it in Supabase database settings and update each application using the old password. It is not your Supabase website login.
- **Gmail app password:** enable Google two-step verification, then create an app password for the sending account. Google shows the generated password when you create it.
- **Website user password:** choose it when registering in ReSource PK. There is no universal demo login or default admin password. The database stores bcrypt hashes, which cannot be read back as passwords.
- **GitHub login:** only needed to push code; it is not needed to run this public repository locally.

Keep credentials in your local `.env` and your password manager. Never commit `.env` or put backend secrets into the frontend.

## 4. Connect the existing database

Open Supabase project **ReSourcePK-Staging**, reference `cvprjenfrkvxpwmalmgo`. Use its **Connect** dialog to get the pooler connection string. Replace its password placeholder correctly; special password characters require URL encoding.

```bash
npm ci
npm run db:migrate
npm test
npm run lint
npm run format:check
npm run dev
```

Migration files 001, 002 and 003 create the identity, organization and catalog model. The runner records applied filenames in `app.schema_migrations`; running it again skips recorded migrations. Do not run the old `src/db/schema.sql` from a legacy branch.

Visit `http://localhost:5000/health`: expect `{"status":"ok"}`. Visit `http://localhost:5000/ready`: expect a successful database readiness response. A working health check alone does not confirm database access.

### Why Table Editor can look empty

In Supabase Table Editor, change the schema dropdown from **public** to **app**, then select a table. These are private application tables. Do not duplicate them in `public` or expose them to browser roles.

If the editor does not list the schema, use SQL Editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'app' ORDER BY table_name;
SELECT name, applied_at FROM app.schema_migrations ORDER BY name;
SELECT 'users' AS table_name, count(*) AS rows FROM app.users
UNION ALL SELECT 'organizations', count(*) FROM app.organizations
UNION ALL SELECT 'listings', count(*) FROM app.listings
UNION ALL SELECT 'buyer_requirements', count(*) FROM app.buyer_requirements;
```

Empty listing tables mean no listings have been created; cloning code does not seed marketplace stock. Avoid posting screenshots of token/session/password-hash tables.

## 5. Start the frontend in a second terminal

```bash
cd ~/Projects/ReSourcePK-preview/ReSourcePK_Frontend
cp .env.example .env
npm ci
npm run lint
npm run build
npm start
```

The frontend `.env` should contain `VITE_API_URL=http://localhost:5000/api/v1`. Open `http://localhost:3000`. Keep the backend terminal running. Restart Vite after changing its environment file. If Vite selects another port because 3000 is occupied, free port 3000 or update backend `APP_URL` and `CORS_ORIGINS` to match and restart both.

## 6. Follow these checks in order

1. **Public page:** inspect hero, story, navigation and catalog. Resize to phone, tablet and desktop widths. Empty catalog is valid until a listing is published.
2. **Validation:** try registration with a short password. Expect a useful error; no account should be created for invalid input. Password visibility controls should work.
3. **Buyer registration:** register using an email inbox you control. Open its verification email, verify, then sign in and enter the workspace. Reusing a consumed verification link must not verify another account.
4. **Seller registration:** use a second inbox and an organization name. Verify and sign in; expect the organization workspace. The buyer-to-seller onboarding path should also let an existing buyer create a seller organization.
5. **Team invitations:** as owner, invite another controlled inbox as manager or staff. Test acceptance both while signed out and while signed in as the intended recipient. An unrelated account must not accept that invitation. Staff must not get owner/manager listing-management controls.
6. **Catalog drafts:** as seller owner/manager, create a listing with valid title, description, material, condition, unit, quantity, MOQ and price. Expect a draft in your seller workspace, not the public catalog. MOQ above available quantity must fail.
7. **Import:** download the CSV template, fill one valid row, preview, then import. Correct invalid rows before committing. CSV/XLSX files are limited to 2 MB and 100 data rows. Imports create drafts; they do not publish directly.
8. **Moderation:** submit a draft for review. Publishing needs a verified active account assigned the narrow `platform_admin` role. Ordinary seller and buyer accounts must be denied moderation. No platform admin is automatically seeded; arrange authorized test-account provisioning before this check.
9. **Discovery:** after authorized publication, find the listing through public search/filter/sort and open its details. Draft/rejected listings must remain hidden from public discovery.
10. **Buyer requirements:** create a requirement with matching material/unit, quantity and optional price limit. Inspect matching published stock and the direct-purchase/MOQ explanation. This is matching only; checkout and group pools are future work.
11. **Password reset/logout:** request reset, open the email, choose a new password, then sign in with it. The reset token must be single-use. Log out and check protected pages no longer display account data.

For each failed check, record the page, account role, steps, expected result, actual result, browser console error and backend request ID. Do not share passwords or email tokens.

## 7. Common problems

| Symptom                               | Check                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Invalid environment configuration     | Replace placeholders; JWT secret must be long enough; configure both Gmail fields together                  |
| Database connection/readiness failure | Correct Supabase project, pooler host, username, password encoding and connection string                    |
| Relation does not exist               | Run migrations against the same database used by the API                                                    |
| Verification email missing            | Gmail app-password setup, sender account, spam folder and backend delivery logs; do not bypass verification |
| Frontend cannot reach API             | Backend is running; frontend API URL ends in `/api/v1`; frontend origin matches CORS                        |
| Moderation returns 403                | A seller owner is not a platform admin; authorized platform assignment is required                          |
| Catalog is empty                      | Create, submit and approve a listing; drafts/imports are private                                            |

## 8. What is ready and what remains

The code includes Phase 1 identity/organizations and the first Phase 2 catalog slice: drafts, import, review, discovery and requirement matching. Backend automated tests, lint/format and frontend lint/build are checks of this slice, not proof of full production readiness.

Live email, real database journeys, browser responsiveness, tenant isolation and moderation must still be verified with configured accounts. Image storage, price tiers, pools, checkout/payments, fulfilment, passports and complete analytics are not implemented by these patches. See `phase-2-progress.md` and `tasks.md` for the remaining scope.
