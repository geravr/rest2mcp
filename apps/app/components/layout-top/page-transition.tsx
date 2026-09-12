import { useLocation } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";

interface PageTransitionProps {
  children: React.ReactNode;
  transitionKey?: string;
}

export function PageTransition({
  children,
  transitionKey,
}: PageTransitionProps) {
  const prefersReducedMotion = useReducedMotion();
  const location = useLocation();
  const key = transitionKey ?? location.pathname;

  if (prefersReducedMotion) {
    return <div className="flex h-full min-h-0 flex-col">{children}</div>;
  }

  return (
    <motion.div
      key={key}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="flex h-full min-h-0 flex-col"
    >
      {children}
    </motion.div>
  );
}
