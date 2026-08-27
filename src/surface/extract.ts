/**
 * Browser-side perception, injected into the page as a STRING (not a transpiled function).
 *
 * Why a string: bundlers (esbuild via tsx/vitest) rewrite named functions with a `__name(...)`
 * helper. Passing such a function to Playwright's evaluate ships that helper reference into the page,
 * where it doesn't exist — so extraction silently throws. A self-contained IIFE string is immune to
 * that across every runtime, including the real discovery run under tsx.
 *
 * Legacy pages have no ARIA/test-ids, so an element's usable "name" comes from its value/text or the
 * adjacent label cell of a two-column table. Each element is tagged with a data-cua-ref so the agent
 * can point at it and it can be re-resolved by ref (prompt-protocol A2).
 */
export interface RawElement {
  ref: string;
  role: "textbox" | "button" | "link" | "combobox" | "text";
  name: string;
  label?: string;
  attrs: { name?: string; id?: string; value?: string; href?: string; type?: string };
  editable: boolean;
}

/** `__OFFSET__` is replaced with a numeric start index so refs stay unique across frames. */
export const EXTRACT_SOURCE = `(() => {
  var start = __OFFSET__;
  var out = [];
  var n = start;
  document.querySelectorAll("[data-cua-ref]").forEach(function (e) { e.removeAttribute("data-cua-ref"); });
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function text(el) { return ((el && el.textContent) || "").replace(/\\s+/g, " ").trim(); }
  function labelFor(el) {
    var id = el.getAttribute("id");
    if (id) { var lab = document.querySelector('label[for="' + id + '"]'); if (lab) return text(lab); }
    var td = el.closest ? el.closest("td") : null;
    if (td && td.previousElementSibling) return text(td.previousElementSibling);
    return undefined;
  }
  function tag(el, role, name, label, editable) {
    var ref = "e" + n++;
    el.setAttribute("data-cua-ref", ref);
    var attrs = {};
    ["name", "id", "value", "href", "type"].forEach(function (a) {
      var v = el.getAttribute(a); if (v !== null) attrs[a] = v;
    });
    var rec = { ref: ref, role: role, name: name, attrs: attrs, editable: !!editable };
    if (label) rec.label = label;
    out.push(rec);
  }
  document.querySelectorAll("input, select, textarea, button, a[href]").forEach(function (el) {
    if (!visible(el)) return;
    var t = el.tagName.toLowerCase();
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (t === "a") return tag(el, "link", text(el), undefined, false);
    if (t === "button" || type === "submit" || type === "button" || type === "image")
      return tag(el, "button", el.getAttribute("value") || text(el), undefined, false);
    if (t === "select") { var l = labelFor(el); return tag(el, "combobox", l || el.getAttribute("name") || "", l, true); }
    var lab = labelFor(el);
    return tag(el, "textbox", lab || el.getAttribute("name") || "", lab, true);
  });
  document.querySelectorAll("tr").forEach(function (tr) {
    var cells = tr.querySelectorAll(":scope > td");
    if (cells.length === 2) {
      var label = text(cells[0]);
      var valueCell = cells[1];
      if (label && text(valueCell) && valueCell.querySelector("input,select,textarea,button,a") === null) {
        tag(valueCell, "text", text(valueCell), label, false);
      }
    }
  });
  return out;
})()`;
