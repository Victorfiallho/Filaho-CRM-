import { createContext, useContext, useState, type ReactNode } from "react";
import { DEFAULT_MAP_FILTERS, type MapFilters } from "../domain/mapUtils";

// Lifted above the routed page (like app.js's module-level `mapFilters`
// global) so navigating away from Map & Routes and back keeps the filters.
interface MapContextValue {
  mapFilters: MapFilters;
  setMapFilters: (filters: MapFilters) => void;
}

const MapContext = createContext<MapContextValue | null>(null);

export function MapFiltersProvider({ children }: { children: ReactNode }) {
  const [mapFilters, setMapFilters] = useState<MapFilters>(DEFAULT_MAP_FILTERS);
  return <MapContext.Provider value={{ mapFilters, setMapFilters }}>{children}</MapContext.Provider>;
}

export function useMapFilters() {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error("useMapFilters must be used within MapFiltersProvider");
  return ctx;
}
