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
  return <BottomNavBar items={items} defaultIndex={index} animateIn={false} labelWidth={80} className="min-w-0" />;
}
