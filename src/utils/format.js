const { decode } = require('he');

function formatDate(value) {
  if (!value) return null;
  try {
    const date = new Date(value);
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(date);
  } catch (error) {
    return value;
  }
}

function stripHtml(value) {
  if (!value) return value;
  return value.replace(/<[^>]*>/g, '');
}

function summariseText(value, maxLength = 220) {
  if (!value) return '';
  const clean = stripHtml(decode(value));
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, maxLength).trimEnd()}…`;
}

function buildShareUrl(provider, { title, url }) {
  switch (provider) {
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        url
      )}`;
    case 'x':
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        title
      )}&url=${encodeURIComponent(url)}`;
    case 'pinterest':
      return `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(
        url
      )}&description=${encodeURIComponent(title)}`;
    case 'whatsapp':
      return `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
    default:
      return url;
  }
}

module.exports = {
  formatDate,
  summariseText,
  buildShareUrl
};

