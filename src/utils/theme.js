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

function buildThemeFromBranding(branding = {}) {
  const theme = {
    ...defaultTheme,
    siteUrl,
    siteName: branding.siteName || branding.name || defaultTheme.siteName,
    brandName: branding.name || defaultTheme.brandName,
    logoUrl: branding.logoUrl || defaultTheme.logoUrl,
    faviconUrl: branding.faviconUrl || defaultTheme.faviconUrl
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
