"use client";

import { CITIES } from "@/lib/config";

export type PropertyType = "casa" | "apartamento";

/** Shared city-checkboxes + property-type select, used by Buscar and the discovery panel. */
export function CitiesAndTypeFields({
  cities,
  onToggleCity,
  propertyType,
  onChangePropertyType,
}: {
  cities: string[];
  onToggleCity: (slug: string) => void;
  propertyType: PropertyType;
  onChangePropertyType: (t: PropertyType) => void;
}) {
  return (
    <>
      <div>
        <label>Ciudades</label>
        {CITIES.map((c) => (
          <div className="checkbox-row" key={c.slug}>
            <input
              type="checkbox"
              id={`city-${c.slug}`}
              checked={cities.includes(c.slug)}
              onChange={() => onToggleCity(c.slug)}
            />
            <label htmlFor={`city-${c.slug}`}>{c.label}</label>
          </div>
        ))}
      </div>
      <div>
        <label>Tipo</label>
        <select
          value={propertyType}
          onChange={(e) => onChangePropertyType(e.target.value as PropertyType)}
        >
          <option value="casa">Casa</option>
          <option value="apartamento">Apartamento</option>
        </select>
      </div>
    </>
  );
}
