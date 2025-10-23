const { request } = require('./apiClient');

const MENU_CACHE_TTL_MS = Number(process.env.MENU_CACHE_TTL_MS || 5 * 60 * 1000);

const envConfigs = {
  primary: {
    id:
      process.env.THEME_MENU_ID ||
      process.env.MENU_ID ||
      null,
    slug:
      process.env.THEME_MENU_SLUG ||
      process.env.MENU_SLUG ||
      null
  },
  footer: {
    id: process.env.THEME_FOOTER_MENU_ID || null,
    slug: process.env.THEME_FOOTER_MENU_SLUG || null
  }
};

const menuCache = new Map();

function getCacheEntry(cacheKey) {
  if (!menuCache.has(cacheKey)) {
    menuCache.set(cacheKey, {
      menu: null,
      fetchedAt: 0
    });
  }
  return menuCache.get(cacheKey);
}

function resolveUrl(item = {}) {
  if (item.url) return item.url;
  if (item.type === 'external' && item.reference?.url) return item.reference.url;
  return null;
}

function normaliseId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return value._id.toString();
  if (value.id) return value.id.toString();
  return null;
}

function buildTree(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const lookup = new Map();
  items.forEach((item) => {
    const id = normaliseId(item._id || item.id);
    if (!id) return;
    lookup.set(id, {
      ...item,
      id,
      children: []
    });
  });

  const roots = [];

  lookup.forEach((item) => {
    const parentId = normaliseId(item.parentId);
    if (parentId && lookup.has(parentId)) {
      lookup.get(parentId).children.push(item);
    } else {
      roots.push(item);
    }
  });

  // sort by order within each level
  const sortChildren = (nodes) => {
    nodes.sort((a, b) => {
      const orderA = typeof a.order === 'number' ? a.order : 0;
      const orderB = typeof b.order === 'number' ? b.order : 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.title || '').localeCompare(b.title || '');
    });
    nodes.forEach((node) => sortChildren(node.children || []));
    return nodes;
  };

  return sortChildren(roots);
}

function mapMenuItem(item) {
  const href = resolveUrl(item);
  if (!href) return null;

  return {
    id: item._id || item.id,
    label: item.title,
    href,
    target: item.target || '_self',
    cssClasses: item.cssClasses || '',
    children: Array.isArray(item.children)
      ? item.children.map(mapMenuItem).filter(Boolean)
      : []
  };
}

function shapeMenuResponse(raw = {}, tree) {
  const items = Array.isArray(tree)
    ? tree.map(mapMenuItem).filter(Boolean)
    : [];

  return {
    id: raw._id || raw.id || null,
    name: raw.name || '',
    slug: raw.slug || null,
    items
  };
}

async function fetchMenuBySlug(slug) {
  if (!slug) {
    return null;
  }

  const response = await request(`/public/menus/slug/${slug}`, {
    allowNotFound: true
  });

  if (!response || response.error) {
    return null;
  }

  const tree = Array.isArray(response.tree) ? response.tree : buildTree(response.items || []);
  return shapeMenuResponse({ ...response, slug }, tree);
}

async function fetchMenuById(id) {
  if (!id) {
    return null;
  }

  const response = await request(`/menus/${id}`, {
    allowNotFound: true
  });

  if (!response || response.error) {
    return null;
  }

  const tree = buildTree(response.items || []);
  return shapeMenuResponse(response, tree);
}

async function ensureMenu({ cacheKey = 'primary', id, slug, force = false } = {}) {
  const entry = getCacheEntry(cacheKey);
  const now = Date.now();

  const config = envConfigs[cacheKey] || {};
  const resolvedId = id ?? config.id ?? null;
  const resolvedSlug = slug ?? config.slug ?? null;

  if (!resolvedId && !resolvedSlug) {
    entry.menu = null;
    entry.fetchedAt = now;
    return null;
  }

  const isCacheValid =
    !force &&
    entry.menu &&
    now - entry.fetchedAt < MENU_CACHE_TTL_MS &&
    ((resolvedId && entry.menu?.id === resolvedId) ||
      (resolvedSlug && entry.menu?.slug === resolvedSlug));

  if (isCacheValid) {
    return entry.menu;
  }

  try {
    let menu = null;

    if (resolvedId) {
      menu = await fetchMenuById(resolvedId);
    }

    if (!menu && resolvedSlug) {
      menu = await fetchMenuBySlug(resolvedSlug);
    }

    entry.menu = menu;
    entry.fetchedAt = Date.now();
    return menu;
  } catch (error) {
    if (entry.menu) {
      return entry.menu;
    }
    throw error;
  }
}

function getMenu(cacheKey = 'primary') {
  const entry = menuCache.get(cacheKey);
  return entry?.menu || null;
}

module.exports = {
  ensureMenu,
  getMenu
};
