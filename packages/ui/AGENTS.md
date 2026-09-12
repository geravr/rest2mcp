# AGENTS.md

Local guidance for the shared UI component library in `packages/ui/`. Read [../../AGENTS.md](../../AGENTS.md) first for monorepo-wide rules.

## Scope

- Applies to React components, hooks, utilities, and theme tokens under `packages/ui/`.
- Source of truth is live code in `packages/ui/`, especially [components/](components), [hooks/](hooks), [lib/](lib), and [styles/](styles).

## Component Architecture

- Components follow shadcn/ui patterns: Radix UI primitives + class-variance-authority (cva) variants + cn utility.
- Components are flat files: `components/<component-name>.tsx`.
- Export components from `packages/ui/index.ts` for app-level imports.
- Subpath exports are available for direct file access: `@repo/ui/components/button`.

## Theme Tokens

- The canonical theme is defined in `styles/theme.css` using HSL CSS variables.
- Use semantic tokens (`--primary`, `--background`, `--foreground`, etc.) instead of raw color values.
- Dark mode is activated via the `.dark` class on the document root.
- All components must respect the theme tokens; do not hardcode colors.

## Pointer Cursor Invariant

- Enabled clickable controls MUST show `cursor: pointer`. Disabled controls keep a non-pointer cursor (`:disabled` on buttons; `data-[disabled]` / `pointer-events-none` on menu items).
- The shared theme owns the button rule: `button:not(:disabled)` and `[role="button"]:not(:disabled)` in `styles/theme.css`. Do not add `cursor-pointer` on every feature button — the theme covers native `<button>` and `role="button"` elements.
- Interactive dropdown primitives (`DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuSubTrigger`) MUST use `cursor-pointer` and MUST NOT use `cursor-default`. When adding or updating shadcn components via `bun ui:add` / `bun ui:update`, do not reintroduce `cursor-default` on interactive menu items.

## Styling

- Use Tailwind CSS v4 for all styling.
- Use the `cn()` utility from `lib/utils.ts` to merge Tailwind classes.
- Avoid inline styles; prefer Tailwind utilities.
- Respect `prefers-reduced-motion` for animations and transitions.

## Accessibility

- Radix UI provides focus management, keyboard navigation, and ARIA for interactive primitives.
- Do not remove or override Radix's accessibility features.
- Ensure all components are keyboard-navigable and screen-reader-friendly.

## Adding Components

- Use the shadcn CLI to add new components: `bun ui:add <component-name>`.
- After adding, verify the component is exported from `packages/ui/index.ts`.
- Run `bun ui:list` to see available components.
- Run `bun ui:update` to update existing components to the latest shadcn version.

## Anti-patterns

- Hardcoding color values instead of using theme tokens.
- Removing Radix UI's accessibility features (focus traps, ARIA, keyboard navigation).
- Using inline styles instead of Tailwind utilities.
- Importing components from subpaths when the barrel export is sufficient.
- Modifying components without checking for downstream consumers in `apps/app` and `apps/web`.

## Review Priorities

- Verify that components use semantic theme tokens.
- Ensure accessibility features are intact (focus management, ARIA, keyboard navigation).
- Check that animations respect `prefers-reduced-motion`.
- Confirm that new components are exported from the barrel file.
- Validate that subpath exports still work for direct file access.

## Commands

See the [root README](../../README.md) for the canonical command reference.

From inside `packages/ui/`:

```bash
bun build                # Build the package
bun dev                  # Watch mode for development
bun lint                 # Lint the package
bun type-check           # Typecheck the package
```
