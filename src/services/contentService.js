const { request } = require('./apiClient');
const { getTenant } = require('./tenantService');
const { formatDate, summariseText } = require('../utils/format');

const slugIndex = new Map();
const MAX_LOOKUP_PAGES = Number(process.env.CONTENT_LOOKUP_MAX_PAGES || 10);
const PAGE_SIZE = Number(process.env.CONTENT_PAGE_SIZE || 50);

function pickMedia(media, { prefer = null } = {}) {
  if (!media) return null;

  if (Array.isArray(media.variants) && media.variants.length > 0) {
    const preferred =
      (prefer && media.variants.find((variant) => variant.name === prefer)) ||
      media.variants.find((variant) => variant.name === 'large') ||
      media.variants.find((variant) => variant.name === 'medium') ||
      media.variants[0];
    if (preferred?.url) {
      return {
        url: preferred.url,
        width: preferred.width,
        height: preferred.height,
        alt: media.altText || media.caption || ''
      };
    }
  }

  if (media.url) {
    return {
      url: media.url,
      width: media.width,
      height: media.height,
      alt: media.altText || media.caption || ''
    };
  }

  return null;
}

function extractCategoryIds(list = []) {
  return list
    .map((value) => {
      if (!value) return null;
      if (typeof value === 'string') return value;
      if (value._id) return value._id.toString();
      return null;
    })
    .filter(Boolean);
}

function rememberContentMapping(content) {
  if (content?.slug && content?.id) {
    slugIndex.set(content.slug, content.id);
  }
  return content;
}

function normaliseListItem(item, { isLead = false } = {}) {
  const id = item._id || item.id;
  if (item.slug && id) {
    slugIndex.set(item.slug, id);
  }

  const preferVariant = isLead ? 'large' : 'medium';
  const heroImage = pickMedia(item.featuredMediaId || item.featuredMedia, { prefer: preferVariant });
  const publishDate = item.publishAt || item.publishedAt;

  return rememberContentMapping({
    id,
    title: item.title,
    slug: item.slug,
    summary: summariseText(item.summary || item.excerpt || item.title),
    publishDate,
    formattedPublishDate: formatDate(publishDate),
    heroImage,
    categoryIds: extractCategoryIds(item.categories)
  });
}

function normaliseDetail(item) {
  const heroImage = pickMedia(item.featuredMediaId || item.featuredMedia);
  const publishDate = item.publishAt || item.publishedAt;

  return rememberContentMapping({
    id: item._id || item.id,
    title: item.title,
    slug: item.slug,
    summary: summariseText(item.summary || item.title, 320),
    publishDate,
    formattedPublishDate: formatDate(publishDate),
    heroImage,
    html: item.html || '',
    categories: item.categories || [],
    categoryIds: extractCategoryIds(item.categories)
  });
}

async function ensureTenantId() {
  const tenant = getTenant();
  return tenant?.id || tenant?._id || null;
}

function normaliseCollection(response, { isLead = false } = {}) {
  const rawItems =
    response?.items ||
    response?.contents ||
    response?.data ||
    response?.results ||
    [];

  return rawItems
    .filter(Boolean)
    .map((item, index) => normaliseListItem(item, { isLead: isLead && index === 0 }));
}

async function getFeaturedContents(limit = 4) {
  const tenantId = await ensureTenantId();
  const response = await request('/contents', {
    searchParams: {
      tenant: tenantId,
      status: 'published',
      limit,
      page: 1
    }
  });

  return normaliseCollection(response, { isLead: true });
}

async function getContentsByCategory(categoryId, { page = 1, limit = 12 } = {}) {
  if (!categoryId) return { items: [], pagination: null };

  const response = await request('/contents', {
    searchParams: {
      status: 'published',
      category: categoryId,
      page,
      limit
    }
  });

  const items = normaliseCollection(response);

  return {
    items,
    pagination: response?.pagination || null
  };
}

async function getContentById(id) {
  if (!id) return null;
  const response = await request(`/contents/${id}`, { allowNotFound: true });
  if (!response?.content) {
    if (response && !response.content) {
      return normaliseDetail(response);
    }
    return null;
  }
  return normaliseDetail(response.content);
}

async function findContentIdBySlug(slug) {
  if (!slug) return null;

  if (slugIndex.has(slug)) {
    return slugIndex.get(slug);
  }

  let currentPage = 1;
  while (currentPage <= MAX_LOOKUP_PAGES) {
    const response = await request('/contents', {
      searchParams: {
        status: 'published',
        page: currentPage,
        limit: PAGE_SIZE
      }
    });

    const items = normaliseCollection(response);
    const match = items.find((item) => item.slug === slug);
    if (match?.id) {
      return match.id;
    }

    const totalPages = response?.pagination?.pages;
    if (!totalPages || currentPage >= totalPages) {
      break;
    }
    currentPage += 1;
  }

  return null;
}

async function getContent({ id, slug }) {
  let targetId = id;

  if (!targetId && slug) {
    targetId = await findContentIdBySlug(slug);
  }

  if (!targetId) return null;

  return getContentById(targetId);
}

module.exports = {
  getFeaturedContents,
  getContentsByCategory,
  getContent,
  searchContents: async function searchContents(query, { page = 1, limit = 12 } = {}) {
    const term = typeof query === 'string' ? query.trim() : '';
    if (!term) {
      return { items: [], pagination: null };
    }

    const response = await request('/contents', {
      searchParams: {
        status: 'published',
        search: term,
        page,
        limit
      }
    });

    const items = normaliseCollection(response);

    return {
      items,
      pagination: response?.pagination || null
    };
  }
};
