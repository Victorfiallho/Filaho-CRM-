import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Select from "../components/Select";
import { useCustomers, useInvalidateCompanyData, useJobs, useLeads } from "../data/hooks";
import { geocodeRecords } from "../data/geocoding";
import { groupBy, titleize, unique } from "../domain/format";
import { buildGoogleMapsRouteUrl, clusterByProximity, nearestNeighborRoute, type LatLng } from "../domain/geo";
import { DEFAULT_MAP_FILTERS, matchesMapFilters } from "../domain/mapUtils";
import { filterRowsBySearch } from "../domain/search";
import type { MapRecord } from "../domain/types";
import { toast } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useMapFilters } from "../state/MapContext";
import { useModal } from "../state/ModalContext";
import { useSearch } from "../state/SearchContext";

type GeocodedRecord = MapRecord & LatLng;

// Ported from app.js (renderMapRoutes, mapRecords, matchesMapFilters, mapPin,
// geocodeVisibleRecords, openMapRecord), then extended well past the original
// MVP at the user's request: OpenStreetMap tiles instead of Google Maps (no
// API key), marker clustering for dense areas, a nearest-neighbor route
// order with a one-click "open in Google Maps" link, and proximity-based
// (not just ZIP-prefix) region grouping.
export default function MapRoutes() {
  const { activeCompanyId, stages, services } = useCompany();
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);
  const { mapFilters, setMapFilters } = useMapFilters();
  const { searchText } = useSearch();
  const { openRecordModal } = useModal();
  const invalidate = useInvalidateCompanyData(activeCompanyId);
  const [geocoding, setGeocoding] = useState(false);
  const [routeStops, setRouteStops] = useState<GeocodedRecord[] | null>(null);
  const [routing, setRouting] = useState(false);
  // Which stops to actually visit today — not every geocoded record needs to
  // be on the route every time. Empty selection = route everyone visible
  // (the original one-click behavior); a non-empty selection narrows it down.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  const openMapRecord = (record: MapRecord) => openRecordModal(record.kind, record as any);

  const geocodeVisible = async () => {
    if (!activeCompanyId) return;
    if (!withoutCoords.length) { toast("All visible records already have coordinates."); return; }
    setGeocoding(true);
    try {
      const updated = await geocodeRecords(withoutCoords, activeCompanyId);
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

  const routeCandidates = selectedIds.size ? withCoords.filter(r => selectedIds.has(r.id)) : withCoords;

  const optimizeRoute = async () => {
    if (!routeCandidates.length) { toast("No geocoded records to route yet — geocode some first."); return; }
    setRouting(true);
    try {
      const start = await currentLocationOrFirstStop(routeCandidates);
      setRouteStops(nearestNeighborRoute(routeCandidates, start));
    } finally {
      setRouting(false);
    }
  };

  const googleMapsUrl = routeStops ? buildGoogleMapsRouteUrl(routeStops) : "";

  return (
    <div className="grid map-layout" style={{ alignItems: "start" }}>
      <section className="card">
        <div className="card-h">
          <div><h3>Company map</h3><span className="sub">OpenStreetMap tiles — no API key needed</span></div>
          <span className="pill">{filtered.length} records</span>
        </div>
        <div className="card-b">
          <MapFilterBar zips={zips} cities={cities} services={services} stages={stages} filters={mapFilters} onChange={setMapFilters} />
          <LeafletMapCanvas records={filtered} routeStops={routeStops} onPinClick={openMapRecord} />
          <div className="between" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
            <span className="sub">
              {missingCoords ? `${missingCoords} of ${filtered.length} visible records still need coordinates.` : "All visible records have coordinates."}
            </span>
            <div className="inline-actions">
              <button className="btn ghost slim" onClick={geocodeVisible} disabled={geocoding}>{geocoding ? "Geocoding..." : "Geocode visible records"}</button>
              {selectedIds.size > 0 && (
                <button className="btn ghost slim" onClick={() => setSelectedIds(new Set())}>Clear selection ({selectedIds.size})</button>
              )}
              <button className="btn ghost slim" onClick={optimizeRoute} disabled={routing || !routeCandidates.length}>
                {routing ? "Finding your location..." : selectedIds.size ? `Optimize route (${selectedIds.size} selected)` : "Optimize route (all visible)"}
              </button>
              {routeStops && (
                <>
                  <a className="btn slim" href={googleMapsUrl} target="_blank" rel="noreferrer">Open in Google Maps</a>
                  <button className="btn ghost slim" onClick={() => setRouteStops(null)}>Clear route</button>
                </>
              )}
            </div>
          </div>
          {routeStops && (
            <div className="empty" style={{ marginTop: 10, textAlign: "left" }}>
              <b>Route order ({routeStops.length} stops):</b> {routeStops.map((s, i) => `${i + 1}. ${s.name || (s as any).title}`).join("  →  ")}
            </div>
          )}
        </div>
      </section>
      <section className="card">
        <div className="card-h">
          <div><h3>Route regions</h3><span className="sub">Grouped by real proximity</span></div>
          <span className="sub">Check stops to route only those</span>
        </div>
        <div className="card-b">
          {proximityGroups.length === 0 && zipOnlyGroups.length === 0 && <div className="empty">No route groups yet</div>}
          {proximityGroups.map((group, i) => {
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
                <span className="pill">{group.items.length} stops</span>
              </div>
              {group.items.map(item => (
                <label className={`route-stop${selectedIds.has(item.id) ? " selected" : ""}`} key={item.id} style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    style={{ marginTop: 3 }}
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                  />
                  <span>
                    <b style={{ display: "block" }}>{(item as any).name || (item as any).title}</b>
                    <span>{[item.city, item.zip, item.service_type].filter(Boolean).join(" | ")}</span>
                  </span>
                </label>
              ))}
            </div>
            );
          })}
          {zipOnlyGroups.map(([region, items]) => (
            <div className="route-block" key={`zip-${region}`}>
              <div className="between"><b>Region {region}xx</b><span className="pill">{items.length} stops (not geocoded)</span></div>
              {items.slice(0, 5).map(item => (
                <div className="route-stop" key={item.id}>
                  <b>{(item as any).name || (item as any).title}</b>
                  <span>{[item.city, item.zip, item.service_type].filter(Boolean).join(" | ")}</span>
                </div>
              ))}
            </div>
          ))}
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

function numberedDivIcon(color: string, label: string | number) {
  return L.divIcon({
    className: "route-pin",
    html: `<span style="background:${color}">${label}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

function LeafletMapCanvas({ records, routeStops, onPinClick }: { records: MapRecord[]; routeStops: GeocodedRecord[] | null; onPinClick: (r: MapRecord) => void }) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const onPinClickRef = useRef(onPinClick);
  onPinClickRef.current = onPinClick;
  // Only auto-fit/center the view the first time markers show up — otherwise
  // every re-render (typing in search, a query refetch, anything) would
  // re-run fitBounds/setView and yank the map back, fighting any pan/zoom
  // the user had just done by hand.
  const hasFitRef = useRef(false);

  // `records` is already a stable reference from the parent's useMemo, so
  // this only recomputes when the actual record set changes — not on every
  // render (an inline, unmemoized .filter() here was the original bug: a
  // fresh array every render kept re-triggering the marker effect below).
  const withCoords = useMemo(() => records.filter(r => Number(r.lat) && Number(r.lng)), [records]);

  // Create the map + a persistent cluster layer once (Atlanta default center
  // — same fallback app.js used).
  useEffect(() => {
    if (!mapElRef.current || mapInstanceRef.current) return;
    const map = L.map(mapElRef.current, { center: [33.749, -84.388], zoom: 9 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    clusterGroupRef.current = L.markerClusterGroup({ maxClusterRadius: 50 });
    map.addLayer(clusterGroupRef.current);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    return () => { map.remove(); mapInstanceRef.current = null; clusterGroupRef.current = null; routeLayerRef.current = null; };
  }, []);

  // Redraw pins whenever the visible/geocoded record set, or the active
  // route, changes. With an active route: plain (non-clustered) numbered
  // pins in visiting order + a dashed line connecting them, since clustering
  // would hide exactly the stop-by-stop detail a route view needs. Without
  // one: clustered plain pins, better for browsing a dense list at a glance.
  useEffect(() => {
    const map = mapInstanceRef.current;
    const clusterGroup = clusterGroupRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !clusterGroup || !routeLayer) return;
    clusterGroup.clearLayers();
    routeLayer.clearLayers();

    if (routeStops && routeStops.length) {
      routeStops.forEach((record, index) => {
        const marker = L.marker([record.lat, record.lng], { icon: numberedDivIcon(PIN_COLOR[record.kind], index + 1) });
        marker.bindTooltip(record.name || (record as any).title || record.kind);
        marker.on("click", () => onPinClickRef.current(record));
        marker.addTo(routeLayer);
      });
      L.polyline(routeStops.map(r => [r.lat, r.lng] as [number, number]), { color: "#f97316", weight: 3, dashArray: "6 8" }).addTo(routeLayer);
      const bounds = L.latLngBounds(routeStops.map(r => [r.lat, r.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [24, 24] });
      return;
    }

    withCoords.forEach(record => {
      const marker = L.circleMarker([Number(record.lat), Number(record.lng)], {
        radius: 9, color: "#fff", weight: 2, fillColor: PIN_COLOR[record.kind], fillOpacity: 1
      });
      marker.bindTooltip(record.name || (record as any).title || record.kind);
      marker.on("click", () => onPinClickRef.current(record));
      clusterGroup.addLayer(marker);
    });
    if (!hasFitRef.current && withCoords.length) {
      hasFitRef.current = true;
      if (withCoords.length > 1) {
        map.fitBounds(L.latLngBounds(withCoords.map(r => [Number(r.lat), Number(r.lng)] as [number, number])), { padding: [24, 24] });
      } else {
        map.setView([Number(withCoords[0].lat), Number(withCoords[0].lng)], 12);
      }
    }
  }, [withCoords, routeStops]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={mapElRef} className="leaflet-map-canvas" />
      {!withCoords.length && !routeStops && <div className="map-empty">No geocoded records to show yet — click "Geocode visible records" below.</div>}
    </div>
  );
}
