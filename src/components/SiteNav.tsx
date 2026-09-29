import { useEffect, useState } from "react";
import { LayoutGrid, KeyRound, Terminal, Cpu, Activity } from "lucide-react";

import { BottomNavBar, type NavItem } from "@/components/ui/bottom-nav-bar";

const items: NavItem[] = [
  { label: "Overview", icon: LayoutGrid, href: "/overview" },
  { label: "API", icon: KeyRound, href: "/api" },
  { label: "Setup", icon: Terminal, href: "/setup" },
  { label: "Models", icon: Cpu, href: "/models" },
  { label: "Activity", icon: Activity, href: "/activity" },
];

/** Dashboard navigation: the bottom nav bar pointed at the site pages. */
export default function SiteNav({ path }: { path: string }) {
  const index = items.findIndex((i) => i.href === path);
  // Compact in the desktop header, full size as the phone bottom bar.
  const [compact, setCompact] = useState(true);
  useEffect(() => {
    const mq = matchMedia("(max-width: 760px)");
    const update = () => setCompact(!mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return (
    <BottomNavBar
      items={items}
      defaultIndex={index}
      animateIn={false}
      compact={compact}
      labelWidth={compact ? 64 : 80}
      className="min-w-0"
    />
  );
}
