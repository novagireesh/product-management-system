export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function clean(query) {
  const out = {};
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return out;
}

export function qs(query) {
  const s = new URLSearchParams(clean(query)).toString();
  return s ? `?${s}` : '';
}

/** JSON API helper. Pass `form` (FormData) for uploads. */
export async function api(path, { method = 'GET', body, form, query, signal, headers: extra } = {}) {
  const headers = { 'X-PM-Client': '1', ...(extra || {}) };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}${qs(query)}`, { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth') && !path.startsWith('/public')) {
      window.dispatchEvent(new CustomEvent('pm:unauthorized'));
    }
    throw new ApiError((data && data.error) || res.statusText || 'Request failed', res.status, data);
  }
  return data;
}

/** POST JSON and download the binary response as a file. */
export async function downloadPost(path, body, fallbackName) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'X-PM-Client': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || 'Download failed', res.status);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  saveBlob(blob, name);
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Trigger a GET download through a plain link (cookies are sent automatically). */
export function downloadUrl(path, query) {
  const a = document.createElement('a');
  a.href = `/api${path}${qs(query)}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
