const { request } = require('./apiClient');
const { buildThemeFromBranding } = require('../utils/theme');

let tenantInfo = null;
let brandingInfo = null;
let theme = buildThemeFromBranding();

async function loadTenantInfo() {
  const data = await request('/tenant/info');
  tenantInfo = data?.tenant || null;
  brandingInfo = data?.branding || null;
  theme = buildThemeFromBranding(brandingInfo);
  return { tenant: tenantInfo, branding: brandingInfo, theme };
}

function getTenant() {
  return tenantInfo;
}

function getBranding() {
  return brandingInfo;
}

function getTheme() {
  return theme;
}

module.exports = {
  loadTenantInfo,
  getTenant,
  getBranding,
  getTheme
};

