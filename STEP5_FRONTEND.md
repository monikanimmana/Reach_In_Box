# STEP 5: Minimal Frontend (React/Next.js + Google OAuth)

## What This Delivers

✅ **Real Google OAuth login** (NextAuth.js, not mocked)  
✅ **Header** with user name, email, avatar, logout  
✅ **Tabs** for Scheduled / Sent emails  
✅ **Compose Modal** — subject, body, CSV/text recipient upload, schedule time  
✅ **Email Tables** with loading + empty states  
✅ **Rate limit status** display  
✅ **Typed API calls** with error handling  
✅ **Auto-refresh** every 5 seconds  

---

## Tech Stack

- **Next.js 14** (App Router)
- **React 18** with TypeScript
- **NextAuth.js 4** (Google OAuth)
- **Tailwind CSS** (styling)
- **Lucide icons** (UI icons)
- **Axios** (API client)

---

## Setup: Google OAuth

### 1. Get Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. **APIs & Services** → **OAuth consent screen**
   - Choose **External** user type
   - Fill in app name: "ReachInbox"
   - Add your email as test user
   - Save
4. **Credentials** → **+ Create Credentials** → **OAuth 2.0 Client ID**
   - Choose **Web application**
   - Add authorized redirect URIs:
     - `http://localhost:3001/api/auth/callback/google`
     - `http://localhost:3001` (for development)
   - Copy **Client ID** and **Client Secret**

### 2. Create `.env.local`

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=your-super-secret-nextauth-secret-key-change-in-production

GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

**Generate NEXTAUTH_SECRET:**
```bash
openssl rand -base64 32
```

---

## Running the Frontend

### Install Dependencies

```bash
cd frontend
npm install
```

### Start Development Server

```bash
npm run dev
```

Server runs on **http://localhost:3001**

**Expected output:**
```
  ▲ Next.js 14.0.0
  - Local:        http://localhost:3001
  - Environments: .env.local

 ✓ Ready in 1.2s
```

### Access the App

1. Visit http://localhost:3001
2. Click **"Sign in with Google"**
3. Complete Google OAuth flow
4. Redirected to dashboard

---

## UI Components

### Header
```
[📧 ReachInbox] [User Name] [Avatar] [Logout]
```

- Shows logged-in user info
- Google avatar (from OAuth)
- Logout button

### Dashboard Tabs

```
Scheduled (5)  |  Sent & Failed (12)
```

- Tab switching
- Email count badges
- Auto-refresh every 5s

### Email Tables

**Scheduled Tab:**
- From, To, Subject, Status (yellow "Scheduled" badge), Scheduled At

**Sent Tab:**
- From, To, Subject, Status (green "Sent" or red "Failed" badge), Sent At

**States:**
- Loading: spinner + "Loading..." message
- Empty: emoji + "No {type} emails yet"
- Data: scrollable table with hover effects

### Compose Modal

**Fields:**
- From (sender email)
- Subject
- Body (HTML supported)
- Recipients (CSV or line-break separated)
- Date picker
- Time picker
- Delay between sends (ms)

**Features:**
- Recipient count detection
- Form validation
- Async scheduling with progress
- Success message
- Error handling with toasts

---

## API Integration

### Endpoints Called

```
POST   /api/emails                    → Schedule email(s)
GET    /api/emails?status=scheduled   → Get scheduled emails
GET    /api/emails/sent               → Get sent/failed emails
GET    /api/rate-limit/:sender        → Check rate limit status
```

All calls include error handling and typed responses.

---

## Functional Requirements Met

✅ **Real Google OAuth** — NextAuth.js with Google provider  
✅ **User info display** — Name, email, avatar from OAuth  
✅ **Logout** — NextAuth signOut()  
✅ **Compose form** — Subject, body, recipients, schedule time  
✅ **Email detection** — CSV parsing, email validation  
✅ **Tables** — Scheduled and Sent with proper columns  
✅ **Loading states** — Spinner during data fetch  
✅ **Empty states** — "No emails" message  
✅ **Auto-refresh** — Every 5 seconds  
✅ **Error handling** — Toast-like error display  
✅ **Typed API responses** — Full TypeScript types  
✅ **Rate limit info** — Displayed in schedule response  

---

## Project Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── api/auth/[...nextauth]/route.ts  (OAuth handler)
│   │   ├── auth/
│   │   │   └── signin/
│   │   │       └── page.tsx                 (Login page)
│   │   ├── layout.tsx                       (Root layout)
│   │   └── page.tsx                         (Dashboard)
│   ├── components/
│   │   ├── Header.tsx                       (User info + logout)
│   │   ├── ComposeModal.tsx                 (Email scheduler)
│   │   └── EmailTable.tsx                   (Email list)
│   ├── lib/
│   │   └── api.ts                           (API client + types)
│   └── styles/
│       └── globals.css                      (Tailwind + custom)
├── .env.example
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
└── postcss.config.js
```

---

## Key Files

### `src/app/api/auth/[...nextauth]/route.ts`

NextAuth configuration:
```typescript
GoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
})
```

Routes all OAuth requests through this handler.

### `src/lib/api.ts`

Typed API client:
```typescript
export async function scheduleEmail(data: ScheduleEmailRequest): Promise<ScheduleEmailResponse>
export async function getScheduledEmails(): Promise<Email[]>
export async function getSentEmails(): Promise<Email[]>
```

All calls go through Axios with base URL from `NEXT_PUBLIC_API_URL`.

### `src/components/ComposeModal.tsx`

Email scheduling form:
- Parses recipients (CSV, comma, or line-break separated)
- Validates email addresses
- Displays detected email count in real-time
- Sends to backend with scheduled timestamp
- Shows success count

### `src/app/page.tsx`

Main dashboard:
- Requires authentication (redirects to `/auth/signin` if not logged in)
- Fetches and displays emails
- Auto-refresh every 5 seconds
- Tab switching between Scheduled/Sent

---

## Visual Design

**Color Scheme:**
- Primary: Blue (#3B82F6)
- Success: Green (#10B981)
- Error: Red (#EF4444)
- Warning: Yellow (#F59E0B)

**Typography:**
- Headings: Bold, larger font
- Body: Regular weight
- Labels: Small, medium font

**Spacing:**
- Cards: 1.5rem padding (24px)
- Form inputs: Standard padding, border-gray-300
- Tables: Alternating row hover (light gray background)

**Responsive:**
- Mobile-friendly padding/margins
- Table scrolls horizontally on small screens
- Modal full-width on mobile

---

## Authentication Flow

```
User visits http://localhost:3001
  ↓
Check NextAuth session
  ↓
Session exists?
  ┌─→ YES: Show dashboard (page.tsx)
  │
  └─→ NO: Redirect to /auth/signin
           ↓
          Google OAuth sign-in page
           ↓
          Grant permission
           ↓
          Redirect to /api/auth/callback/google
           ↓
          NextAuth creates session
           ↓
          Redirect to dashboard
```

**Key points:**
- Session stored in encrypted cookie
- User object includes: name, email, image
- Logout clears session

---

## Sending Emails from Frontend

**Flow:**
```
User clicks "Compose Email"
  ↓
Modal opens (ComposeModal.tsx)
  ↓
User fills form:
  - From: test@example.com
  - Subject: Hello
  - Body: Welcome email
  - Recipients: john@example.com, jane@example.com
  - Scheduled: 2026-09-09 21:30
  ↓
User clicks "Schedule 2 Email(s)"
  ↓
For each recipient:
  POST /api/emails with:
  {
    "sender": "test@example.com",
    "recipient": "john@example.com",
    "subject": "Hello",
    "body": "Welcome email",
    "scheduledAt": 1725962400000
  }
  ↓
Backend enqueues job in BullMQ
  ↓
Success response with rateLimit status:
  {
    "hourKey": "rate-limit:test@example.com:2026-09-09-21",
    "currentCount": 1,
    "limit": 50,
    "remaining": 49,
    "percentUsed": 2,
    "resetAt": "2026-09-09T22:00:00.000Z"
  }
  ↓
Success toast: "✅ 2 email(s) scheduled successfully!"
  ↓
Modal closes
  ↓
Dashboard auto-refreshes (fetches scheduled emails from backend)
  ↓
New emails appear in "Scheduled" tab
```

---

## Error Handling

**Validation errors** (form-level):
- Missing required field → "Please fill in all required fields"
- No valid emails → "No valid email addresses found"
- Past date → "Scheduled time must be in the future"
- Duplicate senders/recipients → Allowed (individual emails)

**Network errors** (API-level):
- Failed to connect → "Failed to schedule emails"
- Backend error → Displays backend error message
- Partial success → Shows count of successful emails

**UI feedback:**
- Error message in red box
- Success message in green box
- Loading state on button during request
- Disabled submit button when no recipients

---

## Customization & Theming

To change colors, edit `tailwind.config.ts`:

```typescript
theme: {
  extend: {
    colors: {
      primary: '#3B82F6',      // Change to your brand color
      secondary: '#6B7280',
      success: '#10B981',
      error: '#EF4444',
    },
  },
}
```

Or update CSS classes in `globals.css` (under `@layer components`).

---

## Troubleshooting

### "Google Sign-In Not Working"

**Check:**
1. Google OAuth credentials are correct in `.env.local`
2. Redirect URI matches Google Cloud Console config
3. NEXTAUTH_URL and NEXTAUTH_SECRET are set
4. Browser cookies enabled (NextAuth uses cookies)

### "Cannot connect to backend API"

**Check:**
1. Backend is running on port 3000
2. `NEXT_PUBLIC_API_URL=http://localhost:3000` in `.env.local`
3. CORS is enabled on backend
4. Network tab shows 200 responses (not 404/500)

### "Emails not appearing in table"

**Check:**
1. Backend API endpoints are working (`/api/emails`, `/api/emails/sent`)
2. Auto-refresh is working (check browser console for fetch calls)
3. Click "Refresh" button manually
4. Check backend logs for errors

---

## Testing the Frontend

### 1. Sign in with Google

- Click "Sign in with Google"
- Complete OAuth flow
- Should see dashboard with tabs

### 2. Compose an email

- Click "Compose Email"
- Fill form with test data:
  ```
  From: test@example.com
  Subject: Frontend Test
  Body: This is a frontend test
  Recipients: user1@example.com, user2@example.com
  Date: Today
  Time: Now + 5 minutes
  ```
- Click "Schedule 2 Email(s)"
- Should see success message
- Check "Scheduled" tab — emails should appear

### 3. Check rate limit

- In compose response or rate-limit API call
- Verify current count, limit, remaining, reset time

### 4. Logout & login

- Click logout
- Should redirect to sign-in page
- Click sign in again
- Should go back to dashboard

---

## Next: STEP 6 (Elasticsearch or Full-Text Search)

After verifying frontend works, we'll add search:
1. Single Elasticsearch container, OR
2. Postgres full-text search (documented trade-off)
3. Search endpoint: `/api/emails/search?q=term`

---

## Files Created (STEP 5)

- `frontend/src/app/page.tsx` — Dashboard
- `frontend/src/app/layout.tsx` — Root layout
- `frontend/src/app/auth/signin/page.tsx` — Sign-in page
- `frontend/src/app/api/auth/[...nextauth]/route.ts` — OAuth handler
- `frontend/src/components/Header.tsx` — User header
- `frontend/src/components/ComposeModal.tsx` — Email composer
- `frontend/src/components/EmailTable.tsx` — Email list table
- `frontend/src/lib/api.ts` — Typed API client
- `frontend/src/styles/globals.css` — Tailwind setup
- Config files: `tsconfig.json`, `next.config.js`, `tailwind.config.ts`, `postcss.config.js`

---

**STEP 5 READY FOR TESTING**
