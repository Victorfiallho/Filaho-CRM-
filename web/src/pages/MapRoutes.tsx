import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle, ChevronDown, ChevronRight, MapPin, MapPinned, Maximize2, Navigation, Route, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import PageSkeleton from "../components/PageSkeleton";
import Select from "../components/Select";
import { useCustomers, useIntegrationSettings, useInvalidateCompanyData, useJobs, useLeads } from "../data/hooks";
import { geocodeRecords } from "../data/geocoding";
import { fetchRoutePolyline, fetchOptimizedOrder } from "../data/routing";
import { titleize, unique } from "../domain/format";
import { buildGoogleMapsRouteUrl, clusterByProximity, nearestNeighborRoute, twoOptImprove, type LatLng } from "../domain/geo";
import { countStopsByKind, DEFAULT_MAP_FILTERS, matchesMapFilters, matchesStopQuery, type StopKindFilter } from "../domain/mapUtils";
import { filterRowsBySearch } from "../domain/search";
import type { MapRecord } from "../domain/types";
import { useT } from "../i18n/I18nContext";
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
  const { t, tn } = useT();
  const { data: customers = [], isLoading: customersLoading } = useCustomers(activeCompanyId);
  const { data: leads = [], isLoading: leadsLoading } = useLeads(activeCompanyId);
  const { data: jobs = [], isLoading: jobsLoading } = useJobs(activeCompanyId);
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
  const [kindFilter, setKindFilter] = useState<StopKindFilter>("all");
  // Areas start collapsed — with every stop of every area expanded the list
  // ran thousands of pixels and pushed "Optimize route" off the page.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showUngeocoded, setShowUngeocoded] = useState(false);

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
      .map(items => ({ label: mostCommonCity(items) || t("map.zipGroup", { zip: items[0].zip || "?" }), items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [withCoords, t]);

  const missingCoords = withoutCoords.length;

  const activeFilterCount = Object.values(mapFilters).filter(v => v && v !== "all").length;

  const stageNameById = useMemo(() => new Map(stages.map(st => [st.id, st.name])), [stages]);
  const kindCounts = useMemo(() => countStopsByKind(filtered), [filtered]);
  const stopMatches = (item: MapRecord) =>
    (kindFilter === "all" || item.kind === kindFilter) &&
    matchesStopQuery(item, stopSearch, item.stage_id ? stageNameById.get(item.stage_id) : undefined);
  // While searching or filtering by type, every area with a match opens so
  // the matches are visible without clicking into each one.
  const narrowing = Boolean(stopSearch.trim()) || kindFilter !== "all";
  const visibleProximityGroups = proximityGroups
    .map(g => ({ ...g, key: `${g.label}|${g.items[0]?.id}`, items: g.items.filter(stopMatches) }))
    .filter(g => g.items.length);
  const visibleUngeocoded = withoutCoords.filter(stopMatches);
  const visibleStops = visibleProximityGroups.flatMap(g => g.items);
  const isExpanded = (key: string) => narrowing || visibleProximityGroups.length === 1 || expandedGroups.has(key);
  const toggleExpanded = (key: string) => setExpandedGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const openMapRecord = (record: MapRecord) => openRecordModal(record.kind, record as any);

  const geocodeVisible = async () => {
    if (!activeCompanyId) return;
    if (!apiKey) { toast(t("map.t.needKey")); return; }
    if (!withoutCoords.length) { toast(t("map.t.allHave")); return; }
    setGeocoding(true);
    try {
      const updated = await geocodeRecords(withoutCoords, activeCompanyId, apiKey);
      toast(tn("map.t.geocoded", updated));
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

  // Adds what's currently shown (after search/type filter) to the selection,
  // so "search Duluth → Select shown" builds a route for just that area.
  const selectShownStops = () => setSelectedIds(prev => new Set([...prev, ...visibleStops.map(r => r.id)]));

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
    if (!routeCandidates.length) { toast(t("map.t.noGeocoded")); return; }
    let start: LatLng | null = null;
    if (startMode === "custom") {
      const lat = Number(customStartLat), lng = Number(customStartLng);
      if (!customStartLat.trim() || !customStartLng.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        toast(t("map.t.badStart"));
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

  if (customersLoading || leadsLoading || jobsLoading) return <PageSkeleton cards={2} rows={[12, 10]} />;

  return (
    <div className="grid map-layout" style={{ alignItems: "start" }}>
      <section className="card">
        <div className="card-h">
          <div><h3>{t("map.title")}</h3><span className="sub">{tn("map.visible", filtered.length)}</span></div>
          <button className={`btn ghost slim${filtersOpen ? " is-on" : ""}`} onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen}>
            <SlidersHorizontal aria-hidden="true" />{t("map.filters")}{activeFilterCount > 0 && <span className="filter-count-badge">{activeFilterCount}</span>}
          </button>
        </div>
        <div className="card-b">
          {filtersOpen && <MapFilterBar zips={zips} cities={cities} services={services} stages={stages} filters={mapFilters} onChange={setMapFilters} />}
          <GoogleMapCanvas records={filtered} routeStops={routeStops} onPinClick={openMapRecord} apiKey={apiKey} />
          <div className="between" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
            <span className={`map-geo-status${missingCoords ? "" : " ok"}`}>
              {missingCoords ? <AlertCircle aria-hidden="true" /> : <CheckCircle aria-hidden="true" />}
              {missingCoords ? t("map.missing", { missing: missingCoords, total: filtered.length }) : t("map.allCoords")}
            </span>
            <button className="btn ghost slim" onClick={geocodeVisible} disabled={geocoding}><MapPin aria-hidden="true" />{geocoding ? t("map.geocoding") : t("map.geocode")}</button>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-h">
          <div><h3>{t("map.plan")}</h3><span className="sub">{t("map.planSub")}</span></div>
          <div className="inline-actions">
            {selectedIds.size > 0 && <button className="btn ghost slim" onClick={() => setSelectedIds(new Set())}>{t("map.clear")}</button>}
            <button className="btn ghost slim" onClick={selectShownStops} disabled={!visibleStops.length}>{narrowing ? t("map.selectShown") : t("map.selectAll")}</button>
          </div>
        </div>
        <div className="card-b">
          <label className="map-stop-search-wrap">
            <Search aria-hidden="true" />
            <input
              className="map-stop-search"
              placeholder={t("map.searchPh")}
              value={stopSearch}
              onChange={e => setStopSearch(e.target.value)}
              aria-label={t("map.searchLabel")}
            />
          </label>
          <div className="stop-kind-filter" role="group" aria-label={t("map.kindGroup")}>
            {(["all", "lead", "customer", "job"] as StopKindFilter[]).map(k => (
              <button key={k} type="button" className={kindFilter === k ? "active" : ""} aria-pressed={kindFilter === k} onClick={() => setKindFilter(k)}>
                {k !== "all" && <span className="route-legend-dot" style={{ background: PIN_COLOR[k] }} />}
                {t(`map.kind.${k}`)}<span className="count">{kindCounts[k]}</span>
              </button>
            ))}
          </div>
          <div className="sub stop-list-status">
            {tn("map.selectedOf", withCoords.length, { selected: selectedCount })}
            {narrowing && <> · {tn("map.matches", visibleStops.length + visibleUngeocoded.length)}</>}
            {narrowing && <button className="link-btn" onClick={() => { setStopSearch(""); setKindFilter("all"); }}>{t("map.clearSearch")}</button>}
          </div>
          <div className="stop-list">
            {visibleProximityGroups.length === 0 && visibleUngeocoded.length === 0 && (
              <div className="empty"><MapPinned aria-hidden="true" />{narrowing ? t("map.noMatch") : t("map.noGroups")}</div>
            )}
            {visibleProximityGroups.map(group => {
              const selectedInGroup = group.items.filter(item => selectedIds.has(item.id)).length;
              const regionSelected = selectedInGroup === group.items.length;
              const open = isExpanded(group.key);
              return (
                <div className={`route-block${regionSelected ? " selected" : ""}`} key={group.key}>
                  <div className="stop-group-head">
                    <input
                      type="checkbox"
                      checked={regionSelected}
                      ref={el => { if (el) el.indeterminate = selectedInGroup > 0 && !regionSelected; }}
                      onChange={() => toggleRegionSelected(group.items)}
                      aria-label={t("map.selectArea", { area: group.label })}
                    />
                    <button type="button" className="stop-group-toggle" onClick={() => toggleExpanded(group.key)} aria-expanded={open}>
                      {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                      <b>{group.label}</b>
                    </button>
                    <span className="badge-tone tone-slate">{selectedInGroup > 0 ? `${selectedInGroup}/` : ""}{tn("map.stops", group.items.length)}</span>
                  </div>
                  {open && group.items.map(item => (
                    <label className={`route-stop selectable${selectedIds.has(item.id) ? " selected" : ""}`} key={item.id}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                      />
                      {routeIndexById?.has(item.id)
                        ? <span className="route-order-num" style={{ background: PIN_COLOR[item.kind] }}>{routeIndexById.get(item.id)}</span>
                        : <span className="route-legend-dot" style={{ background: PIN_COLOR[item.kind] }} title={t(`map.one.${item.kind}`)} />}
                      <span className="route-stop-text">
                        <b>{(item as any).name || (item as any).title}</b>
                        <span className="sub">{[item.address, item.city, item.zip, item.service_type].filter(Boolean).join(" · ")}</span>
                      </span>
                    </label>
                  ))}
                </div>
              );
            })}
            {visibleUngeocoded.length > 0 && (
              <div className="route-block">
                <div className="stop-group-head">
                  <button type="button" className="stop-group-toggle" onClick={() => setShowUngeocoded(v => !v)} aria-expanded={showUngeocoded || narrowing}>
                    {showUngeocoded || narrowing ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                    <b>{t("map.needCoords")}</b>
                  </button>
                  <span className="badge-tone tone-amber">{visibleUngeocoded.length}</span>
                </div>
                <div className="sub" style={{ marginTop: 6 }}>
                  {t("map.notRoutable")} <button className="link-btn" onClick={geocodeVisible} disabled={geocoding}>{geocoding ? t("map.geocoding") : t("map.geocodeNow")}</button>
                </div>
                {(showUngeocoded || narrowing) && visibleUngeocoded.map(item => (
                  <div className="route-stop" key={item.id}>
                    <span className="route-stop-text">
                      <b>{(item as any).name || (item as any).title}</b>
                      <span className="sub">{[item.address, item.city, item.zip, item.service_type].filter(Boolean).join(" · ")}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="route-plan-controls">
            <span className="field-label">{t("map.startFrom")}</span>
            <Select
              aria-label={t("map.startFrom")}
              value={startMode}
              onChange={v => setStartMode(v as StartMode)}
              options={[
                { value: "geolocation", label: t("map.start.geolocation") },
                { value: "first", label: t("map.start.first") },
                { value: "custom", label: t("map.start.custom") }
              ]}
            />
            {startMode === "custom" && (
              <div className="route-custom-start">
                <input placeholder={t("map.lat")} aria-label={t("map.lat")} inputMode="decimal" value={customStartLat} onChange={e => setCustomStartLat(e.target.value)} />
                <input placeholder={t("map.lng")} aria-label={t("map.lng")} inputMode="decimal" value={customStartLng} onChange={e => setCustomStartLng(e.target.value)} />
              </div>
            )}
            <button className="btn route-plan-optimize" onClick={optimizeRoute} disabled={routing || !routeCandidates.length}>
              <Route aria-hidden="true" />{routing ? (startMode === "geolocation" ? t("map.findingLocation") : t("map.optimizing")) : t("map.optimize")}
            </button>
            <div className="sub" style={{ textAlign: "center" }}>{tn("map.stopsSelected", selectedCount)}</div>

            {routeStops && (
              <>
                <div className="inline-actions">
                  <a className="btn slim" href={googleMapsUrl} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" />{t("map.openGoogle")}</a>
                  <button className="btn ghost slim" onClick={() => setRouteStops(null)}>{t("map.clearRoute")}</button>
                </div>
                <div>
                  <div className="between" style={{ marginBottom: 8, flexWrap: "wrap" }}>
                    <span className="sub">{t("map.routeOrder")}</span>
                    <div className="route-legend">
                      <span><span className="route-legend-dot" style={{ background: PIN_COLOR.lead }} />{t("map.one.lead")}</span>
                      <span><span className="route-legend-dot" style={{ background: PIN_COLOR.customer }} />{t("map.one.customer")}</span>
                      <span><span className="route-legend-dot" style={{ background: PIN_COLOR.job }} />{t("map.one.job")}</span>
                    </div>
                  </div>
                  <div className="route-order-list">
                    {routeStops.map((s, i) => (
                      <div className="route-order-row" key={s.id}>
                        <span className="route-order-num" style={{ background: PIN_COLOR[s.kind] }}>{i + 1}</span>
                        <span className="route-order-name">{s.name || (s as any).title}</span>
                        <button className="round-btn" onClick={() => moveRouteStop(i, -1)} disabled={i === 0} aria-label={t("map.moveEarlier")}><ArrowUp aria-hidden="true" /></button>
                        <button className="round-btn" onClick={() => moveRouteStop(i, 1)} disabled={i === routeStops.length - 1} aria-label={t("map.moveLater")}><ArrowDown aria-hidden="true" /></button>
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
  const { t } = useT();
  return (
    <div className="map-filters">
      <Select
        value={filters.zip} onChange={v => onChange({ ...filters, zip: v })}
        options={[{ value: "", label: t("map.f.allZips") }, ...zips.map(zip => ({ value: zip, label: zip }))]}
      />
      <Select
        value={filters.city} onChange={v => onChange({ ...filters, city: v })}
        options={[{ value: "", label: t("map.f.allCities") }, ...cities.map(city => ({ value: city, label: city }))]}
      />
      <Select
        value={filters.service_type} onChange={v => onChange({ ...filters, service_type: v })}
        options={[{ value: "all", label: t("map.f.allServices") }, ...services.map(s => ({ value: s, label: s }))]}
      />
      <Select
        value={filters.lead_status} onChange={v => onChange({ ...filters, lead_status: v })}
        options={[{ value: "all", label: t("map.f.allStages") }, ...stages.map(s => ({ value: s.id, label: s.name }))]}
      />
      <Select
        value={filters.job_status} onChange={v => onChange({ ...filters, job_status: v })}
        options={[{ value: "all", label: t("map.f.allJobStatuses") }, ...(["planned", "scheduled", "in progress", "complete"] as const).map(s => ({ value: s, label: t(`status.${s}`) }))]}
      />
      <input type="date" aria-label={t("map.f.date")} value={filters.date} onChange={e => onChange({ ...filters, date: e.target.value })} />
      <button className="btn ghost slim" onClick={() => onChange(DEFAULT_MAP_FILTERS)}>{t("map.clear")}</button>
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
  const { t } = useT();
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
    return <div className="map-canvas empty"><MapPinned aria-hidden="true" />{t("map.c.noKey")}</div>;
  }
  if (loadError) {
    return <div className="map-canvas empty"><AlertCircle aria-hidden="true" />{t("map.c.loadError")}</div>;
  }

  return (
    <div style={{ position: "relative" }}>
      <div ref={mapElRef} className="map-canvas" />
      <button className="map-fit-btn" onClick={fitAll} disabled={!withCoords.length} title={t("map.c.fitTitle")}><Maximize2 aria-hidden="true" />{t("map.c.fit")}</button>
      {ready && !withCoords.length && !routeStops && <div className="map-empty">{t("map.c.empty")}</div>}
    </div>
  );
}
