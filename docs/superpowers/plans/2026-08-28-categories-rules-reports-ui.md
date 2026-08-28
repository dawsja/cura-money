# Categories, Rules, and Reports UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the information hierarchy and action clarity of Categories, Rules, and Reports without changing their data behavior.

**Architecture:** Keep each page's existing React Query data flow and mutations. Refine only page composition, action presentation, responsive layout, and keyboard-accessible controls using the existing semantic theme classes and Lucide icon system.

**Tech Stack:** React, TypeScript, Vite, Tailwind utility classes, TanStack Query, Lucide React.

**Spec:** Approved in-chat Uizze-informed review from 2026-08-28.

## Global Constraints

- Preserve every existing query, mutation, confirmation, drill-down, export, saved layout, and onboarding target.
- Use semantic Cura Money theme classes and explicit light/dark accent pairs.
- Do not add dependencies or modify generated `public/` assets directly.
- The repository has no automated test framework; do not invent a test command.

---

### Task 1: Categories hierarchy and actions

**Files:**
- Modify: `src/ui/src/pages/Categories.tsx`

**Interfaces:**
- Consumes: existing category queries and rename/add/delete/reorder mutations.
- Produces: the same category operations through a hierarchy-first, keyboard-accessible interface.

- [x] **Step 1: Establish the verification baseline**

Run:

```bash
cd src/ui && bunx tsc --noEmit
```

Expected: exit 0 before editing.

- [x] **Step 2: Implement the hierarchy-first layout**

Move category creation behind a clear page action, make type groups collapsible, compact category rows, reveal subcategory editing within expanded categories, and consolidate destructive secondary actions into labelled menus.

- [x] **Step 3: Add keyboard reorder controls**

Expose Move up and Move down controls backed by the existing `onReorder` function while retaining pointer drag behavior.

- [x] **Step 4: Verify Categories**

Run:

```bash
cd src/ui && bunx tsc --noEmit
```

Expected: exit 0.

### Task 2: Rules condition-to-result rows

**Files:**
- Modify: `src/ui/src/pages/Rules.tsx`

**Interfaces:**
- Consumes: existing rule search, pagination, modal, run, update, and delete behavior.
- Produces: structured condition/result rows, optional filters, and a labelled action menu.

- [x] **Step 1: Implement structured rule rows**

Present merchant and matching scope as the `When` side and the resulting type/category as the `Then` side. Keep Run visible and move Edit/Delete into an overflow menu with accessible labels and touch targets.

- [x] **Step 2: Add local filters**

Add account, transaction type, and category filters beside search. Apply them before the existing pagination without changing the API.

- [x] **Step 3: Verify Rules**

Run:

```bash
cd src/ui && bunx tsc --noEmit
```

Expected: exit 0.

### Task 3: Reports hierarchy and toolbar

**Files:**
- Modify: `src/ui/src/pages/Reports.tsx`

**Interfaces:**
- Consumes: existing report queries, widget renderer, saved order/visibility, export modal, and drill-down navigation.
- Produces: a labelled report toolbar and meaningful visual grouping while preserving saved widget order.

- [x] **Step 1: Clarify toolbar scope**

Label the global control as Report range and provide labelled Export and Customize actions. Preserve editing Save/Cancel behavior.

- [x] **Step 2: Strengthen report hierarchy**

Keep Summary first, emphasize Cash flow when it follows Summary, and add lightweight section labels inferred from visible widget order without changing saved order or hide/reorder behavior.

- [x] **Step 3: Verify Reports**

Run:

```bash
cd src/ui && bunx tsc --noEmit
```

Expected: exit 0.

### Task 4: Finish gate

**Files:**
- Review: `src/ui/src/pages/Categories.tsx`
- Review: `src/ui/src/pages/Rules.tsx`
- Review: `src/ui/src/pages/Reports.tsx`

**Interfaces:**
- Consumes: all completed page changes.
- Produces: verified UI source ready for handoff.

- [x] **Step 1: Inspect the final diff**

Run:

```bash
git diff --check
git diff -- src/ui/src/pages/Categories.tsx src/ui/src/pages/Rules.tsx src/ui/src/pages/Reports.tsx
```

Expected: no whitespace errors and no lost functionality.

- [x] **Step 2: Run repository verification**

Run:

```bash
bun run lint
bun run typecheck
cd src/ui && bun run build
```

Expected: all commands exit 0.
