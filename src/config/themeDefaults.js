const defaultTheme = {
  siteName: 'KESK English',
  brandName: 'KESK',
  siteUrl: 'https://en.kesk.org.tr',
  primaryColor: '#1E73BE',
  secondaryColor: '#0F172A',
  accentColor: '#38BDF8',
  backgroundColor: '#F1F5F9',
  surfaceColor: '#FFFFFF',
  textColor: '#0F172A',
  mutedTextColor: '#4B5563',
  borderColor: 'rgba(15, 23, 42, 0.12)',
  logoUrl: null,
  faviconUrl: null,
  navigation: [
    { label: 'Home', href: '/' },
    {
      label: 'Reports',
      href: '/#reports',
      children: [
        { label: 'Statements', href: '/#statements' },
        { label: 'Delegations', href: '/#delegations' }
      ]
    },
    { label: 'Contact', href: '/#contact' }
  ],
  hero: {
    headline: 'Building peace, equality and democracy',
    description:
      'Stay up to date with the latest activities, statements and reports from the Confederation of Public Employees Trade Union.'
  }
};

module.exports = defaultTheme;
