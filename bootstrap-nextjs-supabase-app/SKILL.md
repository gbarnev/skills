---
name: bootstrap-nextjs-supabase-app
description: Bootstrap and structure a production-oriented full-stack Next.js App Router project using pnpm, TypeScript, Supabase Auth and Postgres, Drizzle ORM, Zod, TanStack React Query, Tailwind CSS, and shadcn/ui. Use when starting, scaffolding, or standardizing a new web application that should follow API-first data access, Zod-validated contracts, Advanced SSR query hydration, domain-first source organization, layered domain modules with an explicit dependency direction, authenticated Route Handlers, Drizzle-owned migrations, and documented architecture conventions.
---

# Bootstrap a Next.js Supabase App

Create a maintainable application foundation, not a demo scaffold. Prefer current
stable, mutually compatible package versions and confirm installation commands
against official documentation when network access is available.

## Establish the project

1. Inspect the target directory and preserve existing work.
2. Confirm the product domains, authentication needs, primary reads and writes,
   deployment target, and whether the Supabase project already exists.
3. Initialize a pnpm-based Next.js App Router project with TypeScript, a `src/`
   directory, Tailwind CSS, and the `@/*` import alias.
4. Install the current stable packages:

   ```bash
   pnpm add @supabase/supabase-js @supabase/ssr drizzle-orm postgres @tanstack/react-query zod
   pnpm add -D drizzle-kit drizzle-zod
   pnpm dlx shadcn@latest init
   ```

5. Keep the package manager pinned in `package.json` and use pnpm for every
   command. Do not introduce a second lockfile.
6. Add scripts for type-checking, production builds, tests, Drizzle generation,
   and migrations. Add linting only when configured and working.

## Use domain-first boundaries

Start with this ownership model and adapt domain names to the product:

```text
AGENTS.md                       # application and repository instructions
CLAUDE.md                       # contains @AGENTS.md
.agents/
└── skills/                     # canonical project Agent Skills
.claude/
└── skills/                     # symlinks to .agents/skills/*
drizzle/                        # generated migrations + meta, committed
src/
├── app/
│   ├── layout.tsx              # mounts QueryProvider for the whole app
│   ├── _components/query-provider.tsx
│   ├── _lib/api-client.ts
│   ├── (protected)/
│   │   ├── layout.tsx
│   │   └── <domain>/
│   │       ├── _components/
│   │       ├── _lib/query.ts
│   │       ├── _lib/prefetch.ts
│   │       └── page.tsx
│   ├── api/<domain>/route.ts
│   └── auth/
│       ├── actions.ts
│       ├── callback/route.ts
│       └── confirm/route.ts
├── components/ui/
├── db/
│   ├── index.ts
│   ├── migrate.ts
│   └── schema.ts
└── lib/
    ├── auth.ts
    ├── env.ts
    └── <domain>/               # starts flat, splits by concept as it grows
        ├── contract.ts
        ├── filters.ts
        ├── query.ts
        ├── domain.ts           # add when rules outgrow a query
        ├── service.ts          # add when a use case does more than one thing
        ├── errors.ts           # add when failures need distinct handling
        └── index.ts            # add when other domains consume this one
```

- Keep pages, layouts, server actions, React Query code, SSR prefetching, and
  app-owned UI under `src/app`.
- Put page-owned components and frontend behavior beside the closest route in
  private `_components/` and `_lib/` folders.
- Keep app-wide client providers in `src/app/_components` so they mount from the
  root layout rather than from a route group.
- Keep shadcn-generated primitives in `src/components/ui`, matching
  `components.json`. Do not put product-specific components there.
- Put API/application behavior in `src/lib/<domain>`, grouped by product domain
  rather than technical categories.
- Keep `src/app/api` Route Handlers thin. Import their non-framework
  dependencies from `src/lib`, never directly from `src/db` or page-private
  modules.
- Keep the Drizzle schema and connection in `src/db`; keep business queries in
  the owning `src/lib/<domain>` boundary.
- Avoid root-level catch-all folders such as `queries`, `services`, `contracts`,
  `prefetch`, or `hooks` that mix unrelated domains.
- Mark server-only modules with `import "server-only"` when doing so prevents an
  accidental client import. Apply it unconditionally to `src/db/*` and every
  `src/lib/<domain>/query.ts`, since those are the modules a client import would
  most expensively leak.

## Layer each domain module

Depend in one direction: `src/app` → `src/lib/<domain>` → `src/db`. Routes,
components, server actions, and prefetches call into a domain module; a domain
module never imports from `src/app`, and nothing outside `src/lib/<domain>` and
`src/db` imports the Drizzle client. This single rule is what keeps a
fast-moving prototype from decaying into ad-hoc queries scattered through the
component tree.

Add layers when a use case demands one, not preemptively. Each layer owns one job:

| Layer | Owns | Add it |
| --- | --- | --- |
| `contract` | Zod schemas and inferred types | always |
| `query` | bounded Drizzle reads and writes | always |
| `filters` | list filtering, sorting, and pagination inputs | when lists take parameters |
| `domain` | pure rules: invariants, derivations, state transitions | when rules outgrow a single query |
| `service` | orchestration across queries, domains, or external systems | when a use case does more than one thing |
| `errors` | typed domain errors | when failures need distinct handling |
| `index` | the module's public surface | when another domain consumes it |

Start each layer as a single file and promote it to a folder the moment it holds
more than one concept. A `query.ts` that accumulates every read in the domain
becomes the same catch-all as a root-level `queries/` directory, only harder to
notice:

```text
src/lib/projects/
├── contract.ts
├── errors.ts
├── index.ts                    # the public surface; everything else is internal
├── domain/
│   ├── publishing.ts           # named for the concept, not the layer
│   └── quota.ts
├── queries/
│   ├── list-projects.ts
│   └── get-project-for-owner.ts
└── services/
    ├── publish-project.ts
    └── transfer-ownership.ts
```

- Name files in kebab-case after the operation or concept they contain, so
  `publish-project.ts` exports `publishProject`. One exported use case per file
  in `services/` keeps merge conflicts and blast radius small.
- Do not stutter or restate the layer: inside `lib/projects/services/`, a file
  named `project-service.ts` carries no information the path did not already
  give. Reserve suffixes for when the folder does not disambiguate.
- Re-export the intended entry points from `index.ts` and treat every other file
  as module-internal, so the public surface is a deliberate list rather than
  whatever happens to be exported.

Apply these design rules:

- Write query functions as named, task-specific operations — `listActiveProjects`,
  `getProjectForOwner` — rather than a generic repository over a table. The
  Drizzle query builder is already the persistence abstraction, and wrapping it
  in a `Repository<T>` interface costs composition (partial selects, joins,
  relational `with`) while buying a mockability that a disposable test database
  supplies more honestly.
- Do not create a service that only forwards to one query. A pass-through layer
  adds a file to every change without ever making a decision. Let thin resources
  run Route Handler → `query.ts`, and introduce `service.ts` at the moment a use
  case spans two writes, an external call, or a cross-domain rule.
- Keep `domain.ts` free of I/O. Pure functions over plain data are trivial to
  test and compose cleanly into services.
- Model the domain as plain data plus pure functions rather than as a third
  representation sitting between the Drizzle row and the contract. The schema
  carries shape and constraints, the contracts carry what crosses each edge, and
  pure functions carry invariants and state transitions — a separate entity class
  would add mappers in both directions, and the contract rules already forbid
  class instances in payloads.
- Use `interface` and `type` freely for the seams between modules; they are
  structural and erased at runtime, so a contract costs nothing and needs no
  `implements`, registration, or container. Reach for a class only where runtime
  identity matters: typed errors that callers narrow with `instanceof`, and
  stateful adapters holding a connection or client.
- Express values with invariants as Zod branded types rather than value-object
  classes, so the same value survives serialization across the API and SSR
  boundaries instead of degrading into a bare object on the way out.
- Name functions in the language of the product — `publishProject`,
  `suspendAccount` — rather than CRUD verbs over tables. In this stack the
  function name is where the ubiquitous language actually lives.
- Accept the database handle as the first parameter (`db: Database | Transaction`)
  so any query composes into a larger unit of work. Open transactions in
  `service.ts` with `db.transaction(...)`; never inside a `query.ts` function, or
  two of them can never be combined atomically.
- Put authentication in the Route Handler and authorization in the domain loader.
  Identity is an HTTP concern, but "may this actor see this row" is a domain rule
  that the SSR prefetch path must enforce identically — and a loader that
  requires an actor id cannot accidentally be called without one.
- Let a domain module call another domain's public loader, never its tables or
  internal helpers. A narrow cross-domain surface stays refactorable; reaching
  into a neighbour's schema silently merges the two domains.
- Throw typed domain errors and translate them to status codes in the Route
  Handler. HTTP vocabulary inside `src/lib` makes the same function unusable from
  a prefetch, a background job, or a script.
- Treat the domain loader, not the URL, as the architectural boundary. `/api/*`
  is one consumer and SSR prefetch is another; a server component rendering a
  public marketing page or a one-shot detail view with no client interactivity
  may call a loader directly. Requiring a network hop for data that never
  refetches adds latency without adding a boundary.
- Enforce these import rules mechanically with `server-only` plus a lint rule
  restricting imports of `src/db` outside `src/lib/<domain>`. Conventions that
  live only in a document decay under deadline.

Test each layer the way its dependencies allow:

- Call pure rule functions directly with plain inputs. They need no fixtures,
  database, or test doubles, which is why rules worth protecting belong there.
- Run query tests against real Postgres — an in-process instance such as
  `pglite`, a container, or a disposable branch. A substituted repository only
  asserts that the substitute behaves like itself, while the defects this layer
  actually produces are wrong joins, missing ownership filters, unbounded reads,
  and per-row queries, none of which survive contact with a real planner.
- Pass service dependencies as a typed parameter object rather than resolving
  them from a container, so a test supplies a real transaction alongside a
  recording implementation of the external system and asserts on both.
- When one dependency set recurs across many call sites, export a
  `create<Domain>Service(deps)` factory returning the use-case functions. This is
  constructor injection expressed as a closure and keeps the composition root
  explicit without introducing a resolution framework.
- Cover Route Handlers with request-level tests for authentication, input
  rejection, and status mapping only. Their business assertions belong to the
  loader they delegate to, which both `/api` and the SSR prefetch share.

## Define contracts and validate with Zod

Zod is the single validation boundary. Every value crossing a trust or
serialization edge — request inputs, API responses, environment variables — is
parsed rather than asserted, so a shape change fails loudly at the edge instead
of silently corrupting a render.

- Define each resource's schemas in `src/lib/<domain>/contract.ts` and derive
  TypeScript types with `z.infer`. Do not maintain a hand-written interface
  alongside a schema; they will drift.
- Keep contracts JSON-safe. Represent timestamps as ISO 8601 strings, not `Date`,
  and avoid `undefined`, `Map`, `Set`, and class instances, so the same schema
  validates a dehydrated SSR payload and a browser `fetch` response.
- Derive base shapes from the Drizzle schema with `drizzle-zod`
  (`createSelectSchema` / `createInsertSchema`), then narrow explicitly. Never
  return a full row schema — pick the columns the client actually needs.
- Define one input parser per resource (query params, path params, body) in the
  owning domain, and share it between the Route Handler and the SSR prefetch so
  defaults, coercion, and bounds cannot diverge.
- Parse with `safeParse` at the API boundary and return `400` with a stable,
  serializable issue list. Match the error-formatting API to the installed Zod
  major version rather than assuming a helper name.
- Validate responses in the browser transport with the same schema the server
  used to produce them.
- Validate environment variables once in `src/lib/env.ts` and import from there
  instead of reading `process.env` throughout the codebase. Split server and
  client schemas so a server secret cannot be pulled into a client bundle, and
  reference `NEXT_PUBLIC_*` variables by literal name so Next.js can inline them.
- Fail fast: parse the environment at module load, and let a missing variable
  break the build rather than the first request.

## Build API-first data access

Require an API route for every UI server-state resource. Let browser code read
through `/api/*`; do not place database queries or server-side response shaping
inside React components.

For each resource:

1. Define the Zod contract in `src/lib/<domain>/contract.ts`.
2. Implement the bounded Drizzle query in `src/lib/<domain>/query.ts`, returning
   data that already satisfies the contract.
3. Add an authenticated Route Handler under `src/app/api/<domain>/route.ts` that
   parses inputs with the shared parser and delegates to the domain query.
4. Add the browser request, response validation, and stable query key beside the
   page in `_lib/query.ts`.
5. Consume the resource with TanStack React Query.

Apply these API rules:

- Authenticate every private Route Handler independently. A protected page
  layout does not protect `/api` routes.
- Return `401` for unauthenticated requests and appropriate `4xx` responses for
  invalid input. Do not leak database errors, credentials, or internals.
- Keep HTTP concerns in Route Handlers, persistence and response shaping in the
  domain module, and presentation in components.
- Expose one loader function per resource in the domain module and call it from
  both the Route Handler and the SSR prefetch, so the two paths cannot drift in
  authorization, normalization, or shape.
- Bound list endpoints and select only required columns. Avoid per-row queries.
- Serialize dates explicitly as ISO 8601 strings.
- Use a small shared browser transport under `src/app/_lib` for JSON parsing,
  typed errors, `AbortSignal` support, and Zod response validation.
- Handle `401` responses in one place in the transport rather than in each hook.
- Use resource-oriented URLs and standard HTTP methods.
- Use React Query mutations for client writes, then invalidate or update every
  affected query key. Reserve Server Actions for auth and form-post flows that
  need cookie mutation, and document which of the two owns each write.

## Apply TanStack Query Advanced SSR

Use React Query for all frontend server state; do not recreate request state with
manual `useEffect` and `useState` lifecycles.

Mount the provider in the root layout:

- Put the `"use client"` provider in `src/app/_components/query-provider.tsx` and
  wrap `src/app/layout.tsx` with it, so the cache survives navigation between
  public and protected routes. A provider mounted inside a route group unmounts
  when the user leaves the group and silently discards the cache.
- Create the browser `QueryClient` once per mounted provider with a lazy
  `useState` initializer.
- Never reuse a singleton server `QueryClient` across requests.
- Set a positive shared `staleTime` so hydrated data does not refetch
  immediately.
- Reset private data when identity changes: subscribe to Supabase
  `onAuthStateChange` inside the provider and clear the cache on sign-out and on
  a changed user id. Prefer clearing over keying the provider on the user, which
  would remount the entire tree on every auth event.
- Keep a Suspense boundary below the provider when streamed route content could
  otherwise recreate it.

For primary above-the-fold reads:

1. Create a new `QueryClient` for each server request in the route-local
   `_lib/prefetch.ts`.
2. Authenticate before prefetching private data.
3. Call the owning `src/lib/<domain>` loader directly during server prefetch to
   avoid a server-to-self HTTP request.
4. Use the exact query key and contract used by the browser query.
5. Dehydrate the server client and wrap the client view with a route-level
   `HydrationBoundary`.
6. Let the browser query continue through `/api/*` for refetching and navigation.

Also:

- Pass React Query's `AbortSignal` to `fetch`.
- Include every response-changing input in a stable, serializable query key.
- Handle initial loading, background fetching, unauthorized, retry, error,
  empty, and success states explicitly.
- Prefer `placeholderData: keepPreviousData` for filtered or paginated tables
  when retaining the prior result improves continuity.

## Configure Supabase Auth safely

- Use `@supabase/ssr` for cookie-based App Router authentication.
- Create focused browser and server Supabase factories only where both are
  required. Keep cookie mutation in the supported request/proxy or server-action
  boundary.
- Verify server identity with a method that validates the token, such as
  `getClaims()` where supported or `getUser()` when appropriate. Never authorize
  from an unverified `getSession()` payload.
- Refresh auth cookies through the framework request boundary and guard protected
  layouts for navigation UX.
- Repeat authentication and authorization inside each private API route and
  server mutation.
- Keep the service-role key server-only. Never expose it through a public
  environment variable or client bundle.

Implement the callback routes, since password sign-in is the only flow that works
without them:

- `src/app/auth/callback/route.ts` handles the PKCE redirect. Read the `code`
  parameter, exchange it for a session with `exchangeCodeForSession`, and
  redirect on success. OAuth, magic links, and any provider redirect fail
  silently without this route.
- `src/app/auth/confirm/route.ts` handles emailed links. Read `token_hash` and
  `type`, verify with `verifyOtp`, and route email confirmation, recovery, and
  email-change flows to their destinations.
- Treat the post-auth destination as untrusted input: accept only a relative path
  beginning with `/` and reject protocol-relative or absolute URLs, otherwise the
  callback becomes an open redirect that leaks a fresh session.
- Redirect failures to a dedicated auth error route with a generic message rather
  than echoing the provider error.
- Build redirect URLs from the forwarded host on platforms that proxy preview
  deployments, so callbacks do not resolve to an internal origin.
- Register every callback URL in the Supabase Auth redirect allow list for local,
  preview, and production, and document the set alongside cookie behavior.

## Configure Drizzle and Supabase Postgres

Drizzle owns the schema and the migration history. Keeping a second history in
`supabase/migrations` produces two sources of truth that diverge the first time
either tool is used alone.

- Treat `src/db/schema.ts` as the schema source of truth.
- Configure Drizzle Kit immediately and commit the generated `drizzle/`
  directory, including `meta/`. Do not create `supabase/migrations` or use
  `supabase db push` for application schema. Use the Supabase CLI only for local
  Postgres and project configuration.
- Constrain generation to schemas the application owns with `schemaFilter` (and
  `tablesFilter` where needed), so Drizzle Kit never emits DDL for Supabase-owned
  `auth`, `storage`, `realtime`, or extension schemas.
- Reference `auth.users` by declaring it with `pgSchema("auth")` for foreign-key
  typing only, and keep it excluded from generation.
- Connect with the `postgres` driver through `DATABASE_URL`. If using the
  Supabase transaction pooler, preserve its compatible settings, including
  `prepare: false` when required.
- Run migrations over a direct or session connection via a separate `DIRECT_URL`.
  DDL over the transaction pooler is unreliable.
- Reuse a bounded server connection in development and production; avoid opening
  a new pool per query or hot reload.
- Add indexes for recurring filters, joins, uniqueness constraints, and ordering
  based on actual query shapes.
- Enable RLS on tables exposed through the Supabase Data API and author the
  enable statements and policies in Drizzle migrations, either through the
  schema-level policy helpers when the installed version supports them or as SQL
  appended to the generated migration. Do not assume RLS replaces API
  authorization when Drizzle uses a privileged server connection.
- Keep triggers, functions, and other custom SQL — including any trigger that
  mirrors `auth.users` into an application profile table — in committed migration
  files rather than applying them by hand in the dashboard.
- Generate migrations during development and apply them with `drizzle-kit
  migrate` (or a committed `src/db/migrate.ts`) only when the target environment
  is explicit. Never use schema push against a shared or production database.
- Keep service-role storage or administration operations in isolated server-only
  modules.

## Finish the foundation

Configure the repository for AI-enabled development. Treat AI instructions as
part of the architecture: keep them current when domain language, boundaries,
commands, or invariants change.

Always create a root `AGENTS.md` that records:

- the application's main goal, key user workflows, and important product
  constraints;
- the domain objects and ubiquitous language, including ownership,
  relationships, lifecycle, and invariants;
- the system design and architecture, including dependency boundaries, request
  and data flow, integration points, and major design decisions;
- the selected technologies and pinned package manager;
- the route-first frontend and domain-first API boundaries;
- the dependency direction, the layer-by-need rules for `src/lib/<domain>`, and
  where transactions and authorization are owned;
- the API-first, Zod contract, and React Query Advanced SSR rules;
- authentication, authorization, callback routes, RLS, and secret-handling
  constraints;
- Drizzle-owned migration and connection conventions;
- environment variables and validation commands.

Keep this file operational and specific to the application. Link to detailed
ADRs when needed instead of turning `AGENTS.md` into a historical narrative.

Create a root `CLAUDE.md` containing exactly:

```text
@AGENTS.md
```

For every substantial module introduced by a larger implementation, add
`<module>/AGENTS.md` and `<module>/CLAUDE.md`. A module may be a product-domain,
integration, or independently owned application boundary; do not add these
files to every small utility or route folder. The module `AGENTS.md` supplements
the root instructions and documents:

- the module's main goal, responsibilities, non-goals, and importance to the
  application;
- its domain objects, terminology, state transitions, relationships, and
  invariants;
- its public contracts, entry points, dependencies, and owned persistence;
- its internal system design, data flow, authorization rules, failure modes,
  and architectural constraints;
- the relevant file map, implementation conventions, and focused validation
  commands.

Each module `CLAUDE.md` must contain exactly:

```text
@AGENTS.md
```

Store project-specific Agent Skills canonically under
`.agents/skills/<skill-name>/SKILL.md`. Add only skills that encode reusable,
project-relevant workflows or domain knowledge; do not copy generic
instructions already covered by `AGENTS.md`. Expose each canonical skill to
Claude with a relative symlink:

```text
.claude/skills/<skill-name> -> ../../.agents/skills/<skill-name>
```

Do not maintain duplicate skill copies. Commit the canonical skills and
symlinks, and verify every symlink resolves from a fresh checkout.

Add `.env.example` with placeholders only. Include the pooled database URL, the
direct database URL used for migrations, the Supabase URL and publishable key,
and server-only secrets required by the chosen features. Keep it in sync with
`src/lib/env.ts`. Never commit real credentials.

## Validate before handoff

Run the relevant checks and fix failures:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Also verify:

- every private API route authenticates itself;
- every contract is a Zod schema with its type inferred, and no hand-written
  duplicate interface exists;
- API inputs and browser responses are both parsed, not cast;
- the environment schema covers every variable in `.env.example`, and no server
  secret appears in a client schema or client bundle;
- the query provider mounts in the root layout and clears the cache on sign-out;
- the auth callback and confirm routes exist and reject non-relative
  destinations;
- Drizzle owns the only migration history, generated migrations are committed,
  and they apply cleanly to a fresh database;
- migrations contain no DDL for Supabase-owned schemas;
- no client component imports `src/db` or a server query implementation;
- no module outside `src/lib/<domain>` and `src/db` imports the Drizzle client,
  and no domain module imports from `src/app`;
- no domain module reaches into another domain's tables or internal helpers;
- query functions accept a transaction handle, and transactions open in services
  rather than inside individual queries;
- no service exists that only forwards to a single query, and no pure rule module
  performs I/O;
- no layer file holds more than one concept, and each domain's public surface is
  re-exported from its `index.ts` rather than imported file by file;
- service dependencies arrive as parameters, and query tests run against a real
  Postgres instance rather than a substituted repository;
- authorization is enforced inside the domain loader, not only in the Route
  Handler;
- React Query imports and browser transports remain under `src/app`;
- shadcn primitives remain under `src/components/ui`;
- API Route Handlers delegate to `src/lib` domain modules;
- server-prefetched and browser-fetched query keys and contracts match;
- the root `AGENTS.md` and each substantial module's `AGENTS.md` describe the
  relevant goal, domain model, and architecture;
- every root or module `CLAUDE.md` contains only `@AGENTS.md`;
- project-specific skills live under `.agents/skills`, and every corresponding
  `.claude/skills` symlink resolves;
- only one package-manager lockfile exists.