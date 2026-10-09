import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DecksPage } from "@/pages/DecksPage";
import { useBootstrap } from "@/hooks/useCollection";

const StudyPage = lazy(() => import("@/pages/StudyPage").then((m) => ({ default: m.StudyPage })));
const AddPage = lazy(() => import("@/pages/AddPage").then((m) => ({ default: m.AddPage })));
const BrowsePage = lazy(() => import("@/pages/BrowsePage").then((m) => ({ default: m.BrowsePage })));
const StatsPage = lazy(() => import("@/pages/StatsPage").then((m) => ({ default: m.StatsPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const NoteTypesPage = lazy(() => import("@/pages/NoteTypesPage").then((m) => ({ default: m.NoteTypesPage })));

const Fallback = (): JSX.Element => (
  <div className="glass rounded-xl p-6" aria-busy="true">
    <div className="h-6 w-1/3 rounded bg-muted/40 animate-pulse" />
  </div>
);

const page = (el: JSX.Element): JSX.Element => <Suspense fallback={<Fallback />}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DecksPage /> },
      { path: "study/:deckId", element: page(<StudyPage />) },
      { path: "add", element: page(<AddPage />) },
      { path: "browse", element: page(<BrowsePage />) },
      { path: "stats", element: page(<StatsPage />) },
      { path: "settings", element: page(<SettingsPage />) },
      { path: "notetypes", element: page(<NoteTypesPage />) }
    ]
  }
]);

export const App = (): JSX.Element => {
  const { ready, error } = useBootstrap();
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="glass max-w-md rounded-xl p-6 space-y-2">
          <h1 className="font-semibold">Could not open the local database</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-sm text-muted-foreground">Private browsing or disabled storage can cause this. Try a normal window.</p>
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true">
        <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }
  return <RouterProvider router={router} />;
};
