import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import SessionTimeoutGuard from "./components/SessionTimeoutGuard";
import { I18nProvider } from "./i18n/I18nContext";
import { ConfirmProvider } from "./state/ConfirmContext";
import { AuthProvider } from "./state/AuthContext";
import { CalendarProvider } from "./state/CalendarContext";
import { CompanyProvider } from "./state/CompanyContext";
import { MapFiltersProvider } from "./state/MapContext";
import { ModalProvider } from "./state/ModalContext";
import { SearchProvider } from "./state/SearchContext";
import "./styles.css";

const queryClient = new QueryClient();

// The service worker updates in the background; this reloads once at
// startup when a new deploy takes over, so nobody runs the previous build.
// No periodic check: a reload could interrupt someone typing in a form.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
      <ConfirmProvider>
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
      </ConfirmProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>
);
