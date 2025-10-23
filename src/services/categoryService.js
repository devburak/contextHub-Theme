const { request } = require('./apiClient');

const CACHE_TTL_MS = Number(process.env.CATEGORIES_CACHE_TTL_MS || 5 * 60 * 1000);
const MAX_LIMIT = Number(process.env.CATEGORIES_FETCH_LIMIT || 200);

let categoryCache = {
  categories: [],
  slugMap: new Map(),
  idMap: new Map(),
  fetchedAt: 0
};

function normaliseId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return value._id.toString();
  return String(value);
}

function normaliseCategory(raw) {
  return {
    id: normaliseId(raw._id || raw.id),
    name: raw.name,
    slug: raw.slug,
    description: raw.description || '',
    parentId: normaliseId(raw.parentId),
    ancestors: Array.isArray(raw.ancestors) ? raw.ancestors.map(normaliseId).filter(Boolean) : [],
    position: typeof raw.position === 'number' ? raw.position : 0
  };
}

function updateCache(list) {
  const slugMap = new Map();
  const idMap = new Map();

  list.forEach((category) => {
    if (category.slug) {
      slugMap.set(category.slug, category);
    }
    if (category.id) {
      idMap.set(category.id, category);
    }
  });

  categoryCache = {
    categories: list,
    slugMap,
    idMap,
    fetchedAt: Date.now()
  };
}

async function fetchCategoriesFromApi() {
  const response = await request('/categories', {
    searchParams: {
      flat: 'true',
      limit: MAX_LIMIT
    }
  });

  const list =
    response?.categories ||
    response?.items ||
    [];

  const normalised = list
    .map(normaliseCategory)
    .sort((a, b) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      return a.name.localeCompare(b.name);
    });

  updateCache(normalised);
  return categoryCache.categories;
}

async function ensureCategories({ force } = {}) {
  const now = Date.now();
  if (
    !force &&
    categoryCache.categories.length > 0 &&
    now - categoryCache.fetchedAt < CACHE_TTL_MS
  ) {
    return categoryCache.categories;
  }

  try {
    return await fetchCategoriesFromApi();
  } catch (error) {
    if (categoryCache.categories.length) {
      return categoryCache.categories;
    }
    throw error;
  }
}

function getCategories() {
  return categoryCache.categories;
}

function getTopLevelCategories() {
  return categoryCache.categories.filter((category) => !category.parentId);
}

function getCategoryBySlug(slug) {
  if (!slug) return null;
  return categoryCache.slugMap.get(slug) || null;
}

function getCategoryById(id) {
  if (!id) return null;
  return categoryCache.idMap.get(id) || null;
}

function buildCategoryTrail(categoryIds = []) {
  return categoryIds
    .map((id) => getCategoryById(id))
    .filter(Boolean);
}

module.exports = {
  ensureCategories,
  getCategories,
  getTopLevelCategories,
  getCategoryBySlug,
  getCategoryById,
  buildCategoryTrail
};

