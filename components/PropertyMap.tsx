"use client";

import { useEffect } from "react";
import {
  APIProvider,
  Map,
  Marker,
  useMap,
} from "@vis.gl/react-google-maps";

export interface MapPoint {
  lat: number;
  lng: number;
  rank: number;
  title: string;
}

interface Props {
  refPoint: { lat: number; lng: number };
  maxDistKm: number;
  points: MapPoint[];
}

/** Draws the reference-point radius circle using the imperative Maps API. */
function RadiusCircle({ center, radiusKm }: { center: google.maps.LatLngLiteral; radiusKm: number }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const circle = new google.maps.Circle({
      map,
      center,
      radius: radiusKm * 1000,
      strokeColor: "#2563eb",
      strokeOpacity: 0.5,
      strokeWeight: 1,
      fillColor: "#2563eb",
      fillOpacity: 0.06,
    });
    return () => circle.setMap(null);
  }, [map, center, radiusKm]);
  return null;
}

export function PropertyMap({ refPoint, maxDistKm, points }: Props) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    return (
      <div className="map-wrap" style={{ display: "grid", placeItems: "center" }}>
        <div className="muted" style={{ textAlign: "center", padding: 20 }}>
          Mapa deshabilitado.<br />
          Define <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> en <code>.env</code> para verlo.
        </div>
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <APIProvider apiKey={key}>
        <Map
          defaultCenter={refPoint}
          defaultZoom={12}
          gestureHandling="greedy"
          disableDefaultUI={false}
          style={{ width: "100%", height: "100%" }}
        >
          <Marker
            position={refPoint}
            title="Punto de referencia"
            icon={{
              path: 0, // google.maps.SymbolPath.CIRCLE
              scale: 7,
              fillColor: "#16a34a",
              fillOpacity: 1,
              strokeColor: "#fff",
              strokeWeight: 2,
            }}
          />
          <RadiusCircle center={refPoint} radiusKm={maxDistKm} />
          {points.map((p, i) => (
            <Marker
              key={i}
              position={{ lat: p.lat, lng: p.lng }}
              title={`#${p.rank} ${p.title}`}
              label={{ text: String(p.rank), color: "#fff", fontSize: "11px" }}
            />
          ))}
        </Map>
      </APIProvider>
    </div>
  );
}
