import { createContext, useContext, useState, type ReactNode } from "react";
import { DEFAULT_MAP_FILTERS, type MapFilters } from "../domain/mapUtils";

// Above the routed page, so leaving Map & Routes and coming back keeps the filters.
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
