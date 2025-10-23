const defaultTheme = require('../config/themeDefaults');

function normalizeHex(color) {
  if (!color) return null;
  const value = color.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    return value.toUpperCase();
  }
  return null;
}

const siteUrl =
  process.env.SITE_URL ||
  process.env.CTX_SITE_URL ||
  process.env.ctxSiteUrl ||
  defaultTheme.siteUrl;

const envLogoLayout = (process.env.THEME_LOGO_LAYOUT || '').toLowerCase();
const allowedLogoLayouts = new Set(['fullwidth', 'inline']);
const logoLayout = allowedLogoLayouts.has(envLogoLayout) ? envLogoLayout : defaultTheme.logoLayout;

function buildThemeFromBranding(branding = {}) {
  const theme = {
    ...defaultTheme,
    siteUrl,
    siteName: branding.siteName || branding.name || defaultTheme.siteName,
    brandName: branding.name || defaultTheme.brandName,
    logoUrl: branding.logoUrl || defaultTheme.logoUrl,
    faviconUrl: branding.faviconUrl || defaultTheme.faviconUrl,
    logoLayout
  };

  const primary = normalizeHex(branding.primaryColor);
  const secondary = normalizeHex(branding.secondaryColor);

  if (primary) {
    theme.primaryColor = primary;
  }

  if (secondary) {
    theme.secondaryColor = secondary;
  } else if (primary) {
    theme.secondaryColor = primary;
  }

  return theme;
}

module.exports = {
  buildThemeFromBranding
};
