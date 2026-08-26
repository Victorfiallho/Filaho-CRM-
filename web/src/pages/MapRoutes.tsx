import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { AlertCircle, CheckCircle, ChevronDown, ChevronUp, MapPin, MapPinned, Maximize2, Navigation, Route, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Select from "../components/Select";
import { useCustomers, useIntegrationSettings, useInvalidateCompanyData, useJobs, useLeads } from "../data/hooks";
import { geocodeRecords } from "../data/geocoding";
import { fetchRoutePolyline, fetchOptimizedOrder } from "../data/routing";
import { groupBy, titleize, unique } from "../domain/format";
import { buildGoogleMapsRouteUrl, clusterByProximity, nearestNeighborRoute, twoOptImprove, type LatLng } from "../domain/geo";
import { DEFAULT_MAP_FILTERS, matchesMapFilters } from "../domain/mapUtils";
import { filterRowsBySearch } from "../domain/search";
import type { MapRecord } from "../domain/types";
import { loadGoogleMapsScript } from "../lib/googleMaps";
import { toast } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useMapFilters } from "../state/MapContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

type GeocodedRecord = MapRecord & LatLng;
type StartMode = "geolocation" | "first" | "custom";

// Ported from app.js (renderMapRoutes, mapRecords, matchesMapFilters, mapPin,
// geocodeVisibleRecords, openMapRecord), then extended well past the original
// MVP: Google Maps tiles/geocoding/directions (swapped back from a Leaflet +
// OpenStreetMap/Nominatim/OSRM stint — see data/geocoding.ts, data/routing.ts,
// lib/googleMaps.ts), marker clustering for dense areas, Directions-API route
// optimization with a one-click "open in Google Maps" link, and proximity-based
// (not just ZIP-prefix) region grouping.
export default function MapRoutes() {
  const { activeCompanyId, stages, services } = useCompany();
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);
  const { data: settings } = useIntegrationSettings();
  const apiKey = settings?.google_maps.api_key || "";
  const { mapFilters, setMapFilters } = useMapFilters();
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();
  const invalidate = useInvalidateCompanyData(activeCompanyId);
  const [geocoding, setGeocoding] = useState(false);
  const [routeStops, setRouteStops] = useState<GeocodedRecord[] | null>(null);
  const [routing, setRouting] = useState(false);
  const [startMode, setStartMode] = useState<StartMode>("geolocation");
  const [customStartLat, setCustomStartLat] = useState("");
  const [customStartLng, setCustomStartLng] = useState("");
  // Which stops to actually visit today — not every geocoded record needs to
  // be on the route every time. Empty selection = route everyone visible
  // (the original one-click behavior); a non-empty selection narrows it down.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stopSearch, setStopSearch] = useState("");

  const rows: MapRecord[] = useMemo(() => {
    // A lead always has a linked client at the same address (that's the
    // lead<->client sync rule) — showing both as separate map stops just
    // duplicates the same location, so once a client has an open lead, the
    // lead (which carries the more actionable pipeline stage/value) is what
    // shows on the map, not the bare client entry.
    const customerIdsWithLead = new Set(leads.map(l => l.customer_id).filter(Boolean));
    return [
      ...customers.filter(c => !customerIdsWithLead.has(c.id)).map(r => ({ ...r, kind: "customer" as const })),
      ...leads.map(r => ({ ...r, kind: "lead" as const })),
      ...jobs.map(r => ({ ...r, name: r.title, kind: "job" as const }))
    ].filter(r => r.address || r.city || r.zip);
  }, [customers, leads, jobs]);

  const filtered = useMemo(
    () => filterRowsBySearch(rows.filter(r => matchesMapFilters(r, mapFilters)), searchText),
    [rows, mapFilters, searchText]
  );
  const zips = useMemo(() => unique(rows.map(r => r.zip).filter(Boolean) as string[]), [rows]);
  const cities = useMemo(() => unique(rows.map(r => r.city).filter(Boolean) as string[]), [rows]);

  const withCoords = useMemo(
    () => filtered.filter((r): r is GeocodedRecord => Boolean(Number(r.lat) && Number(r.lng))).map(r => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) })),
    [filtered]
  );
  const withoutCoords = useMemo(() => filtered.filter(r => !(Number(r.lat) && Number(r.lng))), [filtered]);

  // Proximity clusters (real ~5km geographic grouping) for anything already
  // geocoded; records that still need geocoding fall back to the old
  // ZIP-prefix grouping, since that's the only location info they have.
  const proximityGroups = useMemo(() => {
    const groups = clusterByProximity(withCoords, 0.05);
    return Object.values(groups)
      .map(items => ({ label: mostCommonCity(items) || `ZIP ${items[0].zip || "?"}`, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [withCoords]);
  const zipOnlyGroups = useMemo(() => {
    const groups = groupBy(withoutCoords.filter(r => r.zip), r => (r.zip as string).slice(0, 3) || "Other");
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [withoutCoords]);

  const missingCoords = withoutCoords.length;

  const activeFilterCount = Object.values(mapFilters).filter(v => v && v !== "all").length;

  const matchesStopSearch = (item: { name?: string; title?: string; city?: string; zip?: string }) => {
    if (!stopSearch.trim()) return true;
    const q = stopSearch.trim().toLowerCase();
    return [(item as any).name, (item as any).title, item.city, item.zip].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  };
  const visibleProximityGroups = proximityGroups
    .map(g => ({ ...g, items: g.items.filter(matchesStopSearch) }))
    .filter(g => g.items.length);
  const visibleZipOnlyGroups = zipOnlyGroups
    .map(([region, items]) => [region, items.filter(matchesStopSearch)] as const)
    .filter(([, items]) => items.length);

  const openMapRecord = (record: MapRecord) => openRecordModal(record.kind, record as any);

  const geocodeVisible = async () => {
    if (!activeCompanyId) return;
    if (!apiKey) { toast("Add a Google Maps API key in Integrations first."); return; }
    if (!withoutCoords.length) { toast("All visible records already have coordinates."); return; }
    setGeocoding(true);
    try {
      const updated = await geocodeRecords(withoutCoords, activeCompanyId, apiKey);
      toast(`${updated} records geocoded.`);
      invalidate();
    } finally {
      setGeocoding(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleRegionSelected = (items: GeocodedRecord[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = items.every(item => next.has(item.id));
      items.forEach(item => { if (allSelected) next.delete(item.id); else next.add(item.id); });
      return next;
    });
  };

  const selectAllStops = () => setSelectedIds(new Set(withCoords.map(r => r.id)));

  const routeCandidates = selectedIds.size ? withCoords.filter(r => selectedIds.has(r.id)) : withCoords;
  const selectedCount = selectedIds.size || withCoords.length;
  const routeIndexById = routeStops ? new Map(routeStops.map((s, i) => [s.id, i + 1])) : null;

  // Start point: current geolocation (falls back to the first stop if denied/
  // unavailable — currentLocationOrFirstStop, unchanged), the first stop in
  // the list outright, or a custom fixed lat/lng (e.g. the shop/office).
  // Primary path: one Directions API call with waypoints=optimize:true orders
  // every candidate in a single round trip (fetchOptimizedOrder). If that
  // fails (no API key yet, network error, >25 stops) fall back to the
  // client-side nearest-neighbor + 2-opt heuristic (domain/geo.ts) so the
  // feature still works without billing set up.
  const optimizeRoute = async () => {
    if (!routeCandidates.length) { toast("No geocoded records to route yet — geocode some first."); return; }
    let start: LatLng | null = null;
    if (startMode === "custom") {
      const lat = Number(customStartLat), lng = Number(customStartLng);
      if (!customStartLat.trim() || !customStartLng.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        toast("Enter a valid custom start latitude and longitude.");
        return;
      }
      start = { lat, lng };
    } else if (startMode === "first") {
      start = routeCandidates[0];
    }
    setRouting(true);
    try {
      if (!start) start = await currentLocationOrFirstStop(routeCandidates);
      const order = apiKey ? await fetchOptimizedOrder([start, ...routeCandidates], apiKey) : null;
      if (order) {
        // order[0] is always the synthetic start point (index 0 in the array
        // passed above) — drop it and shift the rest back to routeCandidates indices.
        const stops = order.filter(i => i !== 0).map(i => routeCandidates[i - 1]);
        setRouteStops(stops);
      } else {
        const ordered = nearestNeighborRoute(routeCandidates, start);
        setRouteStops(twoOptImprove(ordered));
      }
    } finally {
      setRouting(false);
    }
  };

  // Manual reorder (up/down) after a route's been computed — e.g. the person
  // knows a customer wants to be seen first regardless of distance. Just
  // updates routeStops; GoogleMapCanvas's effect (keyed on routeStops)
  // redraws the numbered pins and re-fetches the real Directions polyline for
  // the new fixed order automatically.
  const moveRouteStop = (index: number, dir: -1 | 1) => {
    setRouteStops(prev => {
      if (!prev) return prev;
      const swapIndex = index + dir;
      if (swapIndex < 0 || swapIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return next;
    });
  };

  const googleMapsUrl = routeStops ? buildGoogleMapsRouteUrl(routeStops) : "";

  return (
    <div className="grid map-layout" style={{ alignItems: "start" }}>
      <section className="card">
        <div className="card-h">
          <div><h3>Company map</h3><span className="sub">{filtered.length} visible location{filtered.length === 1 ? "" : "s"}</span></div>
          <button className="btn ghost slim" onClick={() => setFiltersOpen(v => !v)}>
            <SlidersHorizontal />Filters{activeFilterCount > 0 && <span className="filter-count-badge">{activeFilterCount}</span>}
          </button>
        </div>
        <div className="card-b">
          {filtersOpen && <MapFilterBar zips={zips} cities={cities} services={services} stages={stages} filters={mapFilters} onChange={setMapFilters} />}
          <GoogleMapCanvas records={filtered} routeStops={routeStops} onPinClick={openMapRecord} apiKey={apiKey} />
          <div className="between" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
            <span className={`map-geo-status${missingCoords ? "" : " ok"}`}>
              {missingCoords ? <AlertCircle /> : <CheckCircle />}
              {missingCoords ? `${missingCoords} of ${filtered.length} visible records still need coordinates.` : "All visible records have coordinates."}
            </span>
            <button className="link-btn" onClick={geocodeVisible} disabled={geocoding}><MapPin />{geocoding ? "Geocoding..." : "Geocode records"}</button>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-h">
          <div><h3>Plan a route</h3><span className="sub">Choose the stops you want to visit</span></div>
          <div className="inline-actions">
            {selectedIds.size > 0 && <button className="link-btn" onClick={() => setSelectedIds(new Set())}>Clear</button>}
            <button className="link-btn" onClick={selectAllStops}>Select all</button>
          </div>
        </div>
        <div className="card-b">
          <div className="sub" style={{ fontWeight: 600, marginBottom: 10 }}>
            {selectedCount} of {withCoords.length} stop{withCoords.length === 1 ? "" : "s"} selected
          </div>
          <input className="map-stop-search" placeholder="Search stops" value={stopSearch} onChange={e => setStopSearch(e.target.value)} />
          {visibleProximityGroups.length === 0 && visibleZipOnlyGroups.length === 0 && <div className="empty"><MapPinned />No route groups yet</div>}
          {visibleProximityGroups.map((group, i) => {
            const regionSelected = group.items.every(item => selectedIds.has(item.id));
            return (
            <div className={`route-block${regionSelected ? " selected" : ""}`} key={`geo-${i}`}>
              <div className="between">
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={regionSelected}
                    onChange={() => toggleRegionSelected(group.items)}
                  />
                  <b>{group.label}</b>
                </label>
                <span className="pill">{group.items.length} stop{group.items.length === 1 ? "" : "s"}</span>
              </div>
              {group.items.map(item => (
                <label className={`route-stop${selectedIds.has(item.id) ? " selected" : ""}`} key={item.id} style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    style={{ marginTop: 3 }}
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                  />
                  {routeIndexById?.has(item.id) && <span className="route-order-num" style={{ background: PIN_COLOR[item.kind] }}>{routeIndexById.get(item.id)}</span>}
                  <span>
                    <b style={{ display: "block" }}>{(item as any).name || (item as any).title}</b>
                    <span>{[item.city, item.zip, item.service_type].filter(Boolean).join(" | ")}</span>
                  </span>
                </label>
              ))}
            </div>
            );
          })}
          {visibleZipOnlyGroups.map(([region, items]) => (
            <div className="route-block" key={`zip-${region}`}>
              <div className="between"><b>ZIP {region}xx</b><span className="pill">{items.length} stop{items.length === 1 ? "" : "s"} (not geocoded)</span></div>
              {items.slice(0, 5).map(item => (
                <div className="route-stop" key={item.id}>
                  <b>{(item as any).name || (item as any).title}</b>
                  <span>{[item.city, item.zip, item.service_type].filter(Boolean).join(" | ")}</span>
                </div>
              ))}
            </div>
          ))}

          <div className="route-plan-controls">
            <span className="sub" style={{ fontWeight: 600 }}>Start from</span>
            <Select
              value={startMode}
              onChange={v => setStartMode(v as StartMode)}
              options={[
                { value: "geolocation", label: "My current location" },
                { value: "first", label: "First stop in list" },
                { value: "custom", label: "Custom coordinates" }
              ]}
            />
            {startMode === "custom" && (
              <div className="inline-actions" style={{ marginTop: 8 }}>
                <input placeholder="Latitude" value={customStartLat} onChange={e => setCustomStartLat(e.target.value)} style={{ flex: "0 0 100px" }} />
                <input placeholder="Longitude" value={customStartLng} onChange={e => setCustomStartLng(e.target.value)} style={{ flex: "0 0 100px" }} />
              </div>
            )}
            <button className="btn route-plan-optimize" onClick={optimizeRoute} disabled={routing || !routeCandidates.length}>
              <Route />{routing ? (startMode === "geolocation" ? "Finding your location..." : "Optimizing...") : "Optimize route"}
            </button>
            <div className="sub" style={{ textAlign: "center", marginTop: 6 }}>{selectedCount} stop{selectedCount === 1 ? "" : "s"} selected</div>

            {routeStops && (
              <>
                <div className="inline-actions" style={{ marginTop: 12 }}>
                  <a className="btn slim" href={googleMapsUrl} target="_blank" rel="noreferrer"><Navigation />Open in Google Maps</a>
                  <button className="btn ghost slim" onClick={() => setRouteStops(null)}>Clear route</button>
                </div>
                <div style={{ marginTop: 12 }}>
                  <div className="between" style={{ marginBottom: 8 }}>
                    <span className="sub">Route order — use the arrows to reorder manually</span>
                    <div className="route-legend">
                      <span><span className="route-legend-dot" style={{ background: PIN_COLOR.lead }} />Lead</span>
                      <span><span className="route-legend-dot" style={{ background: PIN_COLOR.customer }} />Client</span>
                      <span><span className="route-legend-dot" style={{ background: PIN_COLOR.job }} />Job</span>
                    </div>
                  </div>
                  <div className="route-order-list">
                    {routeStops.map((s, i) => (
                      <div className="route-order-row" key={s.id}>
                        <span className="route-order-num" style={{ background: PIN_COLOR[s.kind] }}>{i + 1}</span>
                        <span className="route-order-name">{s.name || (s as any).title}</span>
                        <div className="stage-row-order">
                          <button className="btn ghost slim" onClick={() => moveRouteStop(i, -1)} disabled={i === 0} aria-label="Move earlier"><ChevronUp /></button>
                          <button className="btn ghost slim" onClick={() => moveRouteStop(i, 1)} disabled={i === routeStops.length - 1} aria-label="Move later"><ChevronDown /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function mostCommonCity(items: { city?: string }[]): string {
  const counts: Record<string, number> = {};
  items.forEach(i => { if (i.city) counts[i.city] = (counts[i.city] || 0) + 1; });
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? titleize(best[0].toLowerCase()) : "";
}

// Tries the browser's geolocation (so "Optimize route" starts from wherever
// the person clicking it actually is) with a short timeout, falling back to
// the first visible stop when permission is denied/unavailable — this runs
// from a plain button click, not app startup, so it only prompts when asked.
function currentLocationOrFirstStop(stops: GeocodedRecord[]): Promise<LatLng> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(stops[0]); return; }
    const timeout = setTimeout(() => resolve(stops[0]), 4000);
    navigator.geolocation.getCurrentPosition(
      pos => { clearTimeout(timeout); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { clearTimeout(timeout); resolve(stops[0]); },
      { timeout: 3500 }
    );
  });
}

function MapFilterBar({ zips, cities, services, stages, filters, onChange }: {
  zips: string[]; cities: string[]; services: string[]; stages: { id: string; name: string }[];
  filters: typeof DEFAULT_MAP_FILTERS; onChange: (f: typeof DEFAULT_MAP_FILTERS) => void;
}) {
  return (
    <div className="map-filters">
      <Select
        value={filters.zip} onChange={v => onChange({ ...filters, zip: v })}
        options={[{ value: "", label: "All ZIP codes" }, ...zips.map(zip => ({ value: zip, label: zip }))]}
      />
      <Select
        value={filters.city} onChange={v => onChange({ ...filters, city: v })}
        options={[{ value: "", label: "All cities" }, ...cities.map(city => ({ value: city, label: city }))]}
      />
      <Select
        value={filters.service_type} onChange={v => onChange({ ...filters, service_type: v })}
        options={[{ value: "all", label: "All services" }, ...services.map(s => ({ value: s, label: s }))]}
      />
      <Select
        value={filters.lead_status} onChange={v => onChange({ ...filters, lead_status: v })}
        options={[{ value: "all", label: "All lead stages" }, ...stages.map(s => ({ value: s.id, label: s.name }))]}
      />
      <Select
        value={filters.job_status} onChange={v => onChange({ ...filters, job_status: v })}
        options={[{ value: "all", label: "All job statuses" }, ...["planned", "scheduled", "in progress", "complete"].map(s => ({ value: s, label: s }))]}
      />
      <input type="date" value={filters.date} onChange={e => onChange({ ...filters, date: e.target.value })} />
      <button className="btn ghost slim" onClick={() => onChange(DEFAULT_MAP_FILTERS)}>Clear</button>
    </div>
  );
}

const PIN_COLOR: Record<MapRecord["kind"], string> = { lead: "#2f6fed", job: "#d89416", customer: "#10b981" };

function pinIcon(color: string, scale: number): google.maps.Symbol {
  return { path: google.maps.SymbolPath.CIRCLE, scale, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 };
}

function boundsOf(points: LatLng[]): google.maps.LatLngBounds {
  const bounds = new google.maps.LatLngBounds();
  points.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
  return bounds;
}

function GoogleMapCanvas({ records, routeStops, onPinClick, apiKey }: {
  records: MapRecord[]; routeStops: GeocodedRecord[] | null; onPinClick: (r: MapRecord) => void; apiKey: string;
}) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const routeMarkersRef = useRef<google.maps.Marker[]>([]);
  const routeLineRef = useRef<google.maps.Polyline | null>(null);
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Only auto-fit/center the view the first time markers show up — otherwise
  // every re-render (typing in search, a query refetch, anything) would
  // re-run fitBounds and yank the map back, fighting any pan/zoom the user
  // had just done by hand.
  const hasFitRef = useRef(false);

  // `records` is already a stable reference from the parent's useMemo, so
  // this only recomputes when the actual record set changes — not on every
  // render (an inline, unmemoized .filter() here was the original bug: a
  // fresh array every render kept re-triggering the marker effect below).
  const withCoords = useMemo(() => records.filter(r => Number(r.lat) && Number(r.lng)), [records]);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    loadGoogleMapsScript(apiKey)
      .then(() => { if (!cancelled) setReady(true); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [apiKey]);

  // Create the map + a persistent cluster layer once the SDK has loaded
  // (Atlanta default center — same fallback app.js used).
  useEffect(() => {
    if (!ready || !mapElRef.current || mapInstanceRef.current) return;
    const map = new google.maps.Map(mapElRef.current, { center: { lat: 33.749, lng: -84.388 }, zoom: 9 });
    clustererRef.current = new MarkerClusterer({ map });
    mapInstanceRef.current = map;
  }, [ready]);

  // Redraw pins whenever the visible/geocoded record set, or the active
  // route, changes. With an active route: plain (non-clustered) numbered
  // pins in visiting order + a line connecting them, since clustering would
  // hide exactly the stop-by-stop detail a route view needs. Without one:
  // clustered plain pins, better for browsing a dense list at a glance.
  useEffect(() => {
    const map = mapInstanceRef.current;
    const clusterer = clustererRef.current;
    if (!map || !clusterer) return;
    clusterer.clearMarkers();
    routeMarkersRef.current.forEach(m => m.setMap(null));
    routeMarkersRef.current = [];
    routeLineRef.current?.setMap(null);
    routeLineRef.current = null;
    let cancelled = false;

    if (routeStops && routeStops.length) {
      routeMarkersRef.current = routeStops.map((record, index) => {
        const marker = new google.maps.Marker({
          position: { lat: record.lat, lng: record.lng },
          label: { text: String(index + 1), color: "#fff", fontWeight: "700", fontSize: "12px" },
          icon: pinIcon(PIN_COLOR[record.kind], 13),
          title: record.name || (record as any).title || record.kind,
          map
        });
        marker.addListener("click", () => onPinClickRef.current(record));
        return marker;
      });
      const straightLine = routeStops.map(r => ({ lat: r.lat, lng: r.lng }));
      // Straight line is the instant, always-available preview;
      // fetchRoutePolyline() below swaps it for the real road-following path
      // once (if) Directions responds for this exact stop order.
      const routeLine = new google.maps.Polyline({ path: straightLine, strokeColor: "#f97316", strokeWeight: 3, strokeOpacity: 0.85, map });
      routeLineRef.current = routeLine;
      // A single-stop route gives fitBounds a zero-area box, which zooms in
      // to the map's max zoom — a street-level close-up with no surrounding
      // context. A fixed zoom for one stop keeps the view usable.
      if (routeStops.length === 1) {
        map.setCenter({ lat: routeStops[0].lat, lng: routeStops[0].lng });
        map.setZoom(14);
      } else {
        map.fitBounds(boundsOf(straightLine), 24);
        if (apiKey) {
          fetchRoutePolyline(straightLine, apiKey).then(line => {
            if (cancelled || !line) return;
            routeLine.setPath(line);
          });
        }
      }
    } else {
      const markers = withCoords.map(record => {
        const marker = new google.maps.Marker({
          position: { lat: Number(record.lat), lng: Number(record.lng) },
          icon: pinIcon(PIN_COLOR[record.kind], 9),
          title: record.name || (record as any).title || record.kind
        });
        marker.addListener("click", () => onPinClickRef.current(record));
        return marker;
      });
      clusterer.addMarkers(markers);
      if (!hasFitRef.current && withCoords.length) {
        hasFitRef.current = true;
        if (withCoords.length > 1) {
          map.fitBounds(boundsOf(withCoords.map(r => ({ lat: Number(r.lat), lng: Number(r.lng) }))), 24);
        } else {
          map.setCenter({ lat: Number(withCoords[0].lat), lng: Number(withCoords[0].lng) });
          map.setZoom(12);
        }
      }
    }

    return () => { cancelled = true; };
  }, [ready, withCoords, routeStops, apiKey]);

  const fitAll = () => {
    const map = mapInstanceRef.current;
    if (!map || !withCoords.length) return;
    if (withCoords.length > 1) {
      map.fitBounds(boundsOf(withCoords.map(r => ({ lat: Number(r.lat), lng: Number(r.lng) }))), 24);
    } else {
      map.setCenter({ lat: Number(withCoords[0].lat), lng: Number(withCoords[0].lng) });
      map.setZoom(12);
    }
  };

  if (!apiKey) {
    return <div className="map-canvas empty"><MapPinned />Add a Google Maps API key in Integrations to enable the map.</div>;
  }
  if (loadError) {
    return <div className="map-canvas empty"><AlertCircle />Could not load Google Maps. Check the API key in Integrations.</div>;
  }

  return (
    <div style={{ position: "relative" }}>
      <div ref={mapElRef} className="map-canvas" />
      <button className="map-fit-btn" onClick={fitAll} disabled={!withCoords.length} title="Fit all visible pins"><Maximize2 />Fit all</button>
      {ready && !withCoords.length && !routeStops && <div className="map-empty">No geocoded records to show yet — click "Geocode records" below.</div>}
    </div>
  );
}
