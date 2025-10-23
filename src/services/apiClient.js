const { fetch, Headers } = require('undici');

const baseUrl = (
  process.env.CTX_API_BASE_URL ||
  process.env.CTX_API_URL ||
  'https://api.ctxhub.net/api'
).replace(/\/+$/, '');

const apiKey = process.env.CTX_API_KEY || process.env.ctxApiKey || null;
const tenantId = process.env.CTX_TENANT_ID || process.env.ctxTenantId || null;

function buildUrl(path, searchParams) {
  const normalisedPath = typeof path === 'string' ? path.replace(/^\/+/, '') : '';
  const url = new URL(normalisedPath, `${baseUrl}/`);
  if (searchParams) {
    const params = new URLSearchParams(searchParams);
    params.forEach((value, key) => {
      if (value === undefined || value === null || value === '') {
        params.delete(key);
      }
    });
    url.search = params.toString();
  }
  return url;
}

async function request(path, { method = 'GET', searchParams, body, headers = {}, allowNotFound = false } = {}) {
  const url = buildUrl(path, searchParams);
  const requestHeaders = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...headers
  });

  if (apiKey) {
    requestHeaders.set('Authorization', `Bearer ${apiKey}`);
  }

  if (tenantId) {
    requestHeaders.set('x-tenant-id', tenantId);
  }

  const options = {
    method,
    headers: requestHeaders
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(
      `ContextHub API request failed (${response.status} ${response.statusText})`
    );
    error.status = response.status;
    error.body = errorText;
    throw error;
  }

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse ContextHub API response for ${url}: ${error.message}`);
  }
}

module.exports = {
  request
};
