const { request } = require('./apiClient');

const CONTACT_FORM_ID = process.env.CTX_API_CONTACT_FORM_ID || process.env.ctxApiContactFormId || null;
const CONTACT_FORM_LOCALE = process.env.CTX_DEFAULT_LOCALE || process.env.THEME_DEFAULT_LOCALE || 'tr';
const CONTACT_FORM_SLUG = process.env.CTX_API_CONTACT_FORM_SLUG || process.env.ctxApiContactFormSlug || null;
const CACHE_TTL_MS = Number(process.env.CONTACT_FORM_CACHE_TTL_MS || 5 * 60 * 1000);

let contactFormCache = {
  form: null,
  fetchedAt: 0,
  localeKey: null
};

function resolveText(value, localePreference) {
  if (!value) return '';
  if (typeof value === 'string') {
    return value;
  }

  const baseLocales = Array.isArray(localePreference)
    ? localePreference.filter(Boolean)
    : [localePreference].filter(Boolean);

  const locales = Array.from(
    new Set([
      ...baseLocales,
      CONTACT_FORM_LOCALE,
      'tr',
      'en'
    ].filter(Boolean))
  );

  for (const locale of locales) {
    if (locale && value[locale]) {
      return value[locale];
    }
  }

  const fallback = Object.values(value)[0];
  return fallback || '';
}

function normaliseOption(option, localePreference) {
  return {
    value: option.value,
    label: resolveText(option.label, localePreference)
  };
}

function normaliseField(field, localePreference) {
  const options = Array.isArray(field.options)
    ? field.options.map((opt) => normaliseOption(opt, localePreference))
    : [];

  const inferredOrder = typeof field.order === 'number' ? field.order : 0;

  return {
    id: field.id || field._id || field.name,
    name: field.name,
    type: field.type,
    label: resolveText(field.label, localePreference),
    placeholder: resolveText(field.placeholder, localePreference),
    helpText: resolveText(field.helpText, localePreference),
    required: Boolean(field.required),
    validation: field.validation || {},
    options,
    defaultValue: field.defaultValue,
    order: inferredOrder,
    width: field.width || 'full',
    className: field.className || ''
  };
}

function buildCacheEntry(form, localePreference) {
  if (!form) return null;

  const preferredLocales = Array.isArray(localePreference)
    ? localePreference
    : [localePreference];

  const fields = Array.isArray(form.fields)
    ? form.fields
        .map((field, index) => {
          const normalised = normaliseField(field, preferredLocales);
          if (normalised.order === undefined || normalised.order === null) {
            normalised.order = index;
          }
          normalised._originalIndex = index;
          return normalised;
        })
        .sort((a, b) => {
          if (a.order !== b.order) {
            return a.order - b.order;
          }
          return a._originalIndex - b._originalIndex;
        })
        .map(({ _originalIndex, ...rest }) => rest)
    : [];

  return {
    id: form._id || form.id || CONTACT_FORM_ID,
    slug: form.slug || CONTACT_FORM_SLUG || null,
    title: resolveText(form.title, preferredLocales),
    description: resolveText(form.description, preferredLocales),
    fields,
    settings: {
      submitButtonText: resolveText(form.settings?.submitButtonText, preferredLocales) || 'Gönder',
      successMessage: form.settings?.successMessage || {
        tr: 'Gönderiminiz için teşekkürler!',
        en: 'Thank you for your submission!'
      },
      enableHoneypot: form.settings?.enableHoneypot !== false
    }
  };
}

async function fetchPrivateForm(localePreference) {
  if (!CONTACT_FORM_ID) {
    return null;
  }

  const response = await request(`/forms/${CONTACT_FORM_ID}`, {
    allowNotFound: true
  });

  if (!response || !response.form) {
    console.warn('[ContactForm] Private fetch returned no form', {
      contactFormId: CONTACT_FORM_ID
    });
    return null;
  }

  return buildCacheEntry(response.form, localePreference);
}

async function fetchPublicForm(localePreference, slugCandidate) {
  const slug = slugCandidate || CONTACT_FORM_SLUG || CONTACT_FORM_ID;
  if (!slug) {
    return null;
  }

  try {
    const response = await request(`/public/forms/${slug}`, {
      allowNotFound: true,
      withApiKey: false
    });

    if (!response || !response.form) {
      console.warn('[ContactForm] Public fetch returned no form', {
        slug
      });
      return null;
    }

    return buildCacheEntry(response.form, localePreference);
  } catch (error) {
    console.error('Failed to fetch public contact form:', error);
    return null;
  }
}

async function fetchContactForm(localePreference) {
  let form = null;

  try {
    form = await fetchPrivateForm(localePreference);
  } catch (error) {
    console.warn('[ContactForm] Private fetch failed, falling back to public endpoint', {
      error: error.message
    });
  }

  if (!form) {
    form = await fetchPublicForm(localePreference);
  }

  if (!form) {
    console.error('[ContactForm] Failed to fetch form via ID or slug', {
      contactFormId: CONTACT_FORM_ID,
      contactFormSlug: CONTACT_FORM_SLUG
    });
  }

  return form;
}

async function getContactForm({ force = false, locale } = {}) {
  if (!CONTACT_FORM_ID) {
    if (!CONTACT_FORM_SLUG) {
      return null;
    }
  }

  const now = Date.now();
  const localePreference = Array.isArray(locale) ? locale : [locale];
  const localeKey = JSON.stringify(localePreference.filter(Boolean));

  if (
    !force &&
    contactFormCache.form &&
    now - contactFormCache.fetchedAt < CACHE_TTL_MS &&
    contactFormCache.localeKey === localeKey
  ) {
    return contactFormCache.form;
  }

  try {
    const form = await fetchContactForm(localePreference);
    contactFormCache = {
      form,
      fetchedAt: Date.now(),
      localeKey
    };
    return form;
  } catch (error) {
    console.error('Failed to fetch contact form:', error);
    if (contactFormCache.form) {
      return contactFormCache.form;
    }
    return null;
  }
}

function clearContactFormCache() {
  contactFormCache = {
    form: null,
    fetchedAt: 0,
    localeKey: null
  };
}

function normaliseCheckboxValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : String(item))).filter(Boolean);
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [typeof value === 'string' ? value : String(value)].filter(Boolean);
}

function buildSubmissionPayload(form, body, options = {}) {
  const localePreference = Array.isArray(options.localePreference)
    ? options.localePreference
    : [options.localePreference].filter(Boolean);

  const errors = {};
  const values = {};
  const data = {};

  if (!form || !Array.isArray(form.fields)) {
    return { errors: { form: 'Form is unavailable.' }, values: {}, data: {} };
  }

  for (const field of form.fields) {
    if (field.type === 'section') {
      continue;
    }

    if (field.type === 'file') {
      errors[field.name] = 'File uploads are not supported by this theme yet.';
      continue;
    }

  const rawValue = body[field.name];
  const hasUserValue = !(rawValue === undefined || rawValue === null || rawValue === '');
  const initialValue = hasUserValue ? rawValue : field.defaultValue;
  values[field.name] = initialValue;

    const displayName = field.label || field.name;
    const validationMessage = field.validation?.errorMessage
      ? resolveText(field.validation.errorMessage, localePreference)
      : null;

    const requiredMessage = validationMessage || `${displayName} alanı zorunludur.`;

    switch (field.type) {
      case 'checkbox': {
  const normalised = normaliseCheckboxValue(initialValue);
  values[field.name] = normalised;
        if (field.required && normalised.length === 0) {
          errors[field.name] = requiredMessage;
          break;
        }
        if (normalised.length > 0) {
          data[field.name] = normalised;
        }
        break;
      }
      case 'number':
      case 'rating': {
  const numericValue = typeof initialValue === 'string' ? initialValue.trim() : initialValue;
        if (numericValue === undefined || numericValue === null || numericValue === '') {
          if (field.required) {
            errors[field.name] = requiredMessage;
          }
          break;
        }
        const parsed = Number(numericValue);
        if (Number.isNaN(parsed)) {
          errors[field.name] = validationMessage || `${displayName} geçerli bir sayı olmalıdır.`;
          break;
        }
        data[field.name] = parsed;
        values[field.name] = numericValue;
        if (field.validation?.min !== undefined && parsed < field.validation.min) {
          errors[field.name] = validationMessage || `${displayName} ${field.validation.min} değerinden küçük olamaz.`;
        }
        if (field.validation?.max !== undefined && parsed > field.validation.max) {
          errors[field.name] = validationMessage || `${displayName} ${field.validation.max} değerinden büyük olamaz.`;
        }
        break;
      }
      case 'email': {
  const value = typeof initialValue === 'string' ? initialValue.trim() : '';
  values[field.name] = value;
        if (!value) {
          if (field.required) {
            errors[field.name] = requiredMessage;
          }
          break;
        }
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(value)) {
          errors[field.name] = validationMessage || 'Lütfen geçerli bir e-posta adresi girin.';
          break;
        }
        data[field.name] = value;
        break;
      }
      case 'phone': {
  const value = typeof initialValue === 'string' ? initialValue.trim() : '';
        values[field.name] = value;
        if (!value) {
          if (field.required) {
            errors[field.name] = requiredMessage;
          }
          break;
        }
        const phonePattern = /^[\d\s+().-]{6,}$/;
        if (!phonePattern.test(value)) {
          errors[field.name] = validationMessage || 'Lütfen geçerli bir telefon numarası girin.';
          break;
        }
        data[field.name] = value;
        break;
      }
      case 'select':
      case 'radio': {
  const value = typeof initialValue === 'string' ? initialValue.trim() : '';
        values[field.name] = value;
        if (!value) {
          if (field.required) {
            errors[field.name] = requiredMessage;
          }
          break;
        }
        if (field.options.length > 0 && !field.options.some((option) => option.value === value)) {
          errors[field.name] = validationMessage || `${displayName} için geçersiz seçim.`;
          break;
        }
        data[field.name] = value;
        break;
      }
      case 'date': {
        const value = typeof rawValue === 'string' ? rawValue.trim() : '';
        values[field.name] = value;
        if (!value) {
          if (field.required) {
            errors[field.name] = requiredMessage;
          }
          break;
        }
        data[field.name] = value;
        break;
      }
      case 'hidden': {
  let value = initialValue;
        if (value === undefined || value === null || value === '') {
          value = field.defaultValue ?? '';
          values[field.name] = value;
        }
        if (value !== undefined && value !== null && value !== '') {
          data[field.name] = value;
        }
        break;
      }
      default: {
  const value = typeof initialValue === 'string' ? initialValue.trim() : '';
        values[field.name] = value;
        if (!value) {
          if (field.required) {
            errors[field.name] = requiredMessage;
          }
          break;
        }
        data[field.name] = value;
      }
    }
  }

  return { errors, values, data };
}

async function submitContactForm({ data, locale, honeypot } = {}) {
  const apiKey = process.env.CTX_API_KEY || process.env.ctxApiKey || null;
  if (!apiKey) {
    throw new Error('ContextHub API key is not configured.');
  }

  const formId = CONTACT_FORM_ID;
  if (!formId) {
    throw new Error('Contact form ID is not configured.');
  }

  return request(`/public/forms/${CONTACT_FORM_ID}/submit`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey
    },
    body: {
      apiKey,
      data,
      locale: locale || CONTACT_FORM_LOCALE,
      source: 'web',
      honeypot: honeypot || ''
    }
  });
}

module.exports = {
  getContactForm,
  clearContactFormCache,
  buildSubmissionPayload,
  submitContactForm,
  resolveText
};
