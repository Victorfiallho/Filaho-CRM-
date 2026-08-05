import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./state/AuthContext";
import { CalendarProvider } from "./state/CalendarContext";
import { CompanyProvider } from "./state/CompanyContext";
import { MapFiltersProvider } from "./state/MapContext";
import { ModalProvider } from "./state/ModalContext";
import { SearchProvider } from "./state/SearchContext";
import "./styles.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
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
