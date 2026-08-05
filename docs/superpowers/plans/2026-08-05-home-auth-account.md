# Home Authentication and Account Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real email authentication, persistent sessions, protected product routes, and backend-supported account settings to the existing Windup homepage.

**Architecture:** `entities/user` owns the exact backend contract; `features/auth-session` owns session state and token lifecycle; `pages/home` owns account UI; `app` performs composition and route protection. Refresh Token persists in localStorage while Access Token remains in memory and is exposed through the existing shared API token-provider boundary.

**Tech Stack:** React 19, React Router 8, TypeScript 6, Vite 8, Tailwind CSS 4, Vitest, Testing Library.

## Global Constraints

- Implement only endpoints and fields present in `feat/user-module`.
- Do not add OAuth, avatar, nickname editing, email editing, account deletion, `application`, or `capabilities`.
- Keep the homepage public and protect all production product routes.
- Persist only Refresh Token under `windup.auth.refresh-token`; keep Access Token in memory.
- Preserve the existing homepage editorial grey-green visual language.

---

### Task 1: User entity and real authentication adapter

**Files:**
- Create: `frontend/src/entities/user/index.ts`
- Create: `frontend/src/entities/user/api.ts`
- Create: `frontend/src/entities/user/api.test.ts`
- Modify: `frontend/src/entities/index.ts`

**Interfaces:**
- Consumes: `ApiClient` and `createApiClient` from `@/shared/api`.
- Produces: `User`, `AuthTokens`, `UserApis`, and `createUserApis(options?)`.

- [ ] **Step 1: Write failing adapter tests**

Cover literal request paths and bodies for `sendCode`, `register`, `login`, `loginByCode`, `refresh`, `logout`, `me`, and `changePassword`. Assert snake_case responses become camelCase:

```ts
expect(await apis.login({ email: 'a@b.com', password: 'password1', code: '123456' })).toEqual({
  accessToken: 'access',
  refreshToken: 'refresh',
  user: { id: 7, email: 'a@b.com', nickname: null, emailVerifiedAt: null, status: 'normal' },
})
```

- [ ] **Step 2: Run the entity test and verify RED**

Run: `npm test -- --run src/entities/user/api.test.ts`

Expected: FAIL because `createUserApis` does not exist.

- [ ] **Step 3: Implement the exact backend contract**

Use these public signatures:

```ts
interface UserApis {
  sendCode(input: { email: string; purpose: 'login' | 'register' | 'reset_password' }): Promise<void>
  register(input: { email: string; password: string; code: string; nickname?: string }): Promise<AuthTokens>
  login(input: { email: string; password: string; code: string }): Promise<AuthTokens>
  loginByCode(input: { email: string; code: string }): Promise<AuthTokens>
  refresh(refreshToken: string): Promise<AuthTokens>
  logout(refreshToken: string): Promise<void>
  me(): Promise<User>
  changePassword(input: { oldPassword: string; newPassword: string }): Promise<void>
}
```

- [ ] **Step 4: Run the entity tests and verify GREEN**

Run: `npm test -- --run src/entities/user/api.test.ts`

Expected: PASS.

### Task 2: Persistent authentication session

**Files:**
- Create: `frontend/src/features/auth-session/session-storage.ts`
- Create: `frontend/src/features/auth-session/session-storage.test.ts`
- Create: `frontend/src/features/auth-session/index.tsx`
- Create: `frontend/src/features/auth-session/index.test.tsx`

**Interfaces:**
- Consumes: `UserApis`, `AuthTokens`, `registerApiAccessTokenProvider`.
- Produces: `AuthSessionProvider`, `useAuthSession`, `ProtectedRoute`.

- [ ] **Step 1: Write failing storage and provider tests**

Test that only Refresh Token enters localStorage, bootstrap refreshes and fetches `/auth/me`, login stores the rotated Refresh Token, logout clears local state even when the backend rejects, and guests are redirected with a safe `returnTo`.

- [ ] **Step 2: Run the session tests and verify RED**

Run: `npm test -- --run src/features/auth-session/session-storage.test.ts src/features/auth-session/index.test.tsx`

Expected: FAIL because the session module does not exist.

- [ ] **Step 3: Implement session state and route protection**

Use this state contract:

```ts
type AuthSessionState =
  | { status: 'booting'; user: null }
  | { status: 'guest'; user: null }
  | { status: 'authenticated'; user: User }
```

Register a token getter during Provider lifetime. Decode only the JWT `exp` payload to schedule refresh 60 seconds early; token signature validation remains a backend responsibility. Reject `returnTo` values that do not start with `/` or start with `//`.

- [ ] **Step 4: Run the session tests and verify GREEN**

Run: `npm test -- --run src/features/auth-session/session-storage.test.ts src/features/auth-session/index.test.tsx`

Expected: PASS.

### Task 3: Homepage account interface

**Files:**
- Create: `frontend/src/pages/home/account-panel.tsx`
- Create: `frontend/src/pages/home/account-panel.test.tsx`
- Modify: `frontend/src/pages/home/index.tsx`
- Modify: `frontend/src/pages/home/index.test.tsx`

**Interfaces:**
- Consumes: `useAuthSession` methods and URL query parameters.
- Produces: login, register, read-only profile, password change, and logout UI.

- [ ] **Step 1: Write failing interaction tests**

Cover opening the account panel, sending a code with the correct purpose, code login, password login with code, registration, readonly profile fields, password change, logout, and the absence of nickname/email/avatar editing controls.

- [ ] **Step 2: Run homepage tests and verify RED**

Run: `npm test -- --run src/pages/home/account-panel.test.tsx src/pages/home/index.test.tsx`

Expected: FAIL because the account panel is missing.

- [ ] **Step 3: Implement the homepage UI**

Use a fixed backdrop and responsive panel aligned to the existing grey-green palette. Keep labels explicit, use native form controls, expose request errors with `role="alert"`, and keep submit buttons disabled during requests. Implement a 60-second send-code countdown without adding a timer dependency.

- [ ] **Step 4: Run homepage tests and verify GREEN**

Run: `npm test -- --run src/pages/home/account-panel.test.tsx src/pages/home/index.test.tsx`

Expected: PASS.

### Task 4: App composition, account entry, and protected routes

**Files:**
- Modify: `frontend/src/app/app.tsx`
- Modify: `frontend/src/app/app.test.tsx`
- Modify: `frontend/src/app/layout/app-header.tsx`
- Modify: `frontend/src/app/layout/app-header.test.tsx`

**Interfaces:**
- Consumes: `createUserApis`, `AuthSessionProvider`, `ProtectedRoute`.
- Produces: one shared User API instance, public homepage, and protected product routes.

- [ ] **Step 1: Write failing route and header tests**

Assert that a guest can render `/`, a guest entering `/quick-start` reaches `/?account=login&returnTo=%2Fquick-start`, and the header account entry displays “登录 / 注册” or the authenticated nickname.

- [ ] **Step 2: Run app tests and verify RED**

Run: `npm test -- --run src/app/app.test.tsx src/app/layout/app-header.test.tsx`

Expected: FAIL because authentication is not composed.

- [ ] **Step 3: Compose auth once and protect routes**

Create `userApis` in the App composition root. Wrap `AppShell` and `Routes` in `AuthSessionProvider`. Keep `/` public and wrap every production product route (including quick start, projects, characters, asset library, history, workflow editor, and formal Playtest) in `ProtectedRoute`; keep the development Demo route public.

- [ ] **Step 4: Run app tests and verify GREEN**

Run: `npm test -- --run src/app/app.test.tsx src/app/layout/app-header.test.tsx`

Expected: PASS.

### Task 5: Full verification

**Files:**
- Modify only files required by failures in the authentication scope.

**Interfaces:**
- Consumes: all tasks above.
- Produces: verified frontend authentication delivery.

- [ ] **Step 1: Run full automated verification**

Run:

```powershell
npm test
npm run format:check
npm run lint
npm run typecheck
npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Inspect the final diff**

Run: `git diff --check -- frontend/src/entities/user frontend/src/features/auth-session frontend/src/pages/home frontend/src/app`

Expected: no whitespace errors and no backend file changes.
