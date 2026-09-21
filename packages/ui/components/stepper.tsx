import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

type StepState = "inactive" | "active" | "completed";

type StepperContextValue = {
  value: number;
  onValueChange: (value: number) => void;
};

type StepItemContextValue = {
  step: number;
  state: StepState;
  disabled: boolean;
};

const StepperContext = React.createContext<StepperContextValue | null>(null);
const StepItemContext = React.createContext<StepItemContextValue | null>(null);

function useStepper() {
  const context = React.use(StepperContext);
  if (!context) {
    throw new Error("Stepper components must be used within Stepper.");
  }
  return context;
}

function useStepItem() {
  const context = React.use(StepItemContext);
  if (!context) {
    throw new Error("Stepper item components must be used within StepperItem.");
  }
  return context;
}

function Stepper({
  value,
  onValueChange,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <StepperContext value={{ value, onValueChange }}>
      <div className={cn("flex flex-col", className)} {...props}>
        {children}
      </div>
    </StepperContext>
  );
}

function StepperNav({
  className,
  children,
  ...props
}: React.ComponentProps<"nav">) {
  return (
    <nav {...props}>
      <ol className={cn("flex w-full items-start", className)}>{children}</ol>
    </nav>
  );
}

function StepperItem({
  step,
  completed = false,
  disabled = false,
  className,
  children,
  ...props
}: React.ComponentProps<"li"> & {
  step: number;
  completed?: boolean;
  disabled?: boolean;
}) {
  const { value } = useStepper();
  const state: StepState = disabled
    ? "inactive"
    : completed
      ? "completed"
      : value === step
        ? "active"
        : "inactive";

  return (
    <StepItemContext value={{ step, state, disabled }}>
      <li
        data-state={state}
        className={cn("relative flex flex-1 flex-col items-center", className)}
        {...props}
      >
        {children}
      </li>
    </StepItemContext>
  );
}

function StepperTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<"button">) {
  const { onValueChange } = useStepper();
  const { step, state, disabled } = useStepItem();

  return (
    <button
      {...props}
      type="button"
      disabled={disabled}
      data-state={state}
      aria-current={state === "active" ? "step" : undefined}
      className={cn(
        "relative z-10 flex w-full flex-col items-center gap-2 rounded-md px-1 text-center",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:opacity-50",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) {
          onValueChange(step);
        }
      }}
    />
  );
}

function StepperIndicator({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  const { state } = useStepItem();

  return (
    <span
      aria-hidden="true"
      data-state={state}
      className={cn(
        "flex size-8 items-center justify-center rounded-full border text-sm font-semibold",
        state === "completed" &&
          "border-primary bg-primary text-primary-foreground",
        state === "active" && "border-primary bg-background text-primary",
        state === "inactive" && "border-border bg-muted text-muted-foreground",
        className,
      )}
      {...props}
    >
      {state === "completed" ? <Check className="size-4" /> : children}
    </span>
  );
}

function StepperTitle({ className, ...props }: React.ComponentProps<"span">) {
  const { state } = useStepItem();

  return (
    <span
      className={cn(
        "max-w-28 text-balance text-xs font-medium leading-4 sm:max-w-none sm:text-sm",
        state === "active" ? "text-foreground" : "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function StepperSeparator({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const { state } = useStepItem();

  return (
    <span
      aria-hidden="true"
      data-state={state}
      className={cn(
        "absolute top-4 left-[calc(50%+1.25rem)] right-[calc(-50%+1.25rem)] h-px",
        state === "completed" ? "bg-primary" : "bg-border",
        className,
      )}
      {...props}
    />
  );
}

function StepperContent({
  step,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { step: number }) {
  const { value } = useStepper();
  if (value !== step) return null;

  return (
    <div
      data-step={step}
      className={cn(
        "border-t border-border pt-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
};
