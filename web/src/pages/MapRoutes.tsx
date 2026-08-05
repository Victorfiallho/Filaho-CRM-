import { useEffect, useMemo, useRef, useState } from "react";
import { useCustomers, useIntegrationSettings, useInvalidateCompanyData, useJobs, useLeads } from "../data/hooks";
import { geocodeRecords } from "../data/geocoding";
import { groupBy, unique } from "../domain/format";
import { DEFAULT_MAP_FILTERS, matchesMapFilters, pseudoPosition } from "../domain/mapUtils";
import type { MapRecord } from "../domain/types";
import { loadGoogleMaps } from "../lib/googleMaps";
import { toast } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useMapFilters } from "../state/MapContext";
import { useModal } from "../state/ModalContext";

// Ported verbatim from app.js (renderMapRoutes, mapRecords, matchesMapFilters,
// mapPin, googleMapsReady, loadGoogleMaps, renderGoogleMap, geocodeVisibleRecords,
// pseudoPosition, openMapRecord).
export default function MapRoutes() {
  const { activeCompanyId, stages, services } = useCompany();
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);
  const { data: settings } = useIntegrationSettings();
  const { mapFilters, setMapFilters } = useMapFilters();
  const { openRecordModal } = useModal();
  const invalidate = useInvalidateCompanyData(activeCompanyId);
  const [geocoding, setGeocoding] = useState(false);

  const rows: MapRecord[] = useMemo(() => [
    ...customers.map(r => ({ ...r, kind: "customer" as const })),
    ...leads.map(r => ({ ...r, kind: "lead" as const })),
    ...jobs.map(r => ({ ...r, name: r.title, kind: "job" as const }))
  ].filter(r => r.address || r.city || r.zip), [customers, leads, jobs]);

  const filtered = useMemo(() => rows.filter(r => matchesMapFilters(r, mapFilters)), [rows, mapFilters]);
  const zips = useMemo(() => unique(rows.map(r => r.zip).filter(Boolean) as string[]), [rows]);
  const cities = useMemo(() => unique(rows.map(r => r.city).filter(Boolean) as string[]), [rows]);
  const regionGroups = useMemo(() => {
    const groups = groupBy(filtered.filter(r => r.zip), r => (r.zip as string).slice(0, 3) || "Other");
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const apiKey = settings?.google_maps.api_key || "";
  const mapsReady = Boolean(apiKey);

  const openMapRecord = (record: MapRecord) => openRecordModal(record.kind, record as any);

  const geocodeVisible = async () => {
    if (!apiKey) { toast("Add a Google Maps API key first."); return; }
    if (!activeCompanyId) return;
    const candidates = filtered.filter(r => !Number(r.lat) || !Number(r.lng));
    if (!candidates.length) { toast("All visible records already have coordinates."); return; }
    setGeocoding(true);
    try {
      const updated = await geocodeRecords(candidates, activeCompanyId, apiKey);
      toast(`${updated} records geocoded.`);
      invalidate();
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: "1.4fr .8fr", alignItems: "start" }}>
      <section className="card">
        <div className="card-h">
          <div><h3>Company map</h3><span className="sub">Visual planning map now, Google Maps API later</span></div>
          <span className="pill">{filtered.length} records</span>
        </div>
        <div className="card-b">
          <MapFilterBar zips={zips} cities={cities} services={services} stages={stages} filters={mapFilters} onChange={setMapFilters} />
          <GoogleMapCanvas records={filtered} apiKey={apiKey} onPinClick={openMapRecord} />
          <div className="between" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <span className="sub">{mapsReady ? "Google Maps is connected for markers and map display." : "Add a Google Maps API key in Integrations to enable real Google map tiles and geocoding."}</span>
            <button className="btn ghost slim" onClick={geocodeVisible} disabled={geocoding}>{geocoding ? "Geocoding..." : "Geocode visible records"}</button>
          </div>
        </div>
      </section>
      <section className="card">
        <div className="card-h"><h3>Route regions</h3><span className="sub">Grouped by ZIP prefix</span></div>
        <div className="card-b">
          {regionGroups.length ? regionGroups.map(([region, items]) => (
            <div className="route-block" key={region}>
              <div className="between"><b>Region {region}xx</b><span className="pill">{items.length} stops</span></div>
              {items.slice(0, 5).map(item => (
                <div className="route-stop" key={item.id}>
                  <b>{(item as any).name || (item as any).title}</b>
                  <span>{[item.city, item.zip, item.service_type].filter(Boolean).join(" | ")}</span>
                </div>
              ))}
            </div>
          )) : <div className="empty">No route groups yet</div>}
        </div>
      </section>
    </div>
  );
}

function MapFilterBar({ zips, cities, services, stages, filters, onChange }: {
  zips: string[]; cities: string[]; services: string[]; stages: { id: string; name: string }[];
  filters: typeof DEFAULT_MAP_FILTERS; onChange: (f: typeof DEFAULT_MAP_FILTERS) => void;
}) {
  return (
    <div className="map-filters">
      <select value={filters.zip} onChange={e => onChange({ ...filters, zip: e.target.value })}>
        <option value="">All ZIP codes</option>
        {zips.map(zip => <option key={zip} value={zip}>{zip}</option>)}
      </select>
      <select value={filters.city} onChange={e => onChange({ ...filters, city: e.target.value })}>
        <option value="">All cities</option>
        {cities.map(city => <option key={city} value={city}>{city}</option>)}
      </select>
      <select value={filters.service_type} onChange={e => onChange({ ...filters, service_type: e.target.value })}>
        <option value="all">All services</option>
        {services.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={filters.lead_status} onChange={e => onChange({ ...filters, lead_status: e.target.value })}>
        <option value="all">All lead stages</option>
        {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select value={filters.job_status} onChange={e => onChange({ ...filters, job_status: e.target.value })}>
        <option value="all">All job statuses</option>
        {["planned", "scheduled", "in progress", "complete"].map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <input type="date" value={filters.date} onChange={e => onChange({ ...filters, date: e.target.value })} />
      <button className="btn ghost slim" onClick={() => onChange(DEFAULT_MAP_FILTERS)}>Clear</button>
    </div>
  );
}

function GoogleMapCanvas({ records, apiKey, onPinClick }: { records: MapRecord[]; apiKey: string; onPinClick: (r: MapRecord) => void }) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  // Mirrors app.js's renderGoogleMap: fallback pins stay visible until the
  // Maps script has actually loaded and the map/markers are drawn.
  const [showGoogleMap, setShowGoogleMap] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!apiKey) { setShowGoogleMap(false); return; }
    loadGoogleMaps(apiKey)
      .then(maps => {
        if (cancelled || !mapElRef.current) return;
        const withCoords = records.filter(r => Number(r.lat) && Number(r.lng));
        const center = withCoords[0] ? { lat: Number(withCoords[0].lat), lng: Number(withCoords[0].lng) } : { lat: 33.749, lng: -84.388 };
        mapInstanceRef.current = new maps.Map(mapElRef.current, { center, zoom: withCoords.length ? 10 : 9, mapTypeControl: false, streetViewControl: false });
        markersRef.current.forEach(m => m.setMap(null));
        markersRef.current = withCoords.map(record => {
          const marker = new maps.Marker({ position: { lat: Number(record.lat), lng: Number(record.lng) }, map: mapInstanceRef.current, title: record.name || (record as any).title || record.kind });
          marker.addListener("click", () => onPinClick(record));
          return marker;
        });
        if (withCoords.length > 1) {
          const bounds = new maps.LatLngBounds();
          withCoords.forEach(r => bounds.extend({ lat: Number(r.lat), lng: Number(r.lng) }));
          mapInstanceRef.current.fitBounds(bounds);
        }
        setShowGoogleMap(true);
      })
      .catch(() => {
        if (!cancelled) { setShowGoogleMap(false); toast("Google Maps could not load. Check the API key."); }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, records]);

  return (
    <>
      <div id="googleMap" ref={mapElRef} className="google-map" style={{ display: showGoogleMap ? "block" : "none" }} />
      <div id="fallbackMap" className="map-canvas" style={{ display: showGoogleMap ? "none" : "block" }}>
        {records.map((record, index) => {
          const pos = pseudoPosition(record, index);
          const label = record.kind === "job" ? "J" : record.kind === "lead" ? "L" : "C";
          return (
            <button key={`${record.kind}_${record.id}`} className={`map-pin ${record.kind}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }} title={record.name || (record as any).title} onClick={() => onPinClick(record)}>
              <span>{label}</span>
              <small>{record.zip || record.city || ""}</small>
            </button>
          );
        })}
        {!records.length && <div className="map-empty">No matching clients, leads, or jobs</div>}
      </div>
    </>
  );
}
