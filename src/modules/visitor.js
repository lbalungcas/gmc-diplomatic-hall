/**
 * The visitor's identity, shared by the 3D hall and the sailing opening: a stable id and display
 * name kept on the device, so the same phone is the same person in both.
 */
const PALETTE = ['#F4B400', '#4FA69C', '#7BA3D4', '#E8A87C', '#C4A4D8', '#6EC4B8'];

export function colorFromId(id) {
  const s = String(id ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function getVisitorInfo() {
  let id = localStorage.getItem('gmc_visitor_id');
  if (!id) {
    id = 'v-' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('gmc_visitor_id', id);
  }

  let name = localStorage.getItem('gmc_visitor_name');
  if (!name) {
    const num = Math.floor(100 + Math.random() * 900);
    name = `Delegate #${num}`;
    localStorage.setItem('gmc_visitor_name', name);
  }

  const color = colorFromId(id);
  return { id, name, color };
}
