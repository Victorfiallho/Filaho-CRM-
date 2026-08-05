import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Select from "../components/Select";
import { useCustomers, useInvalidateCompanyData, useJobs, useLeads } from "../data/hooks";
import { geocodeRecords } from "../data/geocoding";
import { groupBy, unique } from "../domain/format";
import { DEFAULT_MAP_FILTERS, matchesMapFilters } from "../domain/mapUtils";
import type { MapRecord } from "../domain/types";
import { toast } from "../lib/toast";
import { useCompany } from "../state/CompanyContext";
import { useMapFilters } from "../state/MapContext";
import { useModal } from "../state/ModalContext";

// Ported from app.js (renderMapRoutes, mapRecords, matchesMapFilters, mapPin,
// geocodeVisibleRecords, openMapRecord). Map tiles + geocoding were swapped
// from Google Maps to OpenStreetMap (Leaflet + Nominatim) at the user's
// request — no API key required — so the old "no key -> pseudo-position
// fallback canvas" branch (pseudoPosition, still in domain/mapUtils.ts if
// ever needed again) is gone; the real map always renders now.
export default function MapRoutes() {
  const { activeCompanyId, stages, services } = useCompany();
  const { data: customers = [] } = useCustomers(activeCompanyId);
  const { data: leads = [] } = useLeads(activeCompanyId);
  const { data: jobs = [] } = useJobs(activeCompanyId);
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

  const missingCoords = filtered.filter(r => !Number(r.lat) || !Number(r.lng)).length;

  const openMapRecord = (record: MapRecord) => openRecordModal(record.kind, record as any);

  const geocodeVisible = async () => {
    if (!activeCompanyId) return;
    const candidates = filtered.filter(r => !Number(r.lat) || !Number(r.lng));
    if (!candidates.length) { toast("All visible records already have coordinates."); return; }
    setGeocoding(true);
    try {
      const updated = await geocodeRecords(candidates, activeCompanyId);
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
          <div><h3>Company map</h3><span className="sub">OpenStreetMap tiles — no API key needed</span></div>
          <span className="pill">{filtered.length} records</span>
        </div>
        <div className="card-b">
          <MapFilterBar zips={zips} cities={cities} services={services} stages={stages} filters={mapFilters} onChange={setMapFilters} />
          <LeafletMapCanvas records={filtered} onPinClick={openMapRecord} />
          <div className="between" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <span className="sub">
              {missingCoords ? `${missingCoords} of ${filtered.length} visible records still need coordinates.` : "All visible records have coordinates."}
            </span>
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

function LeafletMapCanvas({ records, onPinClick }: { records: MapRecord[]; onPinClick: (r: MapRecord) => void }) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
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

  // Create the map once (Atlanta default center — same fallback app.js used).
  useEffect(() => {
    if (!mapElRef.current || mapInstanceRef.current) return;
    const map = L.map(mapElRef.current, { center: [33.749, -84.388], zoom: 9 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    mapInstanceRef.current = map;
    return () => { map.remove(); mapInstanceRef.current = null; };
  }, []);

  // Redraw markers whenever the visible/geocoded record set actually changes.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = withCoords.map(record => {
      const marker = L.circleMarker([Number(record.lat), Number(record.lng)], {
        radius: 9, color: "#fff", weight: 2, fillColor: PIN_COLOR[record.kind], fillOpacity: 1
      }).addTo(map);
      marker.bindTooltip(record.name || (record as any).title || record.kind);
      marker.on("click", () => onPinClickRef.current(record));
      return marker;
    });
    if (!hasFitRef.current && withCoords.length) {
      hasFitRef.current = true;
      if (withCoords.length > 1) {
        map.fitBounds(L.latLngBounds(withCoords.map(r => [Number(r.lat), Number(r.lng)] as [number, number])), { padding: [24, 24] });
      } else {
        map.setView([Number(withCoords[0].lat), Number(withCoords[0].lng)], 12);
      }
    }
  }, [withCoords]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={mapElRef} className="leaflet-map-canvas" />
      {!withCoords.length && <div className="map-empty">No geocoded records to show yet — click "Geocode visible records" below.</div>}
    </div>
  );
}
