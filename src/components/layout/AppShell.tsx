import { BarChart3, Layers, PlusCircle, Search, Settings } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Decks", icon: Layers, end: true },
  { to: "/add", label: "Add", icon: PlusCircle, end: false },
  { to: "/browse", label: "Browse", icon: Search, end: false },
  { to: "/stats", label: "Stats", icon: BarChart3, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false }
] as const;

export const AppShell = (): JSX.Element => {
  const location = useLocation();
  const studying = location.pathname.startsWith("/study/");
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-7 w-7" />
            <span>
              VIMS <span className="text-primary">Recall</span>
            </span>
          </NavLink>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => cn("inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent", isActive && !studying ? "bg-accent text-foreground" : "text-muted-foreground")}
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className={cn("mx-auto w-full max-w-6xl flex-1 px-4 py-6", studying ? "pb-6" : "pb-24 sm:pb-6")}>
        <Outlet />
      </main>
      {!studying ? (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-background/90 backdrop-blur-xl sm:hidden" aria-label="Primary mobile">
          <div className="grid grid-cols-5">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", isActive ? "text-primary" : "text-muted-foreground")}>
                <Icon className="h-5 w-5" />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  );
};
