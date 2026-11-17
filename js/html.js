// Tiny HTML templating. Everything interpolated into html`...` is escaped
// unless it is itself the result of html`...` or raw(). Titles and synopses
// come from third parties, so nothing reaches the page unescaped by accident.

class Safe {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

export function raw(text) {
  return new Safe(String(text));
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Safe) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => { out += render(value) + strings[index + 1]; });
  return new Safe(out);
}
