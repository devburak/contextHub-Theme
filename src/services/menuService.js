const { request } = require('./apiClient');

const MENU_CACHE_TTL_MS = Number(process.env.MENU_CACHE_TTL_MS || 5 * 60 * 1000);
const menuSlugEnv =
  process.env.THEME_MENU_SLUG ||
  process.env.MENU_SLUG ||
  null;
const menuIdEnv =
  process.env.THEME_MENU_ID ||
  process.env.MENU_ID ||
  null;

let menuCache = {
  menu: null,
  fetchedAt: 0
};

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

async function ensureMenu({ force = false } = {}) {
  const now = Date.now();
  const isCacheValid =
    !force &&
    menuCache.menu &&
    now - menuCache.fetchedAt < MENU_CACHE_TTL_MS;

  if (isCacheValid) {
    return menuCache.menu;
  }

  try {
    let menu = null;

    if (menuIdEnv) {
      menu = await fetchMenuById(menuIdEnv);
    }

    if (!menu && menuSlugEnv) {
      menu = await fetchMenuBySlug(menuSlugEnv);
    }

    menuCache = {
      menu,
      fetchedAt: Date.now()
    };
    return menu;
  } catch (error) {
    if (menuCache.menu) {
      return menuCache.menu;
    }
    throw error;
  }
}

function getMenu() {
  return menuCache.menu;
}

module.exports = {
  ensureMenu,
  getMenu
};
