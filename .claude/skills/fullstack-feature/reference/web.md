# Web digest (React 19, Vite, TypeScript strict)

Repo folder: `web=` from `paths.js`. Full rules: its CLAUDE.md (101 lines).

- Commands: `npm run dev` (http://localhost:5173, proxies /api to the API), `lint`, `typecheck`, `build`. Sign in 9876543210 / OTP 123456 against an API in test OTP mode.
- Style: Prettier single quotes, no semicolons, 100 columns. **No code comments.** Files are component-only; shared constants go in a plain `.ts`.
- Layout: `src/features/<feature>/{api.ts, search.ts, pages/, components/, labels.ts}`, `src/components/{ui,common,layout}`, `src/config/{nav.ts,shortcuts.ts}`, routes in `src/router.tsx` (code-based, TanStack Router, under the `_app` route).
- `api.ts` per feature: DTO-mirroring types (snake_case), `xxxKeys`, `xxxApi` object using `api.get/post/patch/delete` (they return `data` already unwrapped), hooks with TanStack Query (`placeholderData: keepPreviousData` for lists). Mutation that shows its own error: `meta: { silent: true }`. Errors are `ApiError` (`status`, `code`, `message`, `fieldErrors`).
- **List page recipe** (reference `features/users/pages/users-page.tsx`): `search.ts` zod schema (page, search, filters, sort, order, each `.catch()`); route with `validateSearch`; menu item in `config/nav.ts` with `permission`; shortcut; page = `Page` + `PageHeader`, `InsightCards` (URL filter toggles, backed by `GET .../insights`), `Card` with `ListToolbar` (`SearchBox`, `FilterSelect`) and `DataTable` (columns with `sortKey`, `card` renderer for phones, `empty` state, `pagination`). Read and write search with `getRouteApi('/_app/<path>').useSearch()` and `useNavigate({ from })`; reset `page` to 1 when a filter changes.
- **Search, sort, filter and paging are backend-side, state lives in the URL.** Never filter a list in the browser.
- **Forms:** `AppModal` with `formId`, react-hook-form + `zodResolver`, rules equal to the DTO rules. Map `apiError.fieldErrors` to `setError`, use `code` for special cases, else a root error. On success `alerts.success(...)`, close, invalidate the feature's keys. Never unmount a raw `Dialog`/`Sheet` body on close.
- **UI rules:** works on phone, tablet and desktop (no sideways scroll). Light and dark via CSS tokens only (`bg-card`, `text-muted-foreground`…), no hard-coded colours. **Never a native `<select>`**: use `Combobox` (forms, with `Controller`) or `FilterSelect` (list filters).
- Permissions: `can(me, 'x.manage')` from `features/auth/api.ts`; the sidebar hides items the user cannot open.
- Gotchas: React 19 lint forbids setState in effects and ref access during render. `VITE_API_URL` stays `/api/v1`.
- Existing regression scripts for UI and API are in `e2e/` (`npm run test:regression`); reuse them rather than writing new ones.
