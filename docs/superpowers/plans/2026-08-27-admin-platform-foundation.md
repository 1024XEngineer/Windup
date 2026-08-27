# Windup Admin Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可独立构建和验证的 Windup 管理平台基础，包括独立管理员身份、RBAC、审计、Admin API 与 Admin SPA 登录/概览页。

**Architecture:** FastAPI 继续作为唯一后端进程，但 `/admin-api/*` 绕过普通用户 JWT 中间件并进入独立管理员认证依赖。管理员访问令牌和刷新令牌只通过 `admin.windup.xin` 同源的 HttpOnly Cookie 传输，刷新令牌摘要持久化到数据库；React 管理端使用独立 Vite 入口和独立会话上下文，不引用普通用户会话。既有兑换码、敏感词、积分和 Gateway 在本阶段不重写，后续只通过受保护的管理适配层迁移。

**Tech Stack:** Python 3.12、FastAPI、Pydantic 2、SQLAlchemy 2、PostgreSQL/SQLite tests、Redis（后续会话撤销广播）、React 19、React Router 8、TypeScript 6、Vite 8、Tailwind CSS 4、Vitest 4、pytest 8。

**Spec:** `docs/superpowers/specs/2026-08-27-admin-platform-design.md`

## Global Constraints

- 管理员账号、Cookie、JWT 与普通 Windup 用户完全隔离。
- 普通用户 `Authorization: Bearer ...` 不能获得任何 `/admin-api/*` 权限。
- 不开放管理员注册；首个管理员只通过本地 CLI 创建。
- 管理端不把访问令牌、刷新令牌、密码或兑换码明文写入 localStorage/sessionStorage。
- 本阶段只新增管理员认证、RBAC、审计与 Admin SPA；不复制兑换码、敏感词、用户积分或 Gateway 领域实现。
- 数据库新增具名强类型表，不建立万能 JSON/KV 配置表。
- API 写操作使用 CSRF 双提交校验；Cookie 使用 `Secure`、`HttpOnly`、`SameSite=Strict`。
- 所有代码按 TDD 顺序完成，每个任务独立提交。
- 本阶段不修改生产 DNS、Nginx 或服务器。

---

## File Structure

### Backend

- `backend/packages/framework/src/windup_framework/config/admin_auth.py`：管理员 JWT、Cookie 和会话时长引导配置。
- `backend/packages/app/src/windup_app/server/admin/permissions.py`：稳定的权限码常量与内置权限集合。
- `backend/packages/app/src/windup_app/server/admin/model.py`：管理员、角色、权限、关联表与刷新令牌 ORM。
- `backend/packages/app/src/windup_app/server/admin/audit.py`：审计 ORM 与脱敏写入服务。
- `backend/packages/app/src/windup_app/server/admin/service.py`：密码验证、访问令牌、刷新令牌轮换、管理员视图与角色解析。
- `backend/packages/app/src/windup_app/web/admin/dependencies.py`：Cookie 鉴权、CSRF 与权限依赖。
- `backend/packages/app/src/windup_app/web/admin/auth.py`：登录、刷新、登出、当前管理员 API。
- `backend/packages/app/src/windup_app/web/admin/router.py`：唯一 `/admin-api` 装配入口，显式区分公开与受保护路由。
- `backend/scripts/create_admin_user.py`：交互式创建首个管理员和内置超级管理员角色。

### Frontend

- `frontend/admin.html`：独立管理端 HTML 入口。
- `frontend/vite.admin.config.ts`：管理端独立构建配置，输出到 `dist-admin`。
- `frontend/src/admin/api.ts`：只使用 Cookie 的 Admin API 客户端和 CSRF 头。
- `frontend/src/admin/session.tsx`：独立管理员会话状态，不接入普通用户 token provider。
- `frontend/src/admin/login-page.tsx`：管理员邮箱密码登录页。
- `frontend/src/admin/dashboard-page.tsx`：权限摘要和后续模块入口占位卡片。
- `frontend/src/admin/app.tsx`：管理端路由守卫和外壳。
- `frontend/src/admin/main.tsx`：Admin React 根入口。

---

### Task 1: 管理员配置、RBAC 与持久化模型

**Files:**
- Create: `backend/packages/framework/src/windup_framework/config/admin_auth.py`
- Create: `backend/packages/app/src/windup_app/server/admin/__init__.py`
- Create: `backend/packages/app/src/windup_app/server/admin/permissions.py`
- Create: `backend/packages/app/src/windup_app/server/admin/model.py`
- Create: `backend/packages/app/src/windup_app/server/admin/audit.py`
- Modify: `backend/packages/app/src/windup_app/bootstrap/app.py`
- Modify: `backend/tests/conftest.py`
- Test: `backend/tests/test_admin_models.py`
- Test: `backend/tests/test_validate_settings.py`

**Interfaces:**
- Produces: `AdminUser`, `AdminRole`, `AdminPermission`, `AdminRefreshToken`, `AdminAuditLog` ORM models.
- Produces: `ALL_ADMIN_PERMISSIONS: frozenset[str]` and permission constants.
- Produces: `AdminAuthSettings` with `secret`, access/refresh TTL and cookie security settings.
- Consumes: existing `windup_framework.db.Base`, bcrypt dependency already used by normal user auth.

- [ ] **Step 1: Write failing model and configuration tests**

```python
def test_admin_identity_is_not_windup_user(db_session):
    admin = AdminUser(email="owner@example.com", password_hash="$2b$...")
    role = AdminRole(code="super_admin", name="超级管理员")
    permission = AdminPermission(code="audit.read", name="查看审计")
    role.permissions.append(permission)
    admin.roles.append(role)
    db_session.add(admin)
    db_session.flush()
    assert admin.id is not None
    assert {item.code for item in admin.roles[0].permissions} == {"audit.read"}


def test_admin_secret_rejects_short_values(monkeypatch):
    monkeypatch.setenv("ADMIN_JWT_SECRET", "short")
    with pytest.raises(ValidationError):
        AdminAuthSettings(_env_file=None)
```

- [ ] **Step 2: Run focused tests and verify missing modules fail**

Run: `cd backend && uv run pytest tests/test_admin_models.py tests/test_validate_settings.py -q`

Expected: collection fails because `windup_app.server.admin` and `AdminAuthSettings` do not exist.

- [ ] **Step 3: Implement strict settings and ORM schema**

Use these exact settings defaults:

```python
class AdminAuthSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ADMIN_", env_file=("../.env", ".env"))
    jwt_secret: SecretStr
    access_token_ttl_seconds: int = 15 * 60
    refresh_token_ttl_seconds: int = 7 * 24 * 3600
    cookie_secure: bool = True
    cookie_domain: str = ""
```

Define `AdminStatus.ACTIVE = 0` and `AdminStatus.DISABLED = 1`. Use explicit association ORM classes or tables for `windup_admin_user_role` and `windup_admin_role_permission`, unique constraints on email/role code/permission code/refresh hash, and timezone-aware timestamps. `AdminRefreshToken` stores only `token_hash`, `expires_at`, `revoked_at`, `replaced_by_id`, `created_ip` and timestamps.

Audit rows use typed columns:

```python
class AdminAuditLog(Base):
    __tablename__ = "windup_admin_audit_log"
    admin_user_id: Mapped[int | None]
    actor_email: Mapped[str]
    action: Mapped[str]
    resource_type: Mapped[str]
    resource_id: Mapped[str | None]
    result: Mapped[str]
    reason: Mapped[str | None]
    request_id: Mapped[str | None]
    ip_address: Mapped[str | None]
    user_agent: Mapped[str | None]
    create_at: Mapped[datetime]
```

- [ ] **Step 4: Register tables in application startup and test fixtures**

Import admin models in `bootstrap/app.py` before `Base.metadata.create_all(engine)`. Add all new tables to the SQLite fixture list in dependency order so focused tests do not create unrelated tables.

- [ ] **Step 5: Run tests and verify schema passes**

Run: `cd backend && uv run pytest tests/test_admin_models.py tests/test_validate_settings.py -q`

Expected: all new tests pass; existing JWT and database setting tests remain green.

- [ ] **Step 6: Commit task**

```bash
git add backend/packages/framework/src/windup_framework/config/admin_auth.py backend/packages/app/src/windup_app/server/admin backend/packages/app/src/windup_app/bootstrap/app.py backend/tests/conftest.py backend/tests/test_admin_models.py backend/tests/test_validate_settings.py
git commit -m "feat(admin): 建立独立管理员与权限模型"
```

### Task 2: 独立管理员认证、令牌轮换与权限服务

**Files:**
- Create: `backend/packages/app/src/windup_app/server/admin/service.py`
- Test: `backend/tests/test_admin_auth_service.py`

**Interfaces:**
- Consumes: Task 1 `AdminUser`, `AdminRole`, `AdminPermission`, `AdminRefreshToken`, `AdminAuditLog`.
- Produces: `AdminView(id: int, email: str, permissions: frozenset[str])`.
- Produces: `AdminSession(admin: AdminView, access_token: str, refresh_token: str, csrf_token: str)`.
- Produces: `service.authenticate`, `service.refresh`, `service.logout`, `service.decode_access_token`, `service.require_permissions`.

- [ ] **Step 1: Write failing service tests**

```python
def test_login_returns_admin_session_with_permissions(db_session):
    admin = seed_admin(db_session, permissions={"audit.read"})
    result = service.authenticate(db_session, admin.email, "correct-password", ip="127.0.0.1")
    assert result.admin.id == admin.id
    assert result.admin.permissions == frozenset({"audit.read"})
    assert db_session.scalar(select(AdminRefreshToken)).token_hash != result.refresh_token


def test_refresh_rotates_and_revokes_old_token(db_session):
    session = login_admin(db_session)
    rotated = service.refresh(db_session, session.refresh_token, ip="127.0.0.1")
    assert rotated.refresh_token != session.refresh_token
    with pytest.raises(BizException, match="refresh token 无效"):
        service.refresh(db_session, session.refresh_token, ip="127.0.0.1")


def test_normal_user_access_token_is_not_admin_token():
    token = create_access_token(1, "user@example.com")
    with pytest.raises(BizException):
        service.decode_access_token(token)
```

- [ ] **Step 2: Run focused tests and verify service is missing**

Run: `cd backend && uv run pytest tests/test_admin_auth_service.py -q`

Expected: FAIL because `windup_app.server.admin.service` does not exist.

- [ ] **Step 3: Implement password and access-token behavior**

Use bcrypt exactly as the current user service does. Admin JWT payload is isolated by secret, type, issuer and audience:

```python
payload = {
    "sub": str(admin.id),
    "email": admin.email,
    "type": "admin_access",
    "iss": "windup",
    "aud": "windup-admin",
    "iat": now,
    "exp": now + timedelta(seconds=settings.access_token_ttl_seconds),
}
```

Decode with `audience="windup-admin"`, `issuer="windup"` and the dedicated `ADMIN_JWT_SECRET`. Do not accept the normal `JWT_SECRET` or normal token type.

- [ ] **Step 4: Implement opaque refresh-token rotation**

Generate refresh and CSRF values with `secrets.token_urlsafe(48)`. Persist only `sha256(refresh_token)`. Rotation locks the existing row with `SELECT ... FOR UPDATE`, rejects expired/revoked rows, revokes it, creates a replacement and records `replaced_by_id`. Logout revokes the matching active row and is idempotent.

- [ ] **Step 5: Implement permission resolution**

Resolve permissions from active roles and their permission relations in the same session. `require_permissions(admin, required)` raises `BizException("没有管理员权限", code=403)` when any required code is missing.

- [ ] **Step 6: Run service tests**

Run: `cd backend && uv run pytest tests/test_admin_auth_service.py -q`

Expected: login, wrong-password, disabled-admin, token isolation, refresh rotation, expiry, logout and permission tests all pass.

- [ ] **Step 7: Commit task**

```bash
git add backend/packages/app/src/windup_app/server/admin/service.py backend/tests/test_admin_auth_service.py
git commit -m "feat(admin): 实现独立管理员会话"
```

### Task 3: Admin API、Cookie/CSRF 边界与审计

**Files:**
- Create: `backend/packages/app/src/windup_app/web/admin/__init__.py`
- Create: `backend/packages/app/src/windup_app/web/admin/dependencies.py`
- Create: `backend/packages/app/src/windup_app/web/admin/auth.py`
- Create: `backend/packages/app/src/windup_app/web/admin/router.py`
- Modify: `backend/packages/app/src/windup_app/web/middleware/auth.py`
- Modify: `backend/packages/app/src/windup_app/bootstrap/app.py`
- Test: `backend/tests/test_admin_auth_api.py`

**Interfaces:**
- Consumes: Task 2 admin service and `AdminView`.
- Produces: `POST /admin-api/auth/login`, `POST /admin-api/auth/refresh`, `POST /admin-api/auth/logout`, `GET /admin-api/auth/me`.
- Produces: `require_admin_user`, `require_admin_csrf`, `require_admin_permissions(*codes)` FastAPI dependencies.

- [ ] **Step 1: Write failing API security tests**

```python
def test_normal_user_bearer_cannot_access_admin_me(auth_client):
    response = auth_client.get("/admin-api/auth/me")
    assert response.json()["code"] == 401


def test_admin_login_sets_only_http_only_session_cookies(client, seeded_admin):
    response = client.post("/admin-api/auth/login", json={
        "email": seeded_admin.email,
        "password": "correct-password",
    })
    assert response.json()["data"]["admin"]["email"] == seeded_admin.email
    assert "windup_admin_access" in response.cookies
    assert "windup_admin_refresh" in response.cookies
    assert "access_token" not in response.json()["data"]


def test_admin_logout_rejects_missing_csrf(admin_client):
    response = admin_client.post("/admin-api/auth/logout", headers={"X-CSRF-Token": "wrong"})
    assert response.json()["code"] == 403
```

- [ ] **Step 2: Run focused API tests and verify routes fail**

Run: `cd backend && uv run pytest tests/test_admin_auth_api.py -q`

Expected: FAIL with 404 or ordinary-auth 401 because the Admin router is absent.

- [ ] **Step 3: Isolate `/admin-api/*` from ordinary AuthMiddleware**

Add a single explicit bypass before ordinary bearer parsing:

```python
if request.url.path.startswith("/admin-api/"):
    return await call_next(request)
```

This bypass does not authorize requests. `web/admin/router.py` is the only mounting point: it includes only login/refresh as public routes; every other nested router has `Depends(require_admin_user)` at router level.

- [ ] **Step 4: Implement Cookie and CSRF dependencies**

Use exact Cookie names:

```python
ADMIN_ACCESS_COOKIE = "windup_admin_access"
ADMIN_REFRESH_COOKIE = "windup_admin_refresh"
ADMIN_CSRF_COOKIE = "windup_admin_csrf"
```

Access and refresh Cookies are HttpOnly. CSRF Cookie is readable by JavaScript and must equal `X-CSRF-Token` using `secrets.compare_digest`. All use `SameSite="strict"`; `Secure` and optional Domain come from `AdminAuthSettings`. Access Cookie path is `/admin-api`, refresh Cookie path is `/admin-api/auth`, and CSRF Cookie path is `/admin-api`.

- [ ] **Step 5: Implement auth endpoints and audit writes**

Return only:

```python
class AdminSessionOut(BaseModel):
    admin: AdminOut

class AdminOut(BaseModel):
    id: int
    email: str
    permissions: list[str]
```

Login sets all three Cookies and records `auth.login` success. Refresh rotates both access and refresh Cookies and the CSRF value. Logout requires CSRF, revokes refresh, clears Cookies and records `auth.logout`. `me` reads the access Cookie and returns current permissions. Audit payloads include request ID, IP and User-Agent but never password, token or Cookie values.

- [ ] **Step 6: Run Admin API and ordinary auth regressions**

Run: `cd backend && uv run pytest tests/test_admin_auth_api.py tests/test_auth_middleware.py tests/test_auth_api.py -q`

Expected: all tests pass; ordinary user authentication behavior is unchanged.

- [ ] **Step 7: Commit task**

```bash
git add backend/packages/app/src/windup_app/web/admin backend/packages/app/src/windup_app/web/middleware/auth.py backend/packages/app/src/windup_app/bootstrap/app.py backend/tests/test_admin_auth_api.py
git commit -m "feat(admin): 暴露独立认证接口"
```

### Task 4: 首个管理员创建 CLI

**Files:**
- Create: `backend/scripts/create_admin_user.py`
- Test: `backend/tests/test_create_admin_user.py`
- Modify: `.env.example`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/scripts/export_openapi.py`
- Modify: `backend/scripts/schema_sync.py`

**Interfaces:**
- Consumes: Task 1 permission constants and models; Task 2 password hashing helper.
- Produces: `create_admin(session, *, email, password) -> AdminUser`.
- Produces CLI: `cd backend && uv run python scripts/create_admin_user.py --email admin@example.com`.

- [ ] **Step 1: Write failing bootstrap tests**

```python
def test_create_admin_builds_super_admin_with_all_permissions(db_session):
    admin = create_admin(db_session, email="owner@example.com", password="strong-password")
    assert {permission.code for role in admin.roles for permission in role.permissions} == set(
        ALL_ADMIN_PERMISSIONS
    )


def test_create_admin_rejects_existing_email(db_session):
    create_admin(db_session, email="owner@example.com", password="strong-password")
    with pytest.raises(BizException, match="管理员已存在"):
        create_admin(db_session, email="owner@example.com", password="another-password")
```

- [ ] **Step 2: Run focused tests and verify script is missing**

Run: `cd backend && uv run pytest tests/test_create_admin_user.py -q`

Expected: FAIL because `scripts.create_admin_user` does not exist.

- [ ] **Step 3: Implement idempotent role/permission seeding and safe password input**

The CLI accepts only `--email`; password is read twice with `getpass.getpass` and must be 12–128 characters. `create_admin` inserts missing built-in permissions and the `super_admin` role, attaches every permission, creates the admin and commits once. Existing administrator email returns a clear error and does not reset credentials.

- [ ] **Step 4: Add bootstrap configuration documentation**

Add these keys to `.env.example` without real values:

```dotenv
ADMIN_JWT_SECRET=
ADMIN_ACCESS_TOKEN_TTL_SECONDS=900
ADMIN_REFRESH_TOKEN_TTL_SECONDS=604800
ADMIN_COOKIE_SECURE=true
ADMIN_COOKIE_DOMAIN=admin.windup.xin
```

Set test-only `ADMIN_JWT_SECRET` values in `conftest.py`, `export_openapi.py` and `schema_sync.py` before settings imports. Remove no existing `WINDUP_ADMIN_EMAILS` behavior yet; its removal belongs to the later redemption migration PR.

- [ ] **Step 5: Run CLI and settings tests**

Run: `cd backend && uv run pytest tests/test_create_admin_user.py tests/test_validate_settings.py tests/test_env_example_keys_are_live.py -q`

Expected: all tests pass, no password or secret appears in captured output.

- [ ] **Step 6: Commit task**

```bash
git add backend/scripts/create_admin_user.py backend/tests/test_create_admin_user.py .env.example backend/tests/conftest.py backend/scripts/export_openapi.py backend/scripts/schema_sync.py
git commit -m "feat(admin): 增加首个管理员创建命令"
```

### Task 5: 独立 Admin SPA 登录与概览

**Files:**
- Create: `frontend/admin.html`
- Create: `frontend/vite.admin.config.ts`
- Create: `frontend/src/admin/api.ts`
- Create: `frontend/src/admin/api.test.ts`
- Create: `frontend/src/admin/session.tsx`
- Create: `frontend/src/admin/session.test.tsx`
- Create: `frontend/src/admin/login-page.tsx`
- Create: `frontend/src/admin/dashboard-page.tsx`
- Create: `frontend/src/admin/app.tsx`
- Create: `frontend/src/admin/app.test.tsx`
- Create: `frontend/src/admin/main.tsx`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: Task 3 `/admin-api/auth/*` Cookie endpoints.
- Produces: `AdminApi`, `AdminSessionProvider`, `useAdminSession`, `AdminApp`.
- Produces scripts: `npm run dev:admin`, `npm run build:admin`.

- [ ] **Step 1: Write failing API and session tests**

```tsx
it('never writes admin tokens to browser storage', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  await api.login({ email: 'owner@example.com', password: 'strong-password' })
  expect(setItem).not.toHaveBeenCalled()
})


it('shows login for a guest and dashboard after login', async () => {
  render(<AdminSessionProvider api={fakeApi}><AdminApp /></AdminSessionProvider>)
  expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('管理员邮箱'), {
    target: { value: 'owner@example.com' },
  })
  fireEvent.change(screen.getByLabelText('密码'), {
    target: { value: 'strong-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: '登录管理平台' }))
  expect(await screen.findByRole('heading', { name: '管理概览' })).toBeTruthy()
})
```

- [ ] **Step 2: Run focused frontend tests and verify modules fail**

Run: `cd frontend && npm test -- src/admin/api.test.ts src/admin/session.test.tsx src/admin/app.test.tsx`

Expected: FAIL because `src/admin` does not exist.

- [ ] **Step 3: Implement Cookie-only Admin API client**

Use `VITE_ADMIN_API_BASE_URL` with default `/admin-api`, `credentials: "include"`, `recoverUnauthorized: false`. Read only the `windup_admin_csrf` Cookie and attach `X-CSRF-Token` to refresh/logout. On `me` business code 401, call refresh once and retry `me`; never register with `registerApiAccessTokenProvider`.

```ts
export interface AdminApi {
  me(): Promise<AdminIdentity>
  login(input: { email: string; password: string }): Promise<AdminIdentity>
  refresh(): Promise<AdminIdentity>
  logout(): Promise<void>
}
```

- [ ] **Step 4: Implement session state and guarded routes**

Use states `booting | guest | authenticated`. Bootstrap calls `me`, then one refresh attempt. Login updates in-memory identity. Logout clears only in-memory admin identity because server Cookies are authoritative. The Admin app has `/login` and `/`; authenticated users visiting `/login` redirect to `/`, guests visiting `/` see the login page.

- [ ] **Step 5: Implement Windup-styled login and dashboard**

Login page contains email, password, inline error, loading state and no registration link. Dashboard header shows current admin email and logout. Cards list “AI 配置”“敏感词”“兑换码”“用户与积分”“管理员与审计”，all marked “后续阶段接入” and are not wired to mock data or fake APIs.

- [ ] **Step 6: Configure independent Vite entry**

`vite.admin.config.ts` reuses React, Tailwind and `@` alias, builds `admin.html` to `dist-admin`. Add:

```json
"dev:admin": "vite --config vite.admin.config.ts --open /admin.html",
"build:admin": "tsc -b && vite build --config vite.admin.config.ts"
```

Do not change the normal `build` output or Docker volume in this phase.

- [ ] **Step 7: Run frontend tests and builds**

Run: `cd frontend && npm test -- src/admin/api.test.ts src/admin/session.test.tsx src/admin/app.test.tsx`

Run: `cd frontend && npm run typecheck && npm run build:admin`

Expected: tests, TypeScript and Admin build pass; `dist-admin/admin.html` exists; no token strings are emitted to storage.

- [ ] **Step 8: Commit task**

```bash
git add frontend/admin.html frontend/vite.admin.config.ts frontend/src/admin frontend/package.json
git commit -m "feat(admin): 增加独立管理端入口"
```

### Task 6: CI、OpenAPI 与阶段验收

**Files:**
- Modify: `.github/workflows/frontend-ci.yml`
- Modify: `backend/tests/test_auth_middleware.py`
- Modify: `backend/tests/test_cors_preflight.py`
- Modify: `backend/tests/test_env_example_keys_are_live.py`
- Create: `backend/tests/test_admin_openapi.py`
- Modify: `docs/superpowers/specs/2026-08-27-admin-platform-design.md`

**Interfaces:**
- Consumes: Tasks 1–5 complete foundation.
- Produces: CI gate for Admin build and a verified OpenAPI security boundary.

- [ ] **Step 1: Add failing boundary and OpenAPI tests**

```python
def test_admin_paths_do_not_accept_bearer_security(client):
    schema = client.get("/openapi.json").json()
    assert "/admin-api/auth/login" in schema["paths"]
    assert "/admin-api/auth/me" in schema["paths"]
    assert "Authorization" not in str(schema["paths"]["/admin-api/auth/me"])


def test_options_admin_login_allows_configured_admin_origin(client):
    response = client.options(
        "/admin-api/auth/login",
        headers={"Origin": "https://admin.windup.xin", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
```

- [ ] **Step 2: Run boundary tests and verify the missing origin/build gate fails**

Run: `cd backend && uv run pytest tests/test_admin_openapi.py tests/test_auth_middleware.py tests/test_cors_preflight.py -q`

Expected: new assertions fail until the admin origin and route schema are wired.

- [ ] **Step 3: Add Admin build to frontend CI**

After the existing normal build step, run `npm run build:admin`. Do not replace or weaken the existing test, typecheck, lint, format or normal build gates.

- [ ] **Step 4: Complete origin and environment validation**

Default local CORS adds `http://localhost:5174` and `http://127.0.0.1:5174`. Production remains explicit through `WINDUP_CORS_ORIGINS`; `.env.example` documents adding `https://admin.windup.xin`. Update environment-key tests so every new `ADMIN_*` key maps to live settings usage.

- [ ] **Step 5: Record phase status in the spec**

Change the design status to “第一阶段管理基础已实现，配置中心与业务模块待后续 PR”，and mark only phase 1 as completed. Do not claim `admin.windup.xin` is deployed.

- [ ] **Step 6: Run full proportional verification**

Run: `cd backend && uv run pytest tests/test_admin_models.py tests/test_admin_auth_service.py tests/test_admin_auth_api.py tests/test_create_admin_user.py tests/test_admin_openapi.py tests/test_auth_middleware.py tests/test_auth_api.py tests/test_cors_preflight.py tests/test_validate_settings.py tests/test_env_example_keys_are_live.py -q`

Run: `cd backend && uv run ruff check packages/app/src/windup_app/server/admin packages/app/src/windup_app/web/admin packages/framework/src/windup_framework/config/admin_auth.py scripts/create_admin_user.py tests/test_admin_*.py`

Run: `cd frontend && npm test -- src/admin && npm run typecheck && npm run lint && npm run format:check && npm run build && npm run build:admin`

Run: `git diff --check upstream/main...HEAD`

Expected: every command passes. Any repository-wide failure unrelated to this phase is recorded with exact command and evidence, not silently treated as success.

- [ ] **Step 7: Commit task**

```bash
git add .github/workflows/frontend-ci.yml backend/tests/test_auth_middleware.py backend/tests/test_cors_preflight.py backend/tests/test_env_example_keys_are_live.py backend/tests/test_admin_openapi.py docs/superpowers/specs/2026-08-27-admin-platform-design.md
git commit -m "test(admin): 补齐独立管理端验收门禁"
```

## Completion Gate

Before opening a PR linked to #824, verify:

1. The diff contains only phase-1 foundation and its documentation.
2. No existing redemption, sensitive-word, quota or Gateway implementation was copied or replaced.
3. A normal user token cannot authenticate against any Admin endpoint.
4. Browser storage contains no administrator token or password.
5. Admin refresh rotation, disable, logout, CSRF and permission denial tests pass.
6. Normal frontend and backend authentication regressions remain green.
7. Admin SPA builds separately, but production DNS and Nginx remain unchanged.
