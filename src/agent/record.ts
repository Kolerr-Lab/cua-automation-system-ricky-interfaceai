/**
 * Turn a perceived element into a ranked LocatorBundle (blueprint §6.4). This is where replay
 * robustness comes from: the artifact records intent-level, human-visible anchors (role+name, the
 * label of a field, the row a value sits in) — decoupled from the raw model transcript and from any
 * single brittle selector. Strategies are ordered robust→brittle; replay logs any fallback as drift.
 */
import type { Locator, LocatorBundle } from "../artifact/schema.js";
import type { ObservedElement } from "../surface/types.js";

export function synthesizeLocator(el: ObservedElement): LocatorBundle {
  const strategies: Locator[] = [];
  const invariants: LocatorBundle["invariants"] = { visible: true };

  if (el.role === "button" || el.role === "link") {
    const role = el.role;
    if (el.name) strategies.push({ by: "role", role, name: el.name });
    if (el.name) strategies.push({ by: "text", text: el.name });
    if (el.attrs.value) strategies.push({ by: "attr", name: "value", value: el.attrs.value });
    invariants.role = role;
    if (el.name) invariants.name = el.name;
  } else if (el.role === "textbox" || el.role === "combobox") {
    if (el.label) strategies.push({ by: "label", label: el.label });
    if (el.attrs.name) strategies.push({ by: "attr", name: "name", value: el.attrs.name });
    invariants.editable = true;
  } else {
    // A read-only labeled value: anchor on the row whose label cell matches.
    if (el.label) strategies.push({ by: "rowAnchor", header: "label", cell: el.label, targetCol: "value" });
  }

  if (el.attrs.id) strategies.push({ by: "attr", name: "id", value: el.attrs.id });
  if (strategies.length === 0) strategies.push({ by: "text", text: el.name });

  return { strategies, framePath: el.framePath, invariants };
}
