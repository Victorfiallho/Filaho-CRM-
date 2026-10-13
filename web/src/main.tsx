import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import SessionTimeoutGuard from "./components/SessionTimeoutGuard";
import { AuthProvider } from "./state/AuthContext";
import { CalendarProvider } from "./state/CalendarContext";
import { CompanyProvider } from "./state/CompanyContext";
import { MapFiltersProvider } from "./state/MapContext";
import { ModalProvider } from "./state/ModalContext";
import { SearchProvider } from "./state/SearchContext";
import "./styles.css";

const queryClient = new QueryClient();

// registerType 'autoUpdate' installs a new deploy's service worker in the
// background, but the plain injected registerSW.js never reloaded the page —
// so the first open after every deploy still ran the previous build (e.g. no
// "Booking page" in the sidebar) until a manual refresh. Registering through
// the plugin's helper reloads once, right at startup, when a new version
// takes control. No periodic re-check on purpose: that reload could land in
// the middle of someone typing into a record form.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SessionTimeoutGuard />
        <CompanyProvider>
          <SearchProvider>
            <ModalProvider>
              <CalendarProvider>
                <MapFiltersProvider>
                  <BrowserRouter>
                    <App />
                  </BrowserRouter>
                </MapFiltersProvider>
              </CalendarProvider>
            </ModalProvider>
          </SearchProvider>
        </CompanyProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
