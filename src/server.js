require('dotenv').config();

const path = require('path');
const express = require('express');
const compression = require('compression');

const {
  loadTenantInfo,
  getTenant,
  getTheme,
  getBranding
} = require('./services/tenantService');
const {
  ensureCategories,
  getTopLevelCategories,
  getCategories,
  getCategoryBySlug,
  buildCategoryTrail
} = require('./services/categoryService');
const {
  ensureMenu,
  getMenu
} = require('./services/menuService');
const {
  getFeaturedContents,
  getContentsByCategory,
  getContent,
  searchContents
} = require('./services/contentService');
const { formatDate, buildShareUrl } = require('./utils/format');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(compression());
app.use(express.static(path.join(__dirname, '../public')));

app.use((req, res, next) => {
  res.locals.theme = getTheme();
  res.locals.tenant = getTenant();
  res.locals.branding = getBranding();
  res.locals.formatDate = formatDate;
  res.locals.currentPath = req.path;
  next();
});

app.use((req, res, next) => {
  Promise.all([
    ensureCategories().catch((error) => {
      console.error('Failed to refresh categories from API', error);
      return null;
    }),
    ensureMenu({ cacheKey: 'primary' }).catch((error) => {
      console.error('Failed to refresh menu from API', error);
      return null;
    }),
    ensureMenu({ cacheKey: 'footer' }).catch((error) => {
      console.error('Failed to refresh footer menu from API', error);
      return null;
    })
  ]).finally(() => {
    res.locals.categories = getTopLevelCategories();
    res.locals.allCategories = getCategories();
    res.locals.menu = getMenu('primary');
    res.locals.footerMenu = getMenu('footer');
    next();
  });
});

app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    tenant: res.locals.tenant?.slug || null
  });
});

app.get('/', async (req, res, next) => {
  try {
    const featuredContents = await getFeaturedContents(4);
    res.render('pages/home', {
      featuredContents
    });
  } catch (error) {
    next(error);
  }
});

app.get('/category/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const page = Number(req.query.page || 1);
    const category = getCategoryBySlug(slug);

    if (!category) {
      return res.status(404).render('pages/not-found', {
        message: 'The requested category could not be found.'
      });
    }

    const { items, pagination } = await getContentsByCategory(category.id, {
      page,
      limit: 12
    });

    return res.render('pages/category', {
      category,
      contents: items,
      pagination
    });
  } catch (error) {
    next(error);
  }
});

app.get('/content/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const content = await getContent({ slug });

    if (!content) {
      return res.status(404).render('pages/not-found', {
        message: 'Content could not be found.'
      });
    }

    const canonicalUrl = `${req.protocol}://${req.get('host')}/content/${content.slug}`;
    const shareLinks = [
      { provider: 'facebook', url: buildShareUrl('facebook', { title: content.title, url: canonicalUrl }) },
      { provider: 'x', url: buildShareUrl('x', { title: content.title, url: canonicalUrl }) },
      { provider: 'pinterest', url: buildShareUrl('pinterest', { title: content.title, url: canonicalUrl }) },
      { provider: 'whatsapp', url: buildShareUrl('whatsapp', { title: content.title, url: canonicalUrl }) }
    ];

    const categoryTrail = buildCategoryTrail(content.categoryIds);
    const breadcrumbs =
      categoryTrail.length > 0
        ? [
            { label: 'Home', href: '/' },
            { label: categoryTrail[0].name, href: `/category/${categoryTrail[0].slug}` },
            { label: content.title, href: null }
          ]
        : null;

    res.render('pages/content-detail', {
      content: {
        ...content,
        shareLinks,
        breadcrumbs,
        categories: categoryTrail
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/search', async (req, res, next) => {
  try {
    const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Number(req.query.page || 1);
    const limit = 12;
    let results = { items: [], pagination: null };

    if (term) {
      results = await searchContents(term, { page, limit });
    }

    res.render('pages/search', {
      term,
      results
    });
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('pages/error', {
    message: 'Something went wrong while loading the site.',
    error
  });
});

async function start() {
  try {
    await loadTenantInfo();
    await ensureCategories().catch((error) => {
      console.error('Failed to load initial categories:', error);
    });
    await ensureMenu({ cacheKey: 'primary' }).catch((error) => {
      console.error('Failed to load initial menu:', error);
    });
    await ensureMenu({ cacheKey: 'footer' }).catch((error) => {
      console.error('Failed to load initial footer menu:', error);
    });
  } catch (error) {
    console.error('Failed to load tenant info, falling back to defaults:', error);
  }

  app.listen(PORT, () => {
    console.log(`Theme server running at http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
