import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import de from './locales/de.json';
import en from './locales/en.json';

const resources = {
  de: { translation: de },
  en: { translation: en },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'de',
    supportedLngs: ['de', 'en'],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'l2m_language',
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false, // React handles XSS
    },
  });

export default i18n;
