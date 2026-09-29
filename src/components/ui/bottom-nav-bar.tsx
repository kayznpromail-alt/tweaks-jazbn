"use client";

import { useState, type MouseEvent } from "react";

import { motion } from "framer-motion";
import {
  Home,
  LineChart,
  CreditCard,
  MessageCircle,
  Trophy,
  User,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type NavItem = { label: string; icon: LucideIcon; href?: string };

const navItems: NavItem[] = [
  { label: "Home", icon: Home },
  { label: "Portfolio", icon: LineChart },
  { label: "Transactions", icon: CreditCard },
  { label: "Messages", icon: MessageCircle },
  { label: "Rewards", icon: Trophy },
  { label: "Profile", icon: User },
];

const MOBILE_LABEL_WIDTH = 72;

type BottomNavBarProps = {
  className?: string;
  defaultIndex?: number;
  stickyBottom?: boolean;
  /** Items to show; defaults to the demo items. Items with an href render as links. */
  items?: NavItem[];
  /** Plays the scale-in animation on mount. */
  animateIn?: boolean;
  /** Width of the active item's label, in px. */
  labelWidth?: number;
};

export function BottomNavBar({
  className,
  defaultIndex = 0,
  stickyBottom = false,
  items = navItems,
  animateIn = true,
  labelWidth = MOBILE_LABEL_WIDTH,
}: BottomNavBarProps) {
  const [activeIndex, setActiveIndex] = useState(defaultIndex);

  // Let the label expand first, then follow the link.
  const go = (e: MouseEvent<HTMLAnchorElement>, idx: number, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setActiveIndex(idx);
    if (idx === activeIndex) return;
    setTimeout(() => window.location.assign(href), 180);
  };

  return (
    <motion.nav
      initial={animateIn ? { scale: 0.9, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      role="navigation"
      aria-label="Bottom Navigation"
      className={cn(
        "bg-card dark:bg-card border border-border dark:border-sidebar-border rounded-full flex items-center p-2 shadow-xl space-x-1 min-w-[320px] max-w-[95vw] h-[52px]",
        stickyBottom && "fixed inset-x-0 bottom-4 mx-auto z-20 w-fit",
        className,
      )}
    >
      {items.map((item, idx) => {
        const Icon = item.icon;
        const isActive = activeIndex === idx;
        const itemClass = cn(
          "flex items-center gap-0 px-3 py-2 rounded-full transition-colors duration-200 relative h-10 min-w-[44px] min-h-[40px] max-h-[44px]",
          isActive
            ? "bg-primary/10 dark:bg-primary/15 text-primary dark:text-primary gap-2"
            : "bg-transparent text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-muted",
          "focus:outline-none focus-visible:ring-0",
        );

        const content = (
          <>
            <Icon
              size={22}
              strokeWidth={2}
              aria-hidden
              className="transition-colors duration-200"
            />

            <motion.div
              initial={false}
              animate={{
                width: isActive ? `${labelWidth}px` : "0px",
                opacity: isActive ? 1 : 0,
                marginLeft: isActive ? "8px" : "0px",
              }}
              transition={{
                width: { type: "spring", stiffness: 350, damping: 32 },
                opacity: { duration: 0.19 },
                marginLeft: { duration: 0.19 },
              }}
              className={cn("overflow-hidden flex items-center")}
              style={{ maxWidth: labelWidth }}
            >
              <span
                className={cn(
                  "font-medium text-xs whitespace-nowrap select-none transition-opacity duration-200 overflow-hidden text-ellipsis text-[clamp(0.625rem,0.5263rem+0.5263vw,1rem)] leading-[1.9]",
                  isActive ? "text-primary dark:text-primary" : "opacity-0",
                )}
                title={item.label}
              >
                {item.label}
              </span>
            </motion.div>
          </>
        );

        return item.href ? (
          <motion.a
            key={item.label}
            href={item.href}
            whileTap={{ scale: 0.97 }}
            className={itemClass}
            onClick={(e) => go(e, idx, item.href!)}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
          >
            {content}
          </motion.a>
        ) : (
          <motion.button
            key={item.label}
            whileTap={{ scale: 0.97 }}
            className={itemClass}
            onClick={() => setActiveIndex(idx)}
            aria-label={item.label}
            type="button"
          >
            {content}
          </motion.button>
        );
      })}
    </motion.nav>
  );
}

export default BottomNavBar;
