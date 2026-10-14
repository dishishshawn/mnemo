import "./lib/polyfills"; // must run first
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";
import { Layout } from "./components/Layout";
import { installUsageTracking } from "./lib/usage";
import { installChangeTracking, startSyncLoop } from "./lib/sync";
import { db, pruneKeptFiles } from "./lib/db";
import { Spinner } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";

const Home = lazy(() => import("./pages/Home"));
const NewKit = lazy(() => import("./pages/NewKit"));
const KitPage = lazy(() => import("./pages/Kit"));
const SmartStudy = lazy(() => import("./pages/SmartStudy"));
const Flashcards = lazy(() => import("./pages/Flashcards"));
const PracticeTest = lazy(() => import("./pages/PracticeTest"));
const DocPage = lazy(() => import("./pages/DocPage"));
const Podcast = lazy(() => import("./pages/Podcast"));
const Games = lazy(() => import("./pages/Games"));
const Tutor = lazy(() => import("./pages/Tutor"));
const Explain = lazy(() => import("./pages/Explain"));
const ProgressPage = lazy(() => import("./pages/Progress"));
const Sources = lazy(() => import("./pages/Sources"));
const Settings = lazy(() => import("./pages/Settings"));

// Before any database write, so every change is stamped for sync.
installChangeTracking();
installUsageTracking();

// Ask the browser not to evict the study data under storage pressure.
navigator.storage?.persist?.().catch(() => {});

// Kits left "processing" by a closed tab can't resume; surface them as errors so they can be retried.
db.kits
  .filter((k) => k.status === "processing")
  .modify({ status: "error", error: "Processing was interrupted (the tab was closed)." })
  .catch(() => {});
db.sources
  .filter((s) => s.status === "processing" || s.status === "pending")
  .modify({ status: "error", error: "Interrupted before it finished." })
  .catch(() => {});
pruneKeptFiles().catch(() => {});

function RouteBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}

startSyncLoop();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <Layout>
        <RouteBoundary>
        <Suspense fallback={<Spinner label="Loading" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<NewKit />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/kit/:kitId" element={<KitPage />} />
          <Route path="/kit/:kitId/smart" element={<SmartStudy />} />
          <Route path="/kit/:kitId/short" element={<SmartStudy mode="short" />} />
          <Route path="/kit/:kitId/cards" element={<Flashcards />} />
          <Route path="/kit/:kitId/test" element={<PracticeTest />} />
          <Route path="/kit/:kitId/guide" element={<DocPage type="guide" />} />
          <Route path="/kit/:kitId/summary" element={<DocPage type="summary" />} />
          <Route path="/kit/:kitId/podcast" element={<Podcast />} />
          <Route path="/kit/:kitId/games" element={<Games />} />
          <Route path="/kit/:kitId/tutor" element={<Tutor />} />
          <Route path="/kit/:kitId/explain" element={<Explain />} />
          <Route path="/kit/:kitId/progress" element={<ProgressPage />} />
          <Route path="/kit/:kitId/sources" element={<Sources />} />
          <Route path="*" element={<Home />} />
        </Routes>
        </Suspense>
        </RouteBoundary>
      </Layout>
    </HashRouter>
  </StrictMode>,
);
