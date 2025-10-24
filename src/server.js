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
const {
  getContactForm,
  buildSubmissionPayload,
  submitContactForm,
  resolveText
} = require('./services/formService');
const { formatDate, buildShareUrl } = require('./utils/format');

const app = express();
const PORT = process.env.PORT || 3000;

const CONTACT_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const CONTACT_RATE_LIMIT_MAX = 5; // Max 5 submissions per minute per IP
const CONTACT_SUBMISSION_COOLDOWN_MS = 60 * 1000; // Minimum wait between submissions per IP
const contactRateLimitBuckets = new Map();
const contactSubmissionCooldowns = new Map();

const CONTACT_COPY_TR = {
  formUnavailable: 'İletişim formu şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.',
  validationErrorMessage: 'Lütfen formdaki hataları kontrol edin ve tekrar deneyin.',
  submissionErrorMessage: 'Gönderim sırasında bir hata oluştu. Lütfen daha sonra tekrar deneyin.',
  rateLimitMessage: 'Çok fazla deneme yaptınız. Lütfen biraz bekleyip tekrar deneyin.',
  cooldownDefaultMessage: 'Talebiniz alındı. Yeni bir gönderim için lütfen biraz bekleyin.',
  successDefaultMessage: 'Talebiniz başarıyla iletildi.',
  submitButtonText: 'Gönder',
  selectPlaceholder: 'Seçiniz',
  cooldownTextPrefix: 'Yeni bir gönderim yapmak için',
  cooldownTextSuffix: 'saniye bekleyin.',
  honeypotLabel: 'Bu alanı boş bırakın',
  pageHeadTitle: 'İletişim',
  pageHeroTagline: 'Bizimle İletişime Geçin',
  pageHeroHeading: 'İletişim Formu',
  pageHeroDescription: 'Sorularınız, önerileriniz veya geri bildirimleriniz için formu doldurmanız yeterli. En kısa sürede size dönüş yapacağız.',
  formTitleFallback: 'İletişim Formu',
  formDescriptionFallback: 'Sorularınız, önerileriniz veya geri bildirimleriniz için formu doldurmanız yeterli. En kısa sürede size dönüş yapacağız.',
  baselineFormTitleTr: 'İletişim Formu',
  baselineFormDescriptionTr: 'Sorularınız, önerileriniz veya geri bildirimleriniz için formu doldurmanız yeterli. En kısa sürede size dönüş yapacağız.'
};

const CONTACT_COPY_EN = {
  formUnavailable: 'The contact form is currently unavailable. Please try again later.',
  validationErrorMessage: 'Please check the errors in the form and try again.',
  submissionErrorMessage: 'Something went wrong while submitting. Please try again later.',
  rateLimitMessage: 'Too many attempts detected. Please wait a moment before trying again.',
  cooldownDefaultMessage: 'We received your request. Please wait a bit before sending another one.',
  successDefaultMessage: 'Your request has been submitted successfully.',
  submitButtonText: 'Submit',
  selectPlaceholder: 'Select an option',
  cooldownTextPrefix: 'Please wait',
  cooldownTextSuffix: 'seconds before submitting again.',
  honeypotLabel: 'Leave this field empty',
  pageHeadTitle: 'Contact',
  pageHeroTagline: 'Get in Touch',
  pageHeroHeading: 'Contact Form',
  pageHeroDescription: 'Share your questions, suggestions, or feedback and we will get back to you as soon as possible.',
  formTitleFallback: 'Contact Form',
  formDescriptionFallback: 'Complete the form with your questions, suggestions, or feedback and we will respond as soon as possible.',
  baselineFormTitleTr: 'İletişim Formu',
  baselineFormDescriptionTr: 'Sorularınız, önerileriniz veya geri bildirimleriniz için formu doldurmanız yeterli. En kısa sürede size dönüş yapacağız.'
};

function resolvePrimaryLocale(localePreference, res) {
  const normalise = (value) => String(value).toLowerCase();
  const preferenceList = Array.isArray(localePreference)
    ? localePreference.filter(Boolean).map(normalise)
    : [];

  const candidateLocales = [...preferenceList];

  const tenantLocale = res?.locals?.tenant?.defaultLocale;
  if (tenantLocale) {
    candidateLocales.push(normalise(tenantLocale));
  }

  const supportedPrefixes = ['en', 'tr'];
  for (const prefix of supportedPrefixes) {
    const match = candidateLocales.find((locale) => locale.startsWith(prefix));
    if (match) {
      return match;
    }
  }

  if (candidateLocales.length > 0) {
    return candidateLocales[0];
  }

  return 'tr';
}

function getContactCopy(localePreference, res) {
  const locale = resolvePrimaryLocale(localePreference, res);
  const baseCopy = locale.startsWith('en') ? CONTACT_COPY_EN : CONTACT_COPY_TR;
  return {
    ...baseCopy,
    locale
  };
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(compression());
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: true }));

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

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    tenant: res.locals.tenant?.slug || null
  });
});

function buildLocalePreference(req, res, state) {
  const locales = new Set();
  const tenantDefault = res.locals?.tenant?.defaultLocale;
  if (tenantDefault) {
    locales.add(tenantDefault);
  }

  if (state?.localePreference) {
    state.localePreference.filter(Boolean).forEach((item) => locales.add(item));
  }

  if (req.body && typeof req.body.locale === 'string' && req.body.locale.trim()) {
    locales.add(req.body.locale.trim());
  }

  const requestLocales = typeof req.acceptsLanguages === 'function' ? req.acceptsLanguages() : [];
  requestLocales.filter(Boolean).forEach((item) => locales.add(item));

  return Array.from(locales);
}

function getClientIp(req) {
  return (
    req.ip ||
    req.headers['x-forwarded-for'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function getCooldownRemainingMs(ipAddress) {
  const entry = contactSubmissionCooldowns.get(ipAddress);
  if (!entry) {
    return 0;
  }

  const remaining = entry.allowAt - Date.now();
  if (remaining <= 0) {
    contactSubmissionCooldowns.delete(ipAddress);
    return 0;
  }

  return remaining;
}

async function renderHomePage(req, res, next, options = {}) {
  try {
    const featuredContents = await getFeaturedContents(9);

    res.render('pages/home', {
      featuredContents
    });
  } catch (error) {
    next(error);
  }
}

app.get('/', (req, res, next) => {
  renderHomePage(req, res, next);
});

function enforceContactRateLimit(ipAddress) {
  const key = ipAddress || 'unknown';
  const now = Date.now();
  const bucket = contactRateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    contactRateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + CONTACT_RATE_LIMIT_WINDOW_MS
    });
    return;
  }

  if (bucket.count >= CONTACT_RATE_LIMIT_MAX) {
    const retryAfter = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
    const error = new Error('Rate limit exceeded');
    error.code = 'RateLimitExceeded';
    error.statusCode = 429;
    error.retryAfter = retryAfter;
    throw error;
  }

  bucket.count += 1;
}

async function renderContactPage(req, res, next, options = {}) {
  try {
    const { formState = null, contactFormOverride = null, localePreference = null } = options;
    const preferredLocales = Array.isArray(localePreference)
      ? [...localePreference]
      : buildLocalePreference(req, res, formState || null);

    const contactForm = contactFormOverride
      ? contactFormOverride
      : await getContactForm({ locale: preferredLocales });

    const contactCopy = getContactCopy(preferredLocales, res);

    if (!contactForm) {
      console.warn('[ContactPage] Contact form is not available.');
    } else {
      console.log('[ContactPage] Loaded contact form', {
        id: contactForm.id,
        slug: contactForm.slug,
        fieldCount: Array.isArray(contactForm.fields) ? contactForm.fields.length : 0
      });
    }

    res.render('pages/contact', {
      contactForm,
      contactFormState: formState,
      contactFormCopy: contactCopy
    });
  } catch (error) {
    next(error);
  }
}

app.get('/contact', (req, res, next) => {
  const localePreference = buildLocalePreference(req, res, null);
  const contactCopy = getContactCopy(localePreference, res);
  const ipAddress = getClientIp(req);
  const cooldownRemaining = getCooldownRemainingMs(ipAddress);
  const cooldownEntry = contactSubmissionCooldowns.get(ipAddress);

  if (cooldownRemaining > 0) {
    return renderContactPage(req, res, next, {
      formState: {
        status: 'success',
        message: cooldownEntry?.message || contactCopy.cooldownDefaultMessage,
        values: {},
        errors: {},
        localePreference: Array.isArray(localePreference) ? [...localePreference] : [],
        cooldownRemainingMs: cooldownRemaining,
        cooldownExpiresAt: Date.now() + cooldownRemaining
      },
      localePreference,
      contactFormOverride: null
    });
  }

  renderContactPage(req, res, next, { localePreference });
});

app.post('/contact', async (req, res, next) => {
  try {
    const localePreference = buildLocalePreference(req, res, null);
    const contactCopy = getContactCopy(localePreference, res);
    const ipAddress = getClientIp(req);
    const cooldownRemaining = getCooldownRemainingMs(ipAddress);
    if (cooldownRemaining > 0) {
      const cooldownEntry = contactSubmissionCooldowns.get(ipAddress);
      const contactFormDuringCooldown = await getContactForm({ locale: localePreference });
      return renderContactPage(req, res, next, {
        formState: {
          status: 'success',
          message: cooldownEntry?.message || contactCopy.cooldownDefaultMessage,
          values: {},
          errors: {},
          localePreference: Array.isArray(localePreference) ? [...localePreference] : [],
          cooldownRemainingMs: cooldownRemaining,
          cooldownExpiresAt: Date.now() + cooldownRemaining
        },
        contactFormOverride: contactFormDuringCooldown,
        localePreference
      });
    }

    const contactForm = await getContactForm({ locale: localePreference });

    if (!contactForm) {
      return renderContactPage(req, res, next, {
        formState: {
          status: 'error',
          message: contactCopy.formUnavailable,
          values: req.body || {},
          errors: {},
          localePreference: Array.isArray(localePreference) ? [...localePreference] : []
        },
        localePreference
      });
    }

    const honeypotValue = typeof req.body?.honeypot === 'string' ? req.body.honeypot.trim() : '';
    if (contactForm.settings?.enableHoneypot !== false && honeypotValue) {
      const successMessage = resolveText(contactForm.settings?.successMessage, localePreference);
      const cooldownUntil = Date.now() + CONTACT_SUBMISSION_COOLDOWN_MS;
      const cooldownRemainingMs = Math.max(0, cooldownUntil - Date.now());
      contactSubmissionCooldowns.set(ipAddress, {
        allowAt: cooldownUntil,
        message: successMessage || contactCopy.successDefaultMessage
      });

      return renderContactPage(req, res, next, {
        formState: {
          status: 'success',
          message: successMessage || contactCopy.successDefaultMessage,
          values: {},
          errors: {},
          localePreference: Array.isArray(localePreference) ? [...localePreference] : [],
          cooldownRemainingMs,
          cooldownExpiresAt: cooldownUntil
        },
        contactFormOverride: contactForm,
        localePreference
      });
    }

    const { errors, values, data } = buildSubmissionPayload(contactForm, req.body || {}, {
      localePreference
    });

    if (Object.keys(errors).length > 0) {
      return renderContactPage(req, res, next, {
        formState: {
          status: 'error',
          message: contactCopy.validationErrorMessage,
          errors,
          values,
          localePreference: Array.isArray(localePreference) ? [...localePreference] : []
        },
        contactFormOverride: contactForm,
        localePreference
      });
    }

    try {
      enforceContactRateLimit(ipAddress);

      const submissionResult = await submitContactForm({
        data,
        locale: localePreference?.[0],
        honeypot: honeypotValue
      });

      const successMessage = resolveText(
        submissionResult?.message || contactForm.settings?.successMessage,
        localePreference
      );

      const cooldownUntil = Date.now() + CONTACT_SUBMISSION_COOLDOWN_MS;
      const cooldownRemainingMs = Math.max(0, cooldownUntil - Date.now());
      contactSubmissionCooldowns.set(ipAddress, {
        allowAt: cooldownUntil,
        message: successMessage || contactCopy.successDefaultMessage
      });

      return renderContactPage(req, res, next, {
        formState: {
          status: 'success',
          message: successMessage || contactCopy.successDefaultMessage,
          values: {},
          errors: {},
          localePreference: Array.isArray(localePreference) ? [...localePreference] : [],
          cooldownRemainingMs,
          cooldownExpiresAt: cooldownUntil
        },
        contactFormOverride: contactForm,
        localePreference
      });
    } catch (error) {
      let message = contactCopy.submissionErrorMessage;

      if (error.body) {
        try {
          const parsed = JSON.parse(error.body);
          if (parsed?.message) {
            message = parsed.message;
          }
        } catch (_) {
          // Ignore JSON parse errors and fall back to default message
        }
      }

      if (error.status === 429 || error.code === 'RateLimitExceeded') {
        message = contactCopy.rateLimitMessage;
      }

      return renderContactPage(req, res, next, {
        formState: {
          status: 'error',
          message,
          errors: {},
          values,
          localePreference: Array.isArray(localePreference) ? [...localePreference] : []
        },
        contactFormOverride: contactForm,
        localePreference
      });
    }
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
