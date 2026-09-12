# @repo/ui

Shared UI component library built on shadcn/ui patterns — Radix UI primitives + class-variance-authority (cva) variants + cn utility.

## Import

```tsx
import { Button, Dialog, Input } from "@repo/ui";
```

## Available Components

See [index.ts](index.ts) for the live export catalog. Do not maintain a parallel inventory here.

## Theme

The library defines a canonical theme in `styles/theme.css` using HSL CSS variables. Dark mode is activated via the `.dark` class.

## Utilities

- `cn(...inputs)` — merge Tailwind classes with clsx + tailwind-merge
- `useMobile()` — detect mobile viewport

See the [root README](../../README.md) for the full command reference.
